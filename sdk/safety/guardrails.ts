/**
 * CAP-402 Agent Safety Guardrails
 * 
 * Provides safety mechanisms to protect users from:
 * - Excessive spending
 * - Runaway agents
 * - Unintended transactions
 * - Rate limit violations
 */

import { EventEmitter } from 'events';

// ============================================
// TYPES
// ============================================

export interface SpendingLimits {
  max_per_transaction: number;      // Max USD per single transaction
  max_per_hour: number;             // Max USD per hour
  max_per_day: number;              // Max USD per day
  max_per_session: number;          // Max USD per agent session
  require_confirmation_above: number; // Require user confirmation above this amount
}

export interface RateLimits {
  max_invocations_per_minute: number;
  max_invocations_per_hour: number;
  max_trades_per_hour: number;
  max_messages_per_minute: number;
  cooldown_after_error_ms: number;
}

export interface SafetyConfig {
  spending_limits: SpendingLimits;
  rate_limits: RateLimits;
  
  // Behavioral limits
  max_consecutive_failures: number;
  auto_pause_on_anomaly: boolean;
  require_confirmation_for_new_tokens: boolean;
  
  // Allowed operations
  allowed_capabilities: string[];     // Empty = all allowed
  blocked_capabilities: string[];     // Explicit blocklist
  allowed_tokens: string[];           // Empty = all allowed
  blocked_tokens: string[];           // Explicit blocklist
  
  // Emergency controls
  emergency_stop_enabled: boolean;
  emergency_contact?: string;
}

export interface SpendingRecord {
  amount: number;
  timestamp: number;
  capability_id: string;
  transaction_id?: string;
}

export interface SafetyViolation {
  type: 'spending' | 'rate_limit' | 'capability' | 'token' | 'anomaly';
  severity: 'warning' | 'block' | 'emergency';
  message: string;
  details: Record<string, any>;
  timestamp: number;
}

// ============================================
// DEFAULT SAFE CONFIGURATION
// ============================================

export const DEFAULT_SAFETY_CONFIG: SafetyConfig = {
  spending_limits: {
    max_per_transaction: 100,        // $100 max per transaction
    max_per_hour: 500,               // $500 max per hour
    max_per_day: 2000,               // $2000 max per day
    max_per_session: 5000,           // $5000 max per session
    require_confirmation_above: 50   // Confirm above $50
  },
  rate_limits: {
    max_invocations_per_minute: 60,
    max_invocations_per_hour: 1000,
    max_trades_per_hour: 20,
    max_messages_per_minute: 30,
    cooldown_after_error_ms: 5000
  },
  max_consecutive_failures: 5,
  auto_pause_on_anomaly: true,
  require_confirmation_for_new_tokens: true,
  allowed_capabilities: [],          // All allowed by default
  blocked_capabilities: [],
  allowed_tokens: [],                // All allowed by default
  blocked_tokens: [],
  emergency_stop_enabled: true
};

// ============================================
// SAFETY GUARDRAILS CLASS
// ============================================

export class SafetyGuardrails extends EventEmitter {
  private config: SafetyConfig;
  private spendingHistory: SpendingRecord[] = [];
  private invocationCounts: { minute: number; hour: number; lastReset: { minute: number; hour: number } } = {
    minute: 0,
    hour: 0,
    lastReset: { minute: Date.now(), hour: Date.now() }
  };
  private tradeCounts: { hour: number; lastReset: number } = { hour: 0, lastReset: Date.now() };
  private messageCounts: { minute: number; lastReset: number } = { minute: 0, lastReset: Date.now() };
  private consecutiveFailures = 0;
  private violations: SafetyViolation[] = [];
  private isPaused = false;
  private sessionSpending = 0;
  private confirmedTokens: Set<string> = new Set();
  private pendingConfirmations: Map<string, { resolve: (confirmed: boolean) => void; timeout: NodeJS.Timeout }> = new Map();

  constructor(config?: Partial<SafetyConfig>) {
    super();
    this.config = { ...DEFAULT_SAFETY_CONFIG, ...config };
    
    // Initialize with common safe tokens
    this.confirmedTokens.add('SOL');
    this.confirmedTokens.add('USDC');
    this.confirmedTokens.add('USDT');
    this.confirmedTokens.add('ETH');
    this.confirmedTokens.add('BTC');
  }

  // ============================================
  // PRE-EXECUTION CHECKS
  // ============================================

  async checkBeforeInvoke(capabilityId: string, inputs: Record<string, any>): Promise<{
    allowed: boolean;
    reason?: string;
    requiresConfirmation?: boolean;
    confirmationPrompt?: string;
  }> {
    // Check if paused
    if (this.isPaused) {
      return { allowed: false, reason: 'Agent is paused due to safety concerns' };
    }

    // Check capability blocklist
    if (this.config.blocked_capabilities.includes(capabilityId)) {
      this.recordViolation('capability', 'block', `Blocked capability: ${capabilityId}`, { capability_id: capabilityId });
      return { allowed: false, reason: `Capability ${capabilityId} is blocked` };
    }

    // Check capability allowlist (if specified)
    if (this.config.allowed_capabilities.length > 0 && !this.config.allowed_capabilities.includes(capabilityId)) {
      this.recordViolation('capability', 'block', `Capability not in allowlist: ${capabilityId}`, { capability_id: capabilityId });
      return { allowed: false, reason: `Capability ${capabilityId} is not in the allowed list` };
    }

    // Check rate limits
    this.resetCountersIfNeeded();
    
    if (this.invocationCounts.minute >= this.config.rate_limits.max_invocations_per_minute) {
      this.recordViolation('rate_limit', 'block', 'Minute rate limit exceeded', { limit: this.config.rate_limits.max_invocations_per_minute });
      return { allowed: false, reason: 'Rate limit exceeded (per minute). Please wait.' };
    }

    if (this.invocationCounts.hour >= this.config.rate_limits.max_invocations_per_hour) {
      this.recordViolation('rate_limit', 'block', 'Hour rate limit exceeded', { limit: this.config.rate_limits.max_invocations_per_hour });
      return { allowed: false, reason: 'Rate limit exceeded (per hour). Please wait.' };
    }

    // Check token restrictions for trading capabilities
    if (capabilityId.includes('swap') || capabilityId.includes('trade')) {
      const tokenIn = inputs.token_in || inputs.input_token;
      const tokenOut = inputs.token_out || inputs.output_token;

      for (const token of [tokenIn, tokenOut].filter(Boolean)) {
        // Check blocklist
        if (this.config.blocked_tokens.includes(token)) {
          this.recordViolation('token', 'block', `Blocked token: ${token}`, { token });
          return { allowed: false, reason: `Token ${token} is blocked` };
        }

        // Check allowlist
        if (this.config.allowed_tokens.length > 0 && !this.config.allowed_tokens.includes(token)) {
          this.recordViolation('token', 'block', `Token not in allowlist: ${token}`, { token });
          return { allowed: false, reason: `Token ${token} is not in the allowed list` };
        }

        // Check if new token requires confirmation
        if (this.config.require_confirmation_for_new_tokens && !this.confirmedTokens.has(token)) {
          return {
            allowed: true,
            requiresConfirmation: true,
            confirmationPrompt: `First time trading ${token}. Confirm to proceed?`
          };
        }
      }

      // Check trade rate limit
      if (this.tradeCounts.hour >= this.config.rate_limits.max_trades_per_hour) {
        this.recordViolation('rate_limit', 'block', 'Trade rate limit exceeded', { limit: this.config.rate_limits.max_trades_per_hour });
        return { allowed: false, reason: 'Trade limit exceeded (per hour). Please wait.' };
      }
    }

    return { allowed: true };
  }

  async checkSpending(amount: number, capabilityId: string): Promise<{
    allowed: boolean;
    reason?: string;
    requiresConfirmation?: boolean;
    confirmationPrompt?: string;
  }> {
    // Check per-transaction limit
    if (amount > this.config.spending_limits.max_per_transaction) {
      this.recordViolation('spending', 'block', `Transaction exceeds limit: $${amount}`, { amount, limit: this.config.spending_limits.max_per_transaction });
      return { 
        allowed: false, 
        reason: `Transaction amount ($${amount}) exceeds maximum ($${this.config.spending_limits.max_per_transaction})` 
      };
    }

    // Check hourly spending
    const hourlySpending = this.getSpendingInPeriod(60 * 60 * 1000);
    if (hourlySpending + amount > this.config.spending_limits.max_per_hour) {
      this.recordViolation('spending', 'block', `Hourly spending limit would be exceeded`, { current: hourlySpending, amount, limit: this.config.spending_limits.max_per_hour });
      return { 
        allowed: false, 
        reason: `Hourly spending limit ($${this.config.spending_limits.max_per_hour}) would be exceeded` 
      };
    }

    // Check daily spending
    const dailySpending = this.getSpendingInPeriod(24 * 60 * 60 * 1000);
    if (dailySpending + amount > this.config.spending_limits.max_per_day) {
      this.recordViolation('spending', 'block', `Daily spending limit would be exceeded`, { current: dailySpending, amount, limit: this.config.spending_limits.max_per_day });
      return { 
        allowed: false, 
        reason: `Daily spending limit ($${this.config.spending_limits.max_per_day}) would be exceeded` 
      };
    }

    // Check session spending
    if (this.sessionSpending + amount > this.config.spending_limits.max_per_session) {
      this.recordViolation('spending', 'block', `Session spending limit would be exceeded`, { current: this.sessionSpending, amount, limit: this.config.spending_limits.max_per_session });
      return { 
        allowed: false, 
        reason: `Session spending limit ($${this.config.spending_limits.max_per_session}) would be exceeded` 
      };
    }

    // Check if confirmation required
    if (amount > this.config.spending_limits.require_confirmation_above) {
      return {
        allowed: true,
        requiresConfirmation: true,
        confirmationPrompt: `Confirm transaction of $${amount.toFixed(2)}?`
      };
    }

    return { allowed: true };
  }

  // ============================================
  // POST-EXECUTION RECORDING
  // ============================================

  recordInvocation(): void {
    this.resetCountersIfNeeded();
    this.invocationCounts.minute++;
    this.invocationCounts.hour++;
  }

  recordTrade(): void {
    this.resetCountersIfNeeded();
    this.tradeCounts.hour++;
  }

  recordSpending(amount: number, capabilityId: string, transactionId?: string): void {
    this.spendingHistory.push({
      amount,
      timestamp: Date.now(),
      capability_id: capabilityId,
      transaction_id: transactionId
    });
    this.sessionSpending += amount;

    // Keep only last 1000 records
    if (this.spendingHistory.length > 1000) {
      this.spendingHistory = this.spendingHistory.slice(-1000);
    }

    this.emit('spending', { amount, total_session: this.sessionSpending, capability_id: capabilityId });
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
  }

  recordFailure(): void {
    this.consecutiveFailures++;
    
    if (this.consecutiveFailures >= this.config.max_consecutive_failures) {
      this.recordViolation('anomaly', 'emergency', `${this.consecutiveFailures} consecutive failures`, { count: this.consecutiveFailures });
      
      if (this.config.auto_pause_on_anomaly) {
        this.pause('Too many consecutive failures');
      }
    }
  }

  confirmToken(token: string): void {
    this.confirmedTokens.add(token);
  }

  // ============================================
  // EMERGENCY CONTROLS
  // ============================================

  pause(reason: string): void {
    this.isPaused = true;
    this.emit('paused', { reason, timestamp: Date.now() });
    console.warn(`⚠️ AGENT PAUSED: ${reason}`);
  }

  resume(): void {
    this.isPaused = false;
    this.consecutiveFailures = 0;
    this.emit('resumed', { timestamp: Date.now() });
  }

  emergencyStop(): void {
    this.isPaused = true;
    this.recordViolation('anomaly', 'emergency', 'Emergency stop triggered', {});
    this.emit('emergency_stop', { timestamp: Date.now() });
    console.error('🚨 EMERGENCY STOP TRIGGERED');
  }

  // ============================================
  // HELPERS
  // ============================================

  private resetCountersIfNeeded(): void {
    const now = Date.now();
    
    // Reset minute counter
    if (now - this.invocationCounts.lastReset.minute > 60000) {
      this.invocationCounts.minute = 0;
      this.invocationCounts.lastReset.minute = now;
    }
    
    // Reset hour counter
    if (now - this.invocationCounts.lastReset.hour > 3600000) {
      this.invocationCounts.hour = 0;
      this.invocationCounts.lastReset.hour = now;
    }

    // Reset trade counter
    if (now - this.tradeCounts.lastReset > 3600000) {
      this.tradeCounts.hour = 0;
      this.tradeCounts.lastReset = now;
    }

    // Reset message counter
    if (now - this.messageCounts.lastReset > 60000) {
      this.messageCounts.minute = 0;
      this.messageCounts.lastReset = now;
    }
  }

  private getSpendingInPeriod(periodMs: number): number {
    const cutoff = Date.now() - periodMs;
    return this.spendingHistory
      .filter(r => r.timestamp > cutoff)
      .reduce((sum, r) => sum + r.amount, 0);
  }

  private recordViolation(
    type: SafetyViolation['type'],
    severity: SafetyViolation['severity'],
    message: string,
    details: Record<string, any>
  ): void {
    const violation: SafetyViolation = {
      type,
      severity,
      message,
      details,
      timestamp: Date.now()
    };

    this.violations.push(violation);
    
    // Keep only last 100 violations
    if (this.violations.length > 100) {
      this.violations = this.violations.slice(-100);
    }

    this.emit('violation', violation);

    if (severity === 'emergency' && this.config.emergency_stop_enabled) {
      this.emergencyStop();
    }
  }

  // ============================================
  // STATUS & REPORTING
  // ============================================

  getStatus(): {
    paused: boolean;
    consecutive_failures: number;
    session_spending: number;
    hourly_spending: number;
    daily_spending: number;
    invocations_this_minute: number;
    invocations_this_hour: number;
    trades_this_hour: number;
    recent_violations: SafetyViolation[];
  } {
    return {
      paused: this.isPaused,
      consecutive_failures: this.consecutiveFailures,
      session_spending: this.sessionSpending,
      hourly_spending: this.getSpendingInPeriod(3600000),
      daily_spending: this.getSpendingInPeriod(86400000),
      invocations_this_minute: this.invocationCounts.minute,
      invocations_this_hour: this.invocationCounts.hour,
      trades_this_hour: this.tradeCounts.hour,
      recent_violations: this.violations.slice(-10)
    };
  }

  getViolations(limit: number = 50): SafetyViolation[] {
    return this.violations.slice(-limit);
  }

  getSpendingReport(): {
    session: number;
    hourly: number;
    daily: number;
    history: SpendingRecord[];
  } {
    return {
      session: this.sessionSpending,
      hourly: this.getSpendingInPeriod(3600000),
      daily: this.getSpendingInPeriod(86400000),
      history: this.spendingHistory.slice(-50)
    };
  }

  updateConfig(updates: Partial<SafetyConfig>): void {
    this.config = { ...this.config, ...updates };
    this.emit('config_updated', this.config);
  }

  getConfig(): SafetyConfig {
    return { ...this.config };
  }
}

// ============================================
// FACTORY
// ============================================

export function createSafetyGuardrails(config?: Partial<SafetyConfig>): SafetyGuardrails {
  return new SafetyGuardrails(config);
}

// ============================================
// PRESET CONFIGURATIONS
// ============================================

export const SAFETY_PRESETS = {
  // Very conservative - for beginners or testing
  conservative: {
    spending_limits: {
      max_per_transaction: 10,
      max_per_hour: 50,
      max_per_day: 100,
      max_per_session: 200,
      require_confirmation_above: 5
    },
    rate_limits: {
      max_invocations_per_minute: 20,
      max_invocations_per_hour: 200,
      max_trades_per_hour: 5,
      max_messages_per_minute: 10,
      cooldown_after_error_ms: 10000
    },
    max_consecutive_failures: 3,
    auto_pause_on_anomaly: true,
    require_confirmation_for_new_tokens: true
  } as Partial<SafetyConfig>,

  // Standard - balanced protection
  standard: DEFAULT_SAFETY_CONFIG,

  // Aggressive - for experienced users
  aggressive: {
    spending_limits: {
      max_per_transaction: 1000,
      max_per_hour: 5000,
      max_per_day: 20000,
      max_per_session: 50000,
      require_confirmation_above: 500
    },
    rate_limits: {
      max_invocations_per_minute: 120,
      max_invocations_per_hour: 5000,
      max_trades_per_hour: 100,
      max_messages_per_minute: 60,
      cooldown_after_error_ms: 1000
    },
    max_consecutive_failures: 10,
    auto_pause_on_anomaly: true,
    require_confirmation_for_new_tokens: false
  } as Partial<SafetyConfig>
};
