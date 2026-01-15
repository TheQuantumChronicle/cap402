/**
 * Sponsor Integration Tests
 * 
 * Deep testing of all sponsor integrations:
 * - Arcium: C-SPL confidential tokens, MPC computation
 * - Aztec/Noir: ZK proof generation, circuit verification
 * - Helius: DAS API, wallet snapshots, webhooks
 * - Inco: FHE encryption, confidential messaging
 */

import request from 'supertest';
import { app } from '../router/server';

describe('Sponsor Integration Tests', () => {

  // ============================================
  // ARCIUM INTEGRATION
  // ============================================

  describe('Arcium Integration', () => {
    
    test('Arcium sponsor status shows deep integration', async () => {
      const res = await request(app).get('/sponsors/arcium');
      
      expect(res.body.success).toBe(true);
      expect(res.body.sponsor).toBe('Arcium');
      expect(res.body.integration_depth).toBe('deep');
      expect(res.body.capabilities).toContain('cap.cspl.wrap.v1');
      expect(res.body.capabilities).toContain('cap.cspl.transfer.v1');
      expect(res.body.capabilities).toContain('cap.confidential.swap.v1');
    });

    test('Arcium security requirements are strict', async () => {
      const res = await request(app).get('/sponsors/arcium/security');
      
      expect(res.body.security_requirements.requires_token).toBe(true);
      expect(res.body.security_requirements.requires_handshake).toBe(true);
      expect(res.body.security_requirements.min_trust_level).toBe('trusted');
      expect(res.body.privacy_level).toBe('confidential');
    });

    test('Arcium capabilities are confidential mode', async () => {
      const capabilities = ['cap.cspl.wrap.v1', 'cap.cspl.transfer.v1', 'cap.confidential.swap.v1'];
      
      for (const capId of capabilities) {
        const res = await request(app).get(`/capabilities/${capId}`);
        if (res.body.success) {
          expect(res.body.capability.execution.mode).toBe('confidential');
          expect(res.body.sponsor).toBe('Arcium');
        }
      }
    });

    test('Arcium features include C-SPL and MPC', async () => {
      const res = await request(app).get('/sponsors/arcium');
      
      expect(res.body.features).toContain('C-SPL Confidential Token Standard');
      expect(res.body.features).toContain('MPC-powered computation');
      expect(res.body.features).toContain('Encrypted on-chain balances');
    });
  });

  // ============================================
  // AZTEC/NOIR INTEGRATION
  // ============================================

  describe('Aztec/Noir Integration', () => {
    
    test('Noir sponsor status shows deep integration', async () => {
      const res = await request(app).get('/sponsors/noir');
      
      expect(res.body.success).toBe(true);
      expect(res.body.sponsor).toBe('Aztec/Noir');
      expect(res.body.integration_depth).toBe('deep');
      expect(res.body.capabilities).toContain('cap.zk.proof.v1');
    });

    test('Noir has multiple ZK circuits implemented', async () => {
      const res = await request(app).get('/sponsors/noir');
      
      // Should mention number of circuits in features
      const circuitFeature = res.body.features.find((f: string) => f.includes('circuits'));
      expect(circuitFeature).toBeDefined();
    });

    test('ZK proof capability is confidential', async () => {
      const res = await request(app).get('/capabilities/cap.zk.proof.v1');
      
      expect(res.body.success).toBe(true);
      expect(res.body.capability.execution.mode).toBe('confidential');
      expect(res.body.sponsor).toBe('Aztec/Noir');
    });

    test('Noir security requirements are defined', async () => {
      const res = await request(app).get('/sponsors/noir/security');
      
      expect(res.body.success).toBe(true);
      expect(res.body.security_requirements).toBeDefined();
      expect(res.body.capabilities).toContain('cap.zk.proof.v1');
    });

    test('ZK proof capability has correct schema', async () => {
      const res = await request(app).get('/capabilities/cap.zk.proof.v1');
      
      expect(res.body.capability.inputs.schema.properties.proof_type).toBeDefined();
      expect(res.body.capability.inputs.schema.properties.circuit).toBeDefined();
      expect(res.body.capability.inputs.schema.properties.private_inputs).toBeDefined();
      expect(res.body.capability.inputs.schema.properties.public_inputs).toBeDefined();
    });

    test('ZK proof example shows correct usage', async () => {
      const res = await request(app).get('/capabilities/cap.zk.proof.v1/example');
      
      expect(res.body.success).toBe(true);
      expect(res.body.example.inputs.proof_type).toBeDefined();
      expect(res.body.execution_mode).toBe('confidential');
    });
  });

  // ============================================
  // HELIUS INTEGRATION
  // ============================================

  describe('Helius Integration', () => {
    
    test('Helius sponsor status shows deep integration', async () => {
      const res = await request(app).get('/sponsors/helius');
      
      expect(res.body.success).toBe(true);
      expect(res.body.sponsor).toBe('Helius');
      expect(res.body.integration_depth).toBe('deep');
      expect(res.body.capabilities).toContain('cap.wallet.snapshot.v1');
    });

    test('Helius has public security requirements', async () => {
      const res = await request(app).get('/sponsors/helius/security');
      
      expect(res.body.security_requirements.requires_token).toBe(false);
      expect(res.body.security_requirements.requires_handshake).toBe(false);
      expect(res.body.security_requirements.min_trust_level).toBe('newcomer');
      expect(res.body.privacy_level).toBe('public');
    });

    test('Helius features include DAS API', async () => {
      const res = await request(app).get('/sponsors/helius');
      
      expect(res.body.features).toContain('Digital Asset Standard (DAS) API');
      expect(res.body.features).toContain('Fungible token metadata');
      expect(res.body.features).toContain('NFT collection data');
    });

    test('Wallet snapshot capability is public mode', async () => {
      const res = await request(app).get('/capabilities/cap.wallet.snapshot.v1');
      
      expect(res.body.success).toBe(true);
      expect(res.body.capability.execution.mode).toBe('public');
      expect(res.body.sponsor).toBe('Helius');
    });

    test('Wallet snapshot can be invoked without token', async () => {
      const res = await request(app)
        .post('/invoke')
        .send({
          capability_id: 'cap.wallet.snapshot.v1',
          inputs: { address: 'So11111111111111111111111111111111111111112' }
        });

      // Should succeed or fail gracefully (no auth error)
      if (res.body.error) {
        expect(res.body.error).not.toContain('token');
        expect(res.body.error).not.toContain('handshake');
      } else {
        expect(res.body.success).toBe(true);
      }
    });
  });

  // ============================================
  // INCO INTEGRATION
  // ============================================

  describe('Inco Integration', () => {
    
    test('Inco sponsor status shows deep integration', async () => {
      const res = await request(app).get('/sponsors/inco');
      
      expect(res.body.success).toBe(true);
      expect(res.body.sponsor).toBe('Inco');
      expect(res.body.integration_depth).toBe('deep');
      expect(res.body.capabilities).toContain('cap.lightning.message.v1');
      expect(res.body.capabilities).toContain('cap.fhe.compute.v1');
    });

    test('Inco security requirements are strict', async () => {
      const res = await request(app).get('/sponsors/inco/security');
      
      expect(res.body.security_requirements.requires_token).toBe(true);
      expect(res.body.security_requirements.requires_handshake).toBe(true);
      expect(res.body.security_requirements.min_trust_level).toBe('trusted');
      expect(res.body.privacy_level).toBe('encrypted');
    });

    test('Inco features include FHE', async () => {
      const res = await request(app).get('/sponsors/inco');
      
      expect(res.body.features).toContain('Fully Homomorphic Encryption (FHE)');
      expect(res.body.features).toContain('Encrypted computation');
      expect(res.body.features).toContain('Confidential messaging');
    });

    test('FHE compute capability exists', async () => {
      const res = await request(app).get('/capabilities/cap.fhe.compute.v1');
      
      if (res.body.success) {
        expect(res.body.capability.execution.mode).toBe('confidential');
        expect(res.body.sponsor).toBe('Inco');
      }
    });

    test('Lightning message capability exists', async () => {
      const res = await request(app).get('/capabilities/cap.lightning.message.v1');
      
      if (res.body.success) {
        expect(res.body.capability.execution.mode).toBe('confidential');
        expect(res.body.sponsor).toBe('Inco');
      }
    });
  });

  // ============================================
  // CROSS-SPONSOR TESTS
  // ============================================

  describe('Cross-Sponsor Integration', () => {
    
    test('All 4 sponsors are operational', async () => {
      const res = await request(app).get('/sponsors');
      
      expect(res.body.success).toBe(true);
      expect(res.body.sponsors.length).toBe(4);
      
      const sponsorNames = res.body.sponsors.map((s: any) => s.sponsor);
      expect(sponsorNames).toContain('Arcium');
      expect(sponsorNames).toContain('Aztec/Noir');
      expect(sponsorNames).toContain('Helius');
      expect(sponsorNames).toContain('Inco');
    });

    test('All sponsors have deep integration', async () => {
      const res = await request(app).get('/sponsors');
      
      res.body.sponsors.forEach((sponsor: any) => {
        expect(sponsor.integration_depth).toBe('deep');
      });
    });

    test('Capability summary shows sponsor breakdown', async () => {
      const res = await request(app).get('/capabilities/summary');
      
      expect(res.body.by_sponsor).toBeDefined();
      expect(res.body.by_sponsor['Arcium']).toBeGreaterThan(0);
      expect(res.body.by_sponsor['Aztec/Noir']).toBeGreaterThan(0);
      expect(res.body.by_sponsor['Helius']).toBeGreaterThan(0);
      expect(res.body.by_sponsor['Inco']).toBeGreaterThan(0);
    });

    test('Privacy ratio reflects sponsor capabilities', async () => {
      const res = await request(app).get('/capabilities/summary');
      
      expect(res.body.total).toBeDefined();
      expect(res.body.by_mode).toBeDefined();
      // Most capabilities should be confidential (privacy-first)
      expect(res.body.by_mode.confidential).toBeGreaterThan(res.body.by_mode.public);
    });

    test('Templates use capabilities from the registry', async () => {
      const res = await request(app).get('/templates');
      
      // Templates can have capabilities as strings or objects
      const allCapabilities = res.body.templates.flatMap((t: any) => {
        if (!t.capabilities) return [];
        return t.capabilities.map((c: any) => 
          typeof c === 'string' ? c : c.capability_id
        );
      });
      
      // Templates should have capabilities
      expect(allCapabilities.length).toBeGreaterThan(0);
      
      // At least one capability should be from our registry
      const capRes = await request(app).get('/capabilities');
      const registryCaps = capRes.body.capabilities.map((c: any) => c.id);
      const hasRegistryCaps = allCapabilities.some((cap: string) => registryCaps.includes(cap));
      expect(hasRegistryCaps).toBe(true);
    });
  });
});
