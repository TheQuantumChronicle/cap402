/**
 * API Endpoint Tests
 * 
 * Comprehensive tests for all CAP-402 API endpoints
 * Tests both server-side functionality and client/agent scenarios
 */

import request from 'supertest';
import { app } from '../router/server';

describe('CAP-402 API Tests', () => {
  
  // ============================================
  // CORE ENDPOINTS
  // ============================================
  
  describe('Core Endpoints', () => {
    
    test('GET / - Root endpoint returns API info', async () => {
      const res = await request(app).get('/');
      
      expect(res.status).toBe(200);
      // Root endpoint returns JSON with API info
      expect(res.body).toBeDefined();
    });

    test('GET /health - Health check returns status', async () => {
      const res = await request(app).get('/health');
      
      expect(res.status).toBe(200);
      expect(['healthy', 'degraded']).toContain(res.body.status);
      expect(res.body.version).toBeDefined();
    });

    test('GET /capabilities - Lists all capabilities', async () => {
      const res = await request(app).get('/capabilities');
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBeGreaterThan(0);
      expect(Array.isArray(res.body.capabilities)).toBe(true);
    });

    test('GET /capabilities?mode=confidential - Filters by mode', async () => {
      const res = await request(app).get('/capabilities?mode=confidential');
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      res.body.capabilities.forEach((cap: any) => {
        expect(cap.execution.mode).toBe('confidential');
      });
    });

    test('GET /capabilities/summary - Returns sponsor breakdown', async () => {
      const res = await request(app).get('/capabilities/summary');
      
      expect(res.status).toBe(200);
      expect(res.body.total).toBeGreaterThan(0);
      expect(res.body.by_mode).toBeDefined();
      expect(res.body.by_sponsor).toBeDefined();
    });

    test('GET /capabilities/:id - Returns specific capability with sponsor', async () => {
      const res = await request(app).get('/capabilities/cap.price.lookup.v1');
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.capability.id).toBe('cap.price.lookup.v1');
    });

    test('GET /capabilities/:id - Returns 404 for unknown capability', async () => {
      const res = await request(app).get('/capabilities/cap.unknown.v1');
      
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    test('GET /capabilities/:id/example - Returns usage example', async () => {
      const res = await request(app).get('/capabilities/cap.price.lookup.v1/example');
      
      expect(res.status).toBe(200);
      expect(res.body.example).toBeDefined();
      expect(res.body.example.curl).toBeDefined();
      expect(res.body.example.inputs).toBeDefined();
    });
  });

  // ============================================
  // INVOKE ENDPOINT
  // ============================================

  describe('Invoke Endpoint', () => {
    
    test('POST /invoke - Executes public capability', async () => {
      const res = await request(app)
        .post('/invoke')
        .send({
          capability_id: 'cap.price.lookup.v1',
          inputs: { base_token: 'SOL', quote_token: 'USD' }
        });
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.request_id).toBeDefined();
      expect(res.body.outputs).toBeDefined();
    });

    test('POST /invoke - Returns error for missing capability', async () => {
      const res = await request(app)
        .post('/invoke')
        .send({
          capability_id: 'cap.nonexistent.v1',
          inputs: {}
        });
      
      expect(res.body.success).toBe(false);
    });

    test('POST /invoke - Includes metadata in response', async () => {
      const res = await request(app)
        .post('/invoke')
        .send({
          capability_id: 'cap.price.lookup.v1',
          inputs: { base_token: 'ETH', quote_token: 'USD' }
        });
      
      expect(res.body.metadata).toBeDefined();
      expect(res.body.metadata.execution).toBeDefined();
    });
  });

  // ============================================
  // TEMPLATES
  // ============================================

  describe('Templates', () => {
    
    test('GET /templates - Lists all composition templates', async () => {
      const res = await request(app).get('/templates');
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.templates)).toBe(true);
      expect(res.body.templates.length).toBeGreaterThan(0);
    });

    test('GET /templates/:id - Returns specific template', async () => {
      const res = await request(app).get('/templates/template.private-swap.v1');
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.template.id).toBe('template.private-swap.v1');
    });
  });

  // ============================================
  // SPONSORS
  // ============================================

  describe('Sponsor Endpoints', () => {
    
    test('GET /sponsors - Returns all sponsor status', async () => {
      const res = await request(app).get('/sponsors');
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.sponsors).toBeDefined();
      expect(res.body.sponsors.length).toBe(4);
    });

    test('GET /sponsors/arcium - Returns Arcium status', async () => {
      const res = await request(app).get('/sponsors/arcium');
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.sponsor).toBe('Arcium');
      expect(res.body.integration_depth).toBe('deep');
    });

    test('GET /sponsors/arcium/security - Returns security requirements', async () => {
      const res = await request(app).get('/sponsors/arcium/security');
      
      expect(res.status).toBe(200);
      expect(res.body.security_requirements).toBeDefined();
      expect(res.body.security_requirements.requires_token).toBe(true);
      expect(res.body.security_requirements.requires_handshake).toBe(true);
      expect(res.body.privacy_level).toBe('confidential');
    });

    test('GET /sponsors/helius/security - Helius has lower requirements', async () => {
      const res = await request(app).get('/sponsors/helius/security');
      
      expect(res.status).toBe(200);
      expect(res.body.security_requirements.requires_token).toBe(false);
      expect(res.body.security_requirements.requires_handshake).toBe(false);
      expect(res.body.privacy_level).toBe('public');
    });
  });

  // ============================================
  // ANALYTICS
  // ============================================

  describe('Analytics', () => {
    
    test('GET /analytics/dashboard - Returns usage analytics', async () => {
      const res = await request(app).get('/analytics/dashboard');
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
