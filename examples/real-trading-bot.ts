#!/usr/bin/env npx ts-node
/**
 * Real Trading Bot Example
 * 
 * A production trading bot that uses REAL data from CAP-402.
 * Monitors prices, generates signals, and can execute actual trades.
 * 
 * Usage:
 *   npx ts-node examples/real-trading-bot.ts
 * 
 * Environment:
 *   CAP402_ROUTER - Router URL (default: https://cap402.com)
 *   DRY_RUN - Set to 'false' to enable real trades (default: true)
 */

import { createTradingAgent, TradingAgent } from '../sdk/agents/trading-agent';

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  agent_id: process.env.AGENT_ID || `trading-bot-${Date.now()}`,
  name: 'Real Trading Bot',
  router_url: process.env.CAP402_ROUTER || 'https://cap402.com',
  
  // Tokens to monitor
  watched_tokens: ['SOL', 'ETH', 'BTC', 'BONK', 'JUP', 'PYTH'],
  quote_currency: 'USD',
  
  // Check prices every 30 seconds
  price_check_interval_ms: 30000,
  
  // Alert thresholds
  alert_thresholds: {
    price_change_percent: 3,    // Alert on 3%+ moves
    volume_spike_multiplier: 2  // Alert on 2x volume
  },
  
  // Trading limits
  trading_limits: {
    max_position_size: 1000,    // Max $1000 per position
    max_daily_trades: 20,       // Max 20 trades per day
    max_slippage_percent: 0.5   // Max 0.5% slippage
  },
  
  // Safety settings
  mev_protection: true,
  dry_run: process.env.DRY_RUN !== 'false'  // Default to dry run
};

// ============================================
// TRADING BOT
// ============================================

class RealTradingBot {
  private agent: TradingAgent;
  private isRunning = false;

  constructor() {
    this.agent = createTradingAgent(CONFIG);
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Price alerts
    this.agent.on('price_alert', (alert) => {
      const emoji = alert.direction === 'up' ? '📈' : '📉';
      console.log(`\n${emoji} PRICE ALERT: ${alert.token}`);
      console.log(`   ${alert.old_price.toFixed(4)} → ${alert.new_price.toFixed(4)}`);
      console.log(`   Change: ${alert.change_percent.toFixed(2)}%`);
    });

    // Trade signals
    this.agent.on('signal', (signal) => {
      const emoji = signal.type === 'buy' ? '🟢' : signal.type === 'sell' ? '🔴' : '⚪';
      console.log(`\n${emoji} SIGNAL: ${signal.type.toUpperCase()} ${signal.token}`);
      console.log(`   Confidence: ${(signal.confidence * 100).toFixed(0)}%`);
      console.log(`   Reason: ${signal.reason}`);
      
      if (signal.price_target) {
        console.log(`   Target: $${signal.price_target.toFixed(4)}`);
      }
      if (signal.stop_loss) {
        console.log(`   Stop Loss: $${signal.stop_loss.toFixed(4)}`);
      }
    });

    // Trade executions
    this.agent.on('trade_executed', (trade) => {
      console.log(`\n✅ TRADE EXECUTED`);
      console.log(`   ${trade.amount_in} ${trade.token_in} → ${trade.amount_out.toFixed(4)} ${trade.token_out}`);
      console.log(`   Price: ${trade.price.toFixed(6)}`);
      console.log(`   Slippage: ${trade.slippage.toFixed(2)}%`);
      console.log(`   MEV Protected: ${trade.mev_protected ? 'Yes' : 'No'}`);
      if (trade.tx_hash) {
        console.log(`   TX: ${trade.tx_hash}`);
      }
    });

    // MEV warnings
    this.agent.on('mev_warning', (warning) => {
      console.log(`\n⚠️  MEV WARNING for trade ${warning.trade_id}`);
      console.log(`   Risk Level: ${warning.risk.risk_level}`);
      console.log(`   Sandwich Probability: ${(warning.risk.sandwich_probability * 100).toFixed(0)}%`);
    });

    // Prices updated
    this.agent.on('prices_updated', (prices) => {
      // Silent update - uncomment for debugging
      // console.log('Prices updated:', Object.keys(prices).length, 'tokens');
    });

    // Errors
    this.agent.on('agent_error', (error) => {
      console.error('\n❌ Agent Error:', error);
    });
  }

  async start(): Promise<void> {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('           CAP-402 Real Trading Bot');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`\n🤖 Agent: ${CONFIG.agent_id}`);
    console.log(`📡 Router: ${CONFIG.router_url}`);
    console.log(`💰 Tokens: ${CONFIG.watched_tokens.join(', ')}`);
    console.log(`🔒 Dry Run: ${CONFIG.dry_run ? 'YES (no real trades)' : 'NO (REAL TRADES!)'}`);
    console.log(`🛡️  MEV Protection: ${CONFIG.mev_protection ? 'ON' : 'OFF'}`);
    console.log('\nPress Ctrl+C to stop\n');

    this.isRunning = true;
    await this.agent.start();

    // Print initial prices
    this.printPrices();

    // Periodic status updates
    setInterval(() => {
      if (this.isRunning) {
        this.printStatus();
      }
    }, 60000); // Every minute
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    await this.agent.stop();
    
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('           Final Summary');
    console.log('═══════════════════════════════════════════════════════════');
    this.printFinalStats();
  }

  private printPrices(): void {
    console.log('\n📊 Current Prices:');
    const prices = this.agent.getPrices();
    prices.forEach((data, token) => {
      const change = data.change_24h !== undefined ? ` (${data.change_24h >= 0 ? '+' : ''}${data.change_24h.toFixed(2)}%)` : '';
      console.log(`   ${token}: $${data.price.toLocaleString()}${change}`);
    });
  }

  private printStatus(): void {
    const stats = this.agent.getStats();
    const positions = this.agent.getPositions();
    
    console.log('\n─────────────────────────────────────────');
    console.log('📈 Status Update');
    console.log('─────────────────────────────────────────');
    
    // Prices
    console.log('Prices:');
    Object.entries(stats.prices).forEach(([token, price]) => {
      console.log(`  ${token}: $${price.toLocaleString()}`);
    });
    
    // Positions
    if (positions.length > 0) {
      console.log('\nPositions:');
      for (const pos of positions) {
        const pnlSign = pos.unrealized_pnl >= 0 ? '+' : '';
        console.log(`  ${pos.token}: ${pos.amount.toFixed(4)} @ $${pos.avg_entry_price.toFixed(4)}`);
        console.log(`    PnL: ${pnlSign}$${pos.unrealized_pnl.toFixed(2)} (${pnlSign}${pos.unrealized_pnl_percent.toFixed(2)}%)`);
      }
    }
    
    // Trading stats
    console.log(`\nTrades: ${stats.trading_stats.daily_trades} today, ${stats.trading_stats.total_trades} total`);
    console.log(`PnL: $${stats.trading_stats.total_pnl.unrealized.toFixed(2)} unrealized`);
  }

  private printFinalStats(): void {
    const stats = this.agent.getStats();
    const trades = this.agent.getTradeHistory();
    
    console.log(`\nTotal Trades: ${trades.length}`);
    console.log(`Successful: ${trades.filter(t => t.status === 'executed').length}`);
    console.log(`Failed: ${trades.filter(t => t.status === 'failed').length}`);
    
    const pnl = stats.trading_stats.total_pnl;
    console.log(`\nUnrealized PnL: $${pnl.unrealized.toFixed(2)}`);
    console.log(`Realized PnL: $${pnl.realized.toFixed(2)}`);
    
    console.log(`\nAgent Metrics:`);
    console.log(`  Invocations: ${stats.agent_metrics.invocations}`);
    console.log(`  Success Rate: ${(stats.agent_metrics.success_rate * 100).toFixed(1)}%`);
    console.log(`  Avg Latency: ${stats.agent_metrics.avg_latency_ms}ms`);
  }

  // Manual trade execution (for testing)
  async executeTrade(tokenIn: string, tokenOut: string, amount: number): Promise<void> {
    console.log(`\n🔄 Executing trade: ${amount} ${tokenIn} → ${tokenOut}`);
    
    try {
      const trade = await this.agent.executeTrade(tokenIn, tokenOut, amount);
      console.log(`Trade ${trade.status}: ${trade.trade_id}`);
    } catch (error) {
      console.error('Trade failed:', error);
    }
  }
}

// ============================================
// SIGNAL HANDLERS
// ============================================

let bot: RealTradingBot;

async function shutdown(signal: string): Promise<void> {
  console.log(`\n\n📥 Received ${signal}, shutting down...`);
  if (bot) {
    await bot.stop();
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ============================================
// MAIN
// ============================================

async function main(): Promise<void> {
  bot = new RealTradingBot();
  
  try {
    await bot.start();
    
    // Keep running
    await new Promise(() => {});
  } catch (error) {
    console.error('Fatal error:', error);
    await bot.stop();
    process.exit(1);
  }
}

main();
