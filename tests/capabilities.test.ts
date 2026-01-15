/**
 * Capability Tests
 * 
 * Basic test suite for CAP-402 capabilities
 */

import { CORE_CAPABILITIES } from '../spec/capabilities';

describe('CAP-402 Capabilities', () => {
  test('should have capabilities registered', () => {
    // At least 9 core capabilities, may have more
    expect(CORE_CAPABILITIES.length).toBeGreaterThanOrEqual(9);
  });

  test('all capabilities should have required fields', () => {
    CORE_CAPABILITIES.forEach(cap => {
      expect(cap.id).toBeDefined();
      expect(cap.name).toBeDefined();
      expect(cap.description).toBeDefined();
      expect(cap.inputs).toBeDefined();
      expect(cap.outputs).toBeDefined();
      expect(cap.execution).toBeDefined();
      expect(cap.economics).toBeDefined();
      expect(cap.version).toBeDefined();
    });
  });

  test('should have mix of public and confidential capabilities', () => {
    const publicCaps = CORE_CAPABILITIES.filter(c => c.execution.mode === 'public');
    const confidentialCaps = CORE_CAPABILITIES.filter(c => c.execution.mode === 'confidential');
    
    expect(publicCaps.length).toBeGreaterThan(0);
    expect(confidentialCaps.length).toBeGreaterThan(0);
  });

  test('all capability IDs should follow naming convention', () => {
    CORE_CAPABILITIES.forEach(cap => {
      // Allow for multi-segment capability IDs like cap.zk.proof.balance.v1
      expect(cap.id).toMatch(/^cap\.[a-z0-9._-]+\.v\d+$/);
    });
  });

  test('sponsor capabilities should have correct proof types', () => {
    const arciumCap = CORE_CAPABILITIES.find(c => c.id === 'cap.confidential.swap.v1');
    const zkCap = CORE_CAPABILITIES.find(c => c.id === 'cap.zk.proof.v1');
    const incoCap = CORE_CAPABILITIES.find(c => c.id === 'cap.lightning.message.v1');

    expect(arciumCap?.execution.proof_type).toBe('arcium-attestation');
    expect(zkCap?.execution.proof_type).toBe('zk-snark');
    expect(incoCap?.execution.proof_type).toBe('delivery-receipt');
  });
});
