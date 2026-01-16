/**
 * Trading Agent Template
 * 
 * A production-ready trading agent that monitors prices, executes trades,
 * and manages portfolio positions using CAP-402 capabilities.
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
  status: 'pending' | 'executed' | 'failed';
  tx_hash?: string;
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

  getStats(): {
    agent_metrics: any;
    trading_stats: {
      total_trades: number;
      daily_trades: number;
      positions_count: number;
      total_pnl: { unrealized: number; realized: number };
    };
    prices: Record<string, number>;
  } {
    const prices: Record<string, number> = {};
    this.prices.forEach((data, token) => {
      prices[token] = data.price;
    });

    return {
      agent_metrics: this.agent.getMetrics(),
      trading_stats: {
        total_trades: this.trades.length,
        daily_trades: this.dailyTradeCount,
        positions_count: this.positions.size,
        total_pnl: this.getTotalPnL()
      },
      prices
    };
  }

  printStats(): void {
    const stats = this.getStats();
    console.log('\n📊 Trading Agent Stats:');
    console.log(`   Total Trades: ${stats.trading_stats.total_trades}`);
    console.log(`   Daily Trades: ${stats.trading_stats.daily_trades}`);
    console.log(`   Open Positions: ${stats.trading_stats.positions_count}`);
    console.log(`   Unrealized PnL: $${stats.trading_stats.total_pnl.unrealized.toFixed(2)}`);
    console.log('\n   Current Prices:');
    Object.entries(stats.prices).forEach(([token, price]) => {
      console.log(`   • ${token}: $${price.toLocaleString()}`);
    });
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
