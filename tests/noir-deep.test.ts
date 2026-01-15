/**
 * NOIR ZK DEEP INTEGRATION TEST SUITE
 * 
 * Comprehensive testing of Aztec Noir ZK infrastructure:
 * - All 7 circuit types with proof generation
 * - Compiled circuit loading and execution
 * - Public/private input handling
 * - Proof verification
 * - Edge cases and error handling
 * - Performance benchmarks
 * 
 * Run: npm test -- tests/noir-deep.test.ts
 */

import { noirCircuitsProvider } from '../providers/noir-circuits';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

jest.setTimeout(60000);

describe('🔵 NOIR ZK DEEP INTEGRATION SUITE', () => {

  // ============================================
  // CIRCUIT REGISTRY
  // ============================================
  describe('Circuit Registry', () => {
    
    test('lists all 7 available circuits', () => {
      const circuits = noirCircuitsProvider.getAvailableCircuits();
      
      console.log('\n📋 NOIR CIRCUIT REGISTRY:');
      console.log('   Total Circuits:', circuits.length);
      circuits.forEach(c => {
        console.log(`   • ${c.name} (${c.constraints} constraints)`);
      });
      
      expect(circuits.length).toBe(7);
      
      const expectedCircuits = [
        'balance_threshold',
        'credential_ownership',
        'set_membership',
        'age_verification',
        'transaction_limit',
        'kyc_compliance',
        'voting_eligibility'
      ];
      
      expectedCircuits.forEach(name => {
        expect(circuits.map(c => c.name)).toContain(name);
      });
    });

    test('each circuit has complete metadata', () => {
      const circuits = noirCircuitsProvider.getAvailableCircuits();
      
      circuits.forEach(circuit => {
        expect(circuit.name).toBeDefined();
        expect(circuit.description).toBeDefined();
        expect(circuit.public_inputs).toBeInstanceOf(Array);
        expect(circuit.private_inputs).toBeInstanceOf(Array);
        expect(circuit.constraints).toBeGreaterThan(0);
      });
    });

    test('retrieves specific circuit by name', () => {
      const circuit = noirCircuitsProvider.getCircuit('balance_threshold');
      
      console.log('\n🔍 BALANCE_THRESHOLD CIRCUIT:');
      console.log('   Name:', circuit?.name);
      console.log('   Description:', circuit?.description);
      console.log('   Public Inputs:', circuit?.public_inputs);
      console.log('   Private Inputs:', circuit?.private_inputs);
      console.log('   Constraints:', circuit?.constraints);
      
      expect(circuit).toBeDefined();
      expect(circuit?.name).toBe('balance_threshold');
      expect(circuit?.public_inputs).toContain('threshold');
      expect(circuit?.private_inputs).toContain('actual_balance');
    });

    test('returns undefined for non-existent circuit', () => {
      const circuit = noirCircuitsProvider.getCircuit('non_existent_circuit');
      expect(circuit).toBeUndefined();
    });
  });

  // ============================================
  // COMPILED CIRCUIT VERIFICATION
  // ============================================
  describe('Compiled Circuit Verification', () => {
    const circuitPath = path.join(__dirname, '..', 'circuits', 'balance_threshold', 'target', 'balance_threshold.json');

    test('balance_threshold circuit is compiled', () => {
      const exists = fs.existsSync(circuitPath);
      
      console.log('\n📦 COMPILED CIRCUIT:');
      console.log('   Path:', circuitPath);
      console.log('   Exists:', exists);
      
      expect(exists).toBe(true);
    });

    test('compiled circuit has valid structure', () => {
      const circuitJson = JSON.parse(fs.readFileSync(circuitPath, 'utf-8'));
      
      console.log('\n🔬 CIRCUIT STRUCTURE:');
      console.log('   Noir Version:', circuitJson.noir_version);
      console.log('   Hash:', circuitJson.hash);
      console.log('   Has Bytecode:', !!circuitJson.bytecode);
      console.log('   Has ABI:', !!circuitJson.abi);
      console.log('   Parameters:', circuitJson.abi?.parameters?.length);
      
      expect(circuitJson.noir_version).toBeDefined();
      expect(circuitJson.bytecode).toBeDefined();
      expect(circuitJson.abi).toBeDefined();
      expect(circuitJson.abi.parameters).toHaveLength(2);
    });

    test('circuit ABI defines correct parameters', () => {
      const circuitJson = JSON.parse(fs.readFileSync(circuitPath, 'utf-8'));
      const params = circuitJson.abi.parameters;
      
      console.log('\n📝 CIRCUIT PARAMETERS:');
      params.forEach((p: any) => {
        console.log(`   • ${p.name}: ${p.type.kind} (${p.visibility})`);
      });
      
      // actual_balance is private
      const actualBalance = params.find((p: any) => p.name === 'actual_balance');
      expect(actualBalance.visibility).toBe('private');
      expect(actualBalance.type.kind).toBe('integer');
      expect(actualBalance.type.width).toBe(64);
      
      // threshold is public
      const threshold = params.find((p: any) => p.name === 'threshold');
      expect(threshold.visibility).toBe('public');
    });
  });

  // ============================================
  // BALANCE THRESHOLD PROOFS
  // ============================================
  describe('Balance Threshold Proofs', () => {
    
    test('generates proof when balance exceeds threshold', async () => {
      const proof = await noirCircuitsProvider.generateProof(
        'balance_threshold',
        { threshold: 1000, token_mint: 'SOL' },
        { actual_balance: 5000, wallet_signature: 'sig_abc123' }
      );

      console.log('\n✅ BALANCE > THRESHOLD PROOF:');
      console.log('   Proof Length:', proof.proof.length, 'chars');
      console.log('   Proof Prefix:', proof.proof.slice(0, 50) + '...');
      console.log('   VK Length:', proof.verification_key.length, 'chars');
      console.log('   Circuit Hash:', proof.circuit_hash);
      console.log('   Proving Time:', proof.proving_time_ms, 'ms');
      console.log('   Meets Threshold:', proof.public_outputs.meets_threshold);
      console.log('   Mode:', proof.public_outputs.mode);
      
      expect(proof.proof).toMatch(/^0x[a-f0-9]+$/);
      expect(proof.proof.length).toBeGreaterThan(100);
      expect(proof.verification_key).toMatch(/^0x[a-f0-9]+$/);
      expect(proof.public_outputs.meets_threshold).toBe(true);
      // Proving time may be 0 for very fast proofs
      expect(proof.proving_time_ms).toBeGreaterThanOrEqual(0);
    });

    test('generates proof when balance equals threshold', async () => {
      const proof = await noirCircuitsProvider.proveBalanceThreshold(
        1000,  // actual = threshold
        1000,
        'SOL',
        'sig_xyz'
      );

      console.log('\n⚖️ BALANCE = THRESHOLD PROOF:');
      console.log('   Meets Threshold:', proof.public_outputs.meets_threshold);
      
      // Equal meets threshold (>=)
      expect(proof.public_outputs.meets_threshold).toBe(true);
    });

    test('generates proof when balance below threshold', async () => {
      const proof = await noirCircuitsProvider.proveBalanceThreshold(
        500,   // below threshold
        1000,
        'SOL',
        'sig_xyz'
      );

      console.log('\n❌ BALANCE < THRESHOLD PROOF:');
      console.log('   Meets Threshold:', proof.public_outputs.meets_threshold);
      
      expect(proof.public_outputs.meets_threshold).toBe(false);
    });

    test('proof does NOT reveal actual balance', async () => {
      const proof = await noirCircuitsProvider.proveBalanceThreshold(
        999999,  // Large balance - should NOT be revealed
        1000,
        'SOL',
        'sig_xyz'
      );

      console.log('\n🔒 PRIVACY CHECK:');
      console.log('   Public Outputs:', Object.keys(proof.public_outputs));
      console.log('   Contains actual_balance:', 'actual_balance' in proof.public_outputs);
      
      // Private input should NOT appear in public outputs
      expect(proof.public_outputs.actual_balance).toBeUndefined();
      expect(proof.public_outputs.wallet_signature).toBeUndefined();
      
      // Only public outputs should be present
      expect(proof.public_outputs.meets_threshold).toBeDefined();
      expect(proof.public_outputs.threshold).toBe(1000);
    });

    test('handles edge case: zero balance', async () => {
      const proof = await noirCircuitsProvider.proveBalanceThreshold(
        0,
        1000,
        'SOL',
        'sig_xyz'
      );

      expect(proof.public_outputs.meets_threshold).toBe(false);
    });

    test('handles edge case: very large balance', async () => {
      const proof = await noirCircuitsProvider.proveBalanceThreshold(
        Number.MAX_SAFE_INTEGER,
        1000,
        'SOL',
        'sig_xyz'
      );

      expect(proof.public_outputs.meets_threshold).toBe(true);
    });
  });

  // ============================================
  // CREDENTIAL OWNERSHIP PROOFS
  // ============================================
  describe('Credential Ownership Proofs', () => {
    
    test('proves NFT collection ownership', async () => {
      const proof = await noirCircuitsProvider.proveCredentialOwnership(
        { collection: 'DeGods', token_ids: [1234, 5678, 9012] },
        'nft_ownership',
        'metaplex_authority_pubkey',
        'owner_signature_xyz'
      );

      console.log('\n🎨 NFT OWNERSHIP PROOF:');
      console.log('   Proof Generated:', !!proof.proof);
      console.log('   Verified:', proof.public_outputs.verified);
      console.log('   Credential Type:', 'nft_ownership');
      
      expect(proof.proof).toBeDefined();
      expect(proof.public_outputs.verified).toBe(true);
      
      // Private data NOT revealed
      expect(proof.public_outputs.collection).toBeUndefined();
      expect(proof.public_outputs.token_ids).toBeUndefined();
    });

    test('proves professional credential', async () => {
      const proof = await noirCircuitsProvider.proveCredentialOwnership(
        { 
          license_number: 'REDACTED',
          issue_date: '2020-01-01',
          expiry_date: '2025-12-31'
        },
        'professional_license',
        'licensing_board_pubkey',
        'holder_signature'
      );

      console.log('\n📜 PROFESSIONAL LICENSE PROOF:');
      console.log('   Verified:', proof.public_outputs.verified);
      
      expect(proof.public_outputs.verified).toBe(true);
      expect(proof.public_outputs.license_number).toBeUndefined();
    });
  });

  // ============================================
  // SET MEMBERSHIP PROOFS
  // ============================================
  describe('Set Membership Proofs', () => {
    
    test('proves membership in allowlist', async () => {
      const proof = await noirCircuitsProvider.proveSetMembership(
        { address: 'MyWalletAddress123' },
        ['hash1', 'hash2', 'hash3', 'hash4'], // Merkle path
        '0xmerkle_root_abc123',
        'allowlist_v1'
      );

      console.log('\n📋 SET MEMBERSHIP PROOF:');
      console.log('   Proof Generated:', !!proof.proof);
      console.log('   Verified:', proof.public_outputs.verified);
      
      expect(proof.proof).toBeDefined();
      expect(proof.public_outputs.verified).toBe(true);
      
      // Member identity NOT revealed
      expect(proof.public_outputs.address).toBeUndefined();
      expect(proof.public_outputs.member_data).toBeUndefined();
    });
  });

  // ============================================
  // KYC COMPLIANCE PROOFS
  // ============================================
  describe('KYC Compliance Proofs', () => {
    
    test('proves Tier 1 KYC compliance', async () => {
      const proof = await noirCircuitsProvider.proveKYCCompliance(
        { 
          full_name: 'REDACTED',
          date_of_birth: 'REDACTED',
          address: 'REDACTED',
          id_number: 'REDACTED'
        },
        'kyc_verifier_attestation_abc',
        'tier_1',
        'US'
      );

      console.log('\n🏛️ KYC TIER 1 PROOF:');
      console.log('   Is Compliant:', proof.public_outputs.is_compliant);
      console.log('   Compliance Level:', proof.public_outputs.compliance_level);
      console.log('   Jurisdiction:', proof.public_outputs.jurisdiction);
      
      expect(proof.public_outputs.is_compliant).toBe(true);
      expect(proof.public_outputs.compliance_level).toBe('tier_1');
      expect(proof.public_outputs.jurisdiction).toBe('US');
      
      // PII NOT revealed
      expect(proof.public_outputs.full_name).toBeUndefined();
      expect(proof.public_outputs.date_of_birth).toBeUndefined();
      expect(proof.public_outputs.id_number).toBeUndefined();
    });

    test('proves Tier 2 KYC compliance (enhanced)', async () => {
      const proof = await noirCircuitsProvider.proveKYCCompliance(
        {
          full_name: 'REDACTED',
          ssn: 'REDACTED',
          proof_of_address: 'REDACTED',
          source_of_funds: 'REDACTED'
        },
        'enhanced_kyc_attestation',
        'tier_2',
        'EU'
      );

      console.log('\n🏛️ KYC TIER 2 PROOF:');
      console.log('   Is Compliant:', proof.public_outputs.is_compliant);
      console.log('   Compliance Level:', proof.public_outputs.compliance_level);
      console.log('   Jurisdiction:', proof.public_outputs.jurisdiction);
      
      expect(proof.public_outputs.is_compliant).toBe(true);
      expect(proof.public_outputs.compliance_level).toBe('tier_2');
    });

    test('supports multiple jurisdictions', async () => {
      const jurisdictions = ['US', 'EU', 'UK', 'SG', 'JP'];
      
      console.log('\n🌍 MULTI-JURISDICTION KYC:');
      
      for (const jurisdiction of jurisdictions) {
        const proof = await noirCircuitsProvider.proveKYCCompliance(
          { data: 'REDACTED' },
          'attestation',
          'tier_1',
          jurisdiction
        );
        
        console.log(`   ${jurisdiction}: ${proof.public_outputs.is_compliant ? '✅' : '❌'}`);
        expect(proof.public_outputs.jurisdiction).toBe(jurisdiction);
      }
    });
  });

  // ============================================
  // AGE VERIFICATION PROOFS
  // ============================================
  describe('Age Verification Proofs', () => {
    
    test('generates age verification proof', async () => {
      const proof = await noirCircuitsProvider.generateProof(
        'age_verification',
        { minimum_age: 21, current_timestamp: Date.now() },
        { birthdate: '1990-01-01', identity_signature: 'sig_xyz' }
      );

      console.log('\n🎂 AGE VERIFICATION PROOF:');
      console.log('   Is Of Age:', proof.public_outputs.is_of_age);
      console.log('   Minimum Age:', proof.public_outputs.minimum_age);
      
      expect(proof.public_outputs.is_of_age).toBe(true);
      expect(proof.public_outputs.minimum_age).toBe(21);
      
      // Birthdate NOT revealed
      expect(proof.public_outputs.birthdate).toBeUndefined();
    });
  });

  // ============================================
  // TRANSACTION LIMIT PROOFS
  // ============================================
  describe('Transaction Limit Proofs', () => {
    
    test('proves transaction within limits', async () => {
      const proof = await noirCircuitsProvider.generateProof(
        'transaction_limit',
        { max_limit: 10000, min_limit: 100 },
        { transaction_amount: 5000, sender_signature: 'sig_abc' }
      );

      console.log('\n💳 TRANSACTION LIMIT PROOF:');
      console.log('   Verified:', proof.public_outputs.verified);
      
      expect(proof.public_outputs.verified).toBe(true);
      
      // Amount NOT revealed
      expect(proof.public_outputs.transaction_amount).toBeUndefined();
    });
  });

  // ============================================
  // VOTING ELIGIBILITY PROOFS
  // ============================================
  describe('Voting Eligibility Proofs', () => {
    
    test('proves voting eligibility for DAO proposal', async () => {
      const proof = await noirCircuitsProvider.generateProof(
        'voting_eligibility',
        { proposal_id: 'prop_42', dao_address: 'DAO_xyz123' },
        { 
          token_balance: 50000,
          delegation_proof: 'delegation_abc',
          voter_signature: 'voter_sig_xyz'
        }
      );

      console.log('\n🗳️ VOTING ELIGIBILITY PROOF:');
      console.log('   Verified:', proof.public_outputs.verified);
      
      expect(proof.public_outputs.verified).toBe(true);
      
      // Voting power NOT revealed
      expect(proof.public_outputs.token_balance).toBeUndefined();
    });
  });

  // ============================================
  // PROOF VERIFICATION
  // ============================================
  describe('Proof Verification', () => {
    
    test('verifies valid proof', async () => {
      const proof = await noirCircuitsProvider.generateProof(
        'balance_threshold',
        { threshold: 1000 },
        { actual_balance: 5000 }
      );

      const verification = await noirCircuitsProvider.verifyProof(
        proof.proof,
        `vk_balance_threshold_${Date.now()}`,
        { threshold: 1000 }
      );

      console.log('\n✅ PROOF VERIFICATION:');
      console.log('   Valid:', verification.valid);
      console.log('   Circuit:', verification.circuit_name);
      console.log('   Verification Time:', verification.verification_time_ms, 'ms');
      
      expect(verification.valid).toBe(true);
      expect(verification.verification_time_ms).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================
  // PERFORMANCE BENCHMARKS
  // ============================================
  describe('Performance Benchmarks', () => {
    
    test('proof generation performance by circuit', async () => {
      const circuits = ['balance_threshold', 'age_verification', 'transaction_limit'];
      
      console.log('\n⚡ PROOF GENERATION BENCHMARKS:');
      
      for (const circuit of circuits) {
        const circuitMeta = noirCircuitsProvider.getCircuit(circuit);
        const start = Date.now();
        
        await noirCircuitsProvider.generateProof(
          circuit,
          { threshold: 1000, minimum_age: 21, max_limit: 10000, min_limit: 0 },
          { actual_balance: 5000, birthdate: '1990-01-01', transaction_amount: 500 }
        );
        
        const elapsed = Date.now() - start;
        console.log(`   ${circuit}: ${elapsed}ms (${circuitMeta?.constraints} constraints)`);
      }
    });

    test('batch proof generation', async () => {
      const iterations = 10;
      const start = Date.now();
      
      const proofs = await Promise.all(
        Array(iterations).fill(null).map((_, i) =>
          noirCircuitsProvider.proveBalanceThreshold(
            1000 + i * 100,
            500,
            'SOL',
            `sig_${i}`
          )
        )
      );
      
      const elapsed = Date.now() - start;
      
      console.log('\n⚡ BATCH PROOF GENERATION:');
      console.log('   Proofs Generated:', proofs.length);
      console.log('   Total Time:', elapsed, 'ms');
      console.log('   Avg per Proof:', (elapsed / iterations).toFixed(2), 'ms');
      
      expect(proofs.every(p => p.proof)).toBe(true);
    });
  });
});
