/**
 * Tests for Shared Utilities Module
 */

import {
  generateId,
  generateShortId,
  generateUUID,
  sha256,
  sha256Hex,
  hmacSha256,
  now,
  nowSeconds,
  isExpired,
  expiresIn,
  expiresInHours,
  isNonEmptyString,
  isPositiveNumber,
  isNonNegativeNumber,
  isValidPercentage,
  hasMinLength,
  safeDivide,
  safePercentage,
  clamp,
  deepClone,
  pick,
  omit,
  sleep,
  retry,
  withTimeout
} from '../utils';

describe('Shared Utilities', () => {
  describe('ID Generation', () => {
    it('should generate ID with prefix and timestamp', () => {
      const id = generateId('test');
      expect(id).toMatch(/^test_\d+_[a-f0-9]{8}$/);
    });

    it('should generate unique IDs', () => {
      const ids = new Set([generateId('tx'), generateId('tx'), generateId('tx')]);
      expect(ids.size).toBe(3);
    });

    it('should generate short ID without timestamp', () => {
      const id = generateShortId('agent');
      expect(id).toMatch(/^agent_[a-f0-9]{16}$/);
    });

    it('should generate valid UUID', () => {
      const uuid = generateUUID();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });
  });

  describe('Hashing', () => {
    it('should generate consistent SHA256 hash', () => {
      const hash1 = sha256('hello');
      const hash2 = sha256('hello');
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it('should generate different hashes for different inputs', () => {
      const hash1 = sha256('hello');
      const hash2 = sha256('world');
      expect(hash1).not.toBe(hash2);
    });

    it('should generate SHA256 with 0x prefix', () => {
      const hash = sha256Hex('test');
      expect(hash).toMatch(/^0x[a-f0-9]{64}$/);
    });

    it('should generate HMAC-SHA256', () => {
      const hmac = hmacSha256('data', 'secret');
      expect(hmac).toHaveLength(64);
    });
  });

  describe('Timestamps', () => {
    it('should return current timestamp in ms', () => {
      const before = Date.now();
      const timestamp = now();
      const after = Date.now();
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });

    it('should return current timestamp in seconds', () => {
      const seconds = nowSeconds();
      expect(seconds).toBe(Math.floor(Date.now() / 1000));
    });

    it('should correctly check expiration', () => {
      expect(isExpired(Date.now() - 1000)).toBe(true);
      expect(isExpired(Date.now() + 1000)).toBe(false);
    });

    it('should calculate expiration time', () => {
      const before = Date.now();
      const expires = expiresIn(5000);
      expect(expires).toBeGreaterThanOrEqual(before + 5000);
      expect(expires).toBeLessThanOrEqual(before + 5100);
    });

    it('should calculate expiration in hours', () => {
      const before = Date.now();
      const expires = expiresInHours(1);
      expect(expires).toBeGreaterThanOrEqual(before + 3600000);
    });
  });

  describe('Type Guards', () => {
    it('should validate non-empty strings', () => {
      expect(isNonEmptyString('hello')).toBe(true);
      expect(isNonEmptyString('')).toBe(false);
      expect(isNonEmptyString('   ')).toBe(false);
      expect(isNonEmptyString(null)).toBe(false);
      expect(isNonEmptyString(123)).toBe(false);
    });

    it('should validate positive numbers', () => {
      expect(isPositiveNumber(5)).toBe(true);
      expect(isPositiveNumber(0.1)).toBe(true);
      expect(isPositiveNumber(0)).toBe(false);
      expect(isPositiveNumber(-5)).toBe(false);
      expect(isPositiveNumber(NaN)).toBe(false);
      expect(isPositiveNumber('5')).toBe(false);
    });

    it('should validate non-negative numbers', () => {
      expect(isNonNegativeNumber(5)).toBe(true);
      expect(isNonNegativeNumber(0)).toBe(true);
      expect(isNonNegativeNumber(-5)).toBe(false);
      expect(isNonNegativeNumber(NaN)).toBe(false);
    });

    it('should validate percentages', () => {
      expect(isValidPercentage(50)).toBe(true);
      expect(isValidPercentage(0)).toBe(true);
      expect(isValidPercentage(100)).toBe(true);
      expect(isValidPercentage(-1)).toBe(false);
      expect(isValidPercentage(101)).toBe(false);
    });

    it('should validate array minimum length', () => {
      expect(hasMinLength([1, 2, 3], 2)).toBe(true);
      expect(hasMinLength([1], 2)).toBe(false);
      expect(hasMinLength([], 1)).toBe(false);
      expect(hasMinLength(null, 1)).toBe(false);
      expect(hasMinLength(undefined, 1)).toBe(false);
    });
  });

  describe('Safe Math', () => {
    it('should safely divide', () => {
      expect(safeDivide(10, 2)).toBe(5);
      expect(safeDivide(10, 0)).toBe(0);
      expect(safeDivide(10, 0, -1)).toBe(-1);
      expect(safeDivide(10, Infinity)).toBe(0);
    });

    it('should calculate safe percentage', () => {
      expect(safePercentage(50, 100)).toBe(50);
      expect(safePercentage(1, 3)).toBeCloseTo(33.33, 1);
      expect(safePercentage(10, 0)).toBe(0);
    });

    it('should clamp values', () => {
      expect(clamp(5, 0, 10)).toBe(5);
      expect(clamp(-5, 0, 10)).toBe(0);
      expect(clamp(15, 0, 10)).toBe(10);
    });
  });

  describe('Object Utilities', () => {
    it('should deep clone objects', () => {
      const original = { a: 1, b: { c: 2 } };
      const cloned = deepClone(original);
      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
      expect(cloned.b).not.toBe(original.b);
    });

    it('should pick specific keys', () => {
      const obj = { a: 1, b: 2, c: 3 };
      expect(pick(obj, ['a', 'c'])).toEqual({ a: 1, c: 3 });
    });

    it('should omit specific keys', () => {
      const obj = { a: 1, b: 2, c: 3 };
      expect(omit(obj, ['b'])).toEqual({ a: 1, c: 3 });
    });
  });

  describe('Async Utilities', () => {
    it('should sleep for specified duration', async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(45);
    });

    it('should retry failed operations', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 3) throw new Error('fail');
        return 'success';
      };

      const result = await retry(fn, { maxAttempts: 5, baseDelayMs: 10 });
      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('should throw after max retry attempts', async () => {
      const fn = async () => { throw new Error('always fails'); };
      
      await expect(retry(fn, { maxAttempts: 2, baseDelayMs: 10 }))
        .rejects.toThrow('always fails');
    });

    it('should timeout long operations', async () => {
      const slowFn = new Promise(resolve => setTimeout(() => resolve('done'), 1000));
      
      await expect(withTimeout(slowFn, 50, 'Too slow'))
        .rejects.toThrow('Too slow');
    });

    it('should complete fast operations within timeout', async () => {
      const fastFn = Promise.resolve('fast');
      const result = await withTimeout(fastFn, 1000);
      expect(result).toBe('fast');
    });
  });
});
