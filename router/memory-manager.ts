/**
 * Centralized Memory Manager
 * 
 * Monitors and manages memory across all modules:
 * - Enforces size limits on all Maps
 * - Periodic cleanup of stale data
 * - Memory usage monitoring
 * - Graceful degradation under pressure
 */

export interface MemoryStats {
  heap_used_mb: number;
  heap_total_mb: number;
  external_mb: number;
  rss_mb: number;
  usage_percent: number;
  collections: Record<string, number>;
}

interface ManagedCollection {
  name: string;
  getSize: () => number;
  cleanup: () => number; // Returns items removed
  maxSize: number;
}

class MemoryManager {
  private collections: Map<string, ManagedCollection> = new Map();
  private cleanupInterval?: NodeJS.Timeout;
  private readonly CHECK_INTERVAL_MS = 60000; // 60 seconds (was 30)
  private readonly MEMORY_THRESHOLD_PERCENT = 95; // Increased from 80 - Node.js naturally runs high
  private readonly CLEANUP_COOLDOWN_MS = 60000; // Don't spam cleanup more than once per minute
  private lastCleanup = 0;
  private cleanupStats = {
    total_cleanups: 0,
    items_removed: 0,
    last_cleanup_ms: 0
  };

  constructor() {
    this.startMonitoring();
  }

  /**
   * Register a collection for memory management
   */
  register(collection: ManagedCollection): void {
    this.collections.set(collection.name, collection);
  }

  /**
   * Get current memory statistics
   */
  getStats(): MemoryStats {
    const mem = process.memoryUsage();
    const collections: Record<string, number> = {};
    
    for (const [name, col] of this.collections) {
      collections[name] = col.getSize();
    }

    return {
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100,
      heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024 * 100) / 100,
      external_mb: Math.round(mem.external / 1024 / 1024 * 100) / 100,
      rss_mb: Math.round(mem.rss / 1024 / 1024 * 100) / 100,
      usage_percent: Math.round(mem.heapUsed / mem.heapTotal * 100),
      collections
    };
  }

  /**
   * Force cleanup of all collections
   */
  forceCleanup(): { items_removed: number; duration_ms: number } {
    const start = Date.now();
    let totalRemoved = 0;

    for (const [name, col] of this.collections) {
      try {
        const removed = col.cleanup();
        totalRemoved += removed;
        if (removed > 0) {
          console.log(`[MemoryManager] Cleaned ${removed} items from ${name}`);
        }
      } catch (e) {
        console.error(`[MemoryManager] Error cleaning ${name}:`, e);
      }
    }

    const duration = Date.now() - start;
    this.cleanupStats.total_cleanups++;
    this.cleanupStats.items_removed += totalRemoved;
    this.cleanupStats.last_cleanup_ms = duration;
    this.lastCleanup = Date.now();

    return { items_removed: totalRemoved, duration_ms: duration };
  }

  /**
   * Check if memory pressure is high
   */
  isUnderPressure(): boolean {
    const stats = this.getStats();
    return stats.usage_percent > this.MEMORY_THRESHOLD_PERCENT;
  }

  /**
   * Get cleanup statistics
   */
  getCleanupStats() {
    return {
      ...this.cleanupStats,
      last_cleanup_at: this.lastCleanup,
      registered_collections: this.collections.size
    };
  }

  private startMonitoring(): void {
    this.cleanupInterval = setInterval(() => {
      const stats = this.getStats();
      const now = Date.now();
      const timeSinceLastCleanup = now - this.lastCleanup;
      
      // Only log if actually concerning (over 95%)
      if (stats.usage_percent > 95) {
        console.log(`[MemoryManager] Memory usage: ${stats.usage_percent}% (${stats.heap_used_mb}MB / ${stats.heap_total_mb}MB)`);
      }

      // Force cleanup if under pressure AND cooldown has passed
      if (stats.usage_percent > this.MEMORY_THRESHOLD_PERCENT && timeSinceLastCleanup > this.CLEANUP_COOLDOWN_MS) {
        console.log(`[MemoryManager] High memory pressure detected, forcing cleanup...`);
        this.forceCleanup();
        
        // Try to trigger GC if available
        if (global.gc) {
          global.gc();
        }
      }

      // Check collection sizes (with cooldown)
      if (timeSinceLastCleanup > this.CLEANUP_COOLDOWN_MS) {
        for (const [name, col] of this.collections) {
          const size = col.getSize();
          if (size > col.maxSize * 0.95) {
            col.cleanup();
          }
        }
      }
    }, this.CHECK_INTERVAL_MS);

    this.cleanupInterval.unref();
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

export const memoryManager = new MemoryManager();

/**
 * Helper to create a size-limited Map with automatic cleanup
 */
export function createLimitedMap<K, V>(
  name: string,
  maxSize: number,
  getTimestamp: (value: V) => number,
  ttlMs?: number
): Map<K, V> & { cleanup: () => number } {
  const map = new Map<K, V>();
  
  const cleanup = (): number => {
    let removed = 0;
    const now = Date.now();
    
    // Remove expired items if TTL specified
    if (ttlMs) {
      for (const [key, value] of map) {
        if (now - getTimestamp(value) > ttlMs) {
          map.delete(key);
          removed++;
        }
      }
    }
    
    // Remove oldest items if over size limit
    if (map.size > maxSize) {
      const entries = Array.from(map.entries())
        .sort((a, b) => getTimestamp(a[1]) - getTimestamp(b[1]));
      
      const toRemove = map.size - Math.floor(maxSize * 0.8); // Remove 20%
      for (let i = 0; i < toRemove; i++) {
        map.delete(entries[i][0]);
        removed++;
      }
    }
    
    return removed;
  };

  // Register with memory manager
  memoryManager.register({
    name,
    getSize: () => map.size,
    cleanup,
    maxSize
  });

  // Add cleanup method to map
  (map as any).cleanup = cleanup;
  
  return map as Map<K, V> & { cleanup: () => number };
}
