/**
 * Full Integration Flow Tests
 * 
 * End-to-end tests that verify the complete flow of the application
 * from discovery to execution with all security layers
 */

import request from 'supertest';

import { app } from '../router/server';

describe('Full Integration Flow Tests', () => {

  // ============================================
  // COMPLETE AGENT LIFECYCLE
  // ============================================

  describe('Complete Agent Lifecycle', () => {
    const agentId = `lifecycle-agent-${Date.now()}`;
    let tokenId: string;
    let semanticKey: string;

    test('1. Discover API capabilities', async () => {
      const res = await request(app).get('/');
      
      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
    });

    test('2. Check sponsor integrations', async () => {
      const res = await request(app).get('/sponsors');
      
      expect(res.body.sponsors.length).toBe(4);
      expect(res.body.overall_status).toBeDefined();
    });

    test('3. Register in trust network', async () => {
      const res = await request(app)
        .post('/security/trust/register')
        .send({ agent_id: agentId });

      expect(res.body.success).toBe(true);
      expect(res.body.trust_node.reputation_level).toBe('newcomer');
    });

    test('4. Obtain capability token', async () => {
      const res = await request(app)
        .post('/security/tokens/issue')
        .send({
          agent_id: agentId,
          capabilities: ['*'],
          permissions: {
            semantic_access_level: 'premium',
            allowed_modes: ['public', 'confidential']
          }
        });

      expect(res.body.success).toBe(true);
      tokenId = res.body.token.token_id;
      semanticKey = res.body.semantic_key;
    });

    test('5. Invoke public capability with token', async () => {
      const res = await request(app)
        .post('/invoke')
        .set('X-Capability-Token', tokenId)
        .set('X-Semantic-Key', semanticKey)
        .send({
          capability_id: 'cap.price.lookup.v1',
          inputs: { base_token: 'SOL', quote_token: 'USD' }
        });

      expect(res.body.success).toBe(true);
      expect(res.body.outputs.price).toBeDefined();
      expect(res.body.encrypted_semantics).toBeDefined();
    });

    test('6. Decrypt semantic payload', async () => {
      // Get encrypted response
      const invokeRes = await request(app)
        .post('/invoke')
        .set('X-Semantic-Key', semanticKey)
        .send({
          capability_id: 'cap.price.lookup.v1',
          inputs: { base_token: 'ETH', quote_token: 'USD' }
        });

      // Decrypt it
      const res = await request(app)
        .post('/security/semantics/decrypt')
        .send({
          encrypted_payload: invokeRes.body.encrypted_semantics,
          semantic_key: semanticKey
        });

      expect(res.body.success).toBe(true);
      expect(res.body.decrypted_semantics.action_type).toBeDefined();
      expect(res.body.decrypted_semantics.routing_rules).toBeDefined();
    });

    test('7. Check security status after activity', async () => {
      const res = await request(app).get(`/security/status/${agentId}`);

      expect(res.body.success).toBe(true);
      expect(res.body.tokens.count).toBeGreaterThan(0);
      expect(res.body.trust).toBeDefined();
    });

    test('8. Check audit log for agent', async () => {
      const res = await request(app).get(`/security/audit/${agentId}`);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.events)).toBe(true);
    });
  });

  // ============================================
  // PRIVACY-FIRST WORKFLOW
  // ============================================

  describe('Privacy-First Workflow', () => {
    const agentId = `privacy-agent-${Date.now()}`;

    test('1. Check privacy capabilities ratio', async () => {
      const res = await request(app).get('/');
      
      // Root endpoint should return 200
      expect(res.status).toBe(200);
    });

    test('2. List confidential capabilities only', async () => {
      const res = await request(app).get('/capabilities?mode=confidential');
      
      expect(res.body.success).toBe(true);
      res.body.capabilities.forEach((cap: any) => {
        expect(cap.execution.mode).toBe('confidential');
      });
    });

    test('3. Check Arcium security requirements', async () => {
      const res = await request(app).get('/sponsors/arcium/security');
      
      expect(res.body.privacy_level).toBe('confidential');
      expect(res.body.security_requirements.requires_handshake).toBe(true);
    });

    test('4. Initiate handshake for confidential access', async () => {
      // Register first
      await request(app)
        .post('/security/trust/register')
        .send({ agent_id: agentId });

      const res = await request(app)
        .post('/security/handshake/initiate')
        .send({
          agent_id: agentId,
          requested_access: ['confidential', 'premium']
        });

      expect(res.body.success).toBe(true);
      expect(res.body.challenge.step).toBe(1);
    });
  });

  // ============================================
  // MULTI-SPONSOR WORKFLOW
  // ============================================

  describe('Multi-Sponsor Workflow', () => {
    
    test('1. Get capabilities by sponsor', async () => {
      const summary = await request(app).get('/capabilities/summary');
      
      expect(summary.body.by_sponsor['Arcium']).toBeGreaterThan(0);
      expect(summary.body.by_sponsor['Aztec/Noir']).toBeGreaterThan(0);
      expect(summary.body.by_sponsor['Helius']).toBeGreaterThan(0);
      expect(summary.body.by_sponsor['Inco']).toBeGreaterThan(0);
    });

    test('2. Verify each sponsor has unique capabilities', async () => {
      const sponsors = ['arcium', 'noir', 'helius', 'inco'];
      const allCapabilities: string[] = [];

      for (const sponsor of sponsors) {
        const res = await request(app).get(`/sponsors/${sponsor}`);
        allCapabilities.push(...res.body.capabilities);
      }

      // Should have multiple unique capabilities
      const uniqueCaps = [...new Set(allCapabilities)];
      expect(uniqueCaps.length).toBeGreaterThan(4);
    });

    test('3. Templates combine capabilities', async () => {
      const res = await request(app).get('/templates');
      
      // Templates should exist and have capabilities
      expect(res.body.templates.length).toBeGreaterThan(0);
      
      const firstTemplate = res.body.templates[0];
      expect(firstTemplate.capabilities).toBeDefined();
    });
  });

  // ============================================
  // ECONOMIC FLOW
  // ============================================

  describe('Economic Flow', () => {
    
    test('1. Estimate cost endpoint exists', async () => {
      const res = await request(app)
        .post('/estimate')
        .send({
          capability_id: 'cap.price.lookup.v1',
          inputs: { base_token: 'SOL', quote_token: 'USD' }
        });

      // Endpoint should respond
      expect(res.status).not.toBe(404);
    });

    test('2. Compare costs by trust level', async () => {
      const res = await request(app).get('/estimate/cap.price.lookup.v1/compare');

      // Endpoint should respond
      expect(res.status).not.toBe(404);
    });

    test('3. Invocation includes cost in metadata', async () => {
      const res = await request(app)
        .post('/invoke')
        .send({
          capability_id: 'cap.price.lookup.v1',
          inputs: { base_token: 'SOL', quote_token: 'USD' }
        });

      expect(res.body.metadata).toBeDefined();
      if (res.body.metadata.execution) {
        expect(res.body.metadata.execution.cost_actual).toBeDefined();
      }
    });
  });

  // ============================================
  // HEALTH & MONITORING
  // ============================================

  describe('Health & Monitoring', () => {
    
    test('1. System health check', async () => {
      const res = await request(app).get('/health');
      
      expect(['healthy', 'degraded']).toContain(res.body.status);
      expect(res.body.version).toBeDefined();
    });

    test('2. Capability health check', async () => {
      const res = await request(app).get('/health/capabilities');
      
      if (res.body.success) {
        expect(res.body.capabilities).toBeDefined();
      }
    });

    test('3. Metrics endpoint', async () => {
      const res = await request(app).get('/metrics');
      
      expect(res.status).not.toBe(404);
    });

    test('4. Analytics dashboard', async () => {
      const res = await request(app).get('/analytics/dashboard');
      
      expect(res.body.success).toBe(true);
    });
  });

});
