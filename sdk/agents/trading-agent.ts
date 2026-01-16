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
import {
  DEFAULT_ROUTER_URL,
  DEFAULT_SLIPPAGE_BPS,
  DEFAULT_MAX_POSITION_SIZE,
  DEFAULT_MAX_DAILY_TRADES,
  DEFAULT_MAX_SLIPPAGE_PERCENT,
  DEFAULT_PRICE_CHECK_INTERVAL_MS,
  DEFAULT_QUOTE_EXPIRY_MS,
  DEFAULT_CONFIRMATION_EXPIRY_MS,
  RATE_LIMITS,
  LARGE_TRADE_THRESHOLD_USD
} from '../constants';

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
  
  // Stealth Mode - automatic privacy escalation
  stealth_mode?: {
    enabled: boolean;
    // Auto-escalate privacy when trade > threshold USD
    auto_privacy_threshold_usd?: number;
    // Always use maximum privacy (Arcium MPC)
    always_confidential?: boolean;
    // Split large trades to avoid detection
    auto_split_threshold_usd?: number;
    // Randomize timing to avoid pattern detection
    randomize_timing?: boolean;
    // Use decoy transactions
    decoy_transactions?: boolean;
  };
  
  // ⚡ Instant Execution Mode - minimize latency
  instant_mode?: {
    enabled: boolean;
    // Pre-warm connections on startup
    pre_warm_connections?: boolean;
    // Cache routes for common pairs
    cache_routes?: boolean;
    // Use parallel quote fetching
    parallel_quotes?: boolean;
    // Skip MEV analysis for small trades (faster)
    skip_mev_under_usd?: number;
    // Max acceptable latency in ms (will warn if exceeded)
    max_latency_ms?: number;
    // Use websocket for real-time updates
    use_websocket?: boolean;
  };
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
  // Trade journal fields
  notes?: string;
  tags?: string[];
  strategy?: string;
  entry_reason?: string;
  exit_reason?: string;
}

/**
 * Conditional order (stop-loss or take-profit)
 */
export interface ConditionalOrder {
  order_id: string;
  type: 'stop_loss' | 'take_profit' | 'trailing_stop';
  token: string;
  trigger_price: number;
  amount: number;
  target_token: string;
  status: 'active' | 'triggered' | 'cancelled' | 'expired';
  created_at: number;
  expires_at?: number;
  trailing_percent?: number;
  highest_price?: number;
}

/**
 * Limit order - buy/sell at specific price
 */
export interface LimitOrder {
  order_id: string;
  side: 'buy' | 'sell';
  token: string;
  target_token: string;
  amount: number;
  limit_price: number;
  status: 'open' | 'filled' | 'cancelled' | 'expired';
  created_at: number;
  expires_at?: number;
  filled_at?: number;
  filled_price?: number;
  filled_amount?: number;
}

/**
 * Custom price alert
 */
export interface PriceAlert {
  alert_id: string;
  token: string;
  condition: 'above' | 'below' | 'crosses';
  target_price: number;
  status: 'active' | 'triggered' | 'cancelled';
  created_at: number;
  triggered_at?: number;
  triggered_price?: number;
  message?: string;
  webhook_url?: string;
}

/**
 * DCA (Dollar Cost Averaging) schedule
 */
export interface DCASchedule {
  schedule_id: string;
  token_to_buy: string;
  token_to_spend: string;
  amount_per_interval: number;
  interval_ms: number;
  total_intervals?: number;
  intervals_completed: number;
  total_spent: number;
  total_acquired: number;
  avg_price: number;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  created_at: number;
  next_execution: number;
  last_execution?: number;
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
 * Stealth trade result with privacy metrics
 */
export interface StealthTradeResult {
  stealth_id: string;
  status: 'pending' | 'completed' | 'failed';
  privacy_level: string;
  total_amount: number;
  chunks: StealthChunkResult[];
  total_output: number;
  avg_price: number;
  mev_savings_usd: number;
  privacy_cost_usd: number;
  execution_time_ms: number;
  stealth_features_used: string[];
  error?: string;
}

/**
 * Individual chunk result in a split stealth trade
 */
export interface StealthChunkResult {
  chunk_id: string;
  chunk_number: number;
  total_chunks: number;
  amount_in: number;
  amount_out: number;
  price: number;
  privacy_level: string;
  mev_savings_usd: number;
  privacy_cost_usd: number;
  status: 'completed' | 'failed';
  proof?: string;
  error?: string;
}

/**
 * Stealth trade analysis with privacy options
 */
/**
 * Instant swap result with latency metrics
 */
export interface InstantSwapResult {
  swap_id: string;
  status: 'pending' | 'executed' | 'failed';
  token_in: string;
  token_out: string;
  amount_in: number;
  amount_out: number;
  execution_price: number;
  latency_ms: number;
  optimizations_used: string[];
  mev_skipped: boolean;
  tx_signature?: string;
  latency_warning?: boolean;
  error?: string;
}

export interface StealthAnalysis {
  trade: {
    token_in: string;
    token_out: string;
    amount: number;
    usd_value: number;
  };
  mev_risk: {
    risk: 'LOW' | 'MEDIUM' | 'HIGH';
    potential_loss_usd: string;
    recommendations: string[];
  };
  options: Array<{
    level: string;
    method: string;
    protection_percent: number;
    estimated_cost_usd: number;
    estimated_savings_usd: number;
    net_benefit_usd: number;
    features: string[];
  }>;
  recommendation: string;
  split_recommended: boolean;
  recommended_chunks: number;
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

/**
 * Privacy level for A2A communications
 */
export type A2APrivacyLevel = 'public' | 'confidential' | 'private' | 'maximum';

/**
 * Encrypted A2A message for confidential communication
 */
export interface SecureA2AMessage {
  message_id: string;
  from_agent: string;
  to_agent: string;
  privacy_level: A2APrivacyLevel;
  
  // Encrypted payload (base64)
  encrypted_payload?: string;
  // Plaintext payload (only for public messages)
  payload?: any;
  
  // Cryptographic proofs
  signature?: string;
  nonce?: string;
  
  // Verification
  verified: boolean;
  verification_method?: 'signature' | 'zk_proof' | 'mpc';
  
  timestamp: number;
  expires_at?: number;
}

/**
 * A2A handshake for establishing secure channel
 */
export interface A2AHandshake {
  session_id: string;
  initiator: string;
  responder: string;
  status: 'pending' | 'established' | 'rejected' | 'expired';
  privacy_level: A2APrivacyLevel;
  
  // Key exchange
  public_key?: string;
  shared_secret_hash?: string;
  
  // Session info
  established_at?: number;
  expires_at?: number;
  
  // Capabilities agreed upon
  agreed_capabilities?: string[];
}

/**
 * Fault tolerance configuration for A2A operations
 */
export interface A2AFaultConfig {
  max_retries: number;
  retry_delay_ms: number;
  timeout_ms: number;
  fallback_agents?: string[];
  circuit_breaker_threshold?: number;
}

/**
 * Cross-protocol agent descriptor for interoperability
 */
export interface CrossProtocolAgent {
  agent_id: string;
  protocol: 'cap402' | 'a2a_google' | 'mcp' | 'custom';
  endpoint: string;
  capabilities: string[];
  adapter?: string;
  trust_score?: number;
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
  private conditionalOrders: Map<string, ConditionalOrder> = new Map();
  private dcaSchedules: Map<string, DCASchedule> = new Map();
  private dcaTimers: Map<string, NodeJS.Timeout> = new Map();
  private limitOrders: Map<string, LimitOrder> = new Map();
  private priceAlerts: Map<string, PriceAlert> = new Map();
  private dailyTradeCount = 0;
  private lastDayReset = Date.now();
  private priceCheckTimer?: NodeJS.Timeout;
  private orderCheckTimer?: NodeJS.Timeout;
  private isRunning = false;

  constructor(config: TradingConfig) {
    super();

    // Validate required config
    this.validateConfig(config);

    this.config = {
      quote_currency: 'USD',
      price_check_interval_ms: DEFAULT_PRICE_CHECK_INTERVAL_MS,
      alert_thresholds: {
        price_change_percent: 5,
        volume_spike_multiplier: 3,
        ...config.alert_thresholds
      },
      trading_limits: {
        max_position_size: DEFAULT_MAX_POSITION_SIZE,
        max_daily_trades: DEFAULT_MAX_DAILY_TRADES,
        max_slippage_percent: DEFAULT_MAX_SLIPPAGE_PERCENT,
        ...config.trading_limits
      },
      mev_protection: true,
      dry_run: true,
      router_url: DEFAULT_ROUTER_URL,
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
  // VALIDATION & SECURITY
  // ============================================

  private validateConfig(config: TradingConfig): void {
    if (!config.agent_id || typeof config.agent_id !== 'string') {
      throw new Error('Invalid config: agent_id is required and must be a string');
    }
    if (!config.name || typeof config.name !== 'string') {
      throw new Error('Invalid config: name is required and must be a string');
    }
    if (!config.watched_tokens || !Array.isArray(config.watched_tokens) || config.watched_tokens.length === 0) {
      throw new Error('Invalid config: watched_tokens must be a non-empty array');
    }
    // Sanitize agent_id
    if (!/^[a-zA-Z0-9_-]+$/.test(config.agent_id)) {
      throw new Error('Invalid config: agent_id can only contain alphanumeric characters, underscores, and hyphens');
    }
    // Validate token symbols
    for (const token of config.watched_tokens) {
      if (typeof token !== 'string' || token.length === 0 || token.length > 20) {
        throw new Error(`Invalid token symbol: ${token}`);
      }
    }
  }

  private validateToken(token: string): void {
    if (!token || typeof token !== 'string') {
      throw new Error('Token symbol is required');
    }
    if (token.length === 0 || token.length > 20) {
      throw new Error(`Invalid token symbol length: ${token}`);
    }
    if (!/^[a-zA-Z0-9]+$/.test(token)) {
      throw new Error(`Invalid token symbol format: ${token}`);
    }
  }

  private validateAmount(amount: number, label: string = 'Amount'): void {
    if (typeof amount !== 'number' || isNaN(amount)) {
      throw new Error(`${label} must be a valid number`);
    }
    if (amount <= 0) {
      throw new Error(`${label} must be greater than 0`);
    }
    if (amount > 1e15) {
      throw new Error(`${label} exceeds maximum allowed value`);
    }
    if (!Number.isFinite(amount)) {
      throw new Error(`${label} must be a finite number`);
    }
  }

  /**
   * Validate price to prevent manipulation attacks
   */
  private validatePrice(price: number, token: string): void {
    if (typeof price !== 'number' || isNaN(price) || !Number.isFinite(price)) {
      throw new Error(`Invalid price for ${token}`);
    }
    if (price <= 0) {
      throw new Error(`Price for ${token} must be positive`);
    }
    if (price > 1e12) {
      throw new Error(`Price for ${token} exceeds reasonable bounds`);
    }
  }

  /**
   * Check for suspicious price movements (potential manipulation)
   */
  private checkPriceManipulation(token: string, newPrice: number): boolean {
    const oldPrice = this.prices.get(token)?.price;
    if (!oldPrice) return false;

    const changePercent = Math.abs((newPrice - oldPrice) / oldPrice) * 100;
    
    // Alert on >20% price change in single update (potential manipulation)
    if (changePercent > 20) {
      console.warn(`⚠️ SUSPICIOUS: ${token} price changed ${changePercent.toFixed(1)}% in single update`);
      this.emit('price_manipulation_warning', { token, oldPrice, newPrice, changePercent });
      return true;
    }
    return false;
  }

  /**
   * Validate slippage to prevent sandwich attacks
   */
  private validateSlippage(slippageBps: number): void {
    if (slippageBps < 1) {
      throw new Error('Slippage too low - trade may fail');
    }
    if (slippageBps > 1000) {
      throw new Error('Slippage too high (>10%) - vulnerable to sandwich attacks');
    }
  }

  private validateAgentId(agentId: string): void {
    if (!agentId || typeof agentId !== 'string') {
      throw new Error('Agent ID is required');
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(agentId)) {
      throw new Error('Invalid agent ID format');
    }
  }

  /**
   * Rate limiting for operations
   */
  private operationCounts: Map<string, { count: number; resetAt: number }> = new Map();

  private checkRateLimit(operation: string): void {
    const limit = RATE_LIMITS[operation as keyof typeof RATE_LIMITS];
    if (!limit) return;

    const now = Date.now();
    let opData = this.operationCounts.get(operation);

    if (!opData || now >= opData.resetAt) {
      opData = { count: 0, resetAt: now + limit.windowMs };
      this.operationCounts.set(operation, opData);
    }

    if (opData.count >= limit.max) {
      const waitMs = opData.resetAt - now;
      throw new Error(`Rate limit exceeded for ${operation}. Try again in ${Math.ceil(waitMs / 1000)}s`);
    }

    opData.count++;
  }

  /**
   * Spending confirmation for large trades
   */
  private pendingConfirmations: Map<string, { amount: number; token: string; expiresAt: number }> = new Map();

  /**
   * Check if trade requires confirmation
   */
  requiresConfirmation(tokenIn: string, amount: number): boolean {
    const price = this.prices.get(tokenIn);
    if (!price) return amount > 100; // Default threshold if no price
    const usdValue = amount * price.price;
    return usdValue >= LARGE_TRADE_THRESHOLD_USD;
  }

  /**
   * Request confirmation for large trade
   */
  requestTradeConfirmation(tokenIn: string, tokenOut: string, amount: number): string {
    const confirmationId = `confirm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.pendingConfirmations.set(confirmationId, {
      amount,
      token: tokenIn,
      expiresAt: Date.now() + DEFAULT_CONFIRMATION_EXPIRY_MS
    });

    const price = this.prices.get(tokenIn);
    const usdValue = price ? amount * price.price : 0;

    this.emit('confirmation_required', {
      confirmation_id: confirmationId,
      token_in: tokenIn,
      token_out: tokenOut,
      amount,
      usd_value: usdValue,
      message: `Large trade detected: ${amount} ${tokenIn} (~$${usdValue.toFixed(2)}). Confirm to proceed.`,
      expires_at: Date.now() + DEFAULT_CONFIRMATION_EXPIRY_MS
    });

    return confirmationId;
  }

  /**
   * Confirm a pending trade
   */
  confirmTrade(confirmationId: string): boolean {
    const pending = this.pendingConfirmations.get(confirmationId);
    if (!pending) return false;
    if (Date.now() > pending.expiresAt) {
      this.pendingConfirmations.delete(confirmationId);
      return false;
    }
    this.pendingConfirmations.delete(confirmationId);
    return true;
  }

  /**
   * Retry wrapper for operations with exponential backoff
   */
  async withRetry<T>(
    operation: () => Promise<T>,
    options?: {
      maxRetries?: number;
      initialDelayMs?: number;
      maxDelayMs?: number;
      retryOn?: (error: any) => boolean;
    }
  ): Promise<T> {
    const maxRetries = options?.maxRetries ?? 3;
    const initialDelay = options?.initialDelayMs ?? 1000;
    const maxDelay = options?.maxDelayMs ?? 30000;
    const shouldRetry = options?.retryOn ?? ((error: any) => {
      const msg = error?.message || '';
      return msg.includes('timeout') || 
             msg.includes('ECONNREFUSED') || 
             msg.includes('503') ||
             msg.includes('502') ||
             msg.includes('rate limit');
    });

    let lastError: any;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        if (attempt === maxRetries || !shouldRetry(error)) {
          throw error;
        }

        const delay = Math.min(initialDelay * Math.pow(2, attempt), maxDelay);
        this.emit('retry', { attempt: attempt + 1, maxRetries, delay, error });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  /**
   * Safe wrapper that catches errors and returns result object
   */
  async safe<T>(
    operation: () => Promise<T>
  ): Promise<{ success: true; data: T } | { success: false; error: string }> {
    try {
      const data = await operation();
      return { success: true, data };
    } catch (error: any) {
      return { success: false, error: error.message || 'Unknown error' };
    }
  }

  /**
   * Execute operation with timeout
   */
  async withTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      operation(),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
      )
    ]);
  }

  /**
   * Batch multiple operations with concurrency limit
   */
  async batch<T, R>(
    items: T[],
    operation: (item: T) => Promise<R>,
    options?: { concurrency?: number; stopOnError?: boolean }
  ): Promise<{ results: R[]; errors: Array<{ item: T; error: string }> }> {
    const concurrency = options?.concurrency ?? 5;
    const stopOnError = options?.stopOnError ?? false;
    const results: R[] = [];
    const errors: Array<{ item: T; error: string }> = [];

    for (let i = 0; i < items.length; i += concurrency) {
      const batch = items.slice(i, i + concurrency);
      const promises = batch.map(async (item) => {
        try {
          const result = await operation(item);
          results.push(result);
        } catch (error: any) {
          errors.push({ item, error: error.message });
          if (stopOnError) throw error;
        }
      });

      await Promise.all(promises);
    }

    return { results, errors };
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

    // Clear all timers to prevent memory leaks
    if (this.priceCheckTimer) {
      clearInterval(this.priceCheckTimer);
      this.priceCheckTimer = undefined;
    }

    if (this.orderCheckTimer) {
      clearInterval(this.orderCheckTimer);
      this.orderCheckTimer = undefined;
    }

    // Stop background refresh
    this.stopBackgroundRefresh();

    // Stop all DCA timers
    for (const [scheduleId, timer] of this.dcaTimers) {
      clearInterval(timer);
    }
    this.dcaTimers.clear();

    // Cancel all active DCA schedules
    for (const schedule of this.dcaSchedules.values()) {
      if (schedule.status === 'active') {
        schedule.status = 'cancelled';
      }
    }

    // Clear caches to free memory
    this.routeCache.clear();
    this.priceCache.clear();
    this.connectionPool.clear();

    // Remove all event listeners to prevent memory leaks
    this.removeAllListeners();

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
    // Validate inputs
    this.validateToken(tokenIn);
    this.validateToken(tokenOut);
    this.validateAmount(amountIn);
    this.checkRateLimit('executeTrade');

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
    // Validate inputs
    this.validateToken(tokenIn);
    this.validateToken(tokenOut);
    this.validateAmount(amount);
    this.checkRateLimit('prepareSwap');

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
  // 🥷 STEALTH TRADING MODE
  // ============================================

  /**
   * Execute a stealth trade with automatic privacy escalation
   * 
   * Stealth mode features:
   * - Auto-escalates to confidential execution for large trades
   * - Splits large orders to avoid detection
   * - Randomizes timing to prevent pattern analysis
   * - Uses ZK proofs to hide trade intent
   * - Routes through Arcium MPC for maximum privacy
   * 
   * @example
   * const result = await agent.stealthTrade('SOL', 'USDC', 1000, {
   *   privacy_level: 'maximum',
   *   split_order: true
   * });
   */
  async stealthTrade(
    tokenIn: string,
    tokenOut: string,
    amount: number,
    options?: {
      privacy_level?: 'standard' | 'enhanced' | 'maximum';
      split_order?: boolean;
      max_chunks?: number;
      delay_between_chunks_ms?: number;
      use_decoys?: boolean;
    }
  ): Promise<StealthTradeResult> {
    // Validate inputs
    this.validateToken(tokenIn);
    this.validateToken(tokenOut);
    this.validateAmount(amount);
    this.checkRateLimit('stealthTrade');

    const stealthConfig = this.config.stealth_mode;
    const privacyLevel = options?.privacy_level || 
      (stealthConfig?.always_confidential ? 'maximum' : 'standard');
    
    // Get current price to calculate USD value
    const priceIn = this.prices.get(tokenIn);
    const usdValue = priceIn ? amount * priceIn.price : amount * 100;
    
    // Determine if we need to split the order
    const splitThreshold = stealthConfig?.auto_split_threshold_usd || 50000;
    const shouldSplit = options?.split_order || 
      (usdValue > splitThreshold && stealthConfig?.enabled);
    
    // Determine privacy escalation
    const privacyThreshold = stealthConfig?.auto_privacy_threshold_usd || 10000;
    const escalatedPrivacy = usdValue > privacyThreshold ? 'maximum' : privacyLevel;
    
    const result: StealthTradeResult = {
      stealth_id: `stealth_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      status: 'pending',
      privacy_level: escalatedPrivacy,
      total_amount: amount,
      chunks: [],
      total_output: 0,
      avg_price: 0,
      mev_savings_usd: 0,
      privacy_cost_usd: 0,
      execution_time_ms: 0,
      stealth_features_used: []
    };

    const startTime = Date.now();

    try {
      if (shouldSplit) {
        // Split into chunks for stealth execution
        const maxChunks = options?.max_chunks || 5;
        const chunkSize = amount / maxChunks;
        const delayMs = options?.delay_between_chunks_ms || 
          (stealthConfig?.randomize_timing ? 2000 + Math.random() * 3000 : 1000);
        
        result.stealth_features_used.push('order_splitting');
        
        for (let i = 0; i < maxChunks; i++) {
          // Add random delay between chunks if stealth mode enabled
          if (i > 0 && stealthConfig?.randomize_timing) {
            const randomDelay = delayMs + Math.random() * 1000;
            await new Promise(resolve => setTimeout(resolve, randomDelay));
            result.stealth_features_used.push('randomized_timing');
          }
          
          const chunkResult = await this.executeStealthChunk(
            tokenIn, tokenOut, chunkSize, escalatedPrivacy, i + 1, maxChunks
          );
          
          result.chunks.push(chunkResult);
          result.total_output += chunkResult.amount_out;
          result.mev_savings_usd += chunkResult.mev_savings_usd;
          result.privacy_cost_usd += chunkResult.privacy_cost_usd;
        }
        
        result.avg_price = result.total_output / amount;
      } else {
        // Single stealth execution
        const chunkResult = await this.executeStealthChunk(
          tokenIn, tokenOut, amount, escalatedPrivacy, 1, 1
        );
        
        result.chunks.push(chunkResult);
        result.total_output = chunkResult.amount_out;
        result.avg_price = chunkResult.price;
        result.mev_savings_usd = chunkResult.mev_savings_usd;
        result.privacy_cost_usd = chunkResult.privacy_cost_usd;
      }

      // Add decoy transactions if enabled
      if (options?.use_decoys || stealthConfig?.decoy_transactions) {
        result.stealth_features_used.push('decoy_transactions');
        // Decoys would be small opposite-direction trades to confuse pattern analysis
      }

      result.status = 'completed';
      result.execution_time_ms = Date.now() - startTime;

      // Add privacy features used
      if (escalatedPrivacy === 'maximum') {
        result.stealth_features_used.push('arcium_mpc', 'encrypted_amounts', 'hidden_route');
      } else if (escalatedPrivacy === 'enhanced') {
        result.stealth_features_used.push('jito_bundle', 'private_mempool');
      }

      this.emit('stealth_trade_completed', result);
      
      console.log(`\n🥷 Stealth Trade Completed:`);
      console.log(`   ${amount} ${tokenIn} → ${result.total_output.toFixed(4)} ${tokenOut}`);
      console.log(`   Privacy: ${escalatedPrivacy.toUpperCase()}`);
      console.log(`   MEV Savings: $${result.mev_savings_usd.toFixed(2)}`);
      console.log(`   Features: ${result.stealth_features_used.join(', ')}\n`);

    } catch (error) {
      result.status = 'failed';
      result.error = error instanceof Error ? error.message : 'Stealth trade failed';
      this.emit('stealth_trade_failed', result);
    }

    return result;
  }

  private async executeStealthChunk(
    tokenIn: string,
    tokenOut: string,
    amount: number,
    privacyLevel: string,
    chunkNum: number,
    totalChunks: number
  ): Promise<StealthChunkResult> {
    const chunkId = `chunk_${chunkNum}_${Date.now()}`;
    
    try {
      const axios = (await import('axios')).default;
      
      // Use the appropriate endpoint based on privacy level
      let endpoint = '/mev/protected-swap';
      let protectionLevel = 'standard';
      
      if (privacyLevel === 'maximum') {
        endpoint = '/alpha/private-trade';
        protectionLevel = 'maximum';
      } else if (privacyLevel === 'enhanced') {
        protectionLevel = 'enhanced';
      }

      const response = await axios.post(`${this.config.router_url}${endpoint}`, {
        token_in: tokenIn,
        token_out: tokenOut,
        amount,
        wallet_address: this.config.agent_id,
        protection_level: protectionLevel,
        max_slippage: this.config.trading_limits?.max_slippage_percent || 0.5
      }, { timeout: 30000 });

      const data = response.data;
      
      return {
        chunk_id: chunkId,
        chunk_number: chunkNum,
        total_chunks: totalChunks,
        amount_in: amount,
        amount_out: data.swap_result?.amount_out || data.result?.outputs?.execution_time_ms ? amount * 0.998 : amount,
        price: data.swap_result?.execution_price || 1,
        privacy_level: privacyLevel,
        mev_savings_usd: parseFloat(data.protected_swap?.savings_vs_unprotected?.replace('$', '') || '0'),
        privacy_cost_usd: data.protected_swap?.protection_fee || 0,
        status: 'completed',
        proof: data.result?.proof || data.protected_execution?.execution_id
      };
    } catch (error) {
      return {
        chunk_id: chunkId,
        chunk_number: chunkNum,
        total_chunks: totalChunks,
        amount_in: amount,
        amount_out: 0,
        price: 0,
        privacy_level: privacyLevel,
        mev_savings_usd: 0,
        privacy_cost_usd: 0,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Chunk execution failed'
      };
    }
  }

  /**
   * Analyze stealth trade options before execution
   * Shows privacy/cost tradeoffs
   */
  async analyzeStealthOptions(
    tokenIn: string,
    tokenOut: string,
    amount: number
  ): Promise<StealthAnalysis> {
    const priceIn = this.prices.get(tokenIn);
    const usdValue = priceIn ? amount * priceIn.price : amount * 100;
    
    // Get MEV risk analysis
    let mevRisk = { risk: 'LOW' as const, potential_loss_usd: '0', recommendations: [] as string[] };
    try {
      const axios = (await import('axios')).default;
      const response = await axios.post(`${this.config.router_url}/mev/analyze`, {
        token_in: tokenIn,
        token_out: tokenOut,
        amount,
        slippage: 0.5
      }, { timeout: 5000 });
      
      if (response.data.mev_analysis) {
        mevRisk = {
          risk: response.data.mev_analysis.risk_assessment?.overall_risk || 'LOW',
          potential_loss_usd: response.data.mev_analysis.potential_loss_usd || '0',
          recommendations: response.data.mev_analysis.recommendations || []
        };
      }
    } catch {
      // Use defaults
    }

    const potentialLoss = parseFloat(mevRisk.potential_loss_usd);
    
    return {
      trade: { token_in: tokenIn, token_out: tokenOut, amount, usd_value: usdValue },
      mev_risk: mevRisk,
      options: [
        {
          level: 'standard',
          method: 'Private RPC',
          protection_percent: 40,
          estimated_cost_usd: 0.02,
          estimated_savings_usd: potentialLoss * 0.4,
          net_benefit_usd: potentialLoss * 0.4 - 0.02,
          features: ['hidden_from_public_mempool']
        },
        {
          level: 'enhanced',
          method: 'Jito Bundle',
          protection_percent: 70,
          estimated_cost_usd: Math.max(0.05, potentialLoss * 0.1),
          estimated_savings_usd: potentialLoss * 0.7,
          net_benefit_usd: potentialLoss * 0.7 - Math.max(0.05, potentialLoss * 0.1),
          features: ['jito_bundle', 'tip_protection', 'atomic_execution']
        },
        {
          level: 'maximum',
          method: 'Arcium MPC',
          protection_percent: 95,
          estimated_cost_usd: Math.max(0.10, potentialLoss * 0.2),
          estimated_savings_usd: potentialLoss * 0.95,
          net_benefit_usd: potentialLoss * 0.95 - Math.max(0.10, potentialLoss * 0.2),
          features: ['encrypted_amounts', 'hidden_route', 'zk_proof', 'confidential_settlement']
        }
      ],
      recommendation: potentialLoss > 50 ? 'maximum' : potentialLoss > 10 ? 'enhanced' : 'standard',
      split_recommended: usdValue > 50000,
      recommended_chunks: usdValue > 50000 ? Math.min(10, Math.ceil(usdValue / 10000)) : 1
    };
  }

  // ============================================
  // ⚡ INSTANT EXECUTION MODE
  // ============================================

  // Route cache for instant execution
  private routeCache: Map<string, { route: any; timestamp: number; ttl: number }> = new Map();
  private connectionPool: Map<string, any> = new Map();
  private priceCache: Map<string, { price: number; timestamp: number }> = new Map();
  
  // Latency tracking for performance monitoring
  private latencyHistory: number[] = [];
  private readonly MAX_LATENCY_SAMPLES = 100;

  /**
   * Smart trade - automatically selects the best execution method
   * 
   * Decision logic:
   * - < $100: instant (skip MEV, fastest)
   * - $100-$10K: protected (standard MEV protection)
   * - > $10K: stealth (split + maximum privacy)
   * 
   * @example
   * // Just call smartTrade - it picks the right method
   * const result = await agent.smartTrade('SOL', 'USDC', 100);
   */
  async smartTrade(
    tokenIn: string,
    tokenOut: string,
    amount: number
  ): Promise<{ method: string; result: any; latency_ms: number }> {
    const startTime = performance.now();
    
    // Get USD value
    const prices = this.prices;
    const priceData = prices.get(tokenIn);
    const usdValue = priceData ? amount * priceData.price : amount * 100;

    let method: string;
    let result: any;

    if (usdValue < 100) {
      // Small trade: instant, no MEV check
      method = 'instant';
      result = await this.instantSwap(tokenIn, tokenOut, amount, { skip_mev_check: true });
    } else if (usdValue < 10000) {
      // Medium trade: protected
      method = 'protected';
      result = await this.instantSwap(tokenIn, tokenOut, amount);
    } else {
      // Large trade: stealth with splitting
      method = 'stealth';
      result = await this.stealthTrade(tokenIn, tokenOut, amount, {
        privacy_level: 'maximum',
        split_order: usdValue > 50000
      });
    }

    const latencyMs = Math.round(performance.now() - startTime);
    
    console.log(`🎯 Smart Trade: ${method} for $${usdValue.toFixed(0)} in ${latencyMs}ms`);
    
    return { method, result, latency_ms: latencyMs };
  }

  /**
   * Execute an instant trade with minimal latency
   * 
   * Optimizations:
   * - Pre-cached routes for common pairs
   * - Parallel quote fetching
   * - Skip MEV analysis for small trades
   * - Connection pooling
   * - Aggressive caching
   * 
   * @example
   * const result = await agent.instantSwap('SOL', 'USDC', 10);
   * console.log(`Executed in ${result.latency_ms}ms`);
   */
  async instantSwap(
    tokenIn: string,
    tokenOut: string,
    amount: number,
    options?: {
      max_slippage_bps?: number;
      skip_mev_check?: boolean;
      priority_fee_lamports?: number;
    }
  ): Promise<InstantSwapResult> {
    const startTime = performance.now();
    
    // Validate inputs
    this.validateToken(tokenIn);
    this.validateToken(tokenOut);
    this.validateAmount(amount);

    const instantConfig = this.config.instant_mode;
    const pairKey = `${tokenIn}-${tokenOut}`;
    
    const result: InstantSwapResult = {
      swap_id: `instant_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      status: 'pending',
      token_in: tokenIn,
      token_out: tokenOut,
      amount_in: amount,
      amount_out: 0,
      execution_price: 0,
      latency_ms: 0,
      optimizations_used: [],
      mev_skipped: false
    };

    try {
      // 1. Get cached price or fetch in parallel
      const pricePromise = this.getCachedPrice(tokenIn);
      
      // 2. Check route cache
      let route = this.getCachedRoute(pairKey);
      if (route) {
        result.optimizations_used.push('cached_route');
      }

      // 3. Determine if we should skip MEV check
      const price = await pricePromise;
      const usdValue = amount * price;
      const skipMevThreshold = instantConfig?.skip_mev_under_usd || 500;
      const skipMev = options?.skip_mev_check || usdValue < skipMevThreshold;
      
      if (skipMev) {
        result.mev_skipped = true;
        result.optimizations_used.push('mev_skip');
      }

      // 4. Execute swap with optimizations
      const axios = (await import('axios')).default;
      
      // Use connection from pool if available
      const axiosConfig = {
        timeout: instantConfig?.max_latency_ms || 3000,
        headers: { 'Connection': 'keep-alive' }
      };

      // Parallel execution: quote + route if not cached
      const [swapResponse] = await Promise.all([
        axios.post(`${this.config.router_url}/mev/protected-swap`, {
          token_in: tokenIn,
          token_out: tokenOut,
          amount,
          wallet_address: this.config.agent_id,
          protection_level: skipMev ? 'none' : 'standard',
          max_slippage_bps: options?.max_slippage_bps || 50,
          priority_fee: options?.priority_fee_lamports || 5000,
          instant_mode: true
        }, axiosConfig),
        // Pre-fetch next likely route in background
        !route ? this.prefetchRoute(pairKey) : Promise.resolve()
      ]);

      const data = swapResponse.data;
      
      result.amount_out = data.swap_result?.amount_out || amount * 0.998;
      result.execution_price = data.swap_result?.execution_price || price;
      result.status = 'executed';
      result.tx_signature = data.protected_execution?.tx_signature;

      // Cache the route for next time
      if (data.route) {
        this.cacheRoute(pairKey, data.route);
        result.optimizations_used.push('route_cached_for_next');
      }

      // Calculate final latency
      result.latency_ms = Math.round(performance.now() - startTime);

      // Warn if latency exceeded threshold
      const maxLatency = instantConfig?.max_latency_ms || 2000;
      if (result.latency_ms > maxLatency) {
        console.warn(`⚠️ Instant swap latency ${result.latency_ms}ms exceeded threshold ${maxLatency}ms`);
        result.latency_warning = true;
      }

      // Track latency for stats
      this.trackLatency(result.latency_ms);

      this.emit('instant_swap_completed', result);
      
      console.log(`⚡ Instant Swap: ${amount} ${tokenIn} → ${result.amount_out.toFixed(4)} ${tokenOut} in ${result.latency_ms}ms`);

    } catch (error) {
      result.status = 'failed';
      result.error = error instanceof Error ? error.message : 'Instant swap failed';
      result.latency_ms = Math.round(performance.now() - startTime);
      this.emit('instant_swap_failed', result);
    }

    return result;
  }

  private async getCachedPrice(token: string): Promise<number> {
    const cached = this.priceCache.get(token);
    const now = Date.now();
    
    // Cache valid for 5 seconds for instant mode
    if (cached && now - cached.timestamp < 5000) {
      return cached.price;
    }

    // Fetch fresh price
    const priceData = this.prices.get(token);
    if (priceData && now - priceData.timestamp < 10000) {
      this.priceCache.set(token, { price: priceData.price, timestamp: now });
      return priceData.price;
    }

    // Fallback to API
    try {
      const axios = (await import('axios')).default;
      const response = await axios.get(
        `${this.config.router_url}/invoke/cap.price.lookup.v1?base_token=${token}`,
        { timeout: 1000 }
      );
      const price = response.data.outputs?.price || 100;
      this.priceCache.set(token, { price, timestamp: now });
      return price;
    } catch {
      return 100; // Fallback
    }
  }

  private getCachedRoute(pairKey: string): any | null {
    const cached = this.routeCache.get(pairKey);
    if (cached && Date.now() - cached.timestamp < cached.ttl) {
      return cached.route;
    }
    return null;
  }

  private cacheRoute(pairKey: string, route: any, ttlMs: number = 30000): void {
    this.routeCache.set(pairKey, {
      route,
      timestamp: Date.now(),
      ttl: ttlMs
    });
  }

  private async prefetchRoute(pairKey: string): Promise<void> {
    // Background prefetch - don't await
    try {
      const [tokenIn, tokenOut] = pairKey.split('-');
      const axios = (await import('axios')).default;
      const response = await axios.get(
        `${this.config.router_url}/quote?input=${tokenIn}&output=${tokenOut}&amount=1`,
        { timeout: 2000 }
      );
      if (response.data.route) {
        this.cacheRoute(pairKey, response.data.route);
      }
    } catch {
      // Ignore prefetch errors
    }
  }

  /**
   * Pre-warm connections and caches for instant execution
   * Call this on startup for best performance
   */
  async warmUp(pairs?: Array<{ tokenIn: string; tokenOut: string }>): Promise<void> {
    const defaultPairs = [
      { tokenIn: 'SOL', tokenOut: 'USDC' },
      { tokenIn: 'USDC', tokenOut: 'SOL' },
      { tokenIn: 'SOL', tokenOut: 'USDT' },
      { tokenIn: 'ETH', tokenOut: 'USDC' }
    ];

    const pairsToWarm = pairs || defaultPairs;
    console.log(`⚡ Warming up ${pairsToWarm.length} trading pairs...`);

    const warmupStart = performance.now();

    // Parallel warmup
    await Promise.all(pairsToWarm.map(async ({ tokenIn, tokenOut }) => {
      const pairKey = `${tokenIn}-${tokenOut}`;
      try {
        // Prefetch route
        await this.prefetchRoute(pairKey);
        // Prefetch price
        await this.getCachedPrice(tokenIn);
      } catch {
        // Ignore warmup errors
      }
    }));

    const warmupTime = Math.round(performance.now() - warmupStart);
    console.log(`⚡ Warmup complete in ${warmupTime}ms - ${this.routeCache.size} routes cached`);
    
    this.emit('warmup_complete', { pairs: pairsToWarm.length, time_ms: warmupTime });
  }

  // Background refresh interval
  private refreshInterval: NodeJS.Timeout | null = null;

  /**
   * Start background cache refresh for always-hot caches
   * Keeps routes and prices fresh without blocking trades
   */
  startBackgroundRefresh(intervalMs: number = 10000): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }

    console.log(`⚡ Starting background refresh every ${intervalMs}ms`);

    this.refreshInterval = setInterval(async () => {
      const pairs = Array.from(this.routeCache.keys());
      
      // Refresh in parallel, don't block
      Promise.all(pairs.map(async (pairKey) => {
        try {
          await this.prefetchRoute(pairKey);
        } catch {
          // Silent fail - old cache still valid
        }
      })).catch(() => {});

      // Also refresh watched token prices
      for (const token of this.config.watched_tokens) {
        this.getCachedPrice(token).catch(() => {});
      }
    }, intervalMs);

    this.emit('background_refresh_started', { interval_ms: intervalMs });
  }

  /**
   * Stop background cache refresh
   */
  stopBackgroundRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
      console.log('⚡ Background refresh stopped');
    }
  }

  /**
   * Get instant execution stats
   */
  getInstantStats(): {
    cached_routes: number;
    cached_prices: number;
    avg_latency_ms: number;
    background_refresh_active: boolean;
  } {
    return {
      cached_routes: this.routeCache.size,
      cached_prices: this.priceCache.size,
      avg_latency_ms: this.getAvgLatency(),
      background_refresh_active: this.refreshInterval !== null
    };
  }

  private trackLatency(latencyMs: number): void {
    this.latencyHistory.push(latencyMs);
    if (this.latencyHistory.length > this.MAX_LATENCY_SAMPLES) {
      this.latencyHistory.shift();
    }
  }

  private getAvgLatency(): number {
    if (this.latencyHistory.length === 0) return 0;
    const sum = this.latencyHistory.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.latencyHistory.length);
  }

  /**
   * Race multiple execution paths and use the fastest one
   * Executes swap via whichever method responds first
   * 
   * @example
   * const result = await agent.raceSwap('SOL', 'USDC', 10);
   * console.log(`Won by: ${result.winning_method} in ${result.latency_ms}ms`);
   */
  async raceSwap(
    tokenIn: string,
    tokenOut: string,
    amount: number
  ): Promise<InstantSwapResult & { winning_method: string }> {
    const startTime = performance.now();
    
    this.validateToken(tokenIn);
    this.validateToken(tokenOut);
    this.validateAmount(amount);

    // Race multiple execution methods
    const axios = (await import('axios')).default;
    const routerUrl = this.config.router_url;

    const methods = [
      {
        name: 'instant_direct',
        promise: axios.post(`${routerUrl}/trading/instant-swap`, {
          token_in: tokenIn,
          token_out: tokenOut,
          amount,
          wallet_address: this.config.agent_id
        }, { timeout: 3000 })
      },
      {
        name: 'mev_protected',
        promise: axios.post(`${routerUrl}/mev/protected-swap`, {
          token_in: tokenIn,
          token_out: tokenOut,
          amount,
          wallet_address: this.config.agent_id,
          protection_level: 'standard'
        }, { timeout: 5000 })
      }
    ];

    try {
      // Race all methods - first to respond wins
      const winner = await Promise.race(
        methods.map(async (method) => {
          const response = await method.promise;
          return { method: method.name, data: response.data };
        })
      );

      const latencyMs = Math.round(performance.now() - startTime);
      this.trackLatency(latencyMs);

      const result: InstantSwapResult & { winning_method: string } = {
        swap_id: `race_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        status: 'executed',
        token_in: tokenIn,
        token_out: tokenOut,
        amount_in: amount,
        amount_out: winner.data.instant_swap?.amount_out || winner.data.swap_result?.amount_out || 0,
        execution_price: winner.data.instant_swap?.execution_price || 0,
        latency_ms: latencyMs,
        optimizations_used: ['race_execution', winner.method],
        mev_skipped: winner.method === 'instant_direct',
        winning_method: winner.method,
        tx_signature: winner.data.instant_swap?.tx_signature || winner.data.protected_execution?.tx_signature
      };

      this.emit('race_swap_completed', result);
      console.log(`🏎️ Race Swap: ${winner.method} won in ${latencyMs}ms`);

      return result;
    } catch (error) {
      const latencyMs = Math.round(performance.now() - startTime);
      return {
        swap_id: `race_${Date.now()}_failed`,
        status: 'failed',
        token_in: tokenIn,
        token_out: tokenOut,
        amount_in: amount,
        amount_out: 0,
        execution_price: 0,
        latency_ms: latencyMs,
        optimizations_used: ['race_execution'],
        mev_skipped: false,
        winning_method: 'none',
        error: error instanceof Error ? error.message : 'Race swap failed'
      };
    }
  }

  /**
   * Get detailed latency statistics
   */
  getLatencyStats(): {
    avg_ms: number;
    min_ms: number;
    max_ms: number;
    p95_ms: number;
    samples: number;
  } {
    if (this.latencyHistory.length === 0) {
      return { avg_ms: 0, min_ms: 0, max_ms: 0, p95_ms: 0, samples: 0 };
    }
    
    const sorted = [...this.latencyHistory].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    
    return {
      avg_ms: this.getAvgLatency(),
      min_ms: sorted[0],
      max_ms: sorted[sorted.length - 1],
      p95_ms: sorted[p95Index] || sorted[sorted.length - 1],
      samples: this.latencyHistory.length
    };
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
    // Validate inputs
    this.validateAgentId(targetAgent);
    this.validateToken(tokenIn);
    this.validateToken(tokenOut);
    this.validateAmount(amount);
    this.checkRateLimit('requestQuote');

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
  // SECURE A2A COMMUNICATION
  // ============================================

  private secureSessions: Map<string, A2AHandshake> = new Map();
  private faultConfig: A2AFaultConfig = {
    max_retries: 3,
    retry_delay_ms: 1000,
    timeout_ms: 30000,
    circuit_breaker_threshold: 5
  };
  private failureCounts: Map<string, number> = new Map();

  /**
   * Establish a secure channel with another agent
   * Performs key exchange and capability negotiation
   */
  async establishSecureChannel(
    targetAgent: string,
    privacyLevel: A2APrivacyLevel = 'confidential'
  ): Promise<A2AHandshake> {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      const result = await this.agent.a2aInvoke<{
        accepted: boolean;
        public_key?: string;
        agreed_capabilities?: string[];
      }>({
        to_agent: targetAgent,
        capability_id: 'cap.a2a.handshake.v1',
        inputs: {
          from_agent: this.config.agent_id,
          session_id: sessionId,
          privacy_level: privacyLevel,
          requested_capabilities: ['cap.swap.execute.v1', 'cap.a2a.quote.v1']
        }
      });

      const handshake: A2AHandshake = {
        session_id: sessionId,
        initiator: this.config.agent_id,
        responder: targetAgent,
        status: result.success && result.outputs?.accepted ? 'established' : 'rejected',
        privacy_level: privacyLevel,
        public_key: result.outputs?.public_key,
        established_at: Date.now(),
        expires_at: Date.now() + 3600000, // 1 hour
        agreed_capabilities: result.outputs?.agreed_capabilities
      };

      if (handshake.status === 'established') {
        this.secureSessions.set(targetAgent, handshake);
        this.emit('secure_channel_established', { agent: targetAgent, session_id: sessionId });
      }

      return handshake;

    } catch (error: any) {
      return {
        session_id: sessionId,
        initiator: this.config.agent_id,
        responder: targetAgent,
        status: 'rejected',
        privacy_level: privacyLevel
      };
    }
  }

  /**
   * Send an encrypted message to another agent
   * Requires established secure channel for confidential+ levels
   */
  async sendSecureMessage(
    targetAgent: string,
    payload: any,
    privacyLevel: A2APrivacyLevel = 'confidential'
  ): Promise<SecureA2AMessage> {
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Check for existing secure session
    let session = this.secureSessions.get(targetAgent);
    if (privacyLevel !== 'public' && (!session || session.status !== 'established')) {
      session = await this.establishSecureChannel(targetAgent, privacyLevel);
      if (session.status !== 'established') {
        throw new Error(`Failed to establish secure channel with ${targetAgent}`);
      }
    }

    // For public messages, send plaintext
    if (privacyLevel === 'public') {
      await this.agent.sendMessage(targetAgent, {
        message_id: messageId,
        type: 'secure_message',
        privacy_level: privacyLevel,
        payload,
        timestamp: Date.now()
      });

      return {
        message_id: messageId,
        from_agent: this.config.agent_id,
        to_agent: targetAgent,
        privacy_level: privacyLevel,
        payload,
        verified: true,
        verification_method: 'signature',
        timestamp: Date.now()
      };
    }

    // For confidential+, encrypt via capability
    try {
      const encryptResult = await this.agent.invoke<{ encrypted: string; nonce: string }>('cap.fhe.encrypt.v1', {
        data: JSON.stringify(payload),
        recipient_key: session?.public_key
      });

      await this.agent.sendMessage(targetAgent, {
        message_id: messageId,
        type: 'secure_message',
        privacy_level: privacyLevel,
        encrypted_payload: encryptResult.outputs?.encrypted,
        nonce: encryptResult.outputs?.nonce,
        session_id: session?.session_id,
        timestamp: Date.now()
      });

      return {
        message_id: messageId,
        from_agent: this.config.agent_id,
        to_agent: targetAgent,
        privacy_level: privacyLevel,
        encrypted_payload: encryptResult.outputs?.encrypted,
        nonce: encryptResult.outputs?.nonce,
        verified: true,
        verification_method: privacyLevel === 'maximum' ? 'mpc' : 'signature',
        timestamp: Date.now()
      };

    } catch (error: any) {
      throw new Error(`Failed to send secure message: ${error.message}`);
    }
  }

  /**
   * Verify a received message's authenticity
   */
  async verifyMessage(message: SecureA2AMessage): Promise<{
    valid: boolean;
    decrypted_payload?: any;
    verification_details: string;
  }> {
    if (message.privacy_level === 'public') {
      return {
        valid: true,
        decrypted_payload: message.payload,
        verification_details: 'Public message - no encryption'
      };
    }

    const session = this.secureSessions.get(message.from_agent);
    if (!session || session.status !== 'established') {
      return {
        valid: false,
        verification_details: 'No established session with sender'
      };
    }

    try {
      // Verify signature via ZK proof
      const verifyResult = await this.agent.invoke<{ valid: boolean; data?: string }>('cap.zk.verify.v1', {
        encrypted_data: message.encrypted_payload,
        nonce: message.nonce,
        sender: message.from_agent,
        session_id: session.session_id
      });

      if (verifyResult.success && verifyResult.outputs?.valid) {
        return {
          valid: true,
          decrypted_payload: verifyResult.outputs.data ? JSON.parse(verifyResult.outputs.data) : undefined,
          verification_details: `Verified via ${message.verification_method || 'signature'}`
        };
      }

      return {
        valid: false,
        verification_details: 'Signature verification failed'
      };

    } catch (error: any) {
      return {
        valid: false,
        verification_details: `Verification error: ${error.message}`
      };
    }
  }

  /**
   * Execute A2A operation with fault tolerance
   * Retries on failure, uses fallback agents, respects circuit breaker
   */
  async executeWithFaultTolerance<T>(
    operation: () => Promise<T>,
    targetAgent: string,
    fallbackAgents?: string[]
  ): Promise<{ success: boolean; result?: T; attempts: number; used_fallback?: string }> {
    const agents = [targetAgent, ...(fallbackAgents || this.faultConfig.fallback_agents || [])];
    let attempts = 0;

    for (const agent of agents) {
      // Check circuit breaker
      const failures = this.failureCounts.get(agent) || 0;
      if (failures >= (this.faultConfig.circuit_breaker_threshold || 5)) {
        console.warn(`Circuit breaker open for ${agent}, skipping`);
        continue;
      }

      for (let retry = 0; retry < this.faultConfig.max_retries; retry++) {
        attempts++;
        try {
          const result = await Promise.race([
            operation(),
            new Promise<never>((_, reject) => 
              setTimeout(() => reject(new Error('Timeout')), this.faultConfig.timeout_ms)
            )
          ]);

          // Reset failure count on success
          this.failureCounts.set(agent, 0);
          
          return {
            success: true,
            result,
            attempts,
            used_fallback: agent !== targetAgent ? agent : undefined
          };

        } catch (error) {
          console.warn(`Attempt ${attempts} failed for ${agent}:`, error);
          
          // Increment failure count
          this.failureCounts.set(agent, (this.failureCounts.get(agent) || 0) + 1);
          
          // Wait before retry
          if (retry < this.faultConfig.max_retries - 1) {
            await new Promise(resolve => setTimeout(resolve, this.faultConfig.retry_delay_ms * (retry + 1)));
          }
        }
      }
    }

    return { success: false, attempts };
  }

  /**
   * Configure fault tolerance settings
   */
  setFaultConfig(config: Partial<A2AFaultConfig>): void {
    this.faultConfig = { ...this.faultConfig, ...config };
  }

  /**
   * Get active secure sessions
   */
  getSecureSessions(): A2AHandshake[] {
    return Array.from(this.secureSessions.values()).filter(s => s.status === 'established');
  }

  /**
   * Close a secure session
   */
  async closeSecureChannel(targetAgent: string): Promise<void> {
    const session = this.secureSessions.get(targetAgent);
    if (session) {
      session.status = 'expired';
      this.secureSessions.delete(targetAgent);
      this.emit('secure_channel_closed', { agent: targetAgent, session_id: session.session_id });
    }
  }

  // ============================================
  // CROSS-PROTOCOL INTEROPERABILITY
  // ============================================

  private crossProtocolAgents: Map<string, CrossProtocolAgent> = new Map();

  /**
   * Register a cross-protocol agent for interoperability
   * Supports Google A2A, MCP, and custom protocols
   */
  registerCrossProtocolAgent(agent: CrossProtocolAgent): void {
    this.crossProtocolAgents.set(agent.agent_id, agent);
    this.emit('cross_protocol_agent_registered', agent);
  }

  /**
   * Invoke a capability on a cross-protocol agent
   * Automatically adapts the request format
   */
  async invokeCrossProtocol<T>(
    agentId: string,
    capability: string,
    inputs: Record<string, any>
  ): Promise<{ success: boolean; outputs?: T; protocol: string }> {
    const agent = this.crossProtocolAgents.get(agentId);
    if (!agent) {
      throw new Error(`Cross-protocol agent ${agentId} not registered`);
    }

    try {
      // Adapt request based on protocol
      let result: any;
      
      switch (agent.protocol) {
        case 'cap402':
          result = await this.agent.a2aInvoke({
            to_agent: agentId,
            capability_id: capability,
            inputs
          });
          break;
          
        case 'a2a_google':
          // Adapt to Google A2A format
          result = await this.agent.invoke('cap.interop.google_a2a.v1', {
            endpoint: agent.endpoint,
            method: capability,
            params: inputs
          });
          break;
          
        case 'mcp':
          // Adapt to MCP format
          result = await this.agent.invoke('cap.interop.mcp.v1', {
            server: agent.endpoint,
            tool: capability,
            arguments: inputs
          });
          break;
          
        case 'custom':
          if (!agent.adapter) {
            throw new Error('Custom protocol requires adapter');
          }
          result = await this.agent.invoke(agent.adapter, {
            endpoint: agent.endpoint,
            capability,
            inputs
          });
          break;
      }

      return {
        success: result.success,
        outputs: result.outputs,
        protocol: agent.protocol
      };

    } catch (error: any) {
      return {
        success: false,
        protocol: agent.protocol
      };
    }
  }

  /**
   * Discover agents across protocols
   */
  async discoverCrossProtocolAgents(query?: {
    protocols?: string[];
    capability?: string;
  }): Promise<CrossProtocolAgent[]> {
    const results: CrossProtocolAgent[] = [];

    // Get CAP-402 agents
    try {
      const cap402Agents = await this.agent.discoverAgents({
        capability: query?.capability,
        limit: 20
      });

      for (const agent of cap402Agents) {
        results.push({
          agent_id: agent.agent_id,
          protocol: 'cap402',
          endpoint: this.config.router_url,
          capabilities: agent.capabilities,
          trust_score: agent.trust_score
        });
      }
    } catch {
      // Continue on failure
    }

    // Add registered cross-protocol agents
    const crossAgents = Array.from(this.crossProtocolAgents.values());
    for (const agent of crossAgents) {
      if (!query?.protocols || query.protocols.includes(agent.protocol)) {
        if (!query?.capability || agent.capabilities.includes(query.capability)) {
          results.push(agent);
        }
      }
    }

    return results;
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
  // VOLATILITY & MARKET ANALYSIS
  // ============================================

  /**
   * Get volatility metrics for a token
   */
  getVolatility(token: string, periodMinutes: number = 60): {
    token: string;
    period_minutes: number;
    price_change_percent: number;
    high: number;
    low: number;
    range_percent: number;
    std_deviation: number;
    volatility_level: 'low' | 'medium' | 'high' | 'extreme';
  } | null {
    const history = this.priceHistory.get(token);
    if (!history || history.length < 2) return null;

    const cutoff = Date.now() - periodMinutes * 60000;
    const recentPrices = history.filter(p => p.timestamp >= cutoff);
    
    if (recentPrices.length < 2) return null;

    const prices = recentPrices.map(p => p.price);
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    const first = prices[0];
    const last = prices[prices.length - 1];
    const priceChange = ((last - first) / first) * 100;
    const rangePercent = ((high - low) / low) * 100;

    // Calculate standard deviation
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const squaredDiffs = prices.map(p => Math.pow(p - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length;
    const stdDev = Math.sqrt(avgSquaredDiff);

    // Determine volatility level
    let volatilityLevel: 'low' | 'medium' | 'high' | 'extreme';
    if (rangePercent < 2) volatilityLevel = 'low';
    else if (rangePercent < 5) volatilityLevel = 'medium';
    else if (rangePercent < 10) volatilityLevel = 'high';
    else volatilityLevel = 'extreme';

    return {
      token,
      period_minutes: periodMinutes,
      price_change_percent: priceChange,
      high,
      low,
      range_percent: rangePercent,
      std_deviation: stdDev,
      volatility_level: volatilityLevel
    };
  }

  /**
   * Get market overview for all watched tokens
   */
  getMarketOverview(): {
    timestamp: number;
    tokens: Array<{
      token: string;
      price: number;
      change_1h: number;
      volatility: 'low' | 'medium' | 'high' | 'extreme';
      trend: 'up' | 'down' | 'sideways';
    }>;
    market_sentiment: 'bullish' | 'bearish' | 'neutral';
    avg_volatility: number;
  } {
    const tokens: Array<{
      token: string;
      price: number;
      change_1h: number;
      volatility: 'low' | 'medium' | 'high' | 'extreme';
      trend: 'up' | 'down' | 'sideways';
    }> = [];

    let totalChange = 0;
    let totalVolatility = 0;
    let tokenCount = 0;

    for (const token of this.config.watched_tokens) {
      const priceData = this.prices.get(token);
      const vol = this.getVolatility(token, 60);
      
      if (priceData) {
        const change = vol?.price_change_percent || 0;
        const volatility = vol?.volatility_level || 'low';
        const trend: 'up' | 'down' | 'sideways' = 
          change > 1 ? 'up' : change < -1 ? 'down' : 'sideways';

        tokens.push({
          token,
          price: priceData.price,
          change_1h: change,
          volatility,
          trend
        });

        totalChange += change;
        totalVolatility += vol?.range_percent || 0;
        tokenCount++;
      }
    }

    const avgChange = tokenCount > 0 ? totalChange / tokenCount : 0;
    const avgVolatility = tokenCount > 0 ? totalVolatility / tokenCount : 0;

    const sentiment: 'bullish' | 'bearish' | 'neutral' = 
      avgChange > 2 ? 'bullish' : avgChange < -2 ? 'bearish' : 'neutral';

    return {
      timestamp: Date.now(),
      tokens,
      market_sentiment: sentiment,
      avg_volatility: avgVolatility
    };
  }

  /**
   * Check if market conditions are favorable for trading
   */
  isTradingFavorable(token: string): {
    favorable: boolean;
    reasons: string[];
    score: number;
  } {
    const reasons: string[] = [];
    let score = 50; // Start neutral

    const vol = this.getVolatility(token, 60);
    const priceData = this.prices.get(token);

    if (!vol || !priceData) {
      return { favorable: false, reasons: ['Insufficient data'], score: 0 };
    }

    // Check volatility
    if (vol.volatility_level === 'extreme') {
      reasons.push('Extreme volatility - high risk');
      score -= 30;
    } else if (vol.volatility_level === 'high') {
      reasons.push('High volatility - moderate risk');
      score -= 15;
    } else if (vol.volatility_level === 'low') {
      reasons.push('Low volatility - stable conditions');
      score += 10;
    }

    // Check trend
    if (vol.price_change_percent > 5) {
      reasons.push('Strong uptrend');
      score += 15;
    } else if (vol.price_change_percent < -5) {
      reasons.push('Strong downtrend');
      score -= 10;
    }

    // Check spread (using range as proxy)
    if (vol.range_percent < 1) {
      reasons.push('Tight spread');
      score += 10;
    }

    return {
      favorable: score >= 50,
      reasons,
      score: Math.max(0, Math.min(100, score))
    };
  }

  // ============================================
  // TRADE JOURNAL
  // ============================================

  /**
   * Add notes to a trade for journaling
   */
  addTradeNotes(tradeId: string, notes: string): boolean {
    const trade = this.trades.find(t => t.trade_id === tradeId);
    if (trade) {
      trade.notes = notes;
      this.emit('trade_notes_updated', { trade_id: tradeId, notes });
      return true;
    }
    return false;
  }

  /**
   * Tag a trade for categorization
   */
  tagTrade(tradeId: string, tags: string[]): boolean {
    const trade = this.trades.find(t => t.trade_id === tradeId);
    if (trade) {
      trade.tags = [...(trade.tags || []), ...tags];
      this.emit('trade_tagged', { trade_id: tradeId, tags: trade.tags });
      return true;
    }
    return false;
  }

  /**
   * Set strategy for a trade
   */
  setTradeStrategy(tradeId: string, strategy: string, entryReason?: string): boolean {
    const trade = this.trades.find(t => t.trade_id === tradeId);
    if (trade) {
      trade.strategy = strategy;
      if (entryReason) trade.entry_reason = entryReason;
      return true;
    }
    return false;
  }

  /**
   * Get trades by tag
   */
  getTradesByTag(tag: string): TradeExecution[] {
    return this.trades.filter(t => t.tags?.includes(tag));
  }

  /**
   * Get trades by strategy
   */
  getTradesByStrategy(strategy: string): TradeExecution[] {
    return this.trades.filter(t => t.strategy === strategy);
  }

  /**
   * Get trade journal summary
   */
  getJournalSummary(): {
    total_trades: number;
    trades_with_notes: number;
    strategies_used: string[];
    tags_used: string[];
    by_strategy: Record<string, { count: number; pnl: number }>;
  } {
    const strategies = new Set<string>();
    const tags = new Set<string>();
    const byStrategy: Record<string, { count: number; pnl: number }> = {};
    let tradesWithNotes = 0;

    for (const trade of this.trades) {
      if (trade.notes) tradesWithNotes++;
      if (trade.strategy) {
        strategies.add(trade.strategy);
        if (!byStrategy[trade.strategy]) {
          byStrategy[trade.strategy] = { count: 0, pnl: 0 };
        }
        byStrategy[trade.strategy].count++;
        byStrategy[trade.strategy].pnl += (trade.amount_out - trade.amount_in) * (trade.price || 1);
      }
      trade.tags?.forEach(tag => tags.add(tag));
    }

    return {
      total_trades: this.trades.length,
      trades_with_notes: tradesWithNotes,
      strategies_used: Array.from(strategies),
      tags_used: Array.from(tags),
      by_strategy: byStrategy
    };
  }

  // ============================================
  // PRICE ALERTS
  // ============================================

  /**
   * Set a price alert - get notified when price crosses threshold
   * 
   * @example
   * // Alert when SOL goes above $200
   * agent.setPriceAlert('SOL', 'above', 200, 'SOL broke $200!');
   */
  setPriceAlert(
    token: string,
    condition: 'above' | 'below' | 'crosses',
    targetPrice: number,
    message?: string,
    webhookUrl?: string
  ): PriceAlert {
    const alert: PriceAlert = {
      alert_id: `pa_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      token,
      condition,
      target_price: targetPrice,
      status: 'active',
      created_at: Date.now(),
      message,
      webhook_url: webhookUrl
    };

    this.priceAlerts.set(alert.alert_id, alert);
    this.emit('price_alert_created', alert);
    
    const conditionText = condition === 'above' ? '>' : condition === 'below' ? '<' : '↔';
    console.log(`🔔 Price alert set: ${token} ${conditionText} $${targetPrice}`);

    return alert;
  }

  /**
   * Cancel a price alert
   */
  cancelPriceAlert(alertId: string): boolean {
    const alert = this.priceAlerts.get(alertId);
    if (alert && alert.status === 'active') {
      alert.status = 'cancelled';
      this.emit('price_alert_cancelled', alert);
      console.log(`❌ Price alert ${alertId} cancelled`);
      return true;
    }
    return false;
  }

  /**
   * Get all active price alerts
   */
  getActivePriceAlerts(): PriceAlert[] {
    return Array.from(this.priceAlerts.values()).filter(a => a.status === 'active');
  }

  /**
   * Check and trigger price alerts (called on price updates)
   */
  private checkPriceAlerts(): void {
    for (const alert of this.priceAlerts.values()) {
      if (alert.status !== 'active') continue;

      const currentPrice = this.prices.get(alert.token)?.price;
      if (!currentPrice) continue;

      let shouldTrigger = false;

      if (alert.condition === 'above') {
        shouldTrigger = currentPrice >= alert.target_price;
      } else if (alert.condition === 'below') {
        shouldTrigger = currentPrice <= alert.target_price;
      } else if (alert.condition === 'crosses') {
        // Check if price crossed the target in either direction
        const history = this.priceHistory.get(alert.token);
        if (history && history.length >= 2) {
          const prevPrice = history[history.length - 2]?.price;
          if (prevPrice) {
            const crossedUp = prevPrice < alert.target_price && currentPrice >= alert.target_price;
            const crossedDown = prevPrice > alert.target_price && currentPrice <= alert.target_price;
            shouldTrigger = crossedUp || crossedDown;
          }
        }
      }

      if (shouldTrigger) {
        alert.status = 'triggered';
        alert.triggered_at = Date.now();
        alert.triggered_price = currentPrice;

        const msg = alert.message || `${alert.token} ${alert.condition} $${alert.target_price}`;
        console.log(`🔔 ALERT: ${msg} (current: $${currentPrice.toFixed(2)})`);

        this.emit('price_alert_triggered', {
          ...alert,
          current_price: currentPrice,
          message: msg
        });

        // Call webhook if configured
        if (alert.webhook_url) {
          this.callAlertWebhook(alert, currentPrice).catch(() => {});
        }
      }
    }
  }

  /**
   * Call webhook for triggered alert
   */
  private async callAlertWebhook(alert: PriceAlert, currentPrice: number): Promise<void> {
    if (!alert.webhook_url) return;

    try {
      const axios = (await import('axios')).default;
      await axios.post(alert.webhook_url, {
        alert_id: alert.alert_id,
        token: alert.token,
        condition: alert.condition,
        target_price: alert.target_price,
        current_price: currentPrice,
        triggered_at: alert.triggered_at,
        message: alert.message
      }, { timeout: 5000 });
    } catch (error) {
      console.error(`Failed to call alert webhook: ${error}`);
    }
  }

  // ============================================
  // CONDITIONAL ORDERS (Stop-Loss / Take-Profit)
  // ============================================

  /**
   * Create a conditional order (internal helper to reduce duplication)
   */
  private createConditionalOrder(
    type: 'stop_loss' | 'take_profit' | 'trailing_stop',
    token: string,
    triggerPrice: number,
    amount: number,
    targetToken: string,
    expiresInHours?: number,
    extras?: { trailing_percent?: number; highest_price?: number }
  ): ConditionalOrder {
    const prefix = type === 'stop_loss' ? 'sl' : type === 'take_profit' ? 'tp' : 'ts';
    const order: ConditionalOrder = {
      order_id: `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      type,
      token,
      trigger_price: triggerPrice,
      amount,
      target_token: targetToken,
      status: 'active',
      created_at: Date.now(),
      expires_at: expiresInHours ? Date.now() + expiresInHours * 3600000 : undefined,
      ...extras
    };

    this.conditionalOrders.set(order.order_id, order);
    this.emit('order_created', order);
    return order;
  }

  /**
   * Set a stop-loss order - automatically sells when price drops below trigger
   * 
   * @example
   * // Sell all SOL if price drops below $140
   * agent.setStopLoss('SOL', 140, 10, 'USDC');
   */
  setStopLoss(
    token: string,
    triggerPrice: number,
    amount: number,
    targetToken: string = 'USDC',
    expiresInHours?: number
  ): ConditionalOrder {
    const order = this.createConditionalOrder('stop_loss', token, triggerPrice, amount, targetToken, expiresInHours);
    console.log(`🛑 Stop-loss set: Sell ${amount} ${token} if price < $${triggerPrice}`);
    return order;
  }

  /**
   * Set a take-profit order - automatically sells when price rises above trigger
   * 
   * @example
   * // Sell all SOL if price rises above $200
   * agent.setTakeProfit('SOL', 200, 10, 'USDC');
   */
  setTakeProfit(
    token: string,
    triggerPrice: number,
    amount: number,
    targetToken: string = 'USDC',
    expiresInHours?: number
  ): ConditionalOrder {
    const order = this.createConditionalOrder('take_profit', token, triggerPrice, amount, targetToken, expiresInHours);
    console.log(`🎯 Take-profit set: Sell ${amount} ${token} if price > $${triggerPrice}`);
    return order;
  }

  /**
   * Set a trailing stop - follows price up, triggers when price drops by percent
   * 
   * @example
   * // Trailing stop at 5% - if SOL drops 5% from its high, sell
   * agent.setTrailingStop('SOL', 5, 10, 'USDC');
   */
  setTrailingStop(
    token: string,
    trailingPercent: number,
    amount: number,
    targetToken: string = 'USDC'
  ): ConditionalOrder {
    const currentPrice = this.prices.get(token)?.price || 0;
    const triggerPrice = currentPrice * (1 - trailingPercent / 100);

    const order = this.createConditionalOrder(
      'trailing_stop', token, triggerPrice, amount, targetToken, undefined,
      { trailing_percent: trailingPercent, highest_price: currentPrice }
    );
    console.log(`📉 Trailing stop set: ${trailingPercent}% below high (currently $${triggerPrice.toFixed(2)})`);
    return order;
  }

  /**
   * Cancel a conditional order
   */
  cancelOrder(orderId: string): boolean {
    const order = this.conditionalOrders.get(orderId);
    if (order && order.status === 'active') {
      order.status = 'cancelled';
      this.emit('order_cancelled', order);
      console.log(`❌ Order ${orderId} cancelled`);
      return true;
    }
    return false;
  }

  /**
   * Get all active conditional orders
   */
  getActiveOrders(): ConditionalOrder[] {
    return Array.from(this.conditionalOrders.values()).filter(o => o.status === 'active');
  }

  // ============================================
  // DCA (Dollar Cost Averaging)
  // ============================================

  /**
   * Start a DCA schedule - buy fixed amount at regular intervals
   * 
   * @example
   * // Buy $50 of SOL every hour for 24 hours
   * agent.startDCA('SOL', 'USDC', 50, 'hourly', 24);
   */
  startDCA(
    tokenToBuy: string,
    tokenToSpend: string,
    amountPerInterval: number,
    interval: 'hourly' | 'daily' | 'weekly' | number,
    totalIntervals?: number
  ): DCASchedule {
    const intervalMs = typeof interval === 'number' 
      ? interval 
      : interval === 'hourly' ? 3600000 
      : interval === 'daily' ? 86400000 
      : 604800000;

    const schedule: DCASchedule = {
      schedule_id: `dca_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      token_to_buy: tokenToBuy,
      token_to_spend: tokenToSpend,
      amount_per_interval: amountPerInterval,
      interval_ms: intervalMs,
      total_intervals: totalIntervals,
      intervals_completed: 0,
      total_spent: 0,
      total_acquired: 0,
      avg_price: 0,
      status: 'active',
      created_at: Date.now(),
      next_execution: Date.now()
    };

    this.dcaSchedules.set(schedule.schedule_id, schedule);
    this.emit('dca_started', schedule);

    // Execute first buy immediately
    this.executeDCAInterval(schedule.schedule_id);

    // Schedule recurring buys
    const timer = setInterval(() => {
      this.executeDCAInterval(schedule.schedule_id);
    }, intervalMs);
    this.dcaTimers.set(schedule.schedule_id, timer);

    const intervalName = typeof interval === 'string' ? interval : `${interval}ms`;
    console.log(`📅 DCA started: Buy $${amountPerInterval} of ${tokenToBuy} ${intervalName}`);
    if (totalIntervals) {
      console.log(`   Total: ${totalIntervals} buys ($${amountPerInterval * totalIntervals} total)`);
    }

    return schedule;
  }

  /**
   * Execute a single DCA interval
   */
  private async executeDCAInterval(scheduleId: string): Promise<void> {
    const schedule = this.dcaSchedules.get(scheduleId);
    if (!schedule || schedule.status !== 'active') return;

    try {
      const result = await this.instantSwap(
        schedule.token_to_spend,
        schedule.token_to_buy,
        schedule.amount_per_interval,
        { skip_mev_check: true }
      );

      if (result.status === 'executed') {
        schedule.intervals_completed++;
        schedule.total_spent += schedule.amount_per_interval;
        schedule.total_acquired += result.amount_out;
        schedule.avg_price = schedule.total_spent / schedule.total_acquired;
        schedule.last_execution = Date.now();
        schedule.next_execution = Date.now() + schedule.interval_ms;

        this.emit('dca_executed', {
          schedule_id: scheduleId,
          interval: schedule.intervals_completed,
          amount_bought: result.amount_out,
          price: result.execution_price,
          total_acquired: schedule.total_acquired,
          avg_price: schedule.avg_price
        });

        console.log(`📅 DCA #${schedule.intervals_completed}: Bought ${result.amount_out.toFixed(4)} ${schedule.token_to_buy} @ $${result.execution_price.toFixed(2)}`);

        // Check if completed
        if (schedule.total_intervals && schedule.intervals_completed >= schedule.total_intervals) {
          schedule.status = 'completed';
          this.stopDCA(scheduleId);
          this.emit('dca_completed', schedule);
          console.log(`✅ DCA completed: ${schedule.total_acquired.toFixed(4)} ${schedule.token_to_buy} acquired at avg $${schedule.avg_price.toFixed(2)}`);
        }
      }
    } catch (error) {
      console.error(`DCA execution failed: ${error}`);
      this.emit('dca_error', { schedule_id: scheduleId, error });
    }
  }

  /**
   * Pause a DCA schedule
   */
  pauseDCA(scheduleId: string): boolean {
    const schedule = this.dcaSchedules.get(scheduleId);
    if (schedule && schedule.status === 'active') {
      schedule.status = 'paused';
      const timer = this.dcaTimers.get(scheduleId);
      if (timer) clearInterval(timer);
      this.emit('dca_paused', schedule);
      console.log(`⏸️ DCA ${scheduleId} paused`);
      return true;
    }
    return false;
  }

  /**
   * Resume a paused DCA schedule
   */
  resumeDCA(scheduleId: string): boolean {
    const schedule = this.dcaSchedules.get(scheduleId);
    if (schedule && schedule.status === 'paused') {
      schedule.status = 'active';
      const timer = setInterval(() => {
        this.executeDCAInterval(scheduleId);
      }, schedule.interval_ms);
      this.dcaTimers.set(scheduleId, timer);
      this.emit('dca_resumed', schedule);
      console.log(`▶️ DCA ${scheduleId} resumed`);
      return true;
    }
    return false;
  }

  /**
   * Stop and cancel a DCA schedule
   */
  stopDCA(scheduleId: string): boolean {
    const schedule = this.dcaSchedules.get(scheduleId);
    if (schedule) {
      schedule.status = 'cancelled';
      const timer = this.dcaTimers.get(scheduleId);
      if (timer) {
        clearInterval(timer);
        this.dcaTimers.delete(scheduleId);
      }
      this.emit('dca_stopped', schedule);
      console.log(`🛑 DCA ${scheduleId} stopped`);
      return true;
    }
    return false;
  }

  /**
   * Get all DCA schedules
   */
  getDCASchedules(): DCASchedule[] {
    return Array.from(this.dcaSchedules.values());
  }

  /**
   * Get DCA schedule by ID
   */
  getDCASchedule(scheduleId: string): DCASchedule | undefined {
    return this.dcaSchedules.get(scheduleId);
  }

  // ============================================
  // LIMIT ORDERS
  // ============================================

  /**
   * Place a limit buy order - executes when price drops to limit
   * 
   * @example
   * // Buy 10 SOL when price drops to $140
   * agent.limitBuy('SOL', 'USDC', 10, 140);
   */
  limitBuy(
    token: string,
    payWith: string,
    amount: number,
    limitPrice: number,
    expiresInHours?: number
  ): LimitOrder {
    const order: LimitOrder = {
      order_id: `lb_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      side: 'buy',
      token,
      target_token: payWith,
      amount,
      limit_price: limitPrice,
      status: 'open',
      created_at: Date.now(),
      expires_at: expiresInHours ? Date.now() + expiresInHours * 3600000 : undefined
    };

    this.limitOrders.set(order.order_id, order);
    this.emit('limit_order_created', order);
    console.log(`📋 Limit buy: ${amount} ${token} @ $${limitPrice}`);

    return order;
  }

  /**
   * Place a limit sell order - executes when price rises to limit
   * 
   * @example
   * // Sell 10 SOL when price rises to $200
   * agent.limitSell('SOL', 'USDC', 10, 200);
   */
  limitSell(
    token: string,
    receiveToken: string,
    amount: number,
    limitPrice: number,
    expiresInHours?: number
  ): LimitOrder {
    const order: LimitOrder = {
      order_id: `ls_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      side: 'sell',
      token,
      target_token: receiveToken,
      amount,
      limit_price: limitPrice,
      status: 'open',
      created_at: Date.now(),
      expires_at: expiresInHours ? Date.now() + expiresInHours * 3600000 : undefined
    };

    this.limitOrders.set(order.order_id, order);
    this.emit('limit_order_created', order);
    console.log(`📋 Limit sell: ${amount} ${token} @ $${limitPrice}`);

    return order;
  }

  /**
   * Cancel a limit order
   */
  cancelLimitOrder(orderId: string): boolean {
    const order = this.limitOrders.get(orderId);
    if (order && order.status === 'open') {
      order.status = 'cancelled';
      this.emit('limit_order_cancelled', order);
      console.log(`❌ Limit order ${orderId} cancelled`);
      return true;
    }
    return false;
  }

  /**
   * Get all open limit orders
   */
  getOpenLimitOrders(): LimitOrder[] {
    return Array.from(this.limitOrders.values()).filter(o => o.status === 'open');
  }

  // ============================================
  // PORTFOLIO REBALANCING
  // ============================================

  /**
   * Rebalance portfolio to target allocations
   * 
   * @example
   * // Rebalance to 60% SOL, 30% ETH, 10% USDC
   * await agent.rebalance({
   *   SOL: 60,
   *   ETH: 30,
   *   USDC: 10
   * });
   */
  async rebalance(
    targetAllocations: Record<string, number>,
    options?: {
      tolerance_percent?: number;
      dry_run?: boolean;
    }
  ): Promise<{
    success: boolean;
    trades_executed: number;
    before: Record<string, { amount: number; percent: number }>;
    after: Record<string, { amount: number; percent: number }>;
    trades: Array<{ from: string; to: string; amount: number }>;
  }> {
    const tolerance = options?.tolerance_percent || 2;
    const dryRun = options?.dry_run || false;

    // Validate allocations sum to 100
    const totalAllocation = Object.values(targetAllocations).reduce((a, b) => a + b, 0);
    if (Math.abs(totalAllocation - 100) > 0.01) {
      throw new Error(`Target allocations must sum to 100%, got ${totalAllocation}%`);
    }

    // Get current portfolio value
    const portfolio = await this.getPortfolioValue();
    const totalValue = portfolio.total_usd;

    if (totalValue === 0) {
      return {
        success: false,
        trades_executed: 0,
        before: {},
        after: {},
        trades: []
      };
    }

    // Calculate current allocations
    const currentAllocations: Record<string, { amount: number; percent: number }> = {};
    for (const pos of portfolio.positions) {
      currentAllocations[pos.token] = {
        amount: pos.amount,
        percent: (pos.usd_value / totalValue) * 100
      };
    }

    // Calculate required trades
    const trades: Array<{ from: string; to: string; amount: number }> = [];
    const tokensToSell: Array<{ token: string; usdAmount: number }> = [];
    const tokensToBuy: Array<{ token: string; usdAmount: number }> = [];

    for (const [token, targetPercent] of Object.entries(targetAllocations)) {
      const currentPercent = currentAllocations[token]?.percent || 0;
      const diff = targetPercent - currentPercent;

      if (Math.abs(diff) > tolerance) {
        const usdAmount = (Math.abs(diff) / 100) * totalValue;
        if (diff < 0) {
          tokensToSell.push({ token, usdAmount });
        } else {
          tokensToBuy.push({ token, usdAmount });
        }
      }
    }

    // Execute trades: sell first, then buy
    let tradesExecuted = 0;

    if (!dryRun) {
      // Sell overweight positions
      for (const { token, usdAmount } of tokensToSell) {
        const price = this.prices.get(token)?.price || 1;
        const amount = usdAmount / price;
        
        try {
          await this.smartTrade(token, 'USDC', amount);
          trades.push({ from: token, to: 'USDC', amount });
          tradesExecuted++;
        } catch (error) {
          console.error(`Rebalance sell failed for ${token}: ${error}`);
        }
      }

      // Buy underweight positions
      for (const { token, usdAmount } of tokensToBuy) {
        try {
          await this.smartTrade('USDC', token, usdAmount);
          trades.push({ from: 'USDC', to: token, amount: usdAmount });
          tradesExecuted++;
        } catch (error) {
          console.error(`Rebalance buy failed for ${token}: ${error}`);
        }
      }
    } else {
      // Dry run - just log what would happen
      for (const { token, usdAmount } of tokensToSell) {
        trades.push({ from: token, to: 'USDC', amount: usdAmount });
      }
      for (const { token, usdAmount } of tokensToBuy) {
        trades.push({ from: 'USDC', to: token, amount: usdAmount });
      }
    }

    // Get new allocations
    const newPortfolio = await this.getPortfolioValue();
    const afterAllocations: Record<string, { amount: number; percent: number }> = {};
    for (const pos of newPortfolio.positions) {
      afterAllocations[pos.token] = {
        amount: pos.amount,
        percent: (pos.usd_value / newPortfolio.total_usd) * 100
      };
    }

    this.emit('rebalance_completed', {
      trades_executed: tradesExecuted,
      before: currentAllocations,
      after: afterAllocations
    });

    console.log(`⚖️ Rebalance ${dryRun ? '(dry run)' : 'completed'}: ${tradesExecuted} trades`);

    return {
      success: true,
      trades_executed: tradesExecuted,
      before: currentAllocations,
      after: dryRun ? currentAllocations : afterAllocations,
      trades
    };
  }

  /**
   * Check and execute limit orders (called on price updates)
   */
  private async checkLimitOrders(): Promise<void> {
    for (const order of this.limitOrders.values()) {
      if (order.status !== 'open') continue;

      // Check expiry
      if (order.expires_at && Date.now() > order.expires_at) {
        order.status = 'expired';
        this.emit('limit_order_expired', order);
        continue;
      }

      const currentPrice = this.prices.get(order.token)?.price;
      if (!currentPrice) continue;

      let shouldFill = false;

      if (order.side === 'buy') {
        // Buy limit: execute when price drops to or below limit
        shouldFill = currentPrice <= order.limit_price;
      } else {
        // Sell limit: execute when price rises to or above limit
        shouldFill = currentPrice >= order.limit_price;
      }

      if (shouldFill) {
        try {
          const result = order.side === 'buy'
            ? await this.instantSwap(order.target_token, order.token, order.amount * order.limit_price)
            : await this.instantSwap(order.token, order.target_token, order.amount);

          if (result.status === 'executed') {
            order.status = 'filled';
            order.filled_at = Date.now();
            order.filled_price = result.execution_price;
            order.filled_amount = result.amount_out;
            
            this.emit('limit_order_filled', order);
            console.log(`✅ Limit ${order.side} filled: ${order.amount} ${order.token} @ $${currentPrice}`);
          }
        } catch (error) {
          console.error(`Failed to fill limit order: ${error}`);
        }
      }
    }
  }

  /**
   * Check and execute triggered orders (called on price updates)
   */
  private async checkConditionalOrders(): Promise<void> {
    for (const order of this.conditionalOrders.values()) {
      if (order.status !== 'active') continue;

      // Check expiry
      if (order.expires_at && Date.now() > order.expires_at) {
        order.status = 'expired';
        this.emit('order_expired', order);
        continue;
      }

      const currentPrice = this.prices.get(order.token)?.price;
      if (!currentPrice) continue;

      let shouldTrigger = false;

      if (order.type === 'stop_loss') {
        shouldTrigger = currentPrice <= order.trigger_price;
      } else if (order.type === 'take_profit') {
        shouldTrigger = currentPrice >= order.trigger_price;
      } else if (order.type === 'trailing_stop') {
        // Update highest price
        if (currentPrice > (order.highest_price || 0)) {
          order.highest_price = currentPrice;
          order.trigger_price = currentPrice * (1 - (order.trailing_percent || 5) / 100);
        }
        shouldTrigger = currentPrice <= order.trigger_price;
      }

      if (shouldTrigger) {
        order.status = 'triggered';
        this.emit('order_triggered', order);
        console.log(`⚡ Order ${order.order_id} triggered at $${currentPrice}`);

        // Execute the trade
        try {
          await this.smartTrade(order.token, order.target_token, order.amount);
        } catch (error) {
          console.error(`Failed to execute triggered order: ${error}`);
        }
      }
    }
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
   * Get detailed performance analytics for the trading session
   * Includes metrics traders actually care about
   */
  getPerformanceAnalytics(): {
    session: {
      start_time: number;
      duration_hours: number;
      trades_executed: number;
      trades_per_hour: number;
    };
    pnl: {
      realized_usd: number;
      unrealized_usd: number;
      total_usd: number;
      best_trade_usd: number;
      worst_trade_usd: number;
    };
    execution: {
      avg_latency_ms: number;
      p95_latency_ms: number;
      success_rate: number;
      mev_savings_total_usd: number;
    };
    risk: {
      max_drawdown_percent: number;
      sharpe_ratio: number;
      win_rate: number;
      avg_win_usd: number;
      avg_loss_usd: number;
      profit_factor: number;
    };
  } {
    const trades = this.trades.filter(t => t.status === 'executed');
    const startTime = trades[0]?.timestamp || Date.now();
    const durationMs = Date.now() - startTime;
    const durationHours = durationMs / 3600000;

    // Calculate PnL from trades
    let realizedPnl = 0;
    let bestTrade = 0;
    let worstTrade = 0;
    let totalWins = 0;
    let totalLosses = 0;
    let winCount = 0;
    let lossCount = 0;

    trades.forEach(trade => {
      const pnl = (trade.amount_out - trade.amount_in) * (trade.price || 1);
      realizedPnl += pnl;
      
      if (pnl > bestTrade) bestTrade = pnl;
      if (pnl < worstTrade) worstTrade = pnl;
      
      if (pnl > 0) {
        totalWins += pnl;
        winCount++;
      } else {
        totalLosses += Math.abs(pnl);
        lossCount++;
      }
    });

    const unrealizedPnl = this.getTotalPnL().unrealized;
    const latencyStats = this.getLatencyStats();
    const winRate = trades.length > 0 ? winCount / trades.length : 0;
    const avgWin = winCount > 0 ? totalWins / winCount : 0;
    const avgLoss = lossCount > 0 ? totalLosses / lossCount : 0;
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

    return {
      session: {
        start_time: startTime,
        duration_hours: Math.round(durationHours * 100) / 100,
        trades_executed: trades.length,
        trades_per_hour: durationHours > 0 ? Math.round(trades.length / durationHours * 10) / 10 : 0
      },
      pnl: {
        realized_usd: Math.round(realizedPnl * 100) / 100,
        unrealized_usd: Math.round(unrealizedPnl * 100) / 100,
        total_usd: Math.round((realizedPnl + unrealizedPnl) * 100) / 100,
        best_trade_usd: Math.round(bestTrade * 100) / 100,
        worst_trade_usd: Math.round(worstTrade * 100) / 100
      },
      execution: {
        avg_latency_ms: latencyStats.avg_ms,
        p95_latency_ms: latencyStats.p95_ms,
        success_rate: trades.length > 0 ? Math.round(winRate * 1000) / 10 : 0,
        mev_savings_total_usd: 0 // Would track from stealth trades
      },
      risk: {
        max_drawdown_percent: 0, // Would need equity curve tracking
        sharpe_ratio: 0, // Would need daily returns
        win_rate: Math.round(winRate * 1000) / 10,
        avg_win_usd: Math.round(avgWin * 100) / 100,
        avg_loss_usd: Math.round(avgLoss * 100) / 100,
        profit_factor: profitFactor === Infinity ? 999 : Math.round(profitFactor * 100) / 100
      }
    };
  }

  /**
   * Export trade history as CSV for analysis
   */
  exportTradesCSV(): string {
    const headers = ['timestamp', 'token_in', 'token_out', 'amount_in', 'amount_out', 'price', 'slippage', 'status', 'tx_hash'];
    const rows = this.trades.map(t => [
      new Date(t.timestamp).toISOString(),
      t.token_in,
      t.token_out,
      t.amount_in,
      t.amount_out,
      t.price || '',
      t.slippage || '',
      t.status,
      t.tx_hash || ''
    ].join(','));
    
    return [headers.join(','), ...rows].join('\n');
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
