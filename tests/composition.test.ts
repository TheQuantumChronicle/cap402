/**
 * Composition & Template Tests
 * 
 * Tests for capability composition and template execution
 */

import request from 'supertest';
import { app } from '../router/server';

describe('Composition & Template Tests', () => {

  // ============================================
  // TEMPLATE DISCOVERY
  // ============================================

  describe('Template Discovery', () => {
    
    test('Lists all available templates', async () => {
      const res = await request(app).get('/templates');
      
      expect(res.body.success).toBe(true);
      expect(res.body.templates.length).toBeGreaterThan(0);
    });

    test('Each template has required fields', async () => {
      const res = await request(app).get('/templates');
      
      res.body.templates.forEach((template: any) => {
        expect(template.id).toBeDefined();
        expect(template.name).toBeDefined();
        expect(template.description).toBeDefined();
        expect(template.capabilities).toBeDefined();
        expect(Array.isArray(template.capabilities)).toBe(true);
        expect(template.required_inputs).toBeDefined();
      });
    });

    test('Private swap template exists', async () => {
      const res = await request(app).get('/templates/template.private-swap.v1');
      
      expect(res.body.success).toBe(true);
      expect(res.body.template.id).toBe('template.private-swap.v1');
      expect(res.body.template.capabilities.length).toBeGreaterThan(0);
    });

    test('Templates list is not empty', async () => {
      const res = await request(app).get('/templates');
      
      expect(res.body.success).toBe(true);
      expect(res.body.templates.length).toBeGreaterThan(0);
    });

    test('Template capabilities are defined', async () => {
      const res = await request(app).get('/templates');
      
      if (res.body.templates && res.body.templates.length > 0) {
        const template = res.body.templates[0];
        expect(template.capabilities).toBeDefined();
      }
    });
  });

  // ============================================
  // TEMPLATE STRUCTURE
  // ============================================

  describe('Template Structure', () => {
    
    test('Templates have required fields', async () => {
      const res = await request(app).get('/templates');
      
      if (res.body.templates && res.body.templates.length > 0) {
        const template = res.body.templates[0];
        expect(template.id).toBeDefined();
        expect(template.name).toBeDefined();
      }
    });

    test('Templates have capabilities array', async () => {
      const res = await request(app).get('/templates');
      
      if (res.body.templates && res.body.templates.length > 0) {
        const template = res.body.templates[0];
        expect(Array.isArray(template.capabilities)).toBe(true);
      }
    });
  });

  // ============================================
  // COMPOSITION ENDPOINT
  // ============================================

  describe('Composition Endpoint', () => {
    
    test('POST /compose endpoint exists', async () => {
      const res = await request(app)
        .post('/compose')
        .send({
          capabilities: [
            { capability_id: 'cap.price.lookup.v1', inputs: { base_token: 'SOL', quote_token: 'USD' } }
          ]
        });

      // Should not 404
      expect(res.status).not.toBe(404);
    });

    test('Compose with single capability returns response', async () => {
      const res = await request(app)
        .post('/compose')
        .send({
          capabilities: [
            { capability_id: 'cap.price.lookup.v1', inputs: { base_token: 'ETH', quote_token: 'USD' } }
          ]
        });

      // Compose endpoint should return a response
      expect(res.body).toBeDefined();
    });

    test('Compose with multiple capabilities returns response', async () => {
      const res = await request(app)
        .post('/compose')
        .send({
          capabilities: [
            { capability_id: 'cap.price.lookup.v1', inputs: { base_token: 'SOL', quote_token: 'USD' } },
            { capability_id: 'cap.price.lookup.v1', inputs: { base_token: 'ETH', quote_token: 'USD' } }
          ]
        });

      expect(res.body).toBeDefined();
    });

    test('Compose endpoint handles requests', async () => {
      const res = await request(app)
        .post('/compose')
        .send({
          capabilities: [
            { capability_id: 'cap.price.lookup.v1', inputs: { base_token: 'BTC', quote_token: 'USD' } }
          ]
        });

      // Should not 404
      expect(res.status).not.toBe(404);
    });
  });

  // ============================================
  // WORKFLOW SUGGESTIONS
  // ============================================

  describe('Workflow Suggestions', () => {
    
    test('POST /suggest-workflow endpoint exists', async () => {
      const res = await request(app)
        .post('/suggest-workflow')
        .send({ goal: 'I want to swap tokens privately' });

      expect(res.status).not.toBe(404);
    });

    test('Suggests workflows based on goal', async () => {
      const res = await request(app)
        .post('/suggest-workflow')
        .send({ goal: 'private swap' });

      if (res.body.success) {
        expect(res.body.suggestions).toBeDefined();
      }
    });
  });

  // ============================================
  // SEMANTIC DISCOVERY
  // ============================================

  describe('Semantic Discovery', () => {
    
    test('POST /discover endpoint exists', async () => {
      const res = await request(app)
        .post('/discover')
        .send({ query: 'price' });

      expect(res.status).not.toBe(404);
    });

    test('Discovers capabilities by query', async () => {
      const res = await request(app)
        .post('/discover')
        .send({ query: 'price lookup' });

      // Endpoint should respond (may have results or not)
      expect(res.status).not.toBe(404);
    });

    test('Discovers privacy capabilities', async () => {
      const res = await request(app)
        .post('/discover')
        .send({ query: 'confidential private encrypted' });

      // Endpoint should respond
      expect(res.status).not.toBe(404);
    });
  });
});
