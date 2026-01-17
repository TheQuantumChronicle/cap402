/**
 * Privacy Endpoints Tests
 * 
 * Tests for Arcium MPC, Inco FHE, and Noir ZK endpoints
 */

import { arciumProvider } from '../providers/arcium-client';
import { incoFHEProvider } from '../providers/inco-fhe';
import { noirCircuitsProvider } from '../providers/noir-circuits';

describe('Privacy Technology Integrations', () => {
  
  // ============================================
  // ARCIUM MPC TESTS
  // ============================================
  
  describe('Arcium MPC Provider', () => {
    
    test('should get status', () => {
      const status = arciumProvider.getStatus();
      expect(status).toBeDefined();
      expect(status.status).toBeDefined();
      expect(status.mode).toBeDefined();
    });
    
    test('should encrypt data for MPC', () => {
      const data = { amount: 1000, token: 'SOL' };
      const encrypted = arciumProvider.encryptForMPC(data);
      
      expect(encrypted).toBeDefined();
      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.nonce).toBeDefined();
      expect(encrypted.commitment).toBeDefined();
      expect(encrypted.commitment.startsWith('0x')).toBe(true);
    });
    
    test('should encrypt different data types', () => {
      // Number
      const numEncrypted = arciumProvider.encryptForMPC(12345);
      expect(numEncrypted.ciphertext).toBeDefined();
      
      // String
      const strEncrypted = arciumProvider.encryptForMPC('secret message');
      expect(strEncrypted.ciphertext).toBeDefined();
      
      // Object
      const objEncrypted = arciumProvider.encryptForMPC({ nested: { value: 100 } });
      expect(objEncrypted.ciphertext).toBeDefined();
      
      // Array
      const arrEncrypted = arciumProvider.encryptForMPC([1, 2, 3, 4, 5]);
      expect(arrEncrypted.ciphertext).toBeDefined();
    });
    
    test('should submit computation', async () => {
      const result = await arciumProvider.submitComputation({
        programId: 'test-program',
        inputs: { operation: 'add', a: 10, b: 20 }
      });
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.computationId).toBeDefined();
      expect(result.mode).toBeDefined();
    });
    
    test('should wrap tokens to C-SPL', async () => {
      const result = await arciumProvider.wrapToCSPL(
        'owner123',
        'SOL',
        1000
      );
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.outputs).toBeDefined();
    });
    
    test('should transfer C-SPL tokens', async () => {
      const result = await arciumProvider.transferCSPL(
        'from123',
        'to456',
        'SOL',
        'encrypted_amount_xyz'
      );
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });
    
    test('should execute confidential swap', async () => {
      const result = await arciumProvider.confidentialSwap(
        'SOL',
        'USDC',
        'encrypted_100',
        'wallet123'
      );
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.outputs?.operation).toBe('confidential_swap');
    });
    
    test('should submit private bid', async () => {
      const result = await arciumProvider.submitPrivateBid(
        'auction_123',
        'bidder_456',
        'encrypted_bid_amount',
        0.01
      );
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.outputs?.operation).toBe('private_auction_bid');
    });
    
    test('should cast confidential vote', async () => {
      const result = await arciumProvider.castConfidentialVote(
        'proposal_789',
        'voter_abc',
        'encrypted_yes',
        100
      );
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.outputs?.operation).toBe('confidential_vote');
    });
    
    test('should place private order', async () => {
      const result = await arciumProvider.placePrivateOrder(
        'SOL-USDC',
        'trader_xyz',
        'buy',
        'encrypted_price',
        'encrypted_size'
      );
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.outputs?.operation).toBe('private_order');
    });
    
    test('should compute confidential credit score', async () => {
      const result = await arciumProvider.computeConfidentialCreditScore(
        'applicant_123',
        'encrypted_financial_data',
        'lender_456'
      );
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.outputs?.operation).toBe('confidential_credit_score');
    });
  });
  
  // ============================================
  // INCO FHE TESTS
  // ============================================
  
  describe('Inco FHE Provider', () => {
    
    test('should get status', () => {
      const status = incoFHEProvider.getStatus();
      expect(status).toBeDefined();
      expect(status.initialized).toBeDefined();
      expect(status.mode).toBeDefined();
    });
    
    test('should encrypt euint64 value', async () => {
      const encrypted = await incoFHEProvider.encrypt(1000, 'euint64');
      
      expect(encrypted).toBeDefined();
      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.ciphertext.startsWith('0x')).toBe(true);
      expect(encrypted.encryption_type).toBe('euint64');
      expect(encrypted.mode).toBeDefined();
    });
    
    test('should encrypt different types', async () => {
      // euint8
      const e8 = await incoFHEProvider.encrypt(255, 'euint8');
      expect(e8.encryption_type).toBe('euint8');
      
      // euint16
      const e16 = await incoFHEProvider.encrypt(65535, 'euint16');
      expect(e16.encryption_type).toBe('euint16');
      
      // euint32
      const e32 = await incoFHEProvider.encrypt(4294967295, 'euint32');
      expect(e32.encryption_type).toBe('euint32');
      
      // ebool
      const ebool = await incoFHEProvider.encrypt(true, 'ebool');
      expect(ebool.encryption_type).toBe('ebool');
      
      // eaddress
      const eaddr = await incoFHEProvider.encrypt('0x1234567890abcdef', 'eaddress');
      expect(eaddr.encryption_type).toBe('eaddress');
    });
    
    test('should perform FHE addition', async () => {
      const a = await incoFHEProvider.encrypt(100, 'euint64');
      const b = await incoFHEProvider.encrypt(200, 'euint64');
      
      const result = await incoFHEProvider.fheAdd(a, b);
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.encrypted_result).toBeDefined();
      expect(result.computation_proof).toBeDefined();
      expect(result.gas_used).toBe(50000);
    });
    
    test('should perform FHE subtraction', async () => {
      const a = await incoFHEProvider.encrypt(500, 'euint64');
      const b = await incoFHEProvider.encrypt(200, 'euint64');
      
      const result = await incoFHEProvider.fheSub(a, b);
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.encrypted_result).toContain('fhe_sub');
    });
    
    test('should perform FHE multiplication', async () => {
      const a = await incoFHEProvider.encrypt(10, 'euint64');
      const b = await incoFHEProvider.encrypt(20, 'euint64');
      
      const result = await incoFHEProvider.fheMul(a, b);
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.gas_used).toBe(100000); // Mul costs more
    });
    
    test('should perform FHE less than comparison', async () => {
      const a = await incoFHEProvider.encrypt(100, 'euint64');
      const b = await incoFHEProvider.encrypt(200, 'euint64');
      
      const result = await incoFHEProvider.fheLt(a, b);
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.encrypted_result).toContain('fhe_lt');
    });
    
    test('should perform FHE select (conditional)', async () => {
      const condition = await incoFHEProvider.encrypt(true, 'ebool');
      const ifTrue = await incoFHEProvider.encrypt(100, 'euint64');
      const ifFalse = await incoFHEProvider.encrypt(200, 'euint64');
      
      const result = await incoFHEProvider.fheSelect(condition, ifTrue, ifFalse);
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.encrypted_result).toContain('fhe_select');
    });
    
    test('should send confidential message', async () => {
      const message = await incoFHEProvider.sendConfidentialMessage(
        'sender_123',
        'recipient_456',
        'Hello, this is a secret message!',
        3600
      );
      
      expect(message).toBeDefined();
      expect(message.message_id).toBeDefined();
      expect(message.sender).toBe('sender_123');
      expect(message.recipient).toBe('recipient_456');
      expect(message.encrypted_payload).toBeDefined();
      expect(message.expires_at).toBeGreaterThan(Date.now());
    });
    
    test('should create encrypted state', async () => {
      const state = await incoFHEProvider.createEncryptedState(
        'owner_123',
        { balance: 1000, locked: false }
      );
      
      expect(state).toBeDefined();
      expect(state.state_id).toBeDefined();
      expect(state.encrypted_state).toBeDefined();
      expect(state.access_key).toBeDefined();
    });
    
    test('should submit private bid', async () => {
      const bid = await incoFHEProvider.submitPrivateBid(
        'auction_123',
        'bidder_456',
        5000
      );
      
      expect(bid).toBeDefined();
      expect(bid.bid_id).toBeDefined();
      expect(bid.encrypted_amount).toBeDefined();
      expect(bid.commitment).toBeDefined();
    });
    
    test('should submit private vote', async () => {
      const vote = await incoFHEProvider.submitPrivateVote(
        'proposal_789',
        'voter_abc',
        true,
        100
      );
      
      expect(vote).toBeDefined();
      expect(vote.vote_id).toBeDefined();
      expect(vote.encrypted_vote).toBeDefined();
      expect(vote.encrypted_power).toBeDefined();
      expect(vote.receipt).toBeDefined();
    });
    
    test('should generate private random', async () => {
      const random = await incoFHEProvider.generatePrivateRandom(
        'requester_123',
        1,
        100
      );
      
      expect(random).toBeDefined();
      expect(random.random_id).toBeDefined();
      expect(random.encrypted_random).toBeDefined();
      expect(random.commitment).toBeDefined();
      expect(random.reveal_block).toBeGreaterThan(Date.now());
    });
    
    test('should perform encrypted threshold check', async () => {
      const value = await incoFHEProvider.encrypt(500, 'euint64');
      const threshold = await incoFHEProvider.encrypt(1000, 'euint64');
      
      const result = await incoFHEProvider.encryptedThresholdCheck(value, threshold);
      
      expect(result).toBeDefined();
      expect(result.result_id).toBeDefined();
      expect(result.encrypted_result).toBeDefined();
      expect(result.proof).toBeDefined();
    });
    
    test('should aggregate encrypted balances', async () => {
      const balances = [
        await incoFHEProvider.encrypt(100, 'euint64'),
        await incoFHEProvider.encrypt(200, 'euint64'),
        await incoFHEProvider.encrypt(300, 'euint64')
      ];
      
      const result = await incoFHEProvider.aggregateEncryptedBalances(balances);
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.gas_used).toBe(150000); // 50k * 3
    });
    
    test('should handle empty balance aggregation', async () => {
      const result = await incoFHEProvider.aggregateEncryptedBalances([]);
      
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
    });
    
    test('should create time lock', async () => {
      const futureTime = Date.now() + 60000; // 1 minute from now
      const lock = await incoFHEProvider.createTimeLock(1000, futureTime);
      
      expect(lock).toBeDefined();
      expect(lock.lock_id).toBeDefined();
      expect(lock.encrypted_value).toBeDefined();
      expect(lock.unlock_at).toBe(futureTime);
      expect(lock.proof).toBeDefined();
    });
  });
  
  // ============================================
  // NOIR ZK TESTS
  // ============================================
  
  describe('Noir ZK Circuits Provider', () => {
    
    test('should get available circuits', () => {
      const circuits = noirCircuitsProvider.getAvailableCircuits();
      
      expect(circuits).toBeDefined();
      expect(Array.isArray(circuits)).toBe(true);
      expect(circuits.length).toBeGreaterThan(0);
      
      // Check circuit structure
      const circuit = circuits[0];
      expect(circuit.name).toBeDefined();
      expect(circuit.description).toBeDefined();
      expect(circuit.public_inputs).toBeDefined();
      expect(circuit.private_inputs).toBeDefined();
      expect(circuit.constraints).toBeDefined();
    });
    
    test('should get specific circuit by name', () => {
      const circuit = noirCircuitsProvider.getCircuit('balance_threshold');
      
      expect(circuit).toBeDefined();
      expect(circuit?.name).toBe('balance_threshold');
      expect(circuit?.public_inputs).toContain('threshold');
      expect(circuit?.private_inputs).toContain('actual_balance');
    });
    
    test('should return undefined for unknown circuit', () => {
      const circuit = noirCircuitsProvider.getCircuit('nonexistent_circuit');
      expect(circuit).toBeUndefined();
    });
    
    test('should get stats', () => {
      const stats = noirCircuitsProvider.getStats();
      
      expect(stats).toBeDefined();
      expect(stats.sdkAvailable).toBeDefined();
      expect(stats.circuitCount).toBeGreaterThan(0);
      expect(stats.proofsGenerated).toBeDefined();
      expect(stats.proofsVerified).toBeDefined();
    });
    
    test('should generate balance threshold proof', async () => {
      const proof = await noirCircuitsProvider.proveBalanceThreshold(
        5000,  // actual balance
        1000,  // threshold
        'SOL',
        'sig_wallet_123'
      );
      
      expect(proof).toBeDefined();
      expect(proof.proof).toBeDefined();
      expect(proof.proof.startsWith('0x')).toBe(true);
      expect(proof.verification_key).toBeDefined();
      expect(proof.public_outputs.meets_threshold).toBe(true);
      expect(proof.proving_time_ms).toBeGreaterThanOrEqual(0);
    });
    
    test('should generate proof when balance below threshold', async () => {
      const proof = await noirCircuitsProvider.proveBalanceThreshold(
        500,   // actual balance (below threshold)
        1000,  // threshold
        'SOL',
        'sig_wallet_123'
      );
      
      expect(proof).toBeDefined();
      expect(proof.public_outputs.meets_threshold).toBe(false);
    });
    
    test('should generate credential ownership proof', async () => {
      const proof = await noirCircuitsProvider.proveCredentialOwnership(
        { type: 'degree', issuer: 'MIT', year: 2020 },
        'education',
        'issuer_pubkey_123',
        'owner_sig_456'
      );
      
      expect(proof).toBeDefined();
      expect(proof.proof).toBeDefined();
      expect(proof.circuit_hash).toContain('credential_ownership');
    });
    
    test('should generate set membership proof', async () => {
      const proof = await noirCircuitsProvider.proveSetMembership(
        { member_id: 'user_123' },
        ['path1', 'path2', 'path3'],
        'merkle_root_abc',
        'set_whitelist'
      );
      
      expect(proof).toBeDefined();
      expect(proof.proof).toBeDefined();
    });
    
    test('should generate KYC compliance proof', async () => {
      const proof = await noirCircuitsProvider.proveKYCCompliance(
        { name: 'John Doe', dob: '1990-01-01', ssn_hash: 'xxx' },
        'verifier_attestation_123',
        'accredited',
        'US'
      );
      
      expect(proof).toBeDefined();
      expect(proof.public_outputs.is_compliant).toBe(true);
      expect(proof.public_outputs.compliance_level).toBe('accredited');
      expect(proof.public_outputs.jurisdiction).toBe('US');
    });
    
    test('should generate credit score range proof', async () => {
      const proof = await noirCircuitsProvider.proveCreditScoreRange(
        750,  // actual score
        700,  // min
        850,  // max
        'lender_abc'
      );
      
      expect(proof).toBeDefined();
      expect(proof.public_outputs.score_in_range).toBe(true);
      expect(proof.public_outputs.min_score).toBe(700);
      expect(proof.public_outputs.max_score).toBe(850);
    });
    
    test('should generate proof when score out of range', async () => {
      const proof = await noirCircuitsProvider.proveCreditScoreRange(
        600,  // actual score (below min)
        700,  // min
        850,  // max
        'lender_abc'
      );
      
      expect(proof).toBeDefined();
      expect(proof.public_outputs.score_in_range).toBe(false);
    });
    
    test('should generate NFT ownership proof', async () => {
      const proof = await noirCircuitsProvider.proveNFTOwnership(
        'nft_mint_123',
        'collection_abc',
        'merkle_root_xyz',
        ['proof1', 'proof2']
      );
      
      expect(proof).toBeDefined();
      expect(proof.public_outputs.owns_nft_in_collection).toBe(true);
      expect(proof.public_outputs.collection_address).toBe('collection_abc');
    });
    
    test('should generate income verification proof', async () => {
      const proof = await noirCircuitsProvider.proveIncomeVerification(
        150000,  // actual income
        100000,  // threshold
        'USD'
      );
      
      expect(proof).toBeDefined();
      expect(proof.public_outputs.meets_income_threshold).toBe(true);
      expect(proof.public_outputs.currency).toBe('USD');
    });
    
    test('should generate generic proof', async () => {
      const proof = await noirCircuitsProvider.generateProof(
        'age_verification',
        { minimum_age: 21, current_timestamp: Date.now() },
        { birthdate: '1990-01-01', identity_signature: 'sig_123' }
      );
      
      expect(proof).toBeDefined();
      expect(proof.proof).toBeDefined();
      expect(proof.verification_key).toBeDefined();
    });
    
    test('should throw error for unknown circuit', async () => {
      await expect(
        noirCircuitsProvider.generateProof(
          'unknown_circuit',
          {},
          {}
        )
      ).rejects.toThrow('Circuit unknown_circuit not found');
    });
    
    test('should verify proof', async () => {
      const proof = await noirCircuitsProvider.proveBalanceThreshold(
        5000, 1000, 'SOL', 'sig'
      );
      
      const result = await noirCircuitsProvider.verifyProof(
        proof.proof,
        'vk_balance_threshold_v1',
        { threshold: 1000 }
      );
      
      expect(result).toBeDefined();
      expect(result.valid).toBeDefined();
      expect(result.circuit_name).toBe('balance_threshold');
      expect(result.verification_time_ms).toBeGreaterThanOrEqual(0);
    });
  });
  
  // ============================================
  // EDGE CASES & ERROR HANDLING
  // ============================================
  
  describe('Edge Cases & Error Handling', () => {
    
    test('Arcium: should handle empty inputs', async () => {
      const result = await arciumProvider.submitComputation({
        programId: '',
        inputs: {}
      });
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });
    
    test('Arcium: should handle large data encryption', () => {
      const largeData = { array: Array(1000).fill({ value: 'test' }) };
      const encrypted = arciumProvider.encryptForMPC(largeData);
      
      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.ciphertext.length).toBeGreaterThan(100);
    });
    
    test('Inco: should handle zero value encryption', async () => {
      const encrypted = await incoFHEProvider.encrypt(0, 'euint64');
      expect(encrypted.ciphertext).toBeDefined();
    });
    
    test('Inco: should handle max value encryption', async () => {
      const encrypted = await incoFHEProvider.encrypt(Number.MAX_SAFE_INTEGER, 'euint64');
      expect(encrypted.ciphertext).toBeDefined();
    });
    
    test('Inco: should handle boolean false', async () => {
      const encrypted = await incoFHEProvider.encrypt(false, 'ebool');
      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.encryption_type).toBe('ebool');
    });
    
    test('Noir: should handle edge case thresholds', async () => {
      // Exact threshold match
      const proof = await noirCircuitsProvider.proveBalanceThreshold(
        1000, 1000, 'SOL', 'sig'
      );
      expect(proof.public_outputs.meets_threshold).toBe(true);
      
      // Just below threshold
      const proof2 = await noirCircuitsProvider.proveBalanceThreshold(
        999, 1000, 'SOL', 'sig'
      );
      expect(proof2.public_outputs.meets_threshold).toBe(false);
    });
    
    test('Noir: should handle zero threshold', async () => {
      const proof = await noirCircuitsProvider.proveBalanceThreshold(
        100, 0, 'SOL', 'sig'
      );
      expect(proof.public_outputs.meets_threshold).toBe(true);
    });
    
    test('should handle concurrent operations', async () => {
      const operations = [
        arciumProvider.submitComputation({ programId: 'test', inputs: { op: 1 } }),
        incoFHEProvider.encrypt(100, 'euint64'),
        noirCircuitsProvider.proveBalanceThreshold(5000, 1000, 'SOL', 'sig'),
        incoFHEProvider.encrypt(200, 'euint64'),
        arciumProvider.submitComputation({ programId: 'test', inputs: { op: 2 } })
      ];
      
      const results = await Promise.all(operations);
      
      expect(results).toHaveLength(5);
      results.forEach(result => {
        expect(result).toBeDefined();
      });
    });
  });
});
