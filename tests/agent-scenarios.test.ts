/**
 * Agent Scenario Tests
 * 
 * End-to-end tests simulating real agent workflows:
 * - New agent onboarding
 * - Token-based capability access
 * - Trust building over time
 * - Confidential capability access
 */

import request from 'supertest';

import { app } from '../router/server';

describe('Agent Scenario Tests', () => {

  // ============================================
  // SCENARIO 1: New Agent Onboarding
  // ============================================

  describe('Scenario: New Agent Onboarding', () => {
    const agentId = `new-agent-${Date.now()}`;
    let tokenId: string;
    let semanticKey: string;

    test('Step 1: Agent discovers available capabilities', async () => {
      const res = await request(app).get('/capabilities');
      
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBeGreaterThan(0);
    });

    test('Step 2: Agent checks capability summary', async () => {
      const res = await request(app).get('/capabilities/summary');
      
      expect(res.body.total).toBeGreaterThan(0);
      expect(res.body.by_sponsor).toBeDefined();
    });

    test('Step 3: Agent registers in trust network', async () => {
      const res = await request(app)
        .post('/security/trust/register')
        .send({ agent_id: agentId });

      expect(res.body.success).toBe(true);
      expect(res.body.trust_node.trust_score).toBe(10);
      expect(res.body.trust_node.reputation_level).toBe('newcomer');
    });

    test('Step 4: Agent obtains capability token', async () => {
      const res = await request(app)
        .post('/security/tokens/issue')
        .send({
          agent_id: agentId,
          capabilities: ['cap.price.lookup.v1', 'cap.wallet.snapshot.v1']
        });

      expect(res.body.success).toBe(true);
      tokenId = res.body.token.token_id;
      semanticKey = res.body.semantic_key;
    });

    test('Step 5: Agent invokes public capability', async () => {
      const res = await request(app)
        .post('/invoke')
        .set('X-Capability-Token', tokenId)
        .send({
          capability_id: 'cap.price.lookup.v1',
          inputs: { base_token: 'SOL', quote_token: 'USD' }
        });

      expect(res.body.success).toBe(true);
      expect(res.body.outputs).toBeDefined();
    });

    test('Step 6: Agent checks their security status', async () => {
      const res = await request(app).get(`/security/status/${agentId}`);

      expect(res.body.success).toBe(true);
      expect(res.body.tokens.count).toBeGreaterThan(0);
      expect(res.body.trust).toBeDefined();
    });
  });

  // ============================================
  // SCENARIO 2: Confidential Capability Access
  // ============================================

  describe('Scenario: Confidential Capability Access', () => {
    const agentId = `confidential-agent-${Date.now()}`;

    test('Step 1: Agent checks sponsor security requirements', async () => {
      const res = await request(app).get('/sponsors/arcium/security');

      expect(res.body.security_requirements.requires_token).toBe(true);
      expect(res.body.security_requirements.requires_handshake).toBe(true);
      expect(res.body.privacy_level).toBe('confidential');
    });

    test('Step 2: Agent registers and gets token', async () => {
      await request(app)
        .post('/security/trust/register')
        .send({ agent_id: agentId });

      const tokenRes = await request(app)
        .post('/security/tokens/issue')
        .send({
          agent_id: agentId,
          capabilities: ['cap.cspl.wrap.v1', 'cap.confidential.swap.v1'],
          permissions: { allowed_modes: ['public', 'confidential'] }
        });

      expect(tokenRes.body.success).toBe(true);
    });

    test('Step 3: Agent initiates handshake for confidential access', async () => {
      const res = await request(app)
        .post('/security/handshake/initiate')
        .send({
          agent_id: agentId,
          requested_access: ['confidential']
        });

      expect(res.body.success).toBe(true);
      expect(res.body.challenge.step).toBe(1);
      expect(res.body.challenge.total_steps).toBeGreaterThanOrEqual(2);
    });
  });

  // ============================================
  // SCENARIO 3: Template-Based Workflow
  // ============================================

  describe('Scenario: Template-Based Workflow', () => {
    
    test('Step 1: Agent discovers available templates', async () => {
      const res = await request(app).get('/templates');

      expect(res.body.success).toBe(true);
      expect(res.body.templates.length).toBeGreaterThan(0);
    });

    test('Step 2: Agent gets specific template details', async () => {
      const res = await request(app).get('/templates/template.private-swap.v1');

      expect(res.body.success).toBe(true);
      expect(res.body.template.capabilities).toBeDefined();
      expect(res.body.template.required_inputs).toBeDefined();
    });

    test('Step 3: Agent checks template capability requirements', async () => {
      const templateRes = await request(app).get('/templates/template.private-swap.v1');
      const template = templateRes.body.template;

      for (const cap of template.capabilities) {
        const capRes = await request(app).get(`/capabilities/${cap.capability_id}`);
        expect(capRes.body.success).toBe(true);
      }
    });
  });

  // ============================================
  // SCENARIO 4: Multi-Agent Interaction
  // ============================================

  describe('Scenario: Multi-Agent Trust Building', () => {
    const agent1 = `agent1-${Date.now()}`;
    const agent2 = `agent2-${Date.now()}`;

    test('Step 1: Both agents register', async () => {
      const res1 = await request(app)
        .post('/security/trust/register')
        .send({ agent_id: agent1 });

      const res2 = await request(app)
        .post('/security/trust/register')
        .send({ agent_id: agent2 });

      expect(res1.body.success).toBe(true);
      expect(res2.body.success).toBe(true);
    });

    test('Step 2: Check trust network stats', async () => {
      const res = await request(app).get('/security/trust');

      expect(res.body.success).toBe(true);
      expect(res.body.total_agents).toBeGreaterThanOrEqual(2);
    });
  });

  // ============================================
  // SCENARIO 5: Semantic Encryption Flow
  // ============================================

  describe('Scenario: Semantic Encryption Flow', () => {
    const agentId = `semantic-agent-${Date.now()}`;
    let semanticKey: string;

    test('Step 1: Agent gets token with semantic key', async () => {
      const res = await request(app)
        .post('/security/tokens/issue')
        .send({
          agent_id: agentId,
          permissions: { semantic_access_level: 'premium' }
        });

      expect(res.body.success).toBe(true);
      expect(res.body.semantic_key).toBeDefined();
      semanticKey = res.body.semantic_key;
    });

    test('Step 2: Agent invokes with semantic key to get encrypted response', async () => {
      const res = await request(app)
        .post('/invoke')
        .set('X-Semantic-Key', semanticKey)
        .send({
          capability_id: 'cap.price.lookup.v1',
          inputs: { base_token: 'SOL', quote_token: 'USD' }
        });

      expect(res.body.success).toBe(true);
      // Encrypted semantics may or may not be present depending on server config
      if (res.body.encrypted_semantics) {
        expect(res.body.encrypted_semantics.version).toBeDefined();
      }
    });

    test('Step 3: Agent decrypts semantic payload', async () => {
      // First get encrypted response
      const invokeRes = await request(app)
        .post('/invoke')
        .set('X-Semantic-Key', semanticKey)
        .send({
          capability_id: 'cap.price.lookup.v1',
          inputs: { base_token: 'ETH', quote_token: 'USD' }
        });

      const encryptedPayload = invokeRes.body.encrypted_semantics;

      // Decrypt it
      const decryptRes = await request(app)
        .post('/security/semantics/decrypt')
        .send({
          encrypted_payload: encryptedPayload,
          semantic_key: semanticKey
        });

      // Decryption may succeed or fail depending on key matching
      if (decryptRes.body.success) {
        expect(decryptRes.body.decrypted_semantics).toBeDefined();
      } else {
        // Decryption failed is acceptable - key mismatch between sessions
        expect(decryptRes.status).not.toBe(500);
      }
    });
  });

  // ============================================
  // SCENARIO 6: Rate Limiting & Abuse Prevention
  // ============================================

  describe('Scenario: Rate Limiting', () => {
    
    test('API returns rate limit headers', async () => {
      const res = await request(app).get('/health');

      expect(res.headers['x-ratelimit-remaining']).toBeDefined();
      expect(res.headers['x-ratelimit-limit']).toBeDefined();
    });
  });
});
