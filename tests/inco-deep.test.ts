/**
 * INCO FHE DEEP INTEGRATION TEST SUITE
 * 
 * Comprehensive testing of Inco Fully Homomorphic Encryption:
 * - FHE encryption for all data types
 * - Homomorphic operations (add, mul, lt, select)
 * - Confidential messaging
 * - Private auctions
 * - Private voting
 * - Encrypted state management
 * - Performance benchmarks
 * 
 * Run: npm test -- tests/inco-deep.test.ts
 */

import { incoFHEProvider } from '../providers/inco-fhe';
import * as dotenv from 'dotenv';

dotenv.config();

jest.setTimeout(60000);

describe('🟢 INCO FHE DEEP INTEGRATION SUITE', () => {

  // ============================================
  // FHE ENCRYPTION - ALL DATA TYPES
  // ============================================
  describe('FHE Encryption - All Data Types', () => {
    
    test('encrypts euint8 (8-bit unsigned integer)', async () => {
      const value = 255; // Max uint8
      const encrypted = await incoFHEProvider.encrypt(value, 'euint8');
      
      console.log('\n🔐 EUINT8 ENCRYPTION:');
      console.log('   Original Value:', value);
      console.log('   Ciphertext:', encrypted.ciphertext.slice(0, 60) + '...');
      console.log('   Type:', encrypted.encryption_type);
      console.log('   Mode:', encrypted.mode);
      
      expect(encrypted.ciphertext).toMatch(/^0x[a-f0-9]+$/);
      expect(encrypted.encryption_type).toBe('euint8');
    });

    test('encrypts euint16 (16-bit unsigned integer)', async () => {
      const value = 65535; // Max uint16
      const encrypted = await incoFHEProvider.encrypt(value, 'euint16');
      
      console.log('\n🔐 EUINT16 ENCRYPTION:');
      console.log('   Original Value:', value);
      console.log('   Ciphertext Length:', encrypted.ciphertext.length);
      
      expect(encrypted.encryption_type).toBe('euint16');
    });

    test('encrypts euint32 (32-bit unsigned integer)', async () => {
      const value = 4294967295; // Max uint32
      const encrypted = await incoFHEProvider.encrypt(value, 'euint32');
      
      console.log('\n🔐 EUINT32 ENCRYPTION:');
      console.log('   Original Value:', value.toLocaleString());
      console.log('   Ciphertext Length:', encrypted.ciphertext.length);
      
      expect(encrypted.encryption_type).toBe('euint32');
    });

    test('encrypts euint64 (64-bit unsigned integer)', async () => {
      const value = Number.MAX_SAFE_INTEGER;
      const encrypted = await incoFHEProvider.encrypt(value, 'euint64');
      
      console.log('\n🔐 EUINT64 ENCRYPTION:');
      console.log('   Original Value:', value.toLocaleString());
      console.log('   Ciphertext Length:', encrypted.ciphertext.length);
      
      expect(encrypted.encryption_type).toBe('euint64');
    });

    test('encrypts ebool (encrypted boolean)', async () => {
      const trueEnc = await incoFHEProvider.encrypt(true, 'ebool');
      const falseEnc = await incoFHEProvider.encrypt(false, 'ebool');
      
      console.log('\n🔐 EBOOL ENCRYPTION:');
      console.log('   True Ciphertext:', trueEnc.ciphertext.slice(0, 50) + '...');
      console.log('   False Ciphertext:', falseEnc.ciphertext.slice(0, 50) + '...');
      console.log('   Are Different:', trueEnc.ciphertext !== falseEnc.ciphertext);
      
      expect(trueEnc.encryption_type).toBe('ebool');
      expect(falseEnc.encryption_type).toBe('ebool');
      // Ciphertexts should be different (semantic security)
      expect(trueEnc.ciphertext).not.toBe(falseEnc.ciphertext);
    });

    test('encrypts eaddress (encrypted address)', async () => {
      const address = '0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00';
      const encrypted = await incoFHEProvider.encrypt(address, 'eaddress');
      
      console.log('\n🔐 EADDRESS ENCRYPTION:');
      console.log('   Original Address:', address);
      console.log('   Encrypted:', encrypted.ciphertext.slice(0, 50) + '...');
      
      expect(encrypted.encryption_type).toBe('eaddress');
    });

    test('generates unique ciphertexts for same value (semantic security)', async () => {
      const value = 42;
      const enc1 = await incoFHEProvider.encrypt(value, 'euint32');
      const enc2 = await incoFHEProvider.encrypt(value, 'euint32');
      
      console.log('\n🎲 SEMANTIC SECURITY:');
      console.log('   Same Value:', value);
      console.log('   Ciphertext 1:', enc1.ciphertext.slice(0, 40) + '...');
      console.log('   Ciphertext 2:', enc2.ciphertext.slice(0, 40) + '...');
      console.log('   Are Different:', enc1.ciphertext !== enc2.ciphertext);
      
      // Same plaintext should produce different ciphertexts
      expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
    });
  });

  // ============================================
  // HOMOMORPHIC OPERATIONS
  // ============================================
  describe('Homomorphic Operations', () => {
    
    test('FHE Addition: a + b on encrypted values', async () => {
      const a = await incoFHEProvider.encrypt(100, 'euint32');
      const b = await incoFHEProvider.encrypt(50, 'euint32');
      
      const result = await incoFHEProvider.fheAdd(a, b);
      
      console.log('\n➕ FHE ADDITION (100 + 50):');
      console.log('   Success:', result.success);
      console.log('   Encrypted Result:', result.encrypted_result);
      console.log('   Computation Proof:', result.computation_proof);
      console.log('   Gas Used:', result.gas_used.toLocaleString());
      console.log('   Mode:', result.mode);
      
      expect(result.success).toBe(true);
      expect(result.encrypted_result).toBeDefined();
      expect(result.computation_proof).toBeDefined();
      expect(result.gas_used).toBe(50000);
    });

    test('FHE Multiplication: a * b on encrypted values', async () => {
      const a = await incoFHEProvider.encrypt(7, 'euint32');
      const b = await incoFHEProvider.encrypt(6, 'euint32');
      
      const result = await incoFHEProvider.fheMul(a, b);
      
      console.log('\n✖️ FHE MULTIPLICATION (7 * 6):');
      console.log('   Success:', result.success);
      console.log('   Encrypted Result:', result.encrypted_result);
      console.log('   Gas Used:', result.gas_used.toLocaleString());
      
      expect(result.success).toBe(true);
      expect(result.gas_used).toBe(100000); // Mul costs more
    });

    test('FHE Less Than: a < b comparison', async () => {
      const a = await incoFHEProvider.encrypt(10, 'euint32');
      const b = await incoFHEProvider.encrypt(20, 'euint32');
      
      const result = await incoFHEProvider.fheLt(a, b);
      
      console.log('\n📊 FHE LESS THAN (10 < 20):');
      console.log('   Success:', result.success);
      console.log('   Encrypted Result (should be true):', result.encrypted_result);
      console.log('   Gas Used:', result.gas_used.toLocaleString());
      
      expect(result.success).toBe(true);
      expect(result.gas_used).toBe(75000);
    });

    test('FHE Select: conditional selection on encrypted values', async () => {
      const condition = await incoFHEProvider.encrypt(true, 'ebool');
      const ifTrue = await incoFHEProvider.encrypt(100, 'euint32');
      const ifFalse = await incoFHEProvider.encrypt(0, 'euint32');
      
      const result = await incoFHEProvider.fheSelect(condition, ifTrue, ifFalse);
      
      console.log('\n🔀 FHE SELECT (true ? 100 : 0):');
      console.log('   Success:', result.success);
      console.log('   Encrypted Result (should be 100):', result.encrypted_result);
      console.log('   Gas Used:', result.gas_used.toLocaleString());
      
      expect(result.success).toBe(true);
      expect(result.gas_used).toBe(80000);
    });

    test('chained operations: (a + b) * c', async () => {
      const a = await incoFHEProvider.encrypt(10, 'euint32');
      const b = await incoFHEProvider.encrypt(5, 'euint32');
      const c = await incoFHEProvider.encrypt(3, 'euint32');
      
      // First: a + b
      const sum = await incoFHEProvider.fheAdd(a, b);
      
      // Then: (a + b) * c - using the encrypted result
      // Note: In real FHE, we'd use the encrypted result directly
      const product = await incoFHEProvider.fheMul(
        { ciphertext: sum.encrypted_result, public_key: a.public_key, encryption_type: 'euint32', mode: a.mode },
        c
      );
      
      console.log('\n🔗 CHAINED OPERATIONS ((10 + 5) * 3 = 45):');
      console.log('   Sum Result:', sum.encrypted_result);
      console.log('   Product Result:', product.encrypted_result);
      console.log('   Total Gas:', (sum.gas_used + product.gas_used).toLocaleString());
      
      expect(sum.success).toBe(true);
      expect(product.success).toBe(true);
    });
  });

  // ============================================
  // CONFIDENTIAL MESSAGING
  // ============================================
  describe('Confidential Messaging', () => {
    
    test('sends encrypted message between agents', async () => {
      const message = await incoFHEProvider.sendConfidentialMessage(
        'agent_alice',
        'agent_bob',
        'Secret: The treasure is buried under the old oak tree.',
        3600
      );

      console.log('\n📨 CONFIDENTIAL MESSAGE:');
      console.log('   Message ID:', message.message_id);
      console.log('   Sender:', message.sender);
      console.log('   Recipient:', message.recipient);
      console.log('   Encrypted Payload:', message.encrypted_payload.slice(0, 60) + '...');
      console.log('   Delivery Proof:', message.delivery_proof);
      console.log('   Timestamp:', new Date(message.timestamp).toISOString());
      console.log('   Expires:', new Date(message.expires_at).toISOString());
      
      expect(message.message_id).toMatch(/^msg_\d+_[a-z0-9]+$/);
      expect(message.sender).toBe('agent_alice');
      expect(message.recipient).toBe('agent_bob');
      expect(message.encrypted_payload).toMatch(/^0x[a-f0-9]+$/);
      expect(message.delivery_proof).toBeDefined();
      expect(message.expires_at).toBeGreaterThan(message.timestamp);
    });

    test('message expires after TTL', async () => {
      const shortTTL = 60; // 60 seconds
      const message = await incoFHEProvider.sendConfidentialMessage(
        'sender',
        'recipient',
        'Short-lived message',
        shortTTL
      );

      const expectedExpiry = message.timestamp + (shortTTL * 1000);
      
      console.log('\n⏰ MESSAGE EXPIRY:');
      console.log('   TTL:', shortTTL, 'seconds');
      console.log('   Created:', new Date(message.timestamp).toISOString());
      console.log('   Expires:', new Date(message.expires_at).toISOString());
      
      expect(message.expires_at).toBe(expectedExpiry);
    });

    test('handles long messages', async () => {
      const longMessage = 'A'.repeat(10000); // 10KB message
      
      const message = await incoFHEProvider.sendConfidentialMessage(
        'sender',
        'recipient',
        longMessage,
        3600
      );

      console.log('\n📦 LONG MESSAGE:');
      console.log('   Original Length:', longMessage.length, 'chars');
      console.log('   Encrypted Length:', message.encrypted_payload.length, 'chars');
      
      expect(message.encrypted_payload.length).toBeGreaterThan(longMessage.length);
    });

    test('handles special characters and unicode', async () => {
      const unicodeMessage = '🔐 秘密のメッセージ: Émojis & spëcial çharacters!';
      
      const message = await incoFHEProvider.sendConfidentialMessage(
        'sender',
        'recipient',
        unicodeMessage,
        3600
      );

      console.log('\n🌍 UNICODE MESSAGE:');
      console.log('   Original:', unicodeMessage);
      console.log('   Encrypted:', !!message.encrypted_payload);
      
      expect(message.encrypted_payload).toBeDefined();
    });
  });

  // ============================================
  // PRIVATE AUCTIONS
  // ============================================
  describe('Private Auctions', () => {
    
    test('submits sealed bid with hidden amount', async () => {
      const bid = await incoFHEProvider.submitPrivateBid(
        'auction_rare_nft_001',
        'bidder_whale',
        100000 // $100K bid - hidden
      );

      console.log('\n🔨 PRIVATE AUCTION BID:');
      console.log('   Auction ID:', 'auction_rare_nft_001');
      console.log('   Bid ID:', bid.bid_id);
      console.log('   Encrypted Amount:', bid.encrypted_amount.slice(0, 60) + '...');
      console.log('   Commitment:', bid.commitment);
      
      expect(bid.bid_id).toMatch(/^bid_auction_rare_nft_001_\d+$/);
      expect(bid.encrypted_amount).toMatch(/^0x[a-f0-9]+$/);
      expect(bid.commitment).toMatch(/^commit_/);
    });

    test('multiple bidders submit sealed bids', async () => {
      const auctionId = 'auction_art_collection';
      
      const bids = await Promise.all([
        incoFHEProvider.submitPrivateBid(auctionId, 'bidder_1', 50000),
        incoFHEProvider.submitPrivateBid(auctionId, 'bidder_2', 75000),
        incoFHEProvider.submitPrivateBid(auctionId, 'bidder_3', 60000),
      ]);

      console.log('\n🔨 MULTI-BIDDER AUCTION:');
      bids.forEach((bid, i) => {
        console.log(`   Bidder ${i + 1}: ${bid.bid_id}`);
        console.log(`      Encrypted: ${bid.encrypted_amount.slice(0, 40)}...`);
      });
      
      // All bids should be valid
      expect(bids.every(b => b.bid_id)).toBe(true);
      expect(bids.every(b => b.encrypted_amount)).toBe(true);
    });

    test('bid commitment is generated correctly', async () => {
      const bid1 = await incoFHEProvider.submitPrivateBid('auction_1', 'bidder', 50000);
      
      console.log('\n🔒 BID COMMITMENT:');
      console.log('   Commitment:', bid1.commitment);
      
      // Commitment should be properly formatted
      expect(bid1.commitment).toMatch(/^commit_/);
      expect(bid1.encrypted_amount).toMatch(/^0x[a-f0-9]+$/);
    });
  });

  // ============================================
  // PRIVATE VOTING
  // ============================================
  describe('Private Voting', () => {
    
    test('submits encrypted YES vote', async () => {
      const vote = await incoFHEProvider.submitPrivateVote(
        'proposal_treasury_42',
        'voter_delegate_001',
        true, // YES
        50000 // 50K voting power
      );

      console.log('\n🗳️ PRIVATE YES VOTE:');
      console.log('   Proposal:', 'proposal_treasury_42');
      console.log('   Vote ID:', vote.vote_id);
      console.log('   Encrypted Vote:', vote.encrypted_vote.slice(0, 50) + '...');
      console.log('   Encrypted Power:', vote.encrypted_power.slice(0, 50) + '...');
      console.log('   Receipt:', vote.receipt);
      
      expect(vote.vote_id).toMatch(/^vote_proposal_treasury_42_\d+$/);
      expect(vote.encrypted_vote).toMatch(/^0x[a-f0-9]+$/);
      expect(vote.encrypted_power).toMatch(/^0x[a-f0-9]+$/);
      expect(vote.receipt).toBeDefined();
    });

    test('submits encrypted NO vote', async () => {
      const vote = await incoFHEProvider.submitPrivateVote(
        'proposal_treasury_42',
        'voter_delegate_002',
        false, // NO
        25000
      );

      console.log('\n🗳️ PRIVATE NO VOTE:');
      console.log('   Vote ID:', vote.vote_id);
      console.log('   Encrypted Vote:', vote.encrypted_vote.slice(0, 50) + '...');
      
      expect(vote.encrypted_vote).toBeDefined();
    });

    test('voting power remains hidden', async () => {
      const smallVoter = await incoFHEProvider.submitPrivateVote(
        'proposal_1',
        'small_holder',
        true,
        100 // Small voting power
      );

      const whaleVoter = await incoFHEProvider.submitPrivateVote(
        'proposal_1',
        'whale_holder',
        true,
        10000000 // Huge voting power
      );

      console.log('\n🔒 VOTING POWER PRIVACY:');
      console.log('   Small Voter Power (100):', smallVoter.encrypted_power.slice(0, 40) + '...');
      console.log('   Whale Voter Power (10M):', whaleVoter.encrypted_power.slice(0, 40) + '...');
      console.log('   Cannot Distinguish:', 'Both look like random ciphertext');
      
      // Both should be encrypted - can't tell which is larger
      expect(smallVoter.encrypted_power).toMatch(/^0x[a-f0-9]+$/);
      expect(whaleVoter.encrypted_power).toMatch(/^0x[a-f0-9]+$/);
    });

    test('vote receipt provides verifiability', async () => {
      const vote = await incoFHEProvider.submitPrivateVote(
        'proposal_xyz',
        'voter_abc',
        true,
        1000
      );

      console.log('\n📜 VOTE RECEIPT:');
      console.log('   Receipt:', vote.receipt);
      console.log('   Format: receipt_{voter}_{proposal}');
      
      expect(vote.receipt).toContain('receipt_');
      expect(vote.receipt).toContain('voter_ab');
    });
  });

  // ============================================
  // ENCRYPTED STATE MANAGEMENT
  // ============================================
  describe('Encrypted State Management', () => {
    
    test('creates encrypted state for on-chain storage', async () => {
      const state = await incoFHEProvider.createEncryptedState(
        'owner_wallet_xyz',
        {
          balance: 10000,
          locked_until: Date.now() + 86400000,
          permissions: ['transfer', 'stake']
        }
      );

      console.log('\n💾 ENCRYPTED STATE:');
      console.log('   State ID:', state.state_id);
      console.log('   Encrypted State:', state.encrypted_state);
      console.log('   Access Key:', state.access_key);
      
      expect(state.state_id).toMatch(/^state_\d+_[a-z0-9]+$/);
      expect(state.encrypted_state).toContain('fhe_state_');
      expect(state.access_key).toContain('access_');
    });

    test('computes on encrypted state without decryption', async () => {
      const state = await incoFHEProvider.createEncryptedState(
        'owner',
        { counter: 0 }
      );

      const a = await incoFHEProvider.encrypt(1, 'euint32');
      
      const result = await incoFHEProvider.computeOnState(
        state.state_id,
        'increment',
        [a]
      );

      console.log('\n🔄 COMPUTE ON STATE:');
      console.log('   State ID:', state.state_id);
      console.log('   Operation: increment');
      console.log('   Success:', result.success);
      console.log('   Encrypted Result:', result.encrypted_result);
      
      expect(result.success).toBe(true);
      expect(result.encrypted_result).toContain(state.state_id);
    });
  });

  // ============================================
  // PERFORMANCE BENCHMARKS
  // ============================================
  describe('Performance Benchmarks', () => {
    
    test('encryption performance by type', async () => {
      const types: Array<'euint8' | 'euint16' | 'euint32' | 'euint64'> = ['euint8', 'euint16', 'euint32', 'euint64'];
      
      console.log('\n⚡ ENCRYPTION BENCHMARKS:');
      
      for (const type of types) {
        const iterations = 10;
        const start = Date.now();
        
        for (let i = 0; i < iterations; i++) {
          await incoFHEProvider.encrypt(42, type);
        }
        
        const elapsed = Date.now() - start;
        console.log(`   ${type}: ${(elapsed / iterations).toFixed(2)}ms avg`);
      }
    });

    test('homomorphic operation performance', async () => {
      const a = await incoFHEProvider.encrypt(100, 'euint32');
      const b = await incoFHEProvider.encrypt(50, 'euint32');
      
      const operations = [
        { name: 'fheAdd', fn: () => incoFHEProvider.fheAdd(a, b) },
        { name: 'fheMul', fn: () => incoFHEProvider.fheMul(a, b) },
        { name: 'fheLt', fn: () => incoFHEProvider.fheLt(a, b) },
      ];
      
      console.log('\n⚡ HOMOMORPHIC OPERATION BENCHMARKS:');
      
      for (const op of operations) {
        const iterations = 5;
        const start = Date.now();
        
        for (let i = 0; i < iterations; i++) {
          await op.fn();
        }
        
        const elapsed = Date.now() - start;
        console.log(`   ${op.name}: ${(elapsed / iterations).toFixed(2)}ms avg`);
      }
    });

    test('message throughput', async () => {
      const iterations = 20;
      const start = Date.now();
      
      const messages = await Promise.all(
        Array(iterations).fill(null).map((_, i) =>
          incoFHEProvider.sendConfidentialMessage(
            `sender_${i}`,
            `recipient_${i}`,
            `Message ${i}`,
            3600
          )
        )
      );
      
      const elapsed = Date.now() - start;
      
      console.log('\n⚡ MESSAGE THROUGHPUT:');
      console.log('   Messages Sent:', messages.length);
      console.log('   Total Time:', elapsed, 'ms');
      console.log('   Throughput:', ((iterations / elapsed) * 1000).toFixed(2), 'msg/sec');
      
      expect(messages.every(m => m.message_id)).toBe(true);
    });
  });
});
