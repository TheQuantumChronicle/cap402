/**
 * Shared Utilities Module
 * 
 * Centralized utilities for consistent patterns across the codebase:
 * - ID generation
 * - Hashing
 * - Timestamps
 * - Common type guards
 */

import * as crypto from 'crypto';

// ============================================
// ID GENERATION
// ============================================

/**
 * Generate a unique ID with a prefix
 * @param prefix - Prefix for the ID (e.g., 'tx', 'agent', 'order')
 * @param bytes - Number of random bytes (default: 4)
 */
export function generateId(prefix: string, bytes: number = 4): string {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(bytes).toString('hex')}`;
}

/**
 * Generate a short unique ID (no timestamp)
 */
export function generateShortId(prefix: string, bytes: number = 8): string {
  return `${prefix}_${crypto.randomBytes(bytes).toString('hex')}`;
}

/**
 * Generate a UUID v4
 */
export function generateUUID(): string {
  return crypto.randomUUID();
}

// ============================================
// HASHING
// ============================================

/**
 * Generate SHA256 hash of data
 */
export function sha256(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Generate SHA256 hash with 0x prefix
 */
export function sha256Hex(data: string | Buffer): string {
  return '0x' + sha256(data);
}

/**
 * Generate HMAC-SHA256
 */
export function hmacSha256(data: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

// ============================================
// TIMESTAMPS
// ============================================

/**
 * Get current timestamp in milliseconds
 */
export function now(): number {
  return Date.now();
}

/**
 * Get current timestamp in seconds (Unix epoch)
 */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Check if a timestamp has expired
 */
export function isExpired(expiresAt: number): boolean {
  return Date.now() > expiresAt;
}

/**
 * Get expiration timestamp from now
 * @param durationMs - Duration in milliseconds
 */
export function expiresIn(durationMs: number): number {
  return Date.now() + durationMs;
}

/**
 * Get expiration timestamp from hours
 */
export function expiresInHours(hours: number): number {
  return expiresIn(hours * 60 * 60 * 1000);
}

// ============================================
// TYPE GUARDS & VALIDATION
// ============================================

/**
 * Check if value is a non-empty string
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Check if value is a positive number
 */
export function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && value > 0 && !isNaN(value);
}

/**
 * Check if value is a non-negative number
 */
export function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && !isNaN(value);
}

/**
 * Check if value is a valid percentage (0-100)
 */
export function isValidPercentage(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 100;
}

/**
 * Check if array has minimum length
 */
export function hasMinLength<T>(arr: T[] | undefined | null, min: number): arr is T[] {
  return Array.isArray(arr) && arr.length >= min;
}

// ============================================
// SAFE MATH
// ============================================

/**
 * Safe division that returns 0 for division by zero
 */
export function safeDivide(numerator: number, denominator: number, fallback: number = 0): number {
  if (denominator === 0 || !isFinite(denominator)) return fallback;
  const result = numerator / denominator;
  return isFinite(result) ? result : fallback;
}

/**
 * Calculate percentage safely
 */
export function safePercentage(part: number, total: number): number {
  return safeDivide(part, total) * 100;
}

/**
 * Clamp a number between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// ============================================
// OBJECT UTILITIES
// ============================================

/**
 * Deep clone an object
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Pick specific keys from an object
 */
export function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Omit specific keys from an object
 */
export function omit<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result as Omit<T, K>;
}

// ============================================
// ASYNC UTILITIES
// ============================================

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry an async function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number } = {}
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 100, maxDelayMs = 5000 } = options;
  
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxAttempts) {
        const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

/**
 * Execute with timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string = 'Operation timed out'
): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
  });
  
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}
