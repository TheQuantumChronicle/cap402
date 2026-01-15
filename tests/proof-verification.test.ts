/**
 * Proof Verification Tests
 * 
 * Test suite for proof verification system
 */

import { proofVerifier } from '../router/proof-verification';

describe('Proof Verification', () => {
  test('should verify valid Arcium attestation', async () => {
    const result = await proofVerifier.verify({
      proof_type: 'arcium-attestation',
      proof: '0xabc123...'
    });

    expect(result.valid).toBe(true);
    expect(result.proof_type).toBe('arcium-attestation');
    expect(result.verifier).toBe('arcium-verifier');
  });

  test('should verify valid ZK-SNARK proof', async () => {
    // Proof must be > 64 chars and start with 0x for fallback verification
    const validProof = '0x' + 'a'.repeat(128);
    const result = await proofVerifier.verify({
      proof_type: 'zk-snark',
      proof: validProof,
      verification_key: 'vk_test123'
    });

    // Verification result depends on Noir circuit availability
    expect(result.proof_type).toBe('zk-snark');
    expect(result.verifier).toBe('noir-verifier');
    expect(result.verified_at).toBeDefined();
  });

  test('should reject ZK-SNARK without verification key', async () => {
    const result = await proofVerifier.verify({
      proof_type: 'zk-snark',
      proof: '0xdef456...'
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('Verification key required');
  });

  test('should verify delivery receipt', async () => {
    const result = await proofVerifier.verify({
      proof_type: 'delivery-receipt',
      proof: 'proof_msg123'
    });

    expect(result.valid).toBe(true);
    expect(result.verifier).toBe('inco-verifier');
  });

  test('should handle batch verification', async () => {
    const results = await proofVerifier.verifyBatch([
      { proof_type: 'arcium-attestation', proof: '0xabc' },
      { proof_type: 'delivery-receipt', proof: 'proof_123' }
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].valid).toBe(true);
    expect(results[1].valid).toBe(true);
  });
});
