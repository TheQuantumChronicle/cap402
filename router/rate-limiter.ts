interface RateLimitEntry {
  count: number;
  resetTime: number;
}

class RateLimiter {
  private limits: Map<string, RateLimitEntry> = new Map();
  private defaultLimit = 100;
  private defaultWindow = 60000;
  private readonly MAX_ENTRIES = 10000;
  private stats = { checks: 0, limited: 0, allowed: 0 };
  
  // Adaptive rate limiting
  private loadFactor = 1.0; // 1.0 = normal, <1.0 = under load
  private lastLoadCheck = Date.now();

  /**
   * Update load factor based on system metrics
   * Call this periodically or before critical operations
   */
  updateLoadFactor(memoryUsagePercent: number, avgLatencyMs: number): void {
    // Reduce limits when system is stressed
    if (memoryUsagePercent > 85 || avgLatencyMs > 1000) {
      this.loadFactor = 0.5; // Cut limits in half
    } else if (memoryUsagePercent > 70 || avgLatencyMs > 500) {
      this.loadFactor = 0.75;
    } else {
      this.loadFactor = 1.0;
    }
    this.lastLoadCheck = Date.now();
  }

  getLoadFactor(): number { return this.loadFactor; }

  checkLimit(identifier: string, limit?: number, windowMs?: number): boolean {
    this.stats.checks++;
    // Apply load factor to limit
    const maxRequests = Math.floor((limit || this.defaultLimit) * this.loadFactor);
    const window = windowMs || this.defaultWindow;
    const now = Date.now();
    
    let entry = this.limits.get(identifier);
    
    if (!entry || now > entry.resetTime) {
      if (this.limits.size >= this.MAX_ENTRIES) this.cleanupExpired();
      this.limits.set(identifier, { count: 1, resetTime: now + window });
      this.stats.allowed++;
      return true;
    }
    
    if (entry.count >= maxRequests) {
      this.stats.limited++;
      return false;
    }
    
    entry.count++;
    this.stats.allowed++;
    return true;
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.limits.entries()) {
      if (now > entry.resetTime) {
        this.limits.delete(key);
      }
    }
  }

  getRemainingRequests(identifier: string, limit?: number): number {
    const maxRequests = limit || this.defaultLimit;
    const entry = this.limits.get(identifier);
    
    if (!entry) return maxRequests;
    
    const now = Date.now();
    if (now > entry.resetTime) return maxRequests;
    
    return Math.max(0, maxRequests - entry.count);
  }

  getResetTime(identifier: string): number | null {
    const entry = this.limits.get(identifier);
    if (!entry) return null;
    
    const now = Date.now();
    if (now > entry.resetTime) return null;
    
    return entry.resetTime;
  }

  reset(identifier: string): void {
    this.limits.delete(identifier);
  }

  clear(): void {
    this.limits.clear();
  }

  private cleanupInterval?: NodeJS.Timeout;

  // Cleanup expired entries
  startCleanup(intervalMs: number = 60000): NodeJS.Timeout {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.limits.entries()) {
        if (now > entry.resetTime) {
          this.limits.delete(key);
        }
      }
    }, intervalMs);
    // Prevent timer from keeping process alive during tests
    this.cleanupInterval.unref();
    return this.cleanupInterval;
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.limits.clear();
  }

  getStats() {
    return {
      ...this.stats,
      active_limits: this.limits.size,
      load_factor: this.loadFactor,
      rejection_rate: this.stats.checks > 0 
        ? Math.round(this.stats.limited / this.stats.checks * 100) 
        : 0
    };
  }
}

export const rateLimiter = new RateLimiter();
