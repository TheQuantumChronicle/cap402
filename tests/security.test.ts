/**
 * Security Endpoint Tests
 * 
 * Tests for all security-related functionality:
 * - Capability tokens
 * - Trust network
 * - Handshake protocol
 * - Semantic encryption
 * - Audit logging
 */

import request from 'supertest';
import { app } from '../router/server';

describe('CAP-402 Security Tests', () => {

  // ============================================
  // CAPABILITY TOKENS
  // ============================================

  describe('Capability Tokens', () => {
    let testTokenId: string;
    let testSemanticKey: string;

    test('POST /security/tokens/issue - Issues new token', async () => {
      const res = await request(app)
        .post('/security/tokens/issue')
        .send({
          agent_id: 'test-agent-security',
          capabilities: ['cap.price.lookup.v1'],
          permissions: {
            semantic_access_level: 'advanced',
            allowed_modes: ['public', 'confidential']
          }
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.token.token_id).toBeDefined();
      expect(res.body.semantic_key).toBeDefined();
      
      testTokenId = res.body.token.token_id;
      testSemanticKey = res.body.semantic_key;
    });

    test('POST /security/tokens/issue - Rejects invalid agent_id', async () => {
      const res = await request(app)
        .post('/security/tokens/issue')
        .send({
          agent_id: '<script>alert(1)</script>'
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('alphanumeric');
    });

    test('POST /security/tokens/issue - Rejects missing agent_id', async () => {
      const res = await request(app)
        .post('/security/tokens/issue')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('POST /security/tokens/validate - Validates existing token', async () => {
      // First issue a token
      const issueRes = await request(app)
        .post('/security/tokens/issue')
        .send({ agent_id: 'validate-test-agent' });

      const res = await request(app)
        .post('/security/tokens/validate')
        .send({
          token_id: issueRes.body.token.token_id,
          capability_id: 'cap.price.lookup.v1',
          mode: 'public'
        });

      expect(res.status).toBe(200);
      expect(res.body.validation.valid).toBe(true);
    });

    test('POST /security/tokens/validate - Rejects invalid token', async () => {
      const res = await request(app)
        .post('/security/tokens/validate')
        .send({
          token_id: 'invalid-token-12345',
          capability_id: 'cap.price.lookup.v1'
        });

      expect(res.status).toBe(200);
      expect(res.body.validation.valid).toBe(false);
    });

    test('POST /security/tokens/revoke - Revokes token', async () => {
      // First issue a token
      const issueRes = await request(app)
        .post('/security/tokens/issue')
        .send({ agent_id: 'revoke-test-agent' });

      const tokenId = issueRes.body.token.token_id;

      const res = await request(app)
        .post('/security/tokens/revoke')
        .send({
          token_id: tokenId,
          reason: 'test revocation'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify token is now invalid
      const validateRes = await request(app)
        .post('/security/tokens/validate')
        .send({ token_id: tokenId });

      expect(validateRes.body.validation.valid).toBe(false);
      expect(validateRes.body.validation.reason).toContain('revoked');
    });
  });

  // ============================================
  // TRUST NETWORK
  // ============================================

  describe('Trust Network', () => {
    
    test('POST /security/trust/register - Registers new agent', async () => {
      const res = await request(app)
        .post('/security/trust/register')
        .send({ agent_id: 'trust-test-agent-' + Date.now() });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.trust_node.trust_score).toBe(10);
      expect(res.body.trust_node.reputation_level).toBe('newcomer');
    });

    test('POST /security/trust/register - Rejects invalid agent_id', async () => {
      const res = await request(app)
        .post('/security/trust/register')
        .send({ agent_id: 'invalid agent id with spaces' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('GET /security/trust/:id - Returns trust info', async () => {
      // First register
      const agentId = 'trust-lookup-' + Date.now();
      await request(app)
        .post('/security/trust/register')
        .send({ agent_id: agentId });

      const res = await request(app).get(`/security/trust/${agentId}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.trust_score).toBeDefined();
      expect(res.body.reputation_level).toBe('newcomer');
    });

    test('GET /security/trust - Returns network stats', async () => {
      const res = await request(app).get('/security/trust');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.total_agents).toBeDefined();
      expect(res.body.by_level).toBeDefined();
    });
  });

  // ============================================
  // HANDSHAKE PROTOCOL
  // ============================================

  describe('Handshake Protocol', () => {
    
    test('POST /security/handshake/initiate - Starts handshake', async () => {
      const res = await request(app)
        .post('/security/handshake/initiate')
        .send({
          agent_id: 'handshake-test-agent',
          requested_access: ['confidential']
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.session_id).toBeDefined();
      expect(res.body.challenge).toBeDefined();
      expect(res.body.challenge.step).toBe(1);
      expect(res.body.challenge.total_steps).toBeGreaterThanOrEqual(2);
    });

    test('POST /security/handshake/initiate - Rejects invalid agent_id', async () => {
      const res = await request(app)
        .post('/security/handshake/initiate')
        .send({ agent_id: '' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ============================================
  // SEMANTIC ENCRYPTION
  // ============================================

  describe('Semantic Encryption', () => {
    
    test('POST /security/semantics/decrypt - Requires payload and key', async () => {
      const res = await request(app)
        .post('/security/semantics/decrypt')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('required');
    });

    test('POST /security/semantics/verify-action - Requires action and nonce', async () => {
      const res = await request(app)
        .post('/security/semantics/verify-action')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('required');
    });
  });

  // ============================================
  // AUDIT LOG
  // ============================================

  describe('Audit Log', () => {
    
    test('GET /security/audit - Returns audit stats', async () => {
      const res = await request(app).get('/security/audit');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.stats).toBeDefined();
      expect(res.body.stats.total_events).toBeDefined();
      expect(res.body.stats.events_by_severity).toBeDefined();
    });

    test('GET /security/audit/:agent_id - Returns agent events', async () => {
      const res = await request(app).get('/security/audit/test-agent');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.events)).toBe(true);
    });
  });

  // ============================================
  // SECURITY STATUS
  // ============================================

  describe('Security Status', () => {
    
    test('GET /security/status/:agent_id - Returns full security status', async () => {
      // First issue a token and register in trust network
      const agentId = 'status-test-' + Date.now();
      
      await request(app)
        .post('/security/tokens/issue')
        .send({ agent_id: agentId });

      await request(app)
        .post('/security/trust/register')
        .send({ agent_id: agentId });

      const res = await request(app).get(`/security/status/${agentId}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.tokens).toBeDefined();
      expect(res.body.trust).toBeDefined();
      expect(res.body.access).toBeDefined();
    });
  });
});
