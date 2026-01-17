/**
 * Tests for Confidential Execution Pipeline
 * 
 * Tests the full pipeline: Noir → Inco → Arcium → Noir
 */

import { confidentialExecutionPipeline } from '../providers/confidential-execution';

describe('Confidential Execution Pipeline', () => {
  describe('determineExecutionTier', () => {
    it('should return public tier for amounts under $50K', () => {
      const tier = confidentialExecutionPipeline.determineExecutionTier(25000);
      expect(tier).toBe('public');
    });

    it('should return protected tier for amounts $50K-$100K', () => {
      const tier = confidentialExecutionPipeline.determineExecutionTier(75000);
      expect(tier).toBe('protected');
    });

    it('should return confidential tier for amounts over $100K', () => {
      const tier = confidentialExecutionPipeline.determineExecutionTier(150000);
      expect(tier).toBe('confidential');
    });

    it('should handle edge case at $50K threshold', () => {
      const tier = confidentialExecutionPipeline.determineExecutionTier(50000);
      expect(tier).toBe('protected');
    });

    it('should handle edge case at $100K threshold', () => {
      const tier = confidentialExecutionPipeline.determineExecutionTier(100000);
      expect(tier).toBe('confidential');
    });
  });

  describe('executeConfidential', () => {
    it('should execute public tier for small amounts', async () => {
      const result = await confidentialExecutionPipeline.executeConfidential({
        agent_id: 'test-agent',
        operation: 'swap',
        amount_usd: 1000,
        inputs: { token_in: 'SOL', token_out: 'USDC' }
      });

      expect(result.success).toBe(true);
      expect(result.tier).toBe('public');
      expect(result.stages_completed).toContain('public_execution');
    });

    it('should execute full pipeline for large amounts', async () => {
      const result = await confidentialExecutionPipeline.executeConfidential({
        agent_id: 'test-agent',
        operation: 'swap',
        amount_usd: 150000,
        inputs: { token_in: 'SOL', token_out: 'USDC' }
      });

      expect(result.success).toBe(true);
      expect(result.tier).toBe('confidential');
      // Without required_proofs, noir_eligibility is skipped
      expect(result.stages_completed).toContain('inco_encrypt');
      expect(result.stages_completed).toContain('arcium_mpc');
      expect(result.stages_completed).toContain('noir_execution_proof');
      expect(result.fee_usd).toBeGreaterThan(0);
    });

    it('should include noir_eligibility when required_proofs specified', async () => {
      const result = await confidentialExecutionPipeline.executeConfidential({
        agent_id: 'test-agent',
        operation: 'swap',
        amount_usd: 150000,
        inputs: { token_in: 'SOL', token_out: 'USDC' },
        required_proofs: ['balance_threshold']
      });

      expect(result.success).toBe(true);
      expect(result.stages_completed).toContain('noir_eligibility');
    });

    it('should respect privacy_level override', async () => {
      const result = await confidentialExecutionPipeline.executeConfidential({
        agent_id: 'test-agent',
        operation: 'swap',
        amount_usd: 1000,
        inputs: {},
        privacy_level: 'confidential'
      });

      expect(result.success).toBe(true);
      expect(result.tier).toBe('confidential');
    });

    it('should include required proofs when specified', async () => {
      const result = await confidentialExecutionPipeline.executeConfidential({
        agent_id: 'test-agent',
        operation: 'prove',
        amount_usd: 150000,
        inputs: {},
        required_proofs: ['balance_threshold']
      });

      expect(result.success).toBe(true);
      expect(result.eligibility_proof).toBeDefined();
    });
  });

  describe('thresholdSign', () => {
    it('should succeed with valid threshold', async () => {
      const result = await confidentialExecutionPipeline.thresholdSign({
        signers: ['signer1', 'signer2', 'signer3'],
        threshold: 2,
        message_hash: '0xabc123'
      });

      expect(result.success).toBe(true);
      expect(result.threshold_met).toBe(true);
      expect(result.signers_participated.length).toBe(2);
      expect(result.signature).toBeDefined();
    });

    it('should fail when not enough signers', async () => {
      const result = await confidentialExecutionPipeline.thresholdSign({
        signers: ['signer1'],
        threshold: 2,
        message_hash: '0xabc123'
      });

      expect(result.success).toBe(false);
      expect(result.threshold_met).toBe(false);
    });
  });

  describe('multiPartySwap', () => {
    it('should fail with less than 2 parties', async () => {
      const result = await confidentialExecutionPipeline.multiPartySwap({
        parties: [{ agent_id: 'agent1', input_token: 'SOL', output_token: 'USDC', input_amount_encrypted: '0x123', min_output_encrypted: '0xabc' }]
      });

      expect(result.success).toBe(false);
      expect(result.settlements).toHaveLength(0);
    });

    it('should succeed with 2+ parties', async () => {
      const result = await confidentialExecutionPipeline.multiPartySwap({
        parties: [
          { agent_id: 'agent1', input_token: 'SOL', output_token: 'USDC', input_amount_encrypted: '0x123', min_output_encrypted: '0xabc' },
          { agent_id: 'agent2', input_token: 'USDC', output_token: 'SOL', input_amount_encrypted: '0x456', min_output_encrypted: '0xdef' }
        ]
      });

      expect(result.success).toBe(true);
      expect(result.settlements).toHaveLength(2);
      expect(result.fee_usd).toBeGreaterThan(0);
    });
  });

  describe('Encrypted Orderbook', () => {
    it('should create orderbook with valid asset pair', () => {
      const orderbook = confidentialExecutionPipeline.createEncryptedOrderbook('SOL/USDC');
      
      expect(orderbook).not.toBeNull();
      expect(orderbook?.asset_pair).toBe('SOL/USDC');
      expect(orderbook?.orderbook_id).toMatch(/^ob_/);
    });

    it('should return null for empty asset pair', () => {
      const orderbook = confidentialExecutionPipeline.createEncryptedOrderbook('');
      expect(orderbook).toBeNull();
    });

    it('should return null for whitespace-only asset pair', () => {
      const orderbook = confidentialExecutionPipeline.createEncryptedOrderbook('   ');
      expect(orderbook).toBeNull();
    });

    it('should submit encrypted order to orderbook', async () => {
      const orderbook = confidentialExecutionPipeline.createEncryptedOrderbook('ETH/USDC');
      expect(orderbook).not.toBeNull();

      const order = await confidentialExecutionPipeline.submitEncryptedOrder(
        orderbook!.orderbook_id,
        'test-agent',
        'bid',
        3000,
        1.5
      );

      expect(order).not.toBeNull();
      expect(order?.order_id).toMatch(/^order_/);
      expect(order?.commitment).toMatch(/^0x/);
    });

    it('should reject order with invalid price', async () => {
      const orderbook = confidentialExecutionPipeline.createEncryptedOrderbook('BTC/USDC');
      
      const order = await confidentialExecutionPipeline.submitEncryptedOrder(
        orderbook!.orderbook_id,
        'test-agent',
        'bid',
        0,
        1
      );

      expect(order).toBeNull();
    });

    it('should reject order with invalid size', async () => {
      const orderbook = confidentialExecutionPipeline.createEncryptedOrderbook('BTC/USDC');
      
      const order = await confidentialExecutionPipeline.submitEncryptedOrder(
        orderbook!.orderbook_id,
        'test-agent',
        'ask',
        50000,
        -1
      );

      expect(order).toBeNull();
    });

    it('should return null for non-existent orderbook', async () => {
      const order = await confidentialExecutionPipeline.submitEncryptedOrder(
        'non-existent-orderbook',
        'test-agent',
        'bid',
        100,
        1
      );

      expect(order).toBeNull();
    });
  });

  describe('Private Auction', () => {
    it('should create auction with valid parameters', async () => {
      const auction = await confidentialExecutionPipeline.createPrivateAuction(
        'auctioneer-agent',
        'NFT-123',
        1000
      );

      expect(auction).not.toBeNull();
      expect(auction?.auction_id).toMatch(/^auction_/);
      expect(auction?.auctioneer).toBe('auctioneer-agent');
      expect(auction?.asset).toBe('NFT-123');
      expect(auction?.status).toBe('bidding');
    });

    it('should return null for missing auctioneer', async () => {
      const auction = await confidentialExecutionPipeline.createPrivateAuction(
        '',
        'NFT-123'
      );

      expect(auction).toBeNull();
    });

    it('should return null for missing asset', async () => {
      const auction = await confidentialExecutionPipeline.createPrivateAuction(
        'auctioneer',
        ''
      );

      expect(auction).toBeNull();
    });

    it('should return null for negative reserve price', async () => {
      const auction = await confidentialExecutionPipeline.createPrivateAuction(
        'auctioneer',
        'NFT-123',
        -100
      );

      expect(auction).toBeNull();
    });

    it('should submit bid to auction', async () => {
      const auction = await confidentialExecutionPipeline.createPrivateAuction(
        'auctioneer',
        'NFT-456'
      );

      const bid = await confidentialExecutionPipeline.submitAuctionBid(
        auction!.auction_id,
        'bidder-agent',
        5000
      );

      expect(bid).not.toBeNull();
      expect(bid?.bid_commitment).toMatch(/^0x/);
    });

    it('should reject bid with zero amount', async () => {
      const auction = await confidentialExecutionPipeline.createPrivateAuction(
        'auctioneer',
        'NFT-789'
      );

      const bid = await confidentialExecutionPipeline.submitAuctionBid(
        auction!.auction_id,
        'bidder',
        0
      );

      expect(bid).toBeNull();
    });

    it('should reject bid with negative amount', async () => {
      const auction = await confidentialExecutionPipeline.createPrivateAuction(
        'auctioneer',
        'NFT-abc'
      );

      const bid = await confidentialExecutionPipeline.submitAuctionBid(
        auction!.auction_id,
        'bidder',
        -100
      );

      expect(bid).toBeNull();
    });
  });

  describe('provePerformance', () => {
    it('should generate win_rate proof', async () => {
      const proof = await confidentialExecutionPipeline.provePerformance(
        'test-agent',
        {
          total_trades: 100,
          profitable_trades: 65,
          total_volume_usd: 1000000,
          total_pnl_usd: 50000
        },
        'win_rate'
      );

      expect(proof).toBeDefined();
      expect(proof.proof).toBeDefined();
    });

    it('should handle zero total_trades without division error', async () => {
      const proof = await confidentialExecutionPipeline.provePerformance(
        'test-agent',
        {
          total_trades: 0,
          profitable_trades: 0,
          total_volume_usd: 0,
          total_pnl_usd: 0
        },
        'win_rate'
      );

      expect(proof).toBeDefined();
    });

    it('should generate volume proof', async () => {
      const proof = await confidentialExecutionPipeline.provePerformance(
        'test-agent',
        {
          total_trades: 50,
          profitable_trades: 30,
          total_volume_usd: 500000,
          total_pnl_usd: 25000
        },
        'volume'
      );

      expect(proof).toBeDefined();
    });

    it('should generate profitability proof', async () => {
      const proof = await confidentialExecutionPipeline.provePerformance(
        'test-agent',
        {
          total_trades: 200,
          profitable_trades: 120,
          total_volume_usd: 2000000,
          total_pnl_usd: 100000
        },
        'profitability'
      );

      expect(proof).toBeDefined();
    });
  });

  describe('getStats', () => {
    it('should return pipeline statistics', () => {
      const stats = confidentialExecutionPipeline.getStats();

      expect(stats).toHaveProperty('execution_count');
      expect(stats).toHaveProperty('total_volume_usd');
      expect(stats).toHaveProperty('total_fees_usd');
      expect(stats).toHaveProperty('active_orderbooks');
      expect(stats).toHaveProperty('active_auctions');
      expect(typeof stats.execution_count).toBe('number');
    });
  });
});
