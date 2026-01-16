/**
 * CAP-402 SDK Constants
 * 
 * Centralized configuration values to avoid duplication.
 */

// Router URL
export const DEFAULT_ROUTER_URL = 'https://cap402.com';

// Documentation URLs
export const DOCS_BASE_URL = 'https://cap402.com/docs';
export const DOCS_SDK_URL = `${DOCS_BASE_URL}/sdk-docs.html`;
export const DOCS_API_URL = `${DOCS_BASE_URL}/api-docs.html`;

// Default timeouts (ms)
export const DEFAULT_TIMEOUT = 30000;
export const DEFAULT_RETRY_ATTEMPTS = 3;
export const DEFAULT_RETRY_DELAY = 1000;

// Trading defaults
export const DEFAULT_SLIPPAGE_BPS = 50; // 0.5%
export const DEFAULT_MAX_POSITION_SIZE = 10000;
export const DEFAULT_MAX_DAILY_TRADES = 50;
export const DEFAULT_MAX_SLIPPAGE_PERCENT = 1;

// Rate limits (per minute)
export const RATE_LIMITS = {
  prepareSwap: { max: 60, windowMs: 60000 },
  executeTrade: { max: 20, windowMs: 60000 },
  requestQuote: { max: 100, windowMs: 60000 },
  a2aInvoke: { max: 50, windowMs: 60000 },
  detectAlpha: { max: 30, windowMs: 60000 }
} as const;

// Large trade threshold for confirmation
export const LARGE_TRADE_THRESHOLD_USD = 500;

// Price check interval
export const DEFAULT_PRICE_CHECK_INTERVAL_MS = 30000;

// Quote expiry
export const DEFAULT_QUOTE_EXPIRY_MS = 60000;

// Confirmation expiry
export const DEFAULT_CONFIRMATION_EXPIRY_MS = 300000; // 5 minutes

/**
 * Get router URL from environment or default
 */
export function getRouterUrl(): string {
  return process.env.CAP402_ROUTER || DEFAULT_ROUTER_URL;
}
