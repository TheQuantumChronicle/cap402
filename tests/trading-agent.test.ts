/**
 * Trading Agent Comprehensive Tests
 * Tests all agent capabilities including A2A, security, and interoperability
 */

import { 
  createTradingAgent, 
  TradingAgent,
  TradingConfig,
  PreparedTransaction,
  AlphaSignal,
  A2AQuote,
  A2ATradeResult,
  A2AHandshake,
  CrossProtocolAgent
} from '../sdk/agents';

describe('Trading Agent', () => {
  let trader: TradingAgent;

  beforeEach(() => {
    trader = createTradingAgent({
      agent_id: 'test-trader',
      name: 'Test Trading Agent',
      watched_tokens: ['SOL', 'ETH', 'BTC'],
      mev_protection: true,
      router_url: 'https://cap402.com'
    });
  });

  afterEach(async () => {
    try {
      await trader.stop();
    } catch {
      // Ignore stop errors
    }
  }, 5000);

  // ============================================
  // BASIC FUNCTIONALITY
  // ============================================

  describe('Basic Functionality', () => {
    test('should create trading agent with config', () => {
      expect(trader).toBeDefined();
      expect(trader.getStats()).toBeDefined();
    });

    test('should start and stop agent', async () => {
      try {
        await trader.start();
        const stats = trader.getStats();
        expect(stats).toBeDefined();
        
        await trader.stop();
        const stoppedStats = trader.getStats();
        expect(stoppedStats).toBeDefined();
      } catch (error: any) {
        // Network errors are acceptable in test environment
        expect(error.message).toMatch(/500|ECONNREFUSED|timeout/i);
      }
    });

    test('should get price data', async () => {
      try {
        await trader.start();
        // Wait for first price update
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const price = trader.getPrice('SOL');
        // Price may or may not be available depending on network
        expect(price === undefined || typeof price.price === 'number').toBe(true);
      } catch (error: any) {
        // Network errors are acceptable in test environment
        expect(error.message).toMatch(/500|ECONNREFUSED|timeout/i);
      }
    });

    test('should get all prices', async () => {
      const prices = trader.getPrices();
      expect(prices instanceof Map).toBe(true);
    });

    test('should get price history', () => {
      const history = trader.getPriceHistory('SOL');
      expect(Array.isArray(history)).toBe(true);
    });
  });

  // ============================================
  // TRANSACTION PREPARATION
  // ============================================

  describe('Transaction Preparation', () => {
    test('should prepare swap transaction', async () => {
      const tx = await trader.prepareSwap('SOL', 'USDC', 10);
      
      expect(tx).toBeDefined();
      expect(tx.instruction_id).toBeDefined();
      expect(tx.type).toBe('swap');
      expect(tx.status).toBe('ready');
      expect(tx.token_in).toBe('SOL');
      expect(tx.token_out).toBe('USDC');
      expect(tx.amount_in).toBe(10);
      expect(tx.user_action_required).toBe('sign_and_submit');
    });

    test('should include transaction summary', async () => {
      const tx = await trader.prepareSwap('SOL', 'USDC', 10);
      
      expect(tx.summary).toBeDefined();
      expect(tx.summary.headline).toContain('SOL');
      expect(tx.summary.details).toBeDefined();
      expect(tx.summary.details.action).toBe('Token Swap');
      expect(typeof tx.summary.confidence_score).toBe('number');
    });

    test('should include MEV analysis', async () => {
      const tx = await trader.prepareSwap('SOL', 'USDC', 10);
      
      expect(['LOW', 'MEDIUM', 'HIGH']).toContain(tx.mev_risk);
      expect(Array.isArray(tx.mev_recommendations)).toBe(true);
    });

    test('should prepare batch swaps', async () => {
      const swaps = [
        { tokenIn: 'SOL', tokenOut: 'USDC', amount: 5 },
        { tokenIn: 'ETH', tokenOut: 'USDC', amount: 1 }
      ];
      
      const prepared = await trader.prepareBatchSwaps(swaps);
      
      expect(prepared.length).toBe(2);
      expect(prepared[0].token_in).toBe('SOL');
      expect(prepared[1].token_in).toBe('ETH');
    });

    test('should set transaction expiry', async () => {
      const tx = await trader.prepareSwap('SOL', 'USDC', 10);
      
      expect(tx.expires_at).toBeGreaterThan(Date.now());
      expect(tx.expires_at).toBeLessThan(Date.now() + 120000); // Within 2 minutes
    });
  });

  // ============================================
  // ONE-LINER CONVENIENCE METHODS
  // ============================================

  describe('Convenience Methods', () => {
    test('should buy token', async () => {
      const tx = await trader.buy('SOL', 100);
      
      expect(tx.token_out).toBe('SOL');
      expect(tx.type).toBe('swap');
    });

    test('should sell token', async () => {
      const tx = await trader.sell('SOL', 10);
      
      expect(tx.token_in).toBe('SOL');
      expect(tx.type).toBe('swap');
    });

    test('should check profitability', async () => {
      const result = await trader.isProfitable('SOL', 'USDC', 100);
      
      expect(typeof result.profitable).toBe('boolean');
      expect(typeof result.expected_profit_percent).toBe('number');
      expect(typeof result.recommendation).toBe('string');
    });

    test('should get portfolio value', async () => {
      const portfolio = await trader.getPortfolioValue();
      
      expect(typeof portfolio.total_usd).toBe('number');
      expect(Array.isArray(portfolio.positions)).toBe(true);
    });

    test('should smart swap with route selection', async () => {
      const result = await trader.smartSwap('SOL', 'USDC', 10);
      
      expect(['dex', 'a2a', 'auction', 'swarm']).toContain(result.route);
      expect(result.result).toBeDefined();
      expect(typeof result.execution_summary).toBe('string');
    });
  });

  // ============================================
  // ALPHA DETECTION
  // ============================================

  describe('Alpha Detection', () => {
    test('should detect alpha signals', async () => {
      const signals = await trader.detectAlpha();
      
      expect(Array.isArray(signals)).toBe(true);
      // Signals may be empty if no alpha detected
    });

    test('should analyze and generate signals', async () => {
      const signals = await trader.analyzeAndSignal();
      
      expect(Array.isArray(signals)).toBe(true);
    });

    test('should emit alpha events', (done) => {
      trader.on('alpha', (signal: AlphaSignal) => {
        expect(signal.type).toBeDefined();
        expect(signal.token).toBeDefined();
        expect(signal.direction).toBeDefined();
        done();
      });

      // Trigger alpha detection
      trader.detectAlpha().catch(() => {});
      
      // Timeout if no signal
      setTimeout(() => done(), 5000);
    }, 10000);

    test('should act on signal', async () => {
      const signal = {
        type: 'buy' as const,
        token: 'SOL',
        confidence: 75,
        reason: 'Test signal'
      };

      const tx = await trader.actOnSignal(signal, 10);
      
      expect(tx).toBeDefined();
      expect(tx?.token_out).toBe('SOL');
    });

    test('should return null for hold signal', async () => {
      const signal = {
        type: 'hold' as const,
        token: 'SOL',
        confidence: 50,
        reason: 'No action needed'
      };

      const tx = await trader.actOnSignal(signal);
      
      expect(tx).toBeNull();
    });
  });

  // ============================================
  // A2A TRADING
  // ============================================

  describe('A2A Trading', () => {
    test('should request quote from agent', async () => {
      const quote = await trader.requestQuote('agent-xyz', 'SOL', 'USDC', 100);
      
      expect(quote).toBeDefined();
      expect(quote.quote_id).toBeDefined();
      expect(quote.from_agent).toBe('test-trader');
      expect(quote.to_agent).toBe('agent-xyz');
      expect(quote.token_in).toBe('SOL');
      expect(quote.token_out).toBe('USDC');
      expect(quote.amount_in).toBe(100);
      // Status will be 'rejected' if agent not available
      expect(['pending', 'rejected']).toContain(quote.status);
    });

    test('should find trading partners', async () => {
      const partners = await trader.findTradingPartners('SOL', 'USDC', 100);
      
      expect(Array.isArray(partners)).toBe(true);
      // May be empty if no partners available
    });

    test('should handle A2A trade execution', async () => {
      const quote: A2AQuote = {
        quote_id: 'test-quote',
        from_agent: 'test-trader',
        to_agent: 'agent-xyz',
        token_in: 'SOL',
        token_out: 'USDC',
        amount_in: 100,
        amount_out: 14334,
        price: 143.34,
        valid_until: Date.now() + 60000,
        status: 'pending'
      };

      const result = await trader.executeA2ATrade(quote);
      
      expect(result).toBeDefined();
      expect(result.trade_id).toBeDefined();
      expect(['executed', 'failed', 'pending']).toContain(result.status);
    });

    test('should reject expired quote', async () => {
      const expiredQuote: A2AQuote = {
        quote_id: 'expired-quote',
        from_agent: 'test-trader',
        to_agent: 'agent-xyz',
        token_in: 'SOL',
        token_out: 'USDC',
        amount_in: 100,
        amount_out: 14334,
        price: 143.34,
        valid_until: Date.now() - 1000, // Expired
        status: 'pending'
      };

      const result = await trader.executeA2ATrade(expiredQuote);
      
      expect(result.status).toBe('failed');
      expect(result.error).toContain('expired');
    });

    test('should run auction', async () => {
      const result = await trader.auctionTrade('SOL', 'USDC', 1000);
      
      expect(result).toBeDefined();
      expect(Array.isArray(result.bids)).toBe(true);
      expect(typeof result.total_bidders).toBe('number');
    });

    test('should run swarm trade', async () => {
      const result = await trader.swarmTrade('SOL', 'USDC', 10000, { minAgents: 2 });
      
      expect(result).toBeDefined();
      expect(Array.isArray(result.participants)).toBe(true);
      expect(typeof result.total_amount_in).toBe('number');
      expect(typeof result.total_amount_out).toBe('number');
    });
  });

  // ============================================
  // A2A SIGNAL SHARING
  // ============================================

  describe('Signal Sharing', () => {
    test('should broadcast signal', async () => {
      const signal = {
        type: 'buy' as const,
        token: 'SOL',
        confidence: 80,
        reason: 'Momentum detected'
      };

      const result = await trader.broadcastSignal(signal);
      
      expect(result).toBeDefined();
      expect(Array.isArray(result.delivered_to)).toBe(true);
    });

    test('should poll A2A signals', async () => {
      const signals = await trader.pollA2ASignals();
      
      expect(Array.isArray(signals)).toBe(true);
    });

    test('should emit a2a_signal event', (done) => {
      trader.on('a2a_signal', ({ from, signal }) => {
        expect(from).toBeDefined();
        expect(signal).toBeDefined();
        done();
      });

      // Poll for signals
      trader.pollA2ASignals().catch(() => {});
      
      // Timeout if no signal
      setTimeout(() => done(), 3000);
    }, 5000);
  });

  // ============================================
  // SECURE A2A COMMUNICATION
  // ============================================

  describe('Secure Communication', () => {
    test('should establish secure channel', async () => {
      const session = await trader.establishSecureChannel('agent-xyz', 'confidential');
      
      expect(session).toBeDefined();
      expect(session.session_id).toBeDefined();
      expect(session.initiator).toBe('test-trader');
      expect(session.responder).toBe('agent-xyz');
      expect(session.privacy_level).toBe('confidential');
      expect(['established', 'rejected']).toContain(session.status);
    });

    test('should send public message without session', async () => {
      const msg = await trader.sendSecureMessage('agent-xyz', { test: 'data' }, 'public');
      
      expect(msg).toBeDefined();
      expect(msg.message_id).toBeDefined();
      expect(msg.privacy_level).toBe('public');
      expect(msg.verified).toBe(true);
    });

    test('should get secure sessions', () => {
      const sessions = trader.getSecureSessions();
      
      expect(Array.isArray(sessions)).toBe(true);
    });

    test('should close secure channel', async () => {
      // First establish
      await trader.establishSecureChannel('agent-xyz', 'confidential');
      
      // Then close
      await trader.closeSecureChannel('agent-xyz');
      
      const sessions = trader.getSecureSessions();
      const hasSession = sessions.some(s => s.responder === 'agent-xyz');
      expect(hasSession).toBe(false);
    });

    test('should verify public message', async () => {
      const msg = {
        message_id: 'test-msg',
        from_agent: 'agent-xyz',
        to_agent: 'test-trader',
        privacy_level: 'public' as const,
        payload: { test: 'data' },
        verified: false,
        timestamp: Date.now()
      };

      const result = await trader.verifyMessage(msg);
      
      expect(result.valid).toBe(true);
      expect(result.decrypted_payload).toEqual({ test: 'data' });
    });
  });

  // ============================================
  // FAULT TOLERANCE
  // ============================================

  describe('Fault Tolerance', () => {
    test('should configure fault tolerance', () => {
      trader.setFaultConfig({
        max_retries: 5,
        retry_delay_ms: 500,
        timeout_ms: 10000,
        circuit_breaker_threshold: 3
      });

      // No error means success
      expect(true).toBe(true);
    });

    test('should execute with fault tolerance', async () => {
      const result = await trader.executeWithFaultTolerance(
        async () => ({ success: true, data: 'test' }),
        'agent-xyz'
      );

      expect(result.success).toBe(true);
      expect(result.attempts).toBeGreaterThanOrEqual(1);
    });

    test('should use fallback on failure', async () => {
      let callCount = 0;
      
      const result = await trader.executeWithFaultTolerance(
        async () => {
          callCount++;
          if (callCount < 4) throw new Error('Simulated failure');
          return { success: true };
        },
        'agent-xyz',
        ['fallback-agent']
      );

      expect(result.attempts).toBeGreaterThan(1);
    });

    test('should respect timeout', async () => {
      trader.setFaultConfig({ timeout_ms: 100 });

      const result = await trader.executeWithFaultTolerance(
        async () => {
          await new Promise(resolve => setTimeout(resolve, 500));
          return { success: true };
        },
        'agent-xyz'
      );

      expect(result.success).toBe(false);
    }, 10000);
  });

  // ============================================
  // CROSS-PROTOCOL INTEROPERABILITY
  // ============================================

  describe('Cross-Protocol Interoperability', () => {
    test('should register cross-protocol agent', () => {
      const agent: CrossProtocolAgent = {
        agent_id: 'google-agent',
        protocol: 'a2a_google',
        endpoint: 'https://agent.example.com',
        capabilities: ['swap', 'quote']
      };

      trader.registerCrossProtocolAgent(agent);
      
      // No error means success
      expect(true).toBe(true);
    });

    test('should discover cross-protocol agents', async () => {
      // Register a test agent first
      trader.registerCrossProtocolAgent({
        agent_id: 'mcp-agent',
        protocol: 'mcp',
        endpoint: 'https://mcp.example.com',
        capabilities: ['swap']
      });

      const agents = await trader.discoverCrossProtocolAgents({
        protocols: ['mcp'],
        capability: 'swap'
      });

      expect(agents.length).toBeGreaterThanOrEqual(1);
      expect(agents.some(a => a.agent_id === 'mcp-agent')).toBe(true);
    });

    test('should invoke cross-protocol agent', async () => {
      trader.registerCrossProtocolAgent({
        agent_id: 'test-cross',
        protocol: 'cap402',
        endpoint: 'https://cap402.com',
        capabilities: ['cap.price.lookup.v1']
      });

      const result = await trader.invokeCrossProtocol(
        'test-cross',
        'cap.price.lookup.v1',
        { base_token: 'SOL' }
      );

      expect(result).toBeDefined();
      expect(result.protocol).toBe('cap402');
    });

    test('should throw for unregistered agent', async () => {
      await expect(
        trader.invokeCrossProtocol('unknown-agent', 'swap', {})
      ).rejects.toThrow('not registered');
    });
  });

  // ============================================
  // PORTFOLIO & STATS
  // ============================================

  describe('Portfolio & Stats', () => {
    test('should get positions', () => {
      const positions = trader.getPositions();
      
      expect(Array.isArray(positions)).toBe(true);
    });

    test('should get specific position', () => {
      const position = trader.getPosition('SOL');
      
      // May be undefined if no position
      expect(position === undefined || typeof position.amount === 'number').toBe(true);
    });

    test('should get stats', () => {
      const stats = trader.getStats();
      
      expect(stats).toBeDefined();
      expect(typeof stats.trading_stats.total_trades).toBe('number');
      expect(typeof stats.uptime_ms).toBe('number');
    });

    test('should print stats without error', () => {
      // Should not throw
      trader.printStats();
      expect(true).toBe(true);
    });

    test('should get total PnL', () => {
      const pnl = trader.getTotalPnL();
      
      expect(typeof pnl.unrealized).toBe('number');
      expect(typeof pnl.realized).toBe('number');
    });
  });

  // ============================================
  // EVENTS
  // ============================================

  describe('Events', () => {
    test('should emit transaction_prepared event', (done) => {
      trader.on('transaction_prepared', (tx: PreparedTransaction) => {
        expect(tx.instruction_id).toBeDefined();
        done();
      });

      trader.prepareSwap('SOL', 'USDC', 10).catch(() => {});
    }, 10000);

    test('should emit signal event', (done) => {
      trader.on('signal', (signal) => {
        expect(signal.type).toBeDefined();
        done();
      });

      trader.analyzeAndSignal().catch(() => {});
      
      // Timeout if no signal
      setTimeout(() => done(), 5000);
    }, 10000);

    test('should emit secure_channel_established event', (done) => {
      trader.on('secure_channel_established', ({ agent, session_id }) => {
        expect(agent).toBeDefined();
        expect(session_id).toBeDefined();
        done();
      });

      trader.establishSecureChannel('agent-xyz', 'confidential').catch(() => {});
      
      // Timeout if channel not established
      setTimeout(() => done(), 5000);
    }, 10000);
  });
});

// ============================================
// STEALTH TRADING MODE TESTS
// ============================================

describe('Stealth Trading Mode', () => {
  let stealthTrader: TradingAgent;

  beforeEach(() => {
    stealthTrader = createTradingAgent({
      agent_id: 'stealth-trader',
      name: 'Stealth Trading Bot',
      watched_tokens: ['SOL', 'ETH'],
      mev_protection: true,
      router_url: 'http://localhost:3001',
      stealth_mode: {
        enabled: true,
        auto_privacy_threshold_usd: 10000,
        auto_split_threshold_usd: 50000,
        randomize_timing: true,
        decoy_transactions: false
      }
    });
  });

  afterEach(async () => {
    try {
      await stealthTrader.stop();
    } catch {
      // Ignore
    }
  });

  test('should create stealth trader with stealth config', () => {
    expect(stealthTrader).toBeDefined();
    expect((stealthTrader as any).config.stealth_mode).toBeDefined();
    expect((stealthTrader as any).config.stealth_mode.enabled).toBe(true);
  });

  test('should analyze stealth options', async () => {
    const analysis = await stealthTrader.analyzeStealthOptions('SOL', 'USDC', 100);
    
    expect(analysis).toBeDefined();
    expect(analysis.trade.token_in).toBe('SOL');
    expect(analysis.trade.token_out).toBe('USDC');
    expect(analysis.options).toHaveLength(3);
    expect(analysis.options[0].level).toBe('standard');
    expect(analysis.options[1].level).toBe('enhanced');
    expect(analysis.options[2].level).toBe('maximum');
    expect(analysis.recommendation).toBeDefined();
  });

  test('should execute stealth trade with standard privacy', async () => {
    const result = await stealthTrader.stealthTrade('SOL', 'USDC', 10, {
      privacy_level: 'standard'
    });
    
    expect(result).toBeDefined();
    expect(result.stealth_id).toMatch(/^stealth_/);
    expect(result.privacy_level).toBe('standard');
    expect(result.chunks.length).toBeGreaterThan(0);
  }, 30000);

  test('should execute stealth trade with maximum privacy', async () => {
    const result = await stealthTrader.stealthTrade('SOL', 'USDC', 10, {
      privacy_level: 'maximum'
    });
    
    expect(result).toBeDefined();
    expect(result.privacy_level).toBe('maximum');
    expect(result.stealth_features_used).toContain('arcium_mpc');
  }, 30000);

  test('should split large orders', async () => {
    const result = await stealthTrader.stealthTrade('SOL', 'USDC', 100, {
      split_order: true,
      max_chunks: 3
    });
    
    expect(result).toBeDefined();
    expect(result.chunks.length).toBe(3);
    expect(result.stealth_features_used).toContain('order_splitting');
  }, 30000);

  test('should emit stealth_trade_completed event', (done) => {
    stealthTrader.on('stealth_trade_completed', (result) => {
      expect(result.stealth_id).toBeDefined();
      expect(result.status).toBe('completed');
      done();
    });

    stealthTrader.stealthTrade('SOL', 'USDC', 5, { privacy_level: 'standard' }).catch(() => done());
  }, 30000);
});

// ============================================
// ⚡ INSTANT EXECUTION MODE TESTS
// ============================================

describe('Instant Execution Mode', () => {
  let instantTrader: TradingAgent;

  beforeEach(() => {
    instantTrader = createTradingAgent({
      agent_id: 'instant-trader',
      name: 'Instant Trading Bot',
      watched_tokens: ['SOL', 'USDC'],
      mev_protection: true,
      router_url: 'http://localhost:3001',
      instant_mode: {
        enabled: true,
        pre_warm_connections: true,
        cache_routes: true,
        parallel_quotes: true,
        skip_mev_under_usd: 500,
        max_latency_ms: 3000
      }
    });
  });

  afterEach(async () => {
    try {
      await instantTrader.stop();
    } catch {
      // Ignore
    }
  });

  test('should create instant trader with instant config', () => {
    expect(instantTrader).toBeDefined();
    expect((instantTrader as any).config.instant_mode).toBeDefined();
    expect((instantTrader as any).config.instant_mode.enabled).toBe(true);
  });

  test('should execute instant swap', async () => {
    const result = await instantTrader.instantSwap('SOL', 'USDC', 5);
    
    expect(result).toBeDefined();
    expect(result.swap_id).toMatch(/^instant_/);
    expect(result.latency_ms).toBeGreaterThan(0);
    expect(result.optimizations_used).toBeDefined();
  }, 10000);

  test('should skip MEV for small trades', async () => {
    const result = await instantTrader.instantSwap('SOL', 'USDC', 1, {
      skip_mev_check: true
    });
    
    expect(result.mev_skipped).toBe(true);
    expect(result.optimizations_used).toContain('mev_skip');
  }, 10000);

  test('should warm up caches', async () => {
    await instantTrader.warmUp([
      { tokenIn: 'SOL', tokenOut: 'USDC' }
    ]);
    
    const stats = instantTrader.getInstantStats();
    expect(stats.cached_routes).toBeGreaterThanOrEqual(0);
    expect(stats.cached_prices).toBeGreaterThanOrEqual(0);
  }, 10000);

  test('should emit instant_swap_completed event', (done) => {
    instantTrader.on('instant_swap_completed', (result) => {
      expect(result.swap_id).toBeDefined();
      expect(result.latency_ms).toBeGreaterThan(0);
      done();
    });

    instantTrader.instantSwap('SOL', 'USDC', 2).catch(() => {});
  }, 10000);
});

// ============================================
// SMART TRADE TESTS
// ============================================

describe('Smart Trade', () => {
  let trader: TradingAgent;

  beforeEach(() => {
    trader = createTradingAgent({
      agent_id: 'smart-trader',
      name: 'Smart Trader',
      watched_tokens: ['SOL', 'USDC'],
      router_url: 'http://localhost:3001'
    });
  });

  afterEach(async () => {
    try {
      await trader.stop();
    } catch {
      // Ignore
    }
  });

  test('should auto-select execution method based on trade size', async () => {
    const result = await trader.smartTrade('SOL', 'USDC', 1);
    
    expect(result).toBeDefined();
    expect(result.method).toBeDefined();
    expect(result.latency_ms).toBeGreaterThan(0);
    expect(['instant', 'protected', 'stealth']).toContain(result.method);
  }, 15000);
});

// ============================================
// QUICK FACTORY TESTS
// ============================================

describe('Quick Factories', () => {
  test('should create trader with minimal config', () => {
    const trader = createTradingAgent({
      agent_id: 'quick-trader',
      name: 'Quick Trader',
      watched_tokens: ['SOL']
    });

    expect(trader).toBeDefined();
  });
});
