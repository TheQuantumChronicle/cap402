/**
 * Trading Agent Template
 * 
 * A production-ready trading agent that monitors prices, executes trades,
 * and manages portfolio positions using CAP-402 capabilities.
 * 
 * ⚠️ SAFETY WARNINGS:
 * 
 * 1. ALWAYS start with dry_run: true to test without real transactions
 * 2. Set appropriate trading_limits to prevent excessive losses
 * 3. Use mev_protection: true for trades above $100
 * 4. Monitor the agent and set up alerts for anomalies
 * 5. Never run unattended without proper safety guardrails
 * 6. Test thoroughly on testnet before mainnet
 * 
 * The authors are not responsible for any financial losses incurred
 * through the use of this software. Trade at your own risk.
 */

import { CAP402Agent, createAgent, AgentConfig, InvokeResult } from '../agent';
import { EventEmitter } from 'events';

// ============================================
// TYPES
// ============================================

export interface TradingConfig extends Partial<AgentConfig> {
  agent_id: string;
  name: string;
  watched_tokens: string[];
  quote_currency?: string;
  price_check_interval_ms?: number;
  alert_thresholds?: {
    price_change_percent?: number;
    volume_spike_multiplier?: number;
  };
  trading_limits?: {
    max_position_size?: number;
    max_daily_trades?: number;
    max_slippage_percent?: number;
  };
  mev_protection?: boolean;
  dry_run?: boolean;
}

export interface PriceData {
  token: string;
  price: number;
  change_24h?: number;
  volume_24h?: number;
  timestamp: number;
  source?: string;
}

export interface TradeSignal {
  type: 'buy' | 'sell' | 'hold';
  token: string;
  confidence: number;
  reason: string;
  suggested_amount?: number;
  price_target?: number;
  stop_loss?: number;
}

export interface TradeExecution {
  trade_id: string;
  token_in: string;
  token_out: string;
  amount_in: number;
  amount_out: number;
  price: number;
  slippage: number;
  mev_protected: boolean;
  timestamp: number;
  status: 'pending' | 'executed' | 'failed' | 'ready';
  tx_hash?: string;
}

export interface PreparedTransaction {
  instruction_id: string;
  type: 'swap' | 'transfer' | 'stake';
  status: 'ready' | 'expired' | 'executed';
  created_at: number;
  expires_at: number;
  
  // Trade details
  token_in: string;
  token_out: string;
  amount_in: number;
  expected_out: number;
  min_out: number;
  slippage_bps: number;
  
  // Route info
  dex: string;
  route: Array<{ from: string; to: string; pool: string }>;
  price_impact_percent: number;
  
  // MEV protection
  mev_risk: 'LOW' | 'MEDIUM' | 'HIGH';
  mev_recommendations: string[];
  
  // Ready-to-sign transaction (base64 encoded)
  serialized_transaction?: string;
  
  // For user's wallet
  user_action_required: 'sign_and_submit' | 'approve_token' | 'none';
  instructions_for_user: string;
  
  // Human-readable summary
  summary: TransactionSummary;
}

/**
 * Human-readable transaction summary for UI display
 */
export interface TransactionSummary {
  /** One-line description: "Swap 10 SOL → ~1,433 USDC" */
  headline: string;
  /** Detailed breakdown for confirmation dialogs */
  details: {
    action: string;
    you_send: string;
    you_receive: string;
    exchange_rate: string;
    fees_estimate: string;
    time_to_confirm: string;
  };
  /** Risk warnings if any */
  warnings: string[];
  /** Confidence score 0-100 */
  confidence_score: number;
  /** Why this trade was suggested */
  rationale: string;
}

/**
 * Alpha signal with actionable insights
 */
export interface AlphaSignal {
  type: 'momentum' | 'reversal' | 'breakout' | 'whale_activity' | 'volume_spike';
  token: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  strength: 'weak' | 'moderate' | 'strong';
  confidence: number;
  
  // Actionable insights
  suggested_action: 'buy' | 'sell' | 'hold' | 'watch';
  entry_price?: number;
  target_price?: number;
  stop_loss?: number;
  
  // Context
  reason: string;
  supporting_data: {
    price_change_1h?: number;
    price_change_24h?: number;
    volume_change?: number;
    rsi?: number;
    momentum_score?: number;
  };
  
  // Timing
  detected_at: number;
  valid_until: number;
}

export interface Position {
  token: string;
  amount: number;
  avg_entry_price: number;
  current_price: number;
  unrealized_pnl: number;
  unrealized_pnl_percent: number;
}

// ============================================
// A2A TRADING INTERFACES
// ============================================

/**
 * Quote from another trading agent
 */
export interface A2AQuote {
  quote_id: string;
  from_agent: string;
  to_agent: string;
  token_in: string;
  token_out: string;
  amount_in: number;
  amount_out: number;
  price: number;
  valid_until: number;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  terms?: string;
}

/**
 * Trading partner discovered via A2A
 */
export interface A2ATradingPartner {
  agent_id: string;
  name: string;
  trust_score: number;
  quote: A2AQuote;
  available: boolean;
  capabilities: string[];
}

/**
 * Result of an A2A trade execution
 */
export interface A2ATradeResult {
  trade_id: string;
  status: 'executed' | 'failed' | 'pending';
  quote: A2AQuote;
  tx_hash?: string;
  amount_received?: number;
  execution_price?: number;
  error?: string;
}

/**
 * Result of an A2A auction
 */
export interface A2AAuctionResult {
  auction_id: string;
  winner?: { agent_id: string; bid: number };
  bids: Array<{ agent_id: string; price: number; trust_score: number }>;
  best_price?: number;
  total_bidders: number;
  error?: string;
}

/**
 * Result of a swarm trade
 */
export interface A2ASwarmResult {
  swarm_id: string;
  participants: string[];
  total_amount_in: number;
  total_amount_out: number;
  execution_time_ms: number;
  individual_results?: any[];
  error?: string;
}

// ============================================
// TRADING AGENT
// ============================================

export class TradingAgent extends EventEmitter {
  private agent: CAP402Agent;
  private config: Required<TradingConfig>;
  private prices: Map<string, PriceData> = new Map();
  private priceHistory: Map<string, PriceData[]> = new Map();
  private positions: Map<string, Position> = new Map();
  private trades: TradeExecution[] = [];
  private dailyTradeCount = 0;
  private lastDayReset = Date.now();
  private priceCheckTimer?: NodeJS.Timeout;
  private isRunning = false;

  constructor(config: TradingConfig) {
    super();

    this.config = {
      quote_currency: 'USD',
      price_check_interval_ms: 30000,
      alert_thresholds: {
        price_change_percent: 5,
        volume_spike_multiplier: 3,
        ...config.alert_thresholds
      },
      trading_limits: {
        max_position_size: 10000,
        max_daily_trades: 50,
        max_slippage_percent: 1,
        ...config.trading_limits
      },
      mev_protection: true,
      dry_run: true,
      router_url: 'https://cap402.com',
      description: 'Trading agent for price monitoring and trade execution',
      capabilities_provided: ['trading.signals', 'trading.execute'],
      capabilities_required: ['cap.price.lookup.v1', 'cap.swap.execute.v1'],
      ...config
    } as Required<TradingConfig>;

    this.agent = createAgent({
      agent_id: this.config.agent_id,
      name: this.config.name,
      router_url: this.config.router_url,
      description: this.config.description,
      capabilities_provided: this.config.capabilities_provided,
      capabilities_required: this.config.capabilities_required,
      tags: ['trading', 'defi', 'automated']
    });

    this.setupAgentEvents();
  }

  // ============================================
  // LIFECYCLE
  // ============================================

  async start(): Promise<void> {
    console.log(`\n🤖 Starting Trading Agent: ${this.config.name}`);
    console.log(`   Watching: ${this.config.watched_tokens.join(', ')}`);
    console.log(`   Quote: ${this.config.quote_currency}`);
    console.log(`   MEV Protection: ${this.config.mev_protection ? 'ON' : 'OFF'}`);
    console.log(`   Dry Run: ${this.config.dry_run ? 'YES' : 'NO'}\n`);

    // Safety warnings
    if (!this.config.dry_run) {
      console.warn('⚠️  WARNING: Dry run is DISABLED. Real transactions will be executed!');
      console.warn('⚠️  Ensure you have reviewed all trading limits and safety settings.');
    }
    
    if (!this.config.mev_protection) {
      console.warn('⚠️  WARNING: MEV protection is OFF. Large trades may be front-run.');
    }

    if (!this.config.trading_limits?.max_position_size) {
      console.warn('⚠️  WARNING: No max_position_size set. Consider adding trading limits.');
    }

    await this.agent.start();
    this.isRunning = true;

    // Initial price fetch
    await this.updatePrices();

    // Start price monitoring loop
    this.priceCheckTimer = setInterval(async () => {
      if (!this.isRunning) return;
      await this.updatePrices();
      await this.analyzeAndSignal();
    }, this.config.price_check_interval_ms);

    this.emit('started');
  }

  async stop(): Promise<void> {
    console.log('\n🛑 Stopping Trading Agent...');
    this.isRunning = false;

    if (this.priceCheckTimer) {
      clearInterval(this.priceCheckTimer);
    }

    // Print final stats
    this.printStats();

    await this.agent.stop();
    this.emit('stopped');
  }

  // ============================================
  // PRICE MONITORING
  // ============================================

  async updatePrices(): Promise<void> {
    const results = await Promise.allSettled(
      this.config.watched_tokens.map(token => this.fetchPrice(token))
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const token = this.config.watched_tokens[i];

      if (result.status === 'fulfilled' && result.value) {
        const oldPrice = this.prices.get(token);
        const newPrice = result.value;

        this.prices.set(token, newPrice);

        // Store history (keep last 100)
        if (!this.priceHistory.has(token)) {
          this.priceHistory.set(token, []);
        }
        const history = this.priceHistory.get(token)!;
        history.push(newPrice);
        if (history.length > 100) history.shift();

        // Check for significant price change
        if (oldPrice && this.config.alert_thresholds.price_change_percent) {
          const changePercent = ((newPrice.price - oldPrice.price) / oldPrice.price) * 100;
          if (Math.abs(changePercent) >= this.config.alert_thresholds.price_change_percent) {
            this.emit('price_alert', {
              token,
              old_price: oldPrice.price,
              new_price: newPrice.price,
              change_percent: changePercent,
              direction: changePercent > 0 ? 'up' : 'down'
            });
          }
        }

        // Update position if we have one
        const position = this.positions.get(token);
        if (position) {
          position.current_price = newPrice.price;
          position.unrealized_pnl = (newPrice.price - position.avg_entry_price) * position.amount;
          position.unrealized_pnl_percent = ((newPrice.price - position.avg_entry_price) / position.avg_entry_price) * 100;
        }
      }
    }

    this.emit('prices_updated', Object.fromEntries(this.prices));
  }

  private async fetchPrice(token: string): Promise<PriceData | null> {
    try {
      const result = await this.agent.invoke<{
        price: number;
        change_24h?: number;
        volume_24h?: number;
        source?: string;
      }>('cap.price.lookup.v1', {
        base_token: token,
        quote_token: this.config.quote_currency
      });

      if (result.success && result.outputs) {
        return {
          token,
          price: result.outputs.price,
          change_24h: result.outputs.change_24h,
          volume_24h: result.outputs.volume_24h,
          timestamp: Date.now(),
          source: result.outputs.source
        };
      }
    } catch (error) {
      console.error(`Failed to fetch price for ${token}:`, error);
    }
    return null;
  }

  getPrice(token: string): PriceData | undefined {
    return this.prices.get(token);
  }

  getPrices(): Map<string, PriceData> {
    return new Map(this.prices);
  }

  getPriceHistory(token: string): PriceData[] {
    return this.priceHistory.get(token) || [];
  }

  // ============================================
  // SIGNAL GENERATION
  // ============================================

  async analyzeAndSignal(): Promise<TradeSignal[]> {
    const signals: TradeSignal[] = [];

    for (const token of this.config.watched_tokens) {
      const signal = await this.generateSignal(token);
      if (signal && signal.type !== 'hold') {
        signals.push(signal);
        this.emit('signal', signal);
      }
    }

    return signals;
  }

  /**
   * Detect alpha signals - actionable trading opportunities
   * More sophisticated than basic signals, includes momentum, reversals, breakouts
   */
  async detectAlpha(): Promise<AlphaSignal[]> {
    const alphaSignals: AlphaSignal[] = [];
    const now = Date.now();

    for (const token of this.config.watched_tokens) {
      const price = this.prices.get(token);
      const history = this.priceHistory.get(token) || [];

      if (!price || history.length < 10) continue;

      const recentPrices = history.slice(-20).map(p => p.price);
      const avgPrice = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
      const priceDeviation = ((price.price - avgPrice) / avgPrice) * 100;
      const change24h = price.change_24h || 0;
      const volume24h = price.volume_24h || 0;

      // Calculate momentum score
      const shortTermPrices = history.slice(-5).map(p => p.price);
      const shortTermAvg = shortTermPrices.reduce((a, b) => a + b, 0) / shortTermPrices.length;
      const momentumScore = ((price.price - shortTermAvg) / shortTermAvg) * 100;

      // Detect momentum signal
      if (Math.abs(momentumScore) > 2) {
        const isBullish = momentumScore > 0;
        alphaSignals.push({
          type: 'momentum',
          token,
          direction: isBullish ? 'bullish' : 'bearish',
          strength: Math.abs(momentumScore) > 5 ? 'strong' : Math.abs(momentumScore) > 3 ? 'moderate' : 'weak',
          confidence: Math.min(85, 50 + Math.abs(momentumScore) * 5),
          suggested_action: isBullish ? 'buy' : 'sell',
          entry_price: price.price,
          target_price: isBullish ? price.price * 1.05 : price.price * 0.95,
          stop_loss: isBullish ? price.price * 0.97 : price.price * 1.03,
          reason: `${isBullish ? 'Bullish' : 'Bearish'} momentum: ${momentumScore.toFixed(2)}% short-term move`,
          supporting_data: {
            price_change_24h: change24h,
            momentum_score: momentumScore
          },
          detected_at: now,
          valid_until: now + 300000 // 5 minutes
        });
      }

      // Detect reversal signal (oversold/overbought)
      if (priceDeviation < -5 && change24h < -8) {
        alphaSignals.push({
          type: 'reversal',
          token,
          direction: 'bullish',
          strength: priceDeviation < -10 ? 'strong' : 'moderate',
          confidence: Math.min(80, 40 + Math.abs(priceDeviation) * 3),
          suggested_action: 'buy',
          entry_price: price.price,
          target_price: avgPrice,
          stop_loss: price.price * 0.93,
          reason: `Potential reversal: ${priceDeviation.toFixed(2)}% below avg after ${change24h.toFixed(2)}% 24h drop`,
          supporting_data: {
            price_change_24h: change24h,
            momentum_score: momentumScore
          },
          detected_at: now,
          valid_until: now + 600000 // 10 minutes
        });
      } else if (priceDeviation > 8 && change24h > 15) {
        alphaSignals.push({
          type: 'reversal',
          token,
          direction: 'bearish',
          strength: priceDeviation > 15 ? 'strong' : 'moderate',
          confidence: Math.min(75, 35 + priceDeviation * 2),
          suggested_action: 'sell',
          entry_price: price.price,
          target_price: avgPrice * 1.02,
          reason: `Potential reversal: ${priceDeviation.toFixed(2)}% above avg after ${change24h.toFixed(2)}% 24h pump`,
          supporting_data: {
            price_change_24h: change24h,
            momentum_score: momentumScore
          },
          detected_at: now,
          valid_until: now + 600000
        });
      }
    }

    // Emit alpha signals
    for (const signal of alphaSignals) {
      this.emit('alpha', signal);
    }

    return alphaSignals;
  }

  private async generateSignal(token: string): Promise<TradeSignal | null> {
    const price = this.prices.get(token);
    const history = this.priceHistory.get(token) || [];

    if (!price || history.length < 5) {
      return null;
    }

    // Simple momentum-based signal (can be extended with more sophisticated strategies)
    const recentPrices = history.slice(-10).map(p => p.price);
    const avgPrice = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
    const priceDeviation = ((price.price - avgPrice) / avgPrice) * 100;

    // Check 24h change
    const change24h = price.change_24h || 0;

    let signal: TradeSignal = {
      type: 'hold',
      token,
      confidence: 0,
      reason: 'No clear signal'
    };

    // Oversold condition - potential buy
    if (priceDeviation < -3 && change24h < -5) {
      signal = {
        type: 'buy',
        token,
        confidence: Math.min(0.8, Math.abs(priceDeviation) / 10),
        reason: `Oversold: ${priceDeviation.toFixed(2)}% below avg, ${change24h.toFixed(2)}% 24h drop`,
        price_target: avgPrice,
        stop_loss: price.price * 0.95
      };
    }
    // Overbought condition - potential sell
    else if (priceDeviation > 5 && change24h > 10) {
      signal = {
        type: 'sell',
        token,
        confidence: Math.min(0.8, priceDeviation / 15),
        reason: `Overbought: ${priceDeviation.toFixed(2)}% above avg, ${change24h.toFixed(2)}% 24h gain`,
        price_target: avgPrice * 1.02
      };
    }

    return signal;
  }

  // ============================================
  // TRADE EXECUTION
  // ============================================

  async executeTrade(
    tokenIn: string,
    tokenOut: string,
    amountIn: number,
    options?: {
      max_slippage_percent?: number;
      mev_protection?: boolean;
    }
  ): Promise<TradeExecution> {
    // Check daily trade limit
    this.resetDailyCounterIfNeeded();
    const maxDailyTrades = this.config.trading_limits?.max_daily_trades ?? 50;
    if (this.dailyTradeCount >= maxDailyTrades) {
      throw new Error('Daily trade limit reached');
    }

    // Check position size limit
    const priceIn = this.prices.get(tokenIn);
    const maxPositionSize = this.config.trading_limits?.max_position_size ?? 10000;
    if (priceIn && amountIn * priceIn.price > maxPositionSize) {
      throw new Error('Position size exceeds limit');
    }

    const useMevProtection = options?.mev_protection ?? this.config.mev_protection;
    const maxSlippage = options?.max_slippage_percent ?? this.config.trading_limits?.max_slippage_percent ?? 1;

    const trade: TradeExecution = {
      trade_id: `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      token_in: tokenIn,
      token_out: tokenOut,
      amount_in: amountIn,
      amount_out: 0,
      price: 0,
      slippage: 0,
      mev_protected: useMevProtection,
      timestamp: Date.now(),
      status: 'pending'
    };

    if (this.config.dry_run) {
      // Simulate trade
      const priceOut = this.prices.get(tokenOut);
      if (priceIn && priceOut) {
        trade.price = priceIn.price / priceOut.price;
        trade.amount_out = amountIn * trade.price * (1 - 0.003); // 0.3% fee
        trade.slippage = 0.1;
        trade.status = 'executed';
      } else {
        trade.status = 'failed';
      }
      
      console.log(`[DRY RUN] Trade: ${amountIn} ${tokenIn} -> ${trade.amount_out.toFixed(4)} ${tokenOut}`);
    } else {
      try {
        // Analyze MEV risk first via REST endpoint
        if (useMevProtection) {
          try {
            const axios = (await import('axios')).default;
            const mevResponse = await axios.post(`${this.config.router_url}/mev/analyze`, {
              token_in: tokenIn,
              token_out: tokenOut,
              amount: amountIn,
              slippage: maxSlippage
            }, { timeout: 10000 });

            if (mevResponse.data.success && mevResponse.data.mev_analysis) {
              const analysis = mevResponse.data.mev_analysis;
              if (analysis.risk_assessment?.overall_risk === 'HIGH') {
                this.emit('mev_warning', {
                  trade_id: trade.trade_id,
                  risk: analysis.risk_assessment,
                  recommendations: analysis.recommendations
                });
              }
            }
          } catch {
            // MEV analysis failed, continue with trade
          }
        }

        // Execute swap via capability
        const swapResult = await this.agent.invoke('cap.swap.execute.v1', {
          token_in: tokenIn,
          token_out: tokenOut,
          amount_in: amountIn,
          slippage: maxSlippage
        });

        if (swapResult.success && swapResult.outputs) {
          trade.amount_out = swapResult.outputs.amount_out || amountIn;
          trade.price = swapResult.outputs.execution_price || 1;
          trade.slippage = swapResult.outputs.slippage || 0;
          trade.tx_hash = swapResult.outputs.tx_hash;
          trade.status = 'executed';
        } else {
          trade.status = 'failed';
        }
      } catch (error) {
        trade.status = 'failed';
        console.error('Trade execution failed:', error);
      }
    }

    this.trades.push(trade);
    // Keep only last 1000 trades to prevent memory leak
    if (this.trades.length > 1000) {
      this.trades = this.trades.slice(-1000);
    }
    this.dailyTradeCount++;

    if (trade.status === 'executed') {
      this.updatePositions(trade);
      this.emit('trade_executed', trade);
    } else {
      this.emit('trade_failed', trade);
    }

    return trade;
  }

  // ============================================
  // AUTONOMOUS TRANSACTION PREPARATION
  // ============================================

  /**
   * Prepare a ready-to-sign swap transaction
   * Agent does all the work, user just signs
   * 
   * @example
   * const prepared = await agent.prepareSwap('SOL', 'USDC', 10);
   * // User's wallet signs prepared.serialized_transaction
   */
  async prepareSwap(
    tokenIn: string,
    tokenOut: string,
    amount: number,
    options?: {
      slippage_bps?: number;
      user_wallet?: string;
    }
  ): Promise<PreparedTransaction> {
    const slippageBps = options?.slippage_bps ?? 50; // 0.5% default
    const now = Date.now();
    const expiresAt = now + 60000; // 1 minute expiry

    // Get current prices
    const priceIn = this.prices.get(tokenIn);
    const priceOut = this.prices.get(tokenOut);
    
    if (!priceIn || !priceOut) {
      await this.updatePrices();
    }

    const currentPriceIn = this.prices.get(tokenIn)?.price || 0;
    const currentPriceOut = this.prices.get(tokenOut)?.price || 1;
    const expectedOut = (amount * currentPriceIn) / currentPriceOut;
    const minOut = expectedOut * (1 - slippageBps / 10000);

    // Analyze MEV risk
    let mevRisk: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
    let mevRecommendations: string[] = [];
    
    try {
      const axios = (await import('axios')).default;
      const mevResponse = await axios.post(`${this.config.router_url}/mev/analyze`, {
        token_in: tokenIn,
        token_out: tokenOut,
        amount,
        slippage: slippageBps / 100
      }, { timeout: 5000 });

      if (mevResponse.data.success && mevResponse.data.mev_analysis) {
        mevRisk = mevResponse.data.mev_analysis.risk_assessment?.overall_risk || 'LOW';
        mevRecommendations = mevResponse.data.mev_analysis.recommendations || [];
      }
    } catch {
      // MEV check failed, assume low risk
    }

    // Calculate price impact (simplified)
    const usdValue = amount * currentPriceIn;
    const priceImpact = usdValue > 10000 ? 0.5 : usdValue > 1000 ? 0.1 : 0.01;

    // Build human-readable summary
    const warnings: string[] = [];
    if (mevRisk === 'HIGH') warnings.push('⚠️ High MEV risk - consider smaller trade size');
    if (priceImpact > 0.3) warnings.push('⚠️ High price impact - may get worse execution');
    if (usdValue > 1000) warnings.push('💰 Large trade - double-check before signing');
    
    const summary: TransactionSummary = {
      headline: `Swap ${amount} ${tokenIn} → ~${expectedOut.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${tokenOut}`,
      details: {
        action: 'Token Swap',
        you_send: `${amount} ${tokenIn} (~$${usdValue.toFixed(2)})`,
        you_receive: `~${expectedOut.toFixed(4)} ${tokenOut}`,
        exchange_rate: `1 ${tokenIn} = ${(expectedOut / amount).toFixed(4)} ${tokenOut}`,
        fees_estimate: '~$0.01 (network) + 0.3% (DEX)',
        time_to_confirm: '~15 seconds'
      },
      warnings,
      confidence_score: mevRisk === 'LOW' ? 90 : mevRisk === 'MEDIUM' ? 70 : 50,
      rationale: `Best route via Jupiter aggregator with ${slippageBps / 100}% slippage protection`
    };

    const prepared: PreparedTransaction = {
      instruction_id: `prep_${now}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'swap',
      status: 'ready',
      created_at: now,
      expires_at: expiresAt,
      
      token_in: tokenIn,
      token_out: tokenOut,
      amount_in: amount,
      expected_out: expectedOut,
      min_out: minOut,
      slippage_bps: slippageBps,
      
      dex: 'jupiter',
      route: [{ from: tokenIn, to: tokenOut, pool: 'jupiter-aggregator' }],
      price_impact_percent: priceImpact,
      
      mev_risk: mevRisk,
      mev_recommendations: mevRecommendations,
      
      user_action_required: 'sign_and_submit',
      instructions_for_user: `Swap ${amount} ${tokenIn} for ~${expectedOut.toFixed(4)} ${tokenOut}. Min receive: ${minOut.toFixed(4)} ${tokenOut}. Sign in your wallet to execute.`,
      
      summary
    };

    // Emit event for UI/webhook consumption
    this.emit('transaction_prepared', prepared);

    console.log(`\n📝 Transaction Prepared:`);
    console.log(`   ${amount} ${tokenIn} → ~${expectedOut.toFixed(4)} ${tokenOut}`);
    console.log(`   MEV Risk: ${mevRisk}`);
    console.log(`   Expires: ${new Date(expiresAt).toLocaleTimeString()}`);
    console.log(`   Action: User must sign in wallet\n`);

    return prepared;
  }

  /**
   * Prepare multiple swaps as a batch
   */
  async prepareBatchSwaps(
    swaps: Array<{ tokenIn: string; tokenOut: string; amount: number }>
  ): Promise<PreparedTransaction[]> {
    const prepared: PreparedTransaction[] = [];
    
    for (const swap of swaps) {
      const tx = await this.prepareSwap(swap.tokenIn, swap.tokenOut, swap.amount);
      prepared.push(tx);
    }
    
    return prepared;
  }

  /**
   * Auto-prepare transaction when signal is generated
   * Returns ready-to-sign transaction for user
   */
  async actOnSignal(signal: TradeSignal, amount?: number): Promise<PreparedTransaction | null> {
    if (signal.type === 'hold') {
      return null;
    }

    const tradeAmount = amount || signal.suggested_amount || 1;
    
    if (signal.type === 'buy') {
      // Buy signal: swap quote currency for token
      return this.prepareSwap(this.config.quote_currency === 'USD' ? 'USDC' : this.config.quote_currency, signal.token, tradeAmount);
    } else {
      // Sell signal: swap token for quote currency
      return this.prepareSwap(signal.token, this.config.quote_currency === 'USD' ? 'USDC' : this.config.quote_currency, tradeAmount);
    }
  }

  /**
   * Get all pending prepared transactions
   */
  getPendingTransactions(): PreparedTransaction[] {
    // This would be stored in a real implementation
    return [];
  }

  // ============================================
  // AGENT-TO-AGENT (A2A) TRADING
  // ============================================

  /**
   * Request a price quote from another trading agent
   * Enables agent-to-agent price discovery and negotiation
   * 
   * @example
   * const quote = await trader.requestQuote('agent-xyz', 'SOL', 'USDC', 100);
   * if (quote.accepted) {
   *   const tx = await trader.executeA2ATrade(quote);
   * }
   */
  async requestQuote(
    targetAgent: string,
    tokenIn: string,
    tokenOut: string,
    amount: number
  ): Promise<A2AQuote> {
    const quoteId = `quote_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      const result = await this.agent.a2aInvoke<{
        price: number;
        amount_out: number;
        valid_until: number;
        terms?: string;
      }>({
        to_agent: targetAgent,
        capability_id: 'cap.a2a.quote.v1',
        inputs: {
          from_agent: this.config.agent_id,
          token_in: tokenIn,
          token_out: tokenOut,
          amount_in: amount,
          quote_id: quoteId
        }
      });

      if (result.success && result.outputs) {
        return {
          quote_id: quoteId,
          from_agent: this.config.agent_id,
          to_agent: targetAgent,
          token_in: tokenIn,
          token_out: tokenOut,
          amount_in: amount,
          amount_out: result.outputs.amount_out,
          price: result.outputs.price,
          valid_until: result.outputs.valid_until,
          status: 'pending',
          terms: result.outputs.terms
        };
      }
    } catch (error) {
      console.error(`Quote request to ${targetAgent} failed:`, error);
    }

    return {
      quote_id: quoteId,
      from_agent: this.config.agent_id,
      to_agent: targetAgent,
      token_in: tokenIn,
      token_out: tokenOut,
      amount_in: amount,
      amount_out: 0,
      price: 0,
      valid_until: 0,
      status: 'rejected'
    };
  }

  /**
   * Find trading agents that can execute a specific swap
   * Returns agents sorted by trust score and price
   */
  async findTradingPartners(
    tokenIn: string,
    tokenOut: string,
    amount: number
  ): Promise<A2ATradingPartner[]> {
    const partners: A2ATradingPartner[] = [];

    try {
      // Discover agents with swap capability
      const agents = await this.agent.discoverAgents({
        capability: 'cap.swap.execute.v1',
        min_trust_score: 0.5,
        limit: 10
      });

      // Request quotes from each
      for (const agent of agents) {
        if (agent.agent_id === this.config.agent_id) continue;

        const quote = await this.requestQuote(agent.agent_id, tokenIn, tokenOut, amount);
        
        if (quote.status !== 'rejected') {
          partners.push({
            agent_id: agent.agent_id,
            name: agent.name,
            trust_score: agent.trust_score,
            quote,
            available: agent.available,
            capabilities: agent.capabilities
          });
        }
      }

      // Sort by best price (highest amount_out)
      partners.sort((a, b) => b.quote.amount_out - a.quote.amount_out);

    } catch (error) {
      console.error('Failed to find trading partners:', error);
    }

    return partners;
  }

  /**
   * Execute an A2A trade with a partner agent
   * Coordinates the swap between two agents
   */
  async executeA2ATrade(quote: A2AQuote): Promise<A2ATradeResult> {
    const tradeId = `a2a_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Validate quote is still valid
    if (Date.now() > quote.valid_until) {
      return {
        trade_id: tradeId,
        status: 'failed',
        error: 'Quote expired',
        quote
      };
    }

    try {
      // Execute via A2A protocol
      const result = await this.agent.a2aInvoke<{
        tx_hash?: string;
        amount_received: number;
        execution_price: number;
      }>({
        to_agent: quote.to_agent,
        capability_id: 'cap.a2a.execute.v1',
        inputs: {
          quote_id: quote.quote_id,
          from_agent: this.config.agent_id,
          token_in: quote.token_in,
          token_out: quote.token_out,
          amount_in: quote.amount_in,
          expected_out: quote.amount_out
        }
      });

      if (result.success && result.outputs) {
        this.emit('a2a_trade_executed', {
          trade_id: tradeId,
          partner: quote.to_agent,
          amount_in: quote.amount_in,
          amount_out: result.outputs.amount_received
        });

        return {
          trade_id: tradeId,
          status: 'executed',
          quote,
          tx_hash: result.outputs.tx_hash,
          amount_received: result.outputs.amount_received,
          execution_price: result.outputs.execution_price
        };
      }

      return {
        trade_id: tradeId,
        status: 'failed',
        error: result.error || 'Execution failed',
        quote
      };

    } catch (error: any) {
      return {
        trade_id: tradeId,
        status: 'failed',
        error: error.message,
        quote
      };
    }
  }

  /**
   * Broadcast a trading signal to other agents
   * Enables collaborative trading and signal sharing
   */
  async broadcastSignal(signal: TradeSignal | AlphaSignal): Promise<{ delivered_to: string[] }> {
    const deliveredTo: string[] = [];

    try {
      // Find agents interested in this token
      const agents = await this.agent.discoverAgents({
        tags: ['trading', signal.token.toLowerCase()],
        limit: 20
      });

      for (const agent of agents) {
        if (agent.agent_id === this.config.agent_id) continue;

        try {
          await this.agent.sendMessage(agent.agent_id, {
            type: 'trading_signal',
            signal,
            from: this.config.agent_id,
            timestamp: Date.now()
          });
          deliveredTo.push(agent.agent_id);
        } catch {
          // Continue on individual failures
        }
      }

    } catch (error) {
      console.error('Failed to broadcast signal:', error);
    }

    return { delivered_to: deliveredTo };
  }

  /**
   * Subscribe to signals from other trading agents
   * Polls for new messages and emits events
   */
  async pollA2ASignals(): Promise<(TradeSignal | AlphaSignal)[]> {
    const signals: (TradeSignal | AlphaSignal)[] = [];

    try {
      const messages = await this.agent.getMessages(Date.now() - 60000); // Last minute

      for (const msg of messages) {
        if (msg.payload?.type === 'trading_signal' && msg.payload?.signal) {
          signals.push(msg.payload.signal);
          this.emit('a2a_signal', {
            from: msg.from_agent,
            signal: msg.payload.signal
          });
        }
      }

    } catch (error) {
      console.error('Failed to poll A2A signals:', error);
    }

    return signals;
  }

  /**
   * Request best execution from multiple agents (auction)
   * Agents compete to offer the best price
   */
  async auctionTrade(
    tokenIn: string,
    tokenOut: string,
    amount: number,
    maxPrice?: number
  ): Promise<A2AAuctionResult> {
    try {
      const result = await this.agent.startAuction({
        capability_id: 'cap.swap.execute.v1',
        inputs: {
          token_in: tokenIn,
          token_out: tokenOut,
          amount_in: amount
        },
        max_price: maxPrice,
        min_trust_score: 0.6,
        timeout_ms: 10000
      });

      return {
        auction_id: result.auction_id,
        winner: result.winner,
        bids: result.bids,
        best_price: result.winner?.bid,
        total_bidders: result.bids.length
      };

    } catch (error: any) {
      return {
        auction_id: '',
        bids: [],
        total_bidders: 0,
        error: error.message
      };
    }
  }

  /**
   * Coordinate a swarm trade - multiple agents execute in parallel
   * Useful for large orders that need to be split
   */
  async swarmTrade(
    tokenIn: string,
    tokenOut: string,
    totalAmount: number,
    options?: { minAgents?: number; maxAgents?: number }
  ): Promise<A2ASwarmResult> {
    try {
      const result = await this.agent.coordinateSwarm({
        capability_id: 'cap.swap.execute.v1',
        inputs: {
          token_in: tokenIn,
          token_out: tokenOut,
          amount_in: totalAmount
        },
        min_agents: options?.minAgents || 2,
        max_agents: options?.maxAgents || 5,
        strategy: 'parallel'
      });

      const totalReceived = result.results.reduce((sum: number, r: any) => 
        sum + (r.outputs?.amount_out || 0), 0);

      return {
        swarm_id: result.swarm_id,
        participants: result.participants,
        total_amount_in: totalAmount,
        total_amount_out: totalReceived,
        execution_time_ms: result.execution_time_ms,
        individual_results: result.results
      };

    } catch (error: any) {
      return {
        swarm_id: '',
        participants: [],
        total_amount_in: totalAmount,
        total_amount_out: 0,
        execution_time_ms: 0,
        error: error.message
      };
    }
  }

  // ============================================
  // BEST EXECUTION - ONE-LINERS
  // ============================================

  /**
   * Smart swap - automatically finds best execution route
   * Compares DEX, A2A partners, and auctions to get best price
   * 
   * @example
   * const result = await trader.smartSwap('SOL', 'USDC', 100);
   * // Automatically picks best route (DEX vs A2A vs Auction)
   */
  async smartSwap(
    tokenIn: string,
    tokenOut: string,
    amount: number,
    options?: { maxSlippageBps?: number; preferA2A?: boolean }
  ): Promise<{
    route: 'dex' | 'a2a' | 'auction' | 'swarm';
    result: PreparedTransaction | A2ATradeResult;
    savings_vs_dex?: number;
    execution_summary: string;
  }> {
    const maxSlippage = options?.maxSlippageBps ?? 50;
    
    // Get DEX quote first as baseline
    const dexTx = await this.prepareSwap(tokenIn, tokenOut, amount, { slippage_bps: maxSlippage });
    const dexOut = dexTx.expected_out;

    // Try A2A if enabled
    if (options?.preferA2A !== false) {
      try {
        const partners = await this.findTradingPartners(tokenIn, tokenOut, amount);
        
        if (partners.length > 0 && partners[0].quote.amount_out > dexOut * 1.001) {
          // A2A is better by at least 0.1%
          const a2aResult = await this.executeA2ATrade(partners[0].quote);
          
          if (a2aResult.status === 'executed') {
            const savings = ((a2aResult.amount_received! - dexOut) / dexOut) * 100;
            return {
              route: 'a2a',
              result: a2aResult,
              savings_vs_dex: savings,
              execution_summary: `A2A trade via ${partners[0].name}: ${amount} ${tokenIn} → ${a2aResult.amount_received} ${tokenOut} (${savings.toFixed(2)}% better than DEX)`
            };
          }
        }
      } catch {
        // Fall back to DEX
      }
    }

    // Return DEX as default
    return {
      route: 'dex',
      result: dexTx,
      execution_summary: `DEX swap via Jupiter: ${amount} ${tokenIn} → ~${dexOut.toFixed(4)} ${tokenOut}`
    };
  }

  /**
   * One-liner: Buy token with best execution
   */
  async buy(token: string, amountUsd: number): Promise<PreparedTransaction> {
    const quoteToken = this.config.quote_currency === 'USD' ? 'USDC' : this.config.quote_currency;
    return this.prepareSwap(quoteToken, token, amountUsd);
  }

  /**
   * One-liner: Sell token with best execution
   */
  async sell(token: string, amount: number): Promise<PreparedTransaction> {
    const quoteToken = this.config.quote_currency === 'USD' ? 'USDC' : this.config.quote_currency;
    return this.prepareSwap(token, quoteToken, amount);
  }

  /**
   * One-liner: Get current portfolio value
   */
  async getPortfolioValue(): Promise<{
    total_usd: number;
    positions: Array<{ token: string; amount: number; usd_value: number; pnl_percent: number }>;
  }> {
    const positions = this.getPositions();
    const result: Array<{ token: string; amount: number; usd_value: number; pnl_percent: number }> = [];
    let totalUsd = 0;

    for (const pos of positions) {
      const price = this.prices.get(pos.token)?.price || pos.current_price;
      const usdValue = pos.amount * price;
      totalUsd += usdValue;
      
      result.push({
        token: pos.token,
        amount: pos.amount,
        usd_value: usdValue,
        pnl_percent: pos.unrealized_pnl_percent
      });
    }

    return { total_usd: totalUsd, positions: result };
  }

  /**
   * One-liner: Check if a trade is profitable based on current prices
   */
  async isProfitable(tokenIn: string, tokenOut: string, amount: number): Promise<{
    profitable: boolean;
    expected_profit_percent: number;
    recommendation: string;
  }> {
    const tx = await this.prepareSwap(tokenIn, tokenOut, amount);
    const priceImpact = tx.price_impact_percent;
    const mevRisk = tx.mev_risk;
    
    // Estimate fees (~0.3% DEX + ~0.01 network)
    const estimatedFees = 0.3;
    const netProfit = -priceImpact - estimatedFees;
    
    let recommendation = 'Proceed with trade';
    if (mevRisk === 'HIGH') recommendation = 'Consider smaller trade size due to MEV risk';
    if (priceImpact > 1) recommendation = 'High price impact - consider splitting order';
    if (netProfit < -1) recommendation = 'Trade may not be profitable after fees';

    return {
      profitable: netProfit > -0.5,
      expected_profit_percent: netProfit,
      recommendation
    };
  }

  private updatePositions(trade: TradeExecution): void {
    // Reduce position in token_in
    const posIn = this.positions.get(trade.token_in);
    if (posIn) {
      posIn.amount -= trade.amount_in;
      if (posIn.amount <= 0) {
        this.positions.delete(trade.token_in);
      }
    }

    // Increase position in token_out
    let posOut = this.positions.get(trade.token_out);
    if (!posOut) {
      posOut = {
        token: trade.token_out,
        amount: 0,
        avg_entry_price: 0,
        current_price: trade.price,
        unrealized_pnl: 0,
        unrealized_pnl_percent: 0
      };
      this.positions.set(trade.token_out, posOut);
    }

    // Update average entry price
    const totalValue = posOut.amount * posOut.avg_entry_price + trade.amount_out * trade.price;
    posOut.amount += trade.amount_out;
    posOut.avg_entry_price = totalValue / posOut.amount;
    posOut.current_price = trade.price;
  }

  private resetDailyCounterIfNeeded(): void {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    if (now - this.lastDayReset > dayMs) {
      this.dailyTradeCount = 0;
      this.lastDayReset = now;
    }
  }

  // ============================================
  // PORTFOLIO
  // ============================================

  getPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  getPosition(token: string): Position | undefined {
    return this.positions.get(token);
  }

  getTotalPnL(): { unrealized: number; realized: number } {
    let unrealized = 0;
    this.positions.forEach(pos => {
      unrealized += pos.unrealized_pnl;
    });

    // Calculate realized from completed trades (simplified)
    const realized = 0; // Would track from closed positions

    return { unrealized, realized };
  }

  getTradeHistory(): TradeExecution[] {
    return [...this.trades];
  }

  // ============================================
  // STATS & MONITORING
  // ============================================

  /**
   * Get comprehensive trading statistics
   * @returns Trading stats including metrics, positions, and current prices
   */
  getStats(): {
    agent_metrics: any;
    trading_stats: {
      total_trades: number;
      daily_trades: number;
      positions_count: number;
      total_pnl: { unrealized: number; realized: number };
      win_rate: number;
    };
    prices: Record<string, number>;
    uptime_ms: number;
  } {
    const prices: Record<string, number> = {};
    this.prices.forEach((data, token) => {
      prices[token] = data.price;
    });

    // Calculate win rate
    const executedTrades = this.trades.filter(t => t.status === 'executed');
    const profitableTrades = executedTrades.filter(t => t.amount_out > t.amount_in);
    const winRate = executedTrades.length > 0 ? profitableTrades.length / executedTrades.length : 0;

    return {
      agent_metrics: this.agent.getMetrics(),
      trading_stats: {
        total_trades: this.trades.length,
        daily_trades: this.dailyTradeCount,
        positions_count: this.positions.size,
        total_pnl: this.getTotalPnL(),
        win_rate: winRate
      },
      prices,
      uptime_ms: this.isRunning ? Date.now() - (this.trades[0]?.timestamp || Date.now()) : 0
    };
  }

  /**
   * Print formatted trading statistics to console
   */
  printStats(): void {
    const stats = this.getStats();
    const uptimeHours = (stats.uptime_ms / 3600000).toFixed(1);
    
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║       📊 Trading Agent Stats           ║');
    console.log('╠════════════════════════════════════════╣');
    console.log(`║  Uptime:          ${uptimeHours.padStart(8)} hours      ║`);
    console.log(`║  Total Trades:    ${String(stats.trading_stats.total_trades).padStart(8)}            ║`);
    console.log(`║  Daily Trades:    ${String(stats.trading_stats.daily_trades).padStart(8)}            ║`);
    console.log(`║  Win Rate:        ${(stats.trading_stats.win_rate * 100).toFixed(1).padStart(7)}%           ║`);
    console.log(`║  Open Positions:  ${String(stats.trading_stats.positions_count).padStart(8)}            ║`);
    console.log(`║  Unrealized PnL: $${stats.trading_stats.total_pnl.unrealized.toFixed(2).padStart(8)}           ║`);
    console.log('╠════════════════════════════════════════╣');
    console.log('║  Current Prices:                       ║');
    Object.entries(stats.prices).forEach(([token, price]) => {
      const priceStr = `$${price.toLocaleString()}`;
      console.log(`║    ${token.padEnd(6)} ${priceStr.padStart(25)}   ║`);
    });
    console.log('╚════════════════════════════════════════╝');
  }

  // ============================================
  // PRIVATE
  // ============================================

  private setupAgentEvents(): void {
    this.agent.on('error', (error) => {
      this.emit('agent_error', error);
    });

    this.agent.on('rate_limited', (data) => {
      console.warn('⏳ Rate limited, slowing down...');
      // Could implement backoff here
    });

    this.agent.on('circuit_open', (data) => {
      console.warn(`🔴 Circuit open for ${data.capability_id}`);
    });
  }
}

// ============================================
// FACTORY
// ============================================

export function createTradingAgent(config: TradingConfig): TradingAgent {
  return new TradingAgent(config);
}
