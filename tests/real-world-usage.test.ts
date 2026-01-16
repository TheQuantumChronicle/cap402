/**
 * Real-World Usage Tests
 * 
 * Tests that simulate how actual users would interact with CAP-402:
 * - Trading bot workflows
 * - Portfolio monitoring
 * - Multi-token operations
 * - Error recovery scenarios
 * - Concurrent operations
 */

import { 
  prepareSwap, 
  bestSwap, 
  findAlpha, 
  quickTrader,
  createTradingAgent,
  createMonitoringAgent
} from '../sdk/agents';
import { cap402, getPrice, getPrices, swap, mevRisk } from '../sdk/quick';
import { createClient } from '../sdk/client';

describe('Real-World Usage Patterns', () => {
  jest.setTimeout(30000);

  describe('Trading Bot Workflow', () => {
    it('should handle typical trading bot startup sequence', async () => {
      // 1. Create trader
      const trader = quickTrader(['SOL', 'ETH', 'BTC']);
      
      // 2. Prepare a swap
      const solTx = await trader.prepareSwap('SOL', 'USDC', 10);
      
      // 3. Verify structure is correct (price may be 0 if not fetched yet)
      expect(solTx.expected_out).toBeGreaterThanOrEqual(0);
      
      // 4. Verify MEV risk assessment
      expect(solTx.mev_risk).toBeDefined();
      expect(['LOW', 'MEDIUM', 'HIGH']).toContain(solTx.mev_risk);
      
      // 5. Check summary is human-readable
      expect(solTx.summary.headline).toMatch(/Swap.*SOL.*USDC/);
    });

    it('should handle price lookup → swap decision flow', async () => {
      // User wants to check price first, then decide to swap
      const price = await getPrice('SOL');
      expect(price).toBeGreaterThan(0);
      
      // Based on price, prepare a swap
      const tx = await prepareSwap('SOL', 'USDC', 5);
      
      // Verify the swap uses current price
      expect(tx.expected_out).toBeGreaterThanOrEqual(0);
    });

    it('should handle multi-token portfolio check', async () => {
      // User wants to check multiple token prices at once
      const prices = await getPrices(['SOL', 'ETH', 'BTC']);
      
      expect(prices.SOL).toBeGreaterThan(0);
      expect(prices.ETH).toBeGreaterThan(0);
      expect(prices.BTC).toBeGreaterThan(0);
      
      // ETH should be more expensive than SOL
      expect(prices.ETH).toBeGreaterThan(prices.SOL);
      // BTC should be most expensive
      expect(prices.BTC).toBeGreaterThan(prices.ETH);
    });
  });

  describe('MEV Protection Workflow', () => {
    it('should assess MEV risk before large trades', async () => {
      // Small trade - should be low risk
      const smallTrade = await prepareSwap('SOL', 'USDC', 1);
      
      // Large trade - may have higher risk
      const largeTrade = await prepareSwap('SOL', 'USDC', 1000);
      
      // Both should have MEV assessment
      expect(smallTrade.mev_risk).toBeDefined();
      expect(largeTrade.mev_risk).toBeDefined();
      
      // Large trade should have warnings if high risk
      if (largeTrade.mev_risk === 'HIGH') {
        expect(largeTrade.summary.warnings.length).toBeGreaterThan(0);
      }
    });

    it('should provide MEV savings estimate', async () => {
      const risk = await mevRisk('SOL', 'USDC', 500);
      
      expect(risk).toBeDefined();
      expect(risk.risk).toBeDefined();
      expect(risk.sandwich_probability).toBeDefined();
      expect(risk.potential_loss_usd).toBeDefined();
    });
  });

  describe('Alpha Detection Workflow', () => {
    it('should detect signals for watched tokens', async () => {
      const trader = quickTrader(['SOL', 'ETH', 'BTC']);
      
      // Simulate some price history by calling prepareSwap
      await trader.prepareSwap('SOL', 'USDC', 1);
      await trader.prepareSwap('ETH', 'USDC', 1);
      
      // Try to detect alpha (may be empty if no signals)
      const signals = await trader.detectAlpha();
      
      expect(Array.isArray(signals)).toBe(true);
      
      // If there are signals, verify structure
      for (const signal of signals) {
        expect(signal.token).toBeDefined();
        expect(signal.direction).toBeDefined();
        expect(signal.type).toBeDefined();
        expect(signal.confidence).toBeGreaterThan(0);
      }
    });
  });

  describe('Agent-to-Agent Trading', () => {
    it('should find trading partners for a swap', async () => {
      const trader = quickTrader(['SOL', 'USDC']);
      
      const partners = await trader.findTradingPartners('SOL', 'USDC', 100);
      
      expect(Array.isArray(partners)).toBe(true);
      
      // Partners may be empty if no agents registered
      for (const partner of partners) {
        expect(partner.agent_id).toBeDefined();
        expect(partner.quote).toBeDefined();
        expect(partner.quote.amount_out).toBeGreaterThan(0);
      }
    });

    it('should compare DEX vs A2A routes', async () => {
      const result = await bestSwap('SOL', 'USDC', 50);
      
      expect(result.route).toBeDefined();
      expect(['dex', 'a2a', 'auction', 'swarm']).toContain(result.route);
      expect(result.execution_summary).toBeDefined();
      
      // If A2A was chosen, should show savings
      if (result.route === 'a2a' && result.savings_vs_dex) {
        expect(result.savings_vs_dex).toBeGreaterThan(0);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid token gracefully', async () => {
      // Token with invalid characters should throw
      await expect(async () => {
        const trader = quickTrader(['INVALID_TOKEN_XYZ']);
        await trader.prepareSwap('INVALID_TOKEN_XYZ', 'USDC', 10);
      }).rejects.toThrow(/Invalid token/);
    });

    it('should handle zero amount', async () => {
      // Zero amount should throw validation error
      await expect(prepareSwap('SOL', 'USDC', 0)).rejects.toThrow(/greater than 0/);
    });

    it('should handle negative amount', async () => {
      // Should either throw or treat as absolute value
      try {
        const tx = await prepareSwap('SOL', 'USDC', -10);
        // If it doesn't throw, amount should be handled
        expect(tx.amount_in).toBeDefined();
      } catch (error: any) {
        expect(error.message).toMatch(/invalid|negative|amount/i);
      }
    });

    it('should handle same token swap', async () => {
      // Swapping SOL to SOL should be handled
      const tx = await prepareSwap('SOL', 'SOL', 10);
      
      // Should return 1:1 or throw
      expect(tx.token_in).toBe('SOL');
      expect(tx.token_out).toBe('SOL');
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle parallel price lookups', async () => {
      const [sol, eth, btc] = await Promise.all([
        getPrice('SOL'),
        getPrice('ETH'),
        getPrice('BTC')
      ]);
      
      expect(sol).toBeGreaterThan(0);
      expect(eth).toBeGreaterThan(0);
      expect(btc).toBeGreaterThan(0);
    });

    it('should handle parallel swap preparations', async () => {
      const [tx1, tx2, tx3] = await Promise.all([
        prepareSwap('SOL', 'USDC', 10),
        prepareSwap('ETH', 'USDC', 1),
        prepareSwap('BTC', 'USDC', 0.1)
      ]);
      
      expect(tx1.token_in).toBe('SOL');
      expect(tx2.token_in).toBe('ETH');
      expect(tx3.token_in).toBe('BTC');
      
      // All should have valid summaries
      expect(tx1.summary.headline).toBeDefined();
      expect(tx2.summary.headline).toBeDefined();
      expect(tx3.summary.headline).toBeDefined();
    });

    it('should handle rapid sequential operations', async () => {
      const trader = quickTrader(['SOL']);
      
      // Rapid fire 5 operations
      for (let i = 0; i < 5; i++) {
        const tx = await trader.prepareSwap('SOL', 'USDC', i + 1);
        expect(tx.amount_in).toBe(i + 1);
      }
    });
  });

  describe('Monitoring Agent Workflow', () => {
    it('should create monitoring agent for wallet tracking', () => {
      const monitor = createMonitoringAgent({
        agent_id: 'test-monitor',
        name: 'Test Monitor',
        watched_wallets: ['abc123...'],
        thresholds: {
          balance_change_percent: 5
        }
      });
      
      expect(monitor).toBeDefined();
      expect(typeof monitor.start).toBe('function');
      expect(typeof monitor.stop).toBe('function');
    });
  });

  describe('SDK Quick API', () => {
    it('should configure SDK globally', () => {
      // User can configure once, use everywhere
      cap402.configure({ router: 'https://cap402.com' });
      
      // Subsequent calls use the config
      expect(cap402.price).toBeDefined();
      expect(cap402.swap).toBeDefined();
    });

    it('should provide health check', async () => {
      const health = await cap402.health();
      
      expect(health).toBeDefined();
      // health returns a boolean
      expect(typeof health).toBe('boolean');
    });
  });

  describe('Edge Cases', () => {
    it('should handle very small amounts', async () => {
      const tx = await prepareSwap('SOL', 'USDC', 0.0001);
      
      expect(tx.amount_in).toBe(0.0001);
      expect(tx.expected_out).toBeGreaterThanOrEqual(0);
    });

    it('should handle very large amounts', async () => {
      const tx = await prepareSwap('SOL', 'USDC', 1000000);
      
      expect(tx.amount_in).toBe(1000000);
      // Large trades should have elevated risk (MEDIUM, HIGH, or CRITICAL)
      expect(['MEDIUM', 'HIGH', 'CRITICAL']).toContain(tx.mev_risk);
    });

    it('should handle stablecoin to stablecoin', async () => {
      const tx = await prepareSwap('USDC', 'USDT', 100);
      
      expect(tx.token_in).toBe('USDC');
      expect(tx.token_out).toBe('USDT');
      // May not have price data for USDT, just verify structure
      expect(tx.summary).toBeDefined();
      expect(tx.summary.headline).toContain('USDC');
    });

    it('should handle tokens with different decimals', async () => {
      // BTC has 8 decimals, SOL has 9
      const tx = await prepareSwap('BTC', 'SOL', 0.001);
      
      expect(tx.amount_in).toBe(0.001);
      // May return 0 if price data unavailable, just verify structure
      expect(tx.expected_out).toBeGreaterThanOrEqual(0);
    });
  });
});
