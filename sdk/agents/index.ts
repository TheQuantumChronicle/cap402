/**
 * CAP-402 Agent Templates
 * 
 * Pre-built agents for common use cases.
 * 
 * Quick Start:
 *   import { quickTrader, quickMonitor } from './sdk/agents';
 *   
 *   // One-liner trading agent
 *   const trader = quickTrader(['SOL', 'ETH']);
 *   await trader.start();
 *   
 *   // One-liner monitoring agent  
 *   const monitor = quickMonitor(['wallet-address']);
 *   await monitor.start();
 */

export { TradingAgent, createTradingAgent } from './trading-agent';
export type { TradingConfig, PriceData, TradeSignal, TradeExecution, Position, PreparedTransaction, TransactionSummary, AlphaSignal, A2AQuote, A2ATradingPartner, A2ATradeResult, A2AAuctionResult, A2ASwarmResult, A2APrivacyLevel, SecureA2AMessage, A2AHandshake, A2AFaultConfig, CrossProtocolAgent } from './trading-agent';

export { MonitoringAgent, createMonitoringAgent } from './monitoring-agent';
export type { MonitoringConfig, WalletSnapshot, ProtocolHealth, Alert } from './monitoring-agent';

export { AnalyticsAgent, createAnalyticsAgent } from './analytics-agent';
export type { AnalyticsConfig, DataSource, DataPoint, AnalyticsReport, Insight } from './analytics-agent';

// ============================================
// QUICK FACTORIES - Zero Config
// ============================================

/**
 * Create a trading agent with minimal config
 * @example const trader = quickTrader(['SOL', 'ETH', 'BTC']);
 */
export function quickTrader(
  tokens: string[],
  options: { name?: string; dryRun?: boolean; mevProtection?: boolean } = {}
): import('./trading-agent').TradingAgent {
  const { createTradingAgent } = require('./trading-agent');
  
  return createTradingAgent({
    agent_id: `trader-${Date.now().toString(36)}`,
    name: options.name || 'Quick Trader',
    watched_tokens: tokens,
    dry_run: options.dryRun ?? true,  // Safe default
    mev_protection: options.mevProtection ?? true,
    trading_limits: {
      max_position_size: 1000,
      max_daily_trades: 20,
      max_slippage_percent: 0.5
    }
  });
}

/**
 * Ultra-simple trading agent - just pass tokens
 * Starts automatically and emits events
 * 
 * @example
 * const agent = await autoTrader(['SOL', 'ETH']);
 * agent.on('signal', console.log);
 * agent.on('alpha', console.log);
 */
export async function autoTrader(
  tokens: string[],
  options?: { onSignal?: (signal: any) => void; onAlpha?: (alpha: any) => void }
): Promise<import('./trading-agent').TradingAgent> {
  const trader = quickTrader(tokens);
  
  if (options?.onSignal) {
    trader.on('signal', options.onSignal);
  }
  if (options?.onAlpha) {
    trader.on('alpha', options.onAlpha);
  }
  
  await trader.start();
  return trader;
}

/**
 * One-liner to prepare a swap transaction
 * No agent setup required
 * 
 * @example
 * const tx = await prepareSwap('SOL', 'USDC', 10);
 * // tx.summary.headline = "Swap 10 SOL → ~1,433 USDC"
 */
export async function prepareSwap(
  tokenIn: string,
  tokenOut: string,
  amount: number,
  options?: { slippageBps?: number }
): Promise<import('./trading-agent').PreparedTransaction> {
  const trader = quickTrader([tokenIn, tokenOut]);
  return trader.prepareSwap(tokenIn, tokenOut, amount, {
    slippage_bps: options?.slippageBps ?? 50
  });
}

/**
 * One-liner to get best execution route
 * Compares DEX vs A2A automatically
 * 
 * @example
 * const result = await bestSwap('SOL', 'USDC', 100);
 * console.log(result.route); // 'dex' or 'a2a'
 */
export async function bestSwap(
  tokenIn: string,
  tokenOut: string,
  amount: number
): Promise<{
  route: 'dex' | 'a2a' | 'auction' | 'swarm';
  result: any;
  savings_vs_dex?: number;
  execution_summary: string;
}> {
  const trader = quickTrader([tokenIn, tokenOut]);
  return trader.smartSwap(tokenIn, tokenOut, amount);
}

/**
 * One-liner to detect alpha signals
 * 
 * @example
 * const signals = await findAlpha(['SOL', 'ETH', 'BTC']);
 * signals.forEach(s => console.log(s.token, s.direction));
 */
export async function findAlpha(
  tokens: string[]
): Promise<import('./trading-agent').AlphaSignal[]> {
  const trader = quickTrader(tokens);
  await trader.start();
  
  // Wait for price data
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  const signals = await trader.detectAlpha();
  await trader.stop();
  
  return signals;
}

/**
 * One-liner to find A2A trading partners
 * 
 * @example
 * const partners = await findPartners('SOL', 'USDC', 100);
 * console.log(`Best offer: ${partners[0]?.quote.amount_out}`);
 */
export async function findPartners(
  tokenIn: string,
  tokenOut: string,
  amount: number
): Promise<import('./trading-agent').A2ATradingPartner[]> {
  const trader = quickTrader([tokenIn, tokenOut]);
  return trader.findTradingPartners(tokenIn, tokenOut, amount);
}

/**
 * Create a monitoring agent with minimal config
 * @example const monitor = quickMonitor(['wallet-address']);
 */
export function quickMonitor(
  wallets: string[],
  options: { name?: string; intervalMs?: number } = {}
): import('./monitoring-agent').MonitoringAgent {
  const { createMonitoringAgent } = require('./monitoring-agent');
  
  return createMonitoringAgent({
    agent_id: `monitor-${Date.now().toString(36)}`,
    name: options.name || 'Quick Monitor',
    watched_wallets: wallets,
    watched_protocols: [],
    check_interval_ms: options.intervalMs ?? 60000,
    alert_channels: [{ type: 'console', enabled: true }]
  });
}

/**
 * Create an analytics agent with minimal config
 * @example const analytics = quickAnalytics(['SOL', 'ETH']);
 */
export function quickAnalytics(
  tokens: string[],
  options: { name?: string; intervalMs?: number } = {}
): import('./analytics-agent').AnalyticsAgent {
  const { createAnalyticsAgent } = require('./analytics-agent');
  
  return createAnalyticsAgent({
    agent_id: `analytics-${Date.now().toString(36)}`,
    name: options.name || 'Quick Analytics',
    data_sources: tokens.map(token => ({
      id: `${token.toLowerCase()}-price`,
      type: 'price' as const,
      capability_id: 'cap.price.lookup.v1',
      inputs: { base_token: token },
      interval_ms: options.intervalMs ?? 60000,
      enabled: true
    })),
    report_interval_ms: 300000
  });
}
