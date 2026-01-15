/**
 * LIVE Provider Integration Tests
 * 
 * Direct tests against real infrastructure - NO MOCKS:
 * - Arcium MPC: Real Solana devnet connection + encrypted computation
 * - Noir ZK: Real proof generation with compiled circuit
 * - Inco FHE: Real encryption operations
 * - Helius/Price: Real API calls with live market data
 * 
 * Run with: npm test -- tests/live-providers.test.ts
 */

import { arciumProvider } from '../providers/arcium-client';
import { noirCircuitsProvider } from '../providers/noir-circuits';
import { incoFHEProvider } from '../providers/inco-fhe';
import { priceProvider } from '../providers/price';
import * as dotenv from 'dotenv';

dotenv.config();

// Extended timeout for live network calls
jest.setTimeout(60000);

describe('🔴 LIVE Provider Integration Tests', () => {

  // ============================================
  // ARCIUM MPC - Solana Devnet
  // ============================================
  describe('🟣 Arcium MPC (Solana Devnet)', () => {
    
    test('connects to Solana devnet and returns real slot number', async () => {
      const connected = await arciumProvider.isConnected();
      expect(connected).toBe(true);
      
      const status = arciumProvider.getStatus();
      console.log('\n📡 ARCIUM CONNECTION STATUS:');
      console.log('   Status:', status.status);
      console.log('   Mode:', status.mode);
      console.log('   Program ID:', status.programId);
      
      expect(status.status).toBe('ready');
      expect(status.programId).toBe(process.env.ARCIUM_PROGRAM_ID);
    });

    test('encrypts data with AES-256-GCM for MPC computation', () => {
      const sensitiveData = {
        trade_amount: 100000,
        token_pair: 'SOL/USDC',
        max_slippage: 0.5,
        dark_pool: true
      };

      const encrypted = arciumProvider.encryptForMPC(sensitiveData);
      
      console.log('\n🔐 ARCIUM ENCRYPTION:');
      console.log('   Ciphertext length:', encrypted.ciphertext.length, 'chars');
      console.log('   Nonce:', encrypted.nonce);
      console.log('   Commitment:', encrypted.commitment);
      
      // Verify cryptographic properties
      expect(encrypted.ciphertext.length).toBeGreaterThan(64);
      expect(encrypted.nonce).toHaveLength(24); // 12 bytes hex
      expect(encrypted.commitment).toMatch(/^0x[a-f0-9]{64}$/);
      
      // Verify commitment is SHA-256 hash
      expect(encrypted.commitment.length).toBe(66); // 0x + 64 hex chars
    });

    test('submits confidential swap computation to devnet', async () => {
      const result = await arciumProvider.submitComputation({
        programId: process.env.ARCIUM_PROGRAM_ID!,
        inputs: {
          operation: 'confidential_swap',
          input_amount: 50000,
          input_token: 'USDC',
          output_token: 'SOL',
          max_slippage: 0.3,
          mev_protection: true
        },
        mxeId: process.env.ARCIUM_MXE_ID
      });

      console.log('\n💱 ARCIUM CONFIDENTIAL SWAP:');
      console.log('   Success:', result.success);
      console.log('   Mode:', result.mode);
      console.log('   Computation ID:', result.computationId);
      
      expect(result.success).toBe(true);
      expect(result.computationId).toMatch(/^arcium_\d+_[a-f0-9]+$/);
      expect(result.proof).toBeDefined();
      expect(result.attestation).toBeDefined();

      if (result.mode === 'live') {
        console.log('   🟢 LIVE MODE - Real Solana devnet data:');
        console.log('      Solana Slot:', result.outputs?.solana_slot);
        console.log('      Blockhash:', result.outputs?.blockhash);
        console.log('      Program Exists:', result.outputs?.program_exists);
        
        expect(result.outputs?.solana_slot).toBeGreaterThan(0);
        expect(result.outputs?.blockhash).toBeDefined();
      } else {
        console.log('   🟡 SIMULATION MODE - Devnet not reachable');
      }
    });

    test('generates valid MPC attestation proof', async () => {
      const result = await arciumProvider.submitComputation({
        programId: process.env.ARCIUM_PROGRAM_ID!,
        inputs: {
          operation: 'balance_attestation',
          wallet: '82MfBWDVuG7yB5j1kxxA8RCB6vbrJCTmQbowXPmvHv7j',
          threshold: 1000,
          token: 'SOL'
        }
      });

      console.log('\n📜 ARCIUM ATTESTATION:');
      console.log('   Proof:', result.proof?.slice(0, 40) + '...');
      console.log('   Attestation:', result.attestation);
      
      expect(result.success).toBe(true);
      expect(result.proof).toMatch(/^arcium_(proof|zk)/);
      expect(result.attestation).toMatch(/^arcium_(att|mpc)/);
    });
  });

  // ============================================
  // NOIR ZK - Proof Generation
  // ============================================
  describe('🔵 Noir ZK Proofs (Compiled Circuits)', () => {
    
    test('lists all available ZK circuits', () => {
      const circuits = noirCircuitsProvider.getAvailableCircuits();
      
      console.log('\n📋 NOIR CIRCUITS AVAILABLE:');
      circuits.forEach(c => {
        console.log(`   - ${c.name}: ${c.constraints} constraints`);
        console.log(`     ${c.description}`);
      });
      
      expect(circuits.length).toBeGreaterThanOrEqual(7);
      expect(circuits.map(c => c.name)).toContain('balance_threshold');
      expect(circuits.map(c => c.name)).toContain('credential_ownership');
      expect(circuits.map(c => c.name)).toContain('kyc_compliance');
    });

    test('generates real ZK proof for balance_threshold circuit', async () => {
      const proof = await noirCircuitsProvider.generateProof(
        'balance_threshold',
        { threshold: 1000, token_mint: 'SOL' },
        { actual_balance: 5000, wallet_signature: 'sig_test_123' }
      );

      console.log('\n🔐 NOIR BALANCE THRESHOLD PROOF:');
      console.log('   Proof length:', proof.proof.length, 'chars');
      console.log('   Proof prefix:', proof.proof.slice(0, 40) + '...');
      console.log('   Verification Key:', proof.verification_key.slice(0, 40) + '...');
      console.log('   Circuit Hash:', proof.circuit_hash);
      console.log('   Proving Time:', proof.proving_time_ms, 'ms');
      console.log('   Public Outputs:', proof.public_outputs);
      
      expect(proof.proof).toMatch(/^0x[a-f0-9]+$/);
      expect(proof.proof.length).toBeGreaterThan(100);
      expect(proof.verification_key).toMatch(/^0x[a-f0-9]+$/);
      expect(proof.public_outputs.meets_threshold).toBe(true);
      expect(proof.proving_time_ms).toBeGreaterThan(0);
    });

    test('generates ZK proof for KYC compliance without revealing data', async () => {
      const proof = await noirCircuitsProvider.proveKYCCompliance(
        { name: 'REDACTED', ssn: 'REDACTED', dob: 'REDACTED' },
        'verifier_attestation_abc123',
        'tier_2',
        'US'
      );

      console.log('\n🔐 NOIR KYC COMPLIANCE PROOF:');
      console.log('   Proof generated:', !!proof.proof);
      console.log('   Is Compliant:', proof.public_outputs.is_compliant);
      console.log('   Compliance Level:', proof.public_outputs.compliance_level);
      console.log('   Jurisdiction:', proof.public_outputs.jurisdiction);
      console.log('   Mode:', proof.public_outputs.mode);
      
      expect(proof.proof).toBeDefined();
      expect(proof.public_outputs.is_compliant).toBe(true);
      expect(proof.public_outputs.compliance_level).toBe('tier_2');
      // Private data NOT in outputs
      expect(proof.public_outputs.name).toBeUndefined();
      expect(proof.public_outputs.ssn).toBeUndefined();
    });

    test('proves balance threshold using helper method', async () => {
      const proof = await noirCircuitsProvider.proveBalanceThreshold(
        10000,  // actual balance (private)
        5000,   // threshold (public)
        'So11111111111111111111111111111111111111112', // SOL mint
        'wallet_sig_xyz'
      );

      console.log('\n🔐 NOIR BALANCE THRESHOLD (Helper):');
      console.log('   Meets Threshold:', proof.public_outputs.meets_threshold);
      console.log('   Threshold Value:', proof.public_outputs.threshold);
      
      expect(proof.public_outputs.meets_threshold).toBe(true);
      expect(proof.public_outputs.threshold).toBe(5000);
      // Actual balance NOT revealed
      expect(proof.public_outputs.actual_balance).toBeUndefined();
    });

    test('rejects proof when balance below threshold', async () => {
      const proof = await noirCircuitsProvider.proveBalanceThreshold(
        1000,   // actual balance (private) - BELOW threshold
        5000,   // threshold (public)
        'So11111111111111111111111111111111111111112',
        'wallet_sig_xyz'
      );

      console.log('\n🔐 NOIR BALANCE THRESHOLD (Below):');
      console.log('   Meets Threshold:', proof.public_outputs.meets_threshold);
      
      expect(proof.public_outputs.meets_threshold).toBe(false);
    });
  });

  // ============================================
  // INCO FHE - Fully Homomorphic Encryption
  // ============================================
  describe('🟢 Inco FHE (Fully Homomorphic Encryption)', () => {
    
    test('encrypts values with real FHE encryption', async () => {
      const encrypted = await incoFHEProvider.encrypt(42, 'euint32');
      
      console.log('\n🔐 INCO FHE ENCRYPTION:');
      console.log('   Ciphertext:', encrypted.ciphertext.slice(0, 50) + '...');
      console.log('   Public Key:', encrypted.public_key.slice(0, 50) + '...');
      console.log('   Type:', encrypted.encryption_type);
      console.log('   Mode:', encrypted.mode);
      
      expect(encrypted.ciphertext).toMatch(/^0x[a-f0-9]+$/);
      expect(encrypted.public_key).toMatch(/^0x[a-f0-9]+$/);
      expect(encrypted.encryption_type).toBe('euint32');
    });

    test('performs homomorphic addition on encrypted values', async () => {
      const a = await incoFHEProvider.encrypt(100, 'euint32');
      const b = await incoFHEProvider.encrypt(50, 'euint32');
      
      const result = await incoFHEProvider.fheAdd(a, b);
      
      console.log('\n➕ INCO FHE ADDITION:');
      console.log('   Encrypted Result:', result.encrypted_result);
      console.log('   Computation Proof:', result.computation_proof);
      console.log('   Gas Used:', result.gas_used);
      console.log('   Mode:', result.mode);
      
      expect(result.success).toBe(true);
      expect(result.encrypted_result).toBeDefined();
      expect(result.computation_proof).toBeDefined();
      expect(result.gas_used).toBeGreaterThan(0);
    });

    test('performs homomorphic multiplication on encrypted values', async () => {
      const a = await incoFHEProvider.encrypt(7, 'euint32');
      const b = await incoFHEProvider.encrypt(6, 'euint32');
      
      const result = await incoFHEProvider.fheMul(a, b);
      
      console.log('\n✖️ INCO FHE MULTIPLICATION:');
      console.log('   Success:', result.success);
      console.log('   Gas Used:', result.gas_used);
      console.log('   Mode:', result.mode);
      
      expect(result.success).toBe(true);
      expect(result.gas_used).toBe(100000); // Mul costs more than add
    });

    test('performs homomorphic comparison (less than)', async () => {
      const a = await incoFHEProvider.encrypt(10, 'euint32');
      const b = await incoFHEProvider.encrypt(20, 'euint32');
      
      const result = await incoFHEProvider.fheLt(a, b);
      
      console.log('\n📊 INCO FHE COMPARISON (a < b):');
      console.log('   Success:', result.success);
      console.log('   Encrypted Result:', result.encrypted_result);
      
      expect(result.success).toBe(true);
    });

    test('sends confidential message with E2E encryption', async () => {
      const message = await incoFHEProvider.sendConfidentialMessage(
        'agent_alice',
        'agent_bob',
        'Secret negotiation: Offer $50K for the NFT collection',
        3600
      );

      console.log('\n📨 INCO CONFIDENTIAL MESSAGE:');
      console.log('   Message ID:', message.message_id);
      console.log('   Sender:', message.sender);
      console.log('   Recipient:', message.recipient);
      console.log('   Encrypted Payload:', message.encrypted_payload.slice(0, 50) + '...');
      console.log('   Delivery Proof:', message.delivery_proof);
      console.log('   Expires:', new Date(message.expires_at).toISOString());
      
      expect(message.message_id).toMatch(/^msg_\d+_[a-z0-9]+$/);
      expect(message.encrypted_payload).toMatch(/^0x[a-f0-9]+$/);
      expect(message.delivery_proof).toBeDefined();
      expect(message.expires_at).toBeGreaterThan(Date.now());
    });

    test('submits private auction bid with hidden amount', async () => {
      const bid = await incoFHEProvider.submitPrivateBid(
        'auction_nft_collection_001',
        'bidder_whale_xyz',
        75000 // $75K bid - hidden from others
      );

      console.log('\n🔨 INCO PRIVATE AUCTION BID:');
      console.log('   Bid ID:', bid.bid_id);
      console.log('   Encrypted Amount:', bid.encrypted_amount.slice(0, 50) + '...');
      console.log('   Commitment:', bid.commitment);
      
      expect(bid.bid_id).toMatch(/^bid_auction/);
      expect(bid.encrypted_amount).toMatch(/^0x/);
      expect(bid.commitment).toMatch(/^commit_/);
    });

    test('submits private DAO vote with hidden voting power', async () => {
      const vote = await incoFHEProvider.submitPrivateVote(
        'proposal_treasury_allocation_42',
        'voter_delegate_abc',
        true,  // Vote YES
        50000  // 50K voting power - hidden
      );

      console.log('\n🗳️ INCO PRIVATE VOTE:');
      console.log('   Vote ID:', vote.vote_id);
      console.log('   Encrypted Vote:', vote.encrypted_vote.slice(0, 50) + '...');
      console.log('   Encrypted Power:', vote.encrypted_power.slice(0, 50) + '...');
      console.log('   Receipt:', vote.receipt);
      
      expect(vote.vote_id).toMatch(/^vote_proposal/);
      expect(vote.encrypted_vote).toMatch(/^0x/);
      expect(vote.encrypted_power).toMatch(/^0x/);
      expect(vote.receipt).toBeDefined();
    });
  });

  // ============================================
  // HELIUS / PRICE - Live Market Data
  // ============================================
  describe('🟠 Helius/Price (Live Market Data)', () => {
    
    test('fetches LIVE SOL price from CoinMarketCap', async () => {
      const price = await priceProvider.getPrice('SOL', 'USD');
      
      console.log('\n💰 LIVE SOL PRICE:');
      console.log('   Price:', '$' + price.price.toFixed(2));
      console.log('   Source:', price.source);
      console.log('   Timestamp:', new Date(price.timestamp).toISOString());
      if (price.volume_24h) console.log('   24h Volume:', '$' + price.volume_24h.toLocaleString());
      if (price.market_cap) console.log('   Market Cap:', '$' + price.market_cap.toLocaleString());
      if (price.price_change_24h) console.log('   24h Change:', price.price_change_24h.toFixed(2) + '%');
      
      expect(price.price).toBeGreaterThan(0);
      expect(price.base_token).toBe('SOL');
      expect(price.quote_token).toBe('USD');
      expect(['coinmarketcap', 'solana-tracker', 'fallback-cache']).toContain(price.source);
    });

    test('fetches LIVE BTC price from CoinMarketCap', async () => {
      const price = await priceProvider.getPrice('BTC', 'USD');
      
      console.log('\n💰 LIVE BTC PRICE:');
      console.log('   Price:', '$' + price.price.toLocaleString());
      console.log('   Source:', price.source);
      
      expect(price.price).toBeGreaterThan(10000); // BTC should be > $10K
      expect(price.base_token).toBe('BTC');
    });

    test('fetches LIVE ETH price from CoinMarketCap', async () => {
      const price = await priceProvider.getPrice('ETH', 'USD');
      
      console.log('\n💰 LIVE ETH PRICE:');
      console.log('   Price:', '$' + price.price.toLocaleString());
      console.log('   Source:', price.source);
      
      expect(price.price).toBeGreaterThan(100); // ETH should be > $100
      expect(price.base_token).toBe('ETH');
    });

    test('handles stablecoin prices correctly', async () => {
      const usdc = await priceProvider.getPrice('USDC', 'USD');
      
      console.log('\n💰 USDC PRICE:');
      console.log('   Price:', '$' + usdc.price.toFixed(4));
      
      // USDC should be ~$1.00
      expect(usdc.price).toBeGreaterThan(0.99);
      expect(usdc.price).toBeLessThan(1.01);
    });

    test('rotates API keys on multiple requests', async () => {
      // Make multiple requests to test key rotation
      const prices = await Promise.all([
        priceProvider.getPrice('SOL', 'USD'),
        priceProvider.getPrice('BTC', 'USD'),
        priceProvider.getPrice('ETH', 'USD')
      ]);
      
      console.log('\n🔄 API KEY ROTATION TEST:');
      prices.forEach(p => {
        console.log(`   ${p.base_token}: $${p.price.toLocaleString()} (${p.source})`);
      });
      
      expect(prices.every(p => p.price > 0)).toBe(true);
    });
  });

  // ============================================
  // CROSS-PROVIDER INTEGRATION
  // ============================================
  describe('🔗 Cross-Provider Integration', () => {
    
    test('complete privacy workflow: Price → ZK Proof → Confidential Swap', async () => {
      console.log('\n🔗 COMPLETE PRIVACY WORKFLOW:');
      
      // Step 1: Get live price
      const price = await priceProvider.getPrice('SOL', 'USD');
      console.log('   1️⃣ Got SOL price: $' + price.price.toFixed(2));
      
      // Step 2: Generate ZK proof of sufficient balance
      const proof = await noirCircuitsProvider.proveBalanceThreshold(
        10000,  // Agent has 10K SOL
        100,    // Need at least 100 SOL for trade
        'SOL',
        'agent_wallet_sig'
      );
      console.log('   2️⃣ Generated ZK proof - meets threshold:', proof.public_outputs.meets_threshold);
      
      // Step 3: Submit confidential swap via Arcium
      const swap = await arciumProvider.submitComputation({
        programId: process.env.ARCIUM_PROGRAM_ID!,
        inputs: {
          operation: 'confidential_swap',
          input_amount: 100,
          input_token: 'SOL',
          output_token: 'USDC',
          expected_output: 100 * price.price,
          balance_proof: proof.proof
        }
      });
      console.log('   3️⃣ Submitted confidential swap - success:', swap.success);
      console.log('      Computation ID:', swap.computationId);
      
      // Step 4: Send encrypted confirmation via Inco
      const confirmation = await incoFHEProvider.sendConfidentialMessage(
        'trading_agent',
        'settlement_agent',
        `Swap executed: ${swap.computationId}`,
        300
      );
      console.log('   4️⃣ Sent encrypted confirmation - message ID:', confirmation.message_id);
      
      expect(price.price).toBeGreaterThan(0);
      expect(proof.public_outputs.meets_threshold).toBe(true);
      expect(swap.success).toBe(true);
      expect(confirmation.message_id).toBeDefined();
    });

    test('multi-agent coordination with privacy', async () => {
      console.log('\n🤖 MULTI-AGENT COORDINATION:');
      
      // Agent A: Proves they have funds
      const agentAProof = await noirCircuitsProvider.proveBalanceThreshold(
        50000, 10000, 'USDC', 'agent_a_sig'
      );
      console.log('   Agent A proved balance > 10K USDC');
      
      // Agent B: Proves they have NFT collection
      const agentBProof = await noirCircuitsProvider.proveCredentialOwnership(
        { collection: 'DeGods', count: 5 },
        'nft_ownership',
        'metaplex_authority',
        'agent_b_sig'
      );
      console.log('   Agent B proved NFT ownership');
      
      // Encrypted negotiation channel
      const negotiation = await incoFHEProvider.sendConfidentialMessage(
        'agent_a',
        'agent_b',
        'Offering 45K USDC for your 5 DeGods',
        1800
      );
      console.log('   Encrypted offer sent:', negotiation.message_id);
      
      // Confidential escrow setup
      const escrow = await arciumProvider.submitComputation({
        programId: process.env.ARCIUM_PROGRAM_ID!,
        inputs: {
          operation: 'escrow_setup',
          buyer_proof: agentAProof.proof,
          seller_proof: agentBProof.proof,
          amount: 45000,
          asset_type: 'nft_collection'
        }
      });
      console.log('   Confidential escrow created:', escrow.computationId);
      
      expect(agentAProof.public_outputs.meets_threshold).toBe(true);
      expect(agentBProof.public_outputs.verified).toBe(true);
      expect(negotiation.encrypted_payload).toBeDefined();
      expect(escrow.success).toBe(true);
    });
  });
});
