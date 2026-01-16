/**
 * CAP-402 SDK Error Classes
 * 
 * Provides actionable error messages with context and fix suggestions.
 */

// ============================================
// BASE ERROR
// ============================================

export class CAP402Error extends Error {
  public readonly code: string;
  public readonly context: Record<string, any>;
  public readonly suggestion: string;
  public readonly docs_url?: string;

  constructor(
    message: string,
    code: string,
    context: Record<string, any> = {},
    suggestion: string = '',
    docs_url?: string
  ) {
    super(message);
    this.name = 'CAP402Error';
    this.code = code;
    this.context = context;
    this.suggestion = suggestion;
    this.docs_url = docs_url;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      suggestion: this.suggestion,
      docs_url: this.docs_url
    };
  }

  toString() {
    let str = `[${this.code}] ${this.message}`;
    if (this.suggestion) {
      str += `\n  💡 Suggestion: ${this.suggestion}`;
    }
    if (this.docs_url) {
      str += `\n  📚 Docs: ${this.docs_url}`;
    }
    return str;
  }
}

// ============================================
// NETWORK ERRORS
// ============================================

export class NetworkError extends CAP402Error {
  constructor(message: string, context: Record<string, any> = {}) {
    super(
      message,
      'NETWORK_ERROR',
      context,
      'Check your internet connection and router URL. The CAP-402 router may be temporarily unavailable.',
      'https://cap402.com/docs/api-docs.html#troubleshooting'
    );
    this.name = 'NetworkError';
  }
}

export class TimeoutError extends CAP402Error {
  constructor(operation: string, timeoutMs: number, context: Record<string, any> = {}) {
    super(
      `Operation "${operation}" timed out after ${timeoutMs}ms`,
      'TIMEOUT_ERROR',
      { operation, timeout_ms: timeoutMs, ...context },
      'Try increasing the timeout or check if the router is under heavy load.',
      'https://cap402.com/docs/sdk-docs.html#fault-tolerance'
    );
    this.name = 'TimeoutError';
  }
}

export class RateLimitError extends CAP402Error {
  public readonly retryAfterMs: number;

  constructor(retryAfterMs: number, context: Record<string, any> = {}) {
    super(
      `Rate limit exceeded. Retry after ${retryAfterMs}ms`,
      'RATE_LIMIT_ERROR',
      { retry_after_ms: retryAfterMs, ...context },
      'Reduce request frequency or use batch operations. Consider using an API key for higher limits.',
      'https://cap402.com/docs/api-docs.html#rate-limits'
    );
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

// ============================================
// TRADING ERRORS
// ============================================

export class InsufficientBalanceError extends CAP402Error {
  constructor(token: string, required: number, available: number, context: Record<string, any> = {}) {
    super(
      `Insufficient ${token} balance. Required: ${required}, Available: ${available}`,
      'INSUFFICIENT_BALANCE',
      { token, required, available, ...context },
      `Deposit more ${token} or reduce the trade amount.`
    );
    this.name = 'InsufficientBalanceError';
  }
}

export class SlippageExceededError extends CAP402Error {
  constructor(expected: number, actual: number, maxSlippage: number, context: Record<string, any> = {}) {
    super(
      `Slippage exceeded: expected ${expected}, got ${actual} (${((actual - expected) / expected * 100).toFixed(2)}% vs max ${maxSlippage}%)`,
      'SLIPPAGE_EXCEEDED',
      { expected, actual, max_slippage: maxSlippage, ...context },
      'Increase slippage tolerance, reduce trade size, or wait for better liquidity.'
    );
    this.name = 'SlippageExceededError';
  }
}

export class MEVRiskError extends CAP402Error {
  constructor(riskLevel: string, recommendations: string[], context: Record<string, any> = {}) {
    super(
      `High MEV risk detected: ${riskLevel}`,
      'MEV_RISK_HIGH',
      { risk_level: riskLevel, recommendations, ...context },
      recommendations.join('. ') || 'Consider using MEV protection or splitting the trade.'
    );
    this.name = 'MEVRiskError';
  }
}

export class TradeLimitError extends CAP402Error {
  constructor(limitType: string, limit: number, attempted: number, context: Record<string, any> = {}) {
    super(
      `Trade limit exceeded: ${limitType}. Limit: ${limit}, Attempted: ${attempted}`,
      'TRADE_LIMIT_EXCEEDED',
      { limit_type: limitType, limit, attempted, ...context },
      'Wait for the limit to reset or adjust your trading limits in the config.'
    );
    this.name = 'TradeLimitError';
  }
}

export class QuoteExpiredError extends CAP402Error {
  constructor(quoteId: string, expiredAt: number, context: Record<string, any> = {}) {
    super(
      `Quote ${quoteId} expired at ${new Date(expiredAt).toISOString()}`,
      'QUOTE_EXPIRED',
      { quote_id: quoteId, expired_at: expiredAt, ...context },
      'Request a new quote. Quotes typically expire after 60 seconds.'
    );
    this.name = 'QuoteExpiredError';
  }
}

// ============================================
// A2A ERRORS
// ============================================

export class A2AError extends CAP402Error {
  constructor(message: string, code: string, context: Record<string, any> = {}, suggestion: string = '') {
    super(message, code, context, suggestion, 'https://cap402.com/docs/sdk-docs.html#a2a-trading');
    this.name = 'A2AError';
  }
}

export class AgentNotFoundError extends A2AError {
  constructor(agentId: string, context: Record<string, any> = {}) {
    super(
      `Agent "${agentId}" not found or unavailable`,
      'AGENT_NOT_FOUND',
      { agent_id: agentId, ...context },
      'Check the agent ID or use discoverAgents() to find available agents.'
    );
    this.name = 'AgentNotFoundError';
  }
}

export class SecureChannelError extends A2AError {
  constructor(targetAgent: string, reason: string, context: Record<string, any> = {}) {
    super(
      `Failed to establish secure channel with "${targetAgent}": ${reason}`,
      'SECURE_CHANNEL_FAILED',
      { target_agent: targetAgent, reason, ...context },
      'The target agent may not support the requested privacy level or may be offline.'
    );
    this.name = 'SecureChannelError';
  }
}

export class MessageVerificationError extends A2AError {
  constructor(messageId: string, reason: string, context: Record<string, any> = {}) {
    super(
      `Message verification failed for "${messageId}": ${reason}`,
      'MESSAGE_VERIFICATION_FAILED',
      { message_id: messageId, reason, ...context },
      'The message may have been tampered with or the session may have expired.'
    );
    this.name = 'MessageVerificationError';
  }
}

// ============================================
// CONFIGURATION ERRORS
// ============================================

export class ConfigurationError extends CAP402Error {
  constructor(field: string, issue: string, context: Record<string, any> = {}) {
    super(
      `Configuration error in "${field}": ${issue}`,
      'CONFIG_ERROR',
      { field, issue, ...context },
      `Check your configuration for the "${field}" field.`,
      'https://cap402.com/docs/sdk-docs.html#configuration'
    );
    this.name = 'ConfigurationError';
  }
}

export class MissingConfigError extends ConfigurationError {
  constructor(field: string, context: Record<string, any> = {}) {
    super(field, `Required field "${field}" is missing`, context);
    this.name = 'MissingConfigError';
  }
}

// ============================================
// CAPABILITY ERRORS
// ============================================

export class CapabilityError extends CAP402Error {
  constructor(capabilityId: string, message: string, context: Record<string, any> = {}) {
    super(
      `Capability "${capabilityId}" error: ${message}`,
      'CAPABILITY_ERROR',
      { capability_id: capabilityId, ...context },
      'Check the capability inputs and ensure the capability is available.',
      'https://cap402.com/docs/api-docs.html#capabilities'
    );
    this.name = 'CapabilityError';
  }
}

export class CapabilityNotFoundError extends CapabilityError {
  constructor(capabilityId: string, context: Record<string, any> = {}) {
    super(capabilityId, 'Capability not found', context);
    this.name = 'CapabilityNotFoundError';
    // Note: suggestion is set in parent constructor
  }
}

// ============================================
// SAFETY ERRORS
// ============================================

export class SafetyError extends CAP402Error {
  constructor(message: string, code: string, context: Record<string, any> = {}) {
    super(
      message,
      code,
      context,
      'This operation was blocked by safety guardrails. Adjust limits or use emergencyStop()/resume().',
      'https://cap402.com/docs/sdk-docs.html#safety-guardrails'
    );
    this.name = 'SafetyError';
  }
}

export class SpendingLimitError extends SafetyError {
  constructor(limitType: string, limit: number, attempted: number, context: Record<string, any> = {}) {
    super(
      `Spending limit exceeded: ${limitType}. Limit: $${limit}, Attempted: $${attempted}`,
      'SPENDING_LIMIT_EXCEEDED',
      { limit_type: limitType, limit, attempted, ...context }
    );
    this.name = 'SpendingLimitError';
  }
}

export class EmergencyStopError extends SafetyError {
  constructor(context: Record<string, any> = {}) {
    super(
      'Operations paused due to emergency stop',
      'EMERGENCY_STOP_ACTIVE',
      context
    );
    this.name = 'EmergencyStopError';
    // Note: suggestion is set in parent constructor
  }
}

// ============================================
// ERROR HELPERS
// ============================================

/**
 * Wrap an error with CAP-402 context
 */
export function wrapError(error: any, context: Record<string, any> = {}): CAP402Error {
  if (error instanceof CAP402Error) {
    return error;
  }

  const message = error.message || String(error);
  
  // Detect common error patterns
  if (message.includes('ECONNREFUSED') || message.includes('ENOTFOUND')) {
    return new NetworkError(`Connection refused: ${message}`, context);
  }
  
  if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
    return new TimeoutError('unknown', 0, { original_message: message, ...context });
  }
  
  if (message.includes('429') || message.includes('rate limit')) {
    return new RateLimitError(60000, { original_message: message, ...context });
  }
  
  if (message.includes('insufficient') || message.includes('balance')) {
    return new CAP402Error(message, 'INSUFFICIENT_FUNDS', context, 'Check your wallet balance.');
  }

  return new CAP402Error(message, 'UNKNOWN_ERROR', context, 'Check the error details and try again.');
}

/**
 * Check if an error is retryable
 */
export function isRetryable(error: any): boolean {
  if (error instanceof NetworkError) return true;
  if (error instanceof TimeoutError) return true;
  if (error instanceof RateLimitError) return true;
  
  const message = error.message || '';
  return message.includes('ECONNREFUSED') || 
         message.includes('timeout') || 
         message.includes('503') ||
         message.includes('502');
}

/**
 * Get retry delay for an error
 */
export function getRetryDelay(error: any, attempt: number): number {
  if (error instanceof RateLimitError) {
    return error.retryAfterMs;
  }
  
  // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
  return Math.min(1000 * Math.pow(2, attempt), 30000);
}
