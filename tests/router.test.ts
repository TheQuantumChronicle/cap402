/**
 * Router Tests
 * 
 * Test suite for CAP-402 router functionality
 */

import { Router } from '../router/router';

describe('CAP-402 Router', () => {
  let router: Router;

  beforeEach(() => {
    router = new Router();
  });

  test('should reject invalid capability ID', async () => {
    const result = await router.invoke({
      capability_id: 'invalid.capability.v1',
      inputs: {}
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  test('should generate unique request IDs', async () => {
    const result1 = await router.invoke({
      capability_id: 'cap.price.lookup.v1',
      inputs: { base_token: 'SOL', quote_token: 'USD' }
    });

    const result2 = await router.invoke({
      capability_id: 'cap.price.lookup.v1',
      inputs: { base_token: 'BTC', quote_token: 'USD' }
    });

    expect(result1.request_id).not.toBe(result2.request_id);
  });

  test('should include economic hints in response', async () => {
    const result = await router.invoke({
      capability_id: 'cap.price.lookup.v1',
      inputs: { base_token: 'SOL', quote_token: 'USD' }
    });

    expect(result.metadata.economic_hints).toBeDefined();
    expect(result.metadata.economic_hints.x402).toBeDefined();
  });

  test('should include chain signal in response', async () => {
    const result = await router.invoke({
      capability_id: 'cap.price.lookup.v1',
      inputs: { base_token: 'SOL', quote_token: 'USD' }
    });

    expect(result.metadata.chain_signal).toBeDefined();
    expect(result.metadata.chain_signal.commitment_hash).toBeDefined();
  });
});
