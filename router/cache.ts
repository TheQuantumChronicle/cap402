import { memoryManager } from './memory-manager';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  hits: number;
}

class ResponseCache {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private defaultTTL = 30000; // 30 seconds
  private readonly MAX_ENTRIES = 1000;
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0
  };

  constructor() {
    // Register with memory manager
    memoryManager.register({
      name: 'response_cache',
      getSize: () => this.cache.size,
      cleanup: () => this.cleanup(),
      maxSize: this.MAX_ENTRIES
    });
  }

  set<T>(key: string, data: T, ttl?: number): void {
    // Enforce size limit
    if (this.cache.size >= this.MAX_ENTRIES) {
      this.evictLRU();
    }
    
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL,
      hits: 0
    });
  }
  
  /**
   * Evict least recently used entries
   */
  private evictLRU(): void {
    const entries = Array.from(this.cache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);
    
    // Remove oldest 20%
    const toRemove = Math.max(1, Math.floor(this.MAX_ENTRIES * 0.2));
    for (let i = 0; i < toRemove && i < entries.length; i++) {
      this.cache.delete(entries[i][0]);
      this.stats.evictions++;
    }
  }
  
  /**
   * Cleanup expired entries
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
        removed++;
      }
    }
    
    return removed;
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      return null;
    }
    
    const age = Date.now() - entry.timestamp;
    if (age > entry.ttl) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }
    
    // Track hit and update timestamp for LRU
    entry.hits++;
    entry.timestamp = Date.now();
    this.stats.hits++;
    
    return entry.data as T;
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    const age = Date.now() - entry.timestamp;
    if (age > entry.ttl) {
      this.cache.delete(key);
      return false;
    }
    
    return true;
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? Math.round(this.stats.hits / (this.stats.hits + this.stats.misses) * 100)
      : 0;
    
    return {
      size: this.cache.size,
      max_size: this.MAX_ENTRIES,
      hits: this.stats.hits,
      misses: this.stats.misses,
      evictions: this.stats.evictions,
      hit_rate_percent: hitRate,
      keys: Array.from(this.cache.keys())
    };
  }

  private cleanupInterval?: NodeJS.Timeout;

  // Cleanup expired entries periodically
  startCleanup(intervalMs: number = 60000): NodeJS.Timeout {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.cache.entries()) {
        if (now - entry.timestamp > entry.ttl) {
          this.cache.delete(key);
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
    this.cache.clear();
  }
}

export const responseCache = new ResponseCache();
