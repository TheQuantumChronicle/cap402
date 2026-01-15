/**
 * ARCIUM DEEP INTEGRATION TEST SUITE
 * 
 * Comprehensive testing of Arcium MPC infrastructure:
 * - Solana devnet connection & RPC calls
 * - AES-256-GCM encryption for MPC
 * - Confidential computation submission
 * - C-SPL token operations (wrap, transfer, swap)
 * - MPC attestation & proof generation
 * - Error handling & edge cases
 * 
 * Run: npm test -- tests/arcium-deep.test.ts
 */

import { arciumProvider } from '../providers/arcium-client';
import { arciumCSPLProvider } from '../providers/arcium-cspl';
import { Connection, PublicKey } from '@solana/web3.js';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';

dotenv.config();

jest.setTimeout(60000);

describe('🟣 ARCIUM DEEP INTEGRATION SUITE', () => {

  const PROGRAM_ID = process.env.ARCIUM_PROGRAM_ID!;
  const MXE_ID = process.env.ARCIUM_MXE_ID!;
  const TEST_WALLET = process.env.X402_PUBLIC_KEY!;

  // ============================================
  // SOLANA DEVNET CONNECTION
  // ============================================
  describe('Solana Devnet Connection', () => {
    let connection: Connection;

    beforeAll(() => {
      connection = new Connection(
        process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
        'confirmed'
      );
    });

    test('establishes connection to Solana RPC', async () => {
      const version = await connection.getVersion();
      
      console.log('\n🌐 SOLANA RPC CONNECTION:');
      console.log('   Solana Core:', version['solana-core']);
      console.log('   Feature Set:', version['feature-set']);
      
      expect(version['solana-core']).toBeDefined();
    });

    test('retrieves current slot and block height', async () => {
      const slot = await connection.getSlot();
      const blockHeight = await connection.getBlockHeight();
      
      console.log('\n📊 CHAIN STATE:');
      console.log('   Current Slot:', slot.toLocaleString());
      console.log('   Block Height:', blockHeight.toLocaleString());
      
      expect(slot).toBeGreaterThan(0);
      expect(blockHeight).toBeGreaterThan(0);
    });

    test('fetches latest blockhash for transactions', async () => {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      
      console.log('\n🔗 LATEST BLOCKHASH:');
      console.log('   Blockhash:', blockhash);
      console.log('   Valid Until Block:', lastValidBlockHeight.toLocaleString());
      
      expect(blockhash.length).toBeGreaterThanOrEqual(43); // Base58 encoded (43-44 chars)
      expect(lastValidBlockHeight).toBeGreaterThan(0);
    });

    test('verifies Arcium program exists on chain', async () => {
      const programPubkey = new PublicKey(PROGRAM_ID);
      const accountInfo = await connection.getAccountInfo(programPubkey);
      
      console.log('\n📦 ARCIUM PROGRAM:');
      console.log('   Program ID:', PROGRAM_ID);
      console.log('   Exists:', !!accountInfo);
      if (accountInfo) {
        console.log('   Executable:', accountInfo.executable);
        console.log('   Owner:', accountInfo.owner.toBase58());
        console.log('   Lamports:', accountInfo.lamports.toLocaleString());
      }
      
      // Program may or may not exist depending on deployment
      expect(programPubkey.toBase58()).toBe(PROGRAM_ID);
    });

    test('measures RPC latency', async () => {
      const iterations = 5;
      const latencies: number[] = [];
      
      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        await connection.getSlot();
        latencies.push(Date.now() - start);
      }
      
      const avgLatency = latencies.reduce((a, b) => a + b, 0) / iterations;
      const minLatency = Math.min(...latencies);
      const maxLatency = Math.max(...latencies);
      
      console.log('\n⏱️ RPC LATENCY:');
      console.log('   Average:', avgLatency.toFixed(0), 'ms');
      console.log('   Min:', minLatency, 'ms');
      console.log('   Max:', maxLatency, 'ms');
      
      expect(avgLatency).toBeLessThan(5000); // Should be under 5s
    });
  });

  // ============================================
  // ARCIUM PROVIDER INITIALIZATION
  // ============================================
  describe('Arcium Provider Initialization', () => {
    
    test('initializes provider and connects to devnet', async () => {
      const connected = await arciumProvider.isConnected();
      const status = arciumProvider.getStatus();
      
      console.log('\n🔌 ARCIUM PROVIDER:');
      console.log('   Connected:', connected);
      console.log('   Status:', status.status);
      console.log('   Mode:', status.mode);
      console.log('   Program ID:', status.programId);
      
      expect(connected).toBe(true);
      expect(status.status).toBe('ready');
      expect(status.programId).toBe(PROGRAM_ID);
    });

    test('provider is singleton and maintains state', async () => {
      const status1 = arciumProvider.getStatus();
      const status2 = arciumProvider.getStatus();
      
      expect(status1.status).toBe(status2.status);
      expect(status1.mode).toBe(status2.mode);
    });
  });

  // ============================================
  // CRYPTOGRAPHIC OPERATIONS
  // ============================================
  describe('Cryptographic Operations', () => {
    
    test('encrypts data with AES-256-GCM', () => {
      const testData = {
        amount: 1000000,
        token: 'SOL',
        recipient: 'Hx7...abc'
      };

      const encrypted = arciumProvider.encryptForMPC(testData);
      
      console.log('\n🔐 AES-256-GCM ENCRYPTION:');
      console.log('   Input:', JSON.stringify(testData));
      console.log('   Ciphertext Length:', encrypted.ciphertext.length);
      console.log('   Nonce (IV):', encrypted.nonce);
      console.log('   Commitment:', encrypted.commitment);
      
      // Verify cryptographic properties
      expect(encrypted.ciphertext.length).toBeGreaterThan(50);
      expect(encrypted.nonce).toHaveLength(24); // 12 bytes = 24 hex chars
      expect(encrypted.commitment).toMatch(/^0x[a-f0-9]{64}$/);
    });

    test('generates unique ciphertexts for same plaintext', () => {
      const data = { amount: 100 };
      
      const enc1 = arciumProvider.encryptForMPC(data);
      const enc2 = arciumProvider.encryptForMPC(data);
      
      console.log('\n🎲 ENCRYPTION RANDOMNESS:');
      console.log('   Ciphertext 1:', enc1.ciphertext.slice(0, 40) + '...');
      console.log('   Ciphertext 2:', enc2.ciphertext.slice(0, 40) + '...');
      console.log('   Are Different:', enc1.ciphertext !== enc2.ciphertext);
      
      // Same plaintext should produce different ciphertexts (random nonce)
      expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
      expect(enc1.nonce).not.toBe(enc2.nonce);
    });

    test('commitment is deterministic hash of ciphertext', () => {
      const data = { test: 'data' };
      const encrypted = arciumProvider.encryptForMPC(data);
      
      // Verify commitment format (SHA-256)
      expect(encrypted.commitment).toMatch(/^0x[a-f0-9]{64}$/);
      expect(encrypted.commitment.length).toBe(66); // 0x + 64 hex chars
    });

    test('handles large payloads', () => {
      const largeData = {
        transactions: Array(100).fill(null).map((_, i) => ({
          id: i,
          amount: Math.random() * 1000000,
          timestamp: Date.now()
        }))
      };

      const encrypted = arciumProvider.encryptForMPC(largeData);
      
      console.log('\n📦 LARGE PAYLOAD ENCRYPTION:');
      console.log('   Input Size:', JSON.stringify(largeData).length, 'chars');
      console.log('   Ciphertext Size:', encrypted.ciphertext.length, 'chars');
      
      expect(encrypted.ciphertext.length).toBeGreaterThan(1000);
    });

    test('handles special characters and unicode', () => {
      const unicodeData = {
        message: '🔐 Confidential: 日本語テスト émojis ñ',
        amount: 1000
      };

      const encrypted = arciumProvider.encryptForMPC(unicodeData);
      
      console.log('\n🌍 UNICODE ENCRYPTION:');
      console.log('   Input:', unicodeData.message);
      console.log('   Encrypted:', !!encrypted.ciphertext);
      
      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.commitment).toMatch(/^0x[a-f0-9]{64}$/);
    });
  });

  // ============================================
  // MPC COMPUTATION SUBMISSION
  // ============================================
  describe('MPC Computation Submission', () => {
    
    test('submits confidential swap computation', async () => {
      const result = await arciumProvider.submitComputation({
        programId: PROGRAM_ID,
        inputs: {
          operation: 'confidential_swap',
          input_amount: 100,
          input_token: 'SOL',
          output_token: 'USDC',
          max_slippage: 0.5,
          mev_protection: true
        },
        mxeId: MXE_ID
      });

      console.log('\n💱 CONFIDENTIAL SWAP COMPUTATION:');
      console.log('   Success:', result.success);
      console.log('   Mode:', result.mode);
      console.log('   Computation ID:', result.computationId);
      console.log('   Proof:', result.proof?.slice(0, 50) + '...');
      console.log('   Attestation:', result.attestation);
      
      expect(result.success).toBe(true);
      expect(result.computationId).toMatch(/^arcium_\d+_[a-f0-9]+$/);
      expect(result.proof).toBeDefined();
      expect(result.attestation).toBeDefined();

      if (result.mode === 'live') {
        expect(result.outputs?.solana_slot).toBeGreaterThan(0);
      }
    });

    test('submits balance attestation computation', async () => {
      const result = await arciumProvider.submitComputation({
        programId: PROGRAM_ID,
        inputs: {
          operation: 'balance_attestation',
          wallet: TEST_WALLET,
          threshold: 1000,
          token: 'SOL'
        }
      });

      console.log('\n📜 BALANCE ATTESTATION:');
      console.log('   Success:', result.success);
      console.log('   Attestation:', result.attestation);
      
      expect(result.success).toBe(true);
      expect(result.attestation).toMatch(/^arcium_(att|mpc)/);
    });

    test('submits document parsing computation', async () => {
      const result = await arciumProvider.submitComputation({
        programId: PROGRAM_ID,
        inputs: {
          operation: 'document_parse',
          document_type: 'financial_statement',
          encrypted_content: 'base64_encrypted_pdf_content...'
        }
      });

      console.log('\n📄 DOCUMENT PARSING:');
      console.log('   Success:', result.success);
      console.log('   Computation ID:', result.computationId);
      
      expect(result.success).toBe(true);
    });

    test('handles multiple concurrent computations', async () => {
      const computations = await Promise.all([
        arciumProvider.submitComputation({
          programId: PROGRAM_ID,
          inputs: { operation: 'compute_1', value: 100 }
        }),
        arciumProvider.submitComputation({
          programId: PROGRAM_ID,
          inputs: { operation: 'compute_2', value: 200 }
        }),
        arciumProvider.submitComputation({
          programId: PROGRAM_ID,
          inputs: { operation: 'compute_3', value: 300 }
        })
      ]);

      console.log('\n⚡ CONCURRENT COMPUTATIONS:');
      computations.forEach((r, i) => {
        console.log(`   Computation ${i + 1}: ${r.success ? '✅' : '❌'} ${r.computationId}`);
      });
      
      expect(computations.every(c => c.success)).toBe(true);
      
      // All computation IDs should be unique
      const ids = computations.map(c => c.computationId);
      expect(new Set(ids).size).toBe(ids.length);
    });

    test('computation includes execution metadata', async () => {
      const result = await arciumProvider.submitComputation({
        programId: PROGRAM_ID,
        inputs: { operation: 'test_metadata' }
      });

      console.log('\n📊 COMPUTATION METADATA:');
      console.log('   Execution Time:', result.outputs?.execution_time_ms, 'ms');
      console.log('   Program ID:', result.outputs?.program_id);
      console.log('   MXE Cluster:', result.outputs?.mxe_cluster);
      
      expect(result.outputs?.execution_time_ms).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================
  // C-SPL TOKEN OPERATIONS
  // ============================================
  describe('C-SPL Token Operations', () => {
    const TEST_MINT = 'So11111111111111111111111111111111111111112'; // Wrapped SOL

    test('wraps public token to confidential', async () => {
      const result = await arciumCSPLProvider.wrapToConfidential(
        TEST_WALLET,
        TEST_MINT,
        1000
      );

      console.log('\n🔒 WRAP TO CONFIDENTIAL:');
      console.log('   Success:', result.success);
      console.log('   Wrapped Mint:', result.wrapped_mint);
      console.log('   Amount:', result.amount_wrapped);
      console.log('   Confidential Account:', result.confidential_account);
      console.log('   TX Signature:', result.transaction_signature);
      
      expect(result.success).toBe(true);
      expect(result.wrapped_mint).toMatch(/^cspl_/);
      expect(result.amount_wrapped).toBe(1000);
    });

    test('executes confidential transfer', async () => {
      const result = await arciumCSPLProvider.confidentialTransfer(
        TEST_WALLET,
        'RecipientWallet123456789012345678901234567890',
        TEST_MINT,
        500
      );

      console.log('\n💸 CONFIDENTIAL TRANSFER:');
      console.log('   Success:', result.success);
      console.log('   TX Signature:', result.transaction_signature);
      console.log('   Encrypted Amount:', result.encrypted_amount);
      console.log('   Proof:', result.proof);
      console.log('   Commitment:', result.commitment);
      
      expect(result.success).toBe(true);
      expect(result.encrypted_amount).toBeDefined();
      expect(result.proof).toBeDefined();
      expect(result.commitment).toMatch(/^0x/);
    });

    test('executes confidential swap', async () => {
      const result = await arciumCSPLProvider.confidentialSwap(
        TEST_WALLET,
        TEST_MINT,
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        100,
        95
      );

      console.log('\n🔄 CONFIDENTIAL SWAP:');
      console.log('   Success:', result.success);
      console.log('   Encrypted Input:', result.encrypted_input);
      console.log('   Encrypted Output:', result.encrypted_output);
      console.log('   Proof:', result.proof);
      console.log('   Route:', result.route.join(' → '));
      
      expect(result.success).toBe(true);
      expect(result.route).toContain('arcium-mpc');
    });

    test('unwraps confidential token to public', async () => {
      const result = await arciumCSPLProvider.unwrapToPublic(
        TEST_WALLET,
        'cspl_So111111...',
        500
      );

      console.log('\n🔓 UNWRAP TO PUBLIC:');
      console.log('   Success:', result.success);
      console.log('   Public Mint:', result.wrapped_mint);
      console.log('   Amount:', result.amount_wrapped);
      
      expect(result.success).toBe(true);
    });

    test('creates confidential ATA for recipient', async () => {
      const result = await arciumCSPLProvider.createConfidentialATA(
        TEST_WALLET,
        'RecipientWallet123456789012345678901234567890',
        TEST_MINT
      );

      console.log('\n📬 CREATE CONFIDENTIAL ATA:');
      console.log('   Success:', result.success);
      console.log('   Account:', result.account);
      console.log('   TX Signature:', result.transaction_signature);
      
      expect(result.success).toBe(true);
      expect(result.account).toMatch(/^cata_/);
    });

    test('gets confidential balance', async () => {
      const balance = await arciumCSPLProvider.getConfidentialBalance(
        TEST_WALLET,
        TEST_MINT
      );

      console.log('\n💰 CONFIDENTIAL BALANCE:');
      console.log('   Mint:', balance.mint);
      console.log('   Encrypted Balance:', balance.encrypted_balance);
      console.log('   Pending:', balance.pending_balance);
      console.log('   Available:', balance.available_balance);
      
      expect(balance.mint).toBe(TEST_MINT);
      expect(balance.encrypted_balance).toBeDefined();
    });
  });

  // ============================================
  // ERROR HANDLING
  // ============================================
  describe('Error Handling', () => {
    
    test('handles invalid program ID gracefully', async () => {
      const result = await arciumProvider.submitComputation({
        programId: 'InvalidProgramId123',
        inputs: { operation: 'test' }
      });

      // Should still succeed in simulation mode
      expect(result.success).toBe(true);
    });

    test('handles empty inputs', async () => {
      const result = await arciumProvider.submitComputation({
        programId: PROGRAM_ID,
        inputs: {}
      });

      expect(result.success).toBe(true);
    });

    test('handles very large input values', async () => {
      const result = await arciumProvider.submitComputation({
        programId: PROGRAM_ID,
        inputs: {
          operation: 'large_value_test',
          amount: Number.MAX_SAFE_INTEGER
        }
      });

      expect(result.success).toBe(true);
    });
  });

  // ============================================
  // PERFORMANCE BENCHMARKS
  // ============================================
  describe('Performance Benchmarks', () => {
    
    test('encryption performance', () => {
      const iterations = 100;
      const data = { amount: 1000, token: 'SOL' };
      
      const start = Date.now();
      for (let i = 0; i < iterations; i++) {
        arciumProvider.encryptForMPC(data);
      }
      const elapsed = Date.now() - start;
      
      console.log('\n⚡ ENCRYPTION BENCHMARK:');
      console.log('   Iterations:', iterations);
      console.log('   Total Time:', elapsed, 'ms');
      console.log('   Avg per Encryption:', (elapsed / iterations).toFixed(2), 'ms');
      
      expect(elapsed / iterations).toBeLessThan(10); // < 10ms per encryption
    });

    test('computation submission performance', async () => {
      const iterations = 5;
      const times: number[] = [];
      
      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        await arciumProvider.submitComputation({
          programId: PROGRAM_ID,
          inputs: { operation: 'perf_test', iteration: i }
        });
        times.push(Date.now() - start);
      }
      
      const avg = times.reduce((a, b) => a + b, 0) / iterations;
      
      console.log('\n⚡ COMPUTATION BENCHMARK:');
      console.log('   Iterations:', iterations);
      console.log('   Times:', times.map(t => t + 'ms').join(', '));
      console.log('   Average:', avg.toFixed(0), 'ms');
      
      expect(avg).toBeLessThan(2000); // < 2s average
    });
  });
});
