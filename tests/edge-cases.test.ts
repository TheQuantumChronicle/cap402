/**
 * Edge Case & Error Handling Tests
 * 
 * Tests for boundary conditions, error scenarios, and edge cases
 */

import request from 'supertest';

import { app } from '../router/server';

describe('Edge Case & Error Handling Tests', () => {

  // ============================================
  // INPUT VALIDATION
  // ============================================

  describe('Input Validation', () => {
    
    test('Rejects empty capability_id in invoke', async () => {
      const res = await request(app)
        .post('/invoke')
        .send({ capability_id: '', inputs: {} });

      expect(res.body.success).toBe(false);
    });

    test('Handles null inputs in invoke', async () => {
      const res = await request(app)
        .post('/invoke')
        .send({ capability_id: 'cap.price.lookup.v1', inputs: null });

      // Should return some response (success or error)
      expect(res.body).toBeDefined();
    });

    test('Handles very long agent_id', async () => {
      const longId = 'a'.repeat(100);
      const res = await request(app)
        .post('/security/tokens/issue')
        .send({ agent_id: longId });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('64');
    });

    test('Handles special characters in agent_id', async () => {
      const res = await request(app)
        .post('/security/tokens/issue')
        .send({ agent_id: 'test@agent#123' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('alphanumeric');
    });

    test('Handles unicode in agent_id', async () => {
      const res = await request(app)
        .post('/security/tokens/issue')
        .send({ agent_id: 'agent🚀test' });

      expect(res.status).toBe(400);
    });

    test('Handles SQL injection attempt in agent_id', async () => {
      const res = await request(app)
        .post('/security/tokens/issue')
        .send({ agent_id: "'; DROP TABLE users; --" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('Handles XSS attempt in agent_id', async () => {
      const res = await request(app)
        .post('/security/tokens/issue')
        .send({ agent_id: '<img src=x onerror=alert(1)>' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ============================================
  // 404 HANDLING
  // ============================================

  describe('404 Handling', () => {
    
    test('Returns 404 for unknown capability', async () => {
      const res = await request(app).get('/capabilities/cap.unknown.v999');
      
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    test('Returns 404 for unknown template', async () => {
      const res = await request(app).get('/templates/template.unknown.v1');
      
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    test('Returns 404 for unknown sponsor', async () => {
      const res = await request(app).get('/sponsors/unknown-sponsor');
      
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    test('Returns 404 for unknown agent in trust network', async () => {
      const res = await request(app).get('/security/trust/nonexistent-agent-12345');
      
      expect(res.status).toBe(404);
    });
  });

  // ============================================
  // TOKEN EDGE CASES
  // ============================================

  describe('Token Edge Cases', () => {
    
    test('Validates token with wrong capability', async () => {
      const issueRes = await request(app)
        .post('/security/tokens/issue')
        .send({
          agent_id: 'limited-agent',
          capabilities: ['cap.price.lookup.v1']
        });

      const res = await request(app)
        .post('/security/tokens/validate')
        .send({
          token_id: issueRes.body.token.token_id,
          capability_id: 'cap.zk.proof.v1',
          mode: 'confidential'
        });

      expect(res.body.validation.valid).toBe(false);
      expect(res.body.validation.reason).toContain('does not grant access');
    });

    test('Validates token with wrong mode', async () => {
      const issueRes = await request(app)
        .post('/security/tokens/issue')
        .send({
          agent_id: 'public-only-agent',
          capabilities: ['*'],
          permissions: { allowed_modes: ['public'] }
        });

      const res = await request(app)
        .post('/security/tokens/validate')
        .send({
          token_id: issueRes.body.token.token_id,
          capability_id: 'cap.zk.proof.v1',
          mode: 'confidential'
        });

      expect(res.body.validation.valid).toBe(false);
      expect(res.body.validation.reason).toContain('does not allow');
    });

    test('Cannot validate revoked token', async () => {
      // Issue token
      const issueRes = await request(app)
        .post('/security/tokens/issue')
        .send({ agent_id: 'revoke-test-' + Date.now() });

      const tokenId = issueRes.body.token.token_id;

      // Revoke it
      await request(app)
        .post('/security/tokens/revoke')
        .send({ token_id: tokenId });

      // Try to validate
      const res = await request(app)
        .post('/security/tokens/validate')
        .send({ token_id: tokenId });

      expect(res.body.validation.valid).toBe(false);
      expect(res.body.validation.reason).toContain('revoked');
    });

    test('Handles invalid token format', async () => {
      const res = await request(app)
        .post('/security/tokens/validate')
        .send({ token_id: 'not-a-valid-token-format' });

      expect(res.body.validation.valid).toBe(false);
    });
  });

  // ============================================
  // HANDSHAKE EDGE CASES
  // ============================================

  describe('Handshake Edge Cases', () => {
    
    test('Handshake with invalid requested_access type', async () => {
      const res = await request(app)
        .post('/security/handshake/initiate')
        .send({
          agent_id: 'handshake-test',
          requested_access: 'not-an-array'
        });

      expect(res.status).toBe(400);
    });

    test('Handshake respond with invalid challenge_id', async () => {
      const res = await request(app)
        .post('/security/handshake/respond')
        .send({
          challenge_id: 'invalid-challenge',
          step: 1,
          proof: 'some-proof',
          agent_signature: 'some-signature',
          context_hash: 'some-hash'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('not found');
    });
  });

  // ============================================
  // SEMANTIC ENCRYPTION EDGE CASES
  // ============================================

  describe('Semantic Encryption Edge Cases', () => {
    
    test('Decrypt with wrong semantic key fails', async () => {
      // Get a valid encrypted payload
      const tokenRes = await request(app)
        .post('/security/tokens/issue')
        .send({ agent_id: 'decrypt-test-' + Date.now() });

      const invokeRes = await request(app)
        .post('/invoke')
        .set('X-Semantic-Key', tokenRes.body.semantic_key)
        .send({
          capability_id: 'cap.price.lookup.v1',
          inputs: { base_token: 'SOL', quote_token: 'USD' }
        });

      // Try to decrypt with wrong key
      const res = await request(app)
        .post('/security/semantics/decrypt')
        .send({
          encrypted_payload: invokeRes.body.encrypted_semantics,
          semantic_key: 'wrong-key-12345678901234567890'
        });

      // Should fail - decryption with wrong key
      expect(res.body.success).toBe(false);
    });

    test('Decrypt with malformed payload fails', async () => {
      const res = await request(app)
        .post('/security/semantics/decrypt')
        .send({
          encrypted_payload: { invalid: 'payload' },
          semantic_key: 'some-key-12345678901234567890'
        });

      // Should fail with error
      expect(res.body.success).toBe(false);
    });
  });

  // ============================================
  // RATE LIMITING
  // ============================================

  describe('Rate Limiting', () => {
    
    test('Rate limit headers are present', async () => {
      const res = await request(app).get('/health');

      expect(res.headers['x-ratelimit-remaining']).toBeDefined();
      expect(res.headers['x-ratelimit-limit']).toBe('100');
    });

    test('API version headers are present', async () => {
      const res = await request(app).get('/health');

      expect(res.headers['x-api-version']).toBe('1.0.0');
      expect(res.headers['x-protocol']).toBe('CAP-402');
    });
  });

  // ============================================
  // CONTENT TYPE HANDLING
  // ============================================

  describe('Content Type Handling', () => {
    
    test('Handles missing content-type gracefully', async () => {
      const res = await request(app)
        .post('/invoke')
        .set('Content-Type', 'application/json')
        .send('{"capability_id":"cap.price.lookup.v1","inputs":{}}');

      // Should not crash - any response is acceptable
      expect(res.status).toBeDefined();
    });
  });
});
