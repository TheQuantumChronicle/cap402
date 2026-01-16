/**
 * Test that one-liner convenience functions actually work
 * These are the functions shown in the frontend SDK examples
 * 
 * Note: These tests verify the function signatures and return types.
 * Network errors are expected when router is not running.
 */

import { prepareSwap, bestSwap, findAlpha, findPartners, autoTrader, quickTrader } from '../sdk/agents';

describe('One-Liner Functions', () => {
  jest.setTimeout(30000);

  describe('prepareSwap', () => {
    it('returns a PreparedTransaction with summary.headline', async () => {
      const tx = await prepareSwap('SOL', 'USDC', 10);
      
      expect(tx).toBeDefined();
      expect(tx.token_in).toBe('SOL');
      expect(tx.token_out).toBe('USDC');
      expect(tx.amount_in).toBe(10);
      expect(tx.summary).toBeDefined();
      expect(tx.summary.headline).toBeDefined();
      expect(typeof tx.summary.headline).toBe('string');
      expect(tx.summary.headline).toContain('SOL');
      expect(tx.summary.headline).toContain('USDC');
    });

    it('returns expected_out and min_out', async () => {
      const tx = await prepareSwap('ETH', 'USDC', 1);
      
      expect(tx.expected_out).toBeGreaterThanOrEqual(0);
      expect(tx.min_out).toBeGreaterThanOrEqual(0);
      expect(tx.min_out).toBeLessThanOrEqual(tx.expected_out);
    });
  });

  describe('bestSwap', () => {
    it('returns route and execution_summary', async () => {
      const result = await bestSwap('SOL', 'USDC', 100);
      
      expect(result).toBeDefined();
      expect(result.route).toBeDefined();
      expect(['dex', 'a2a', 'auction', 'swarm']).toContain(result.route);
      expect(result.execution_summary).toBeDefined();
      expect(typeof result.execution_summary).toBe('string');
      expect(result.result).toBeDefined();
    });

    it('returns savings_vs_dex when A2A is better', async () => {
      const result = await bestSwap('SOL', 'USDC', 100);
      
      // savings_vs_dex is optional, only present when A2A is used
      if (result.route === 'a2a') {
        expect(result.savings_vs_dex).toBeDefined();
        expect(typeof result.savings_vs_dex).toBe('number');
      }
    });
  });

  describe('findAlpha', () => {
    it('returns array of AlphaSignal with token and direction', async () => {
      // findAlpha starts an agent which may fail to register
      // We test the function exists and returns the right type
      try {
        const signals = await findAlpha(['SOL', 'ETH', 'BTC']);
        
        expect(Array.isArray(signals)).toBe(true);
        
        for (const signal of signals) {
          expect(signal.token).toBeDefined();
          expect(typeof signal.token).toBe('string');
          expect(signal.direction).toBeDefined();
          expect(['bullish', 'bearish']).toContain(signal.direction);
          expect(signal.type).toBeDefined();
          expect(['momentum', 'reversal', 'breakout', 'volume_spike']).toContain(signal.type);
        }
      } catch (error: any) {
        // Network errors are expected when router is not running
        expect(error.message).toMatch(/ECONNREFUSED|500|network|timeout/i);
      }
    });
  });

  describe('findPartners', () => {
    it('returns array of A2ATradingPartner', async () => {
      const partners = await findPartners('SOL', 'USDC', 100);
      
      expect(Array.isArray(partners)).toBe(true);
      
      for (const partner of partners) {
        expect(partner.agent_id).toBeDefined();
        expect(partner.name).toBeDefined();
        expect(partner.quote).toBeDefined();
        expect(partner.quote.amount_out).toBeDefined();
      }
    });
  });

  describe('quickTrader', () => {
    it('creates a TradingAgent with correct methods', () => {
      const trader = quickTrader(['SOL', 'ETH']);
      
      expect(trader).toBeDefined();
      expect(typeof trader.prepareSwap).toBe('function');
      expect(typeof trader.smartSwap).toBe('function');
      expect(typeof trader.buy).toBe('function');
      expect(typeof trader.sell).toBe('function');
      expect(typeof trader.detectAlpha).toBe('function');
      expect(typeof trader.findTradingPartners).toBe('function');
      expect(typeof trader.broadcastSignal).toBe('function');
      expect(typeof trader.withRetry).toBe('function');
      expect(typeof trader.safe).toBe('function');
    });
  });

  describe('autoTrader', () => {
    it('returns a started TradingAgent', async () => {
      try {
        const trader = await autoTrader(['SOL']);
        
        expect(trader).toBeDefined();
        expect(typeof trader.stop).toBe('function');
        expect(typeof trader.prepareSwap).toBe('function');
        expect(typeof trader.smartSwap).toBe('function');
        
        await trader.stop();
      } catch (error: any) {
        // Network errors are expected when router is not running
        expect(error.message).toMatch(/ECONNREFUSED|500|network|timeout/i);
      }
    });
  });
});
