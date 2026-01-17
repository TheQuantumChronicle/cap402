import { priceProvider, PriceResult } from './price';
import { walletProvider, WalletSnapshot, SnapshotOptions } from './wallet';
import { birdEyeClient, BirdEyePriceUpdate, PriceUpdateCallback } from './birdeye-websocket';
import { solanaRPC, TokenMetadata, TransactionDetails } from './solana-rpc';

export interface IntegrationHealth {
  service: string;
  status: 'healthy' | 'degraded' | 'down';
  latency_ms?: number;
  last_check: number;
  error?: string;
}

type CacheEntry<T> = { data: T; ts: number };

class IntegrationManager {
  private health: Map<string, IntegrationHealth> = new Map();
  private cache: Map<string, CacheEntry<any>> = new Map();
  private inflight: Map<string, Promise<any>> = new Map();
  private readonly TTL = 5000;
  private readonly MAX_CACHE = 500;
  private stats = { requests: 0, hits: 0, coalesced: 0, errors: 0, batched: 0 };

  // Batch queue for optimizing multiple requests
  private batchQueue: Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }[]> = new Map();
  private batchTimer: NodeJS.Timeout | null = null;
  private readonly BATCH_DELAY = 50; // ms to wait for batch accumulation

  constructor() {
    setInterval(() => this.healthCheck(), 60000).unref();
    setInterval(() => this.gc(), 30000).unref();
    this.healthCheck();
  }

  /**
   * Generic cached request with coalescing
   * - Returns cached data if fresh
   * - Coalesces duplicate in-flight requests
   * - Auto-retries on failure
   */
  private async cachedRequest<T>(
    key: string,
    fetcher: () => Promise<T>,
    service: string,
    ttl = this.TTL
  ): Promise<T> {
    this.stats.requests++;

    // 1. Check cache
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.ts < ttl) {
      this.stats.hits++;
      return cached.data;
    }

    // 2. Coalesce duplicate in-flight requests
    const pending = this.inflight.get(key);
    if (pending) {
      this.stats.coalesced++;
      return pending;
    }

    // 3. Execute with auto-retry
    const promise = this.withRetry(fetcher, service).then(result => {
      this.cache.set(key, { data: result, ts: Date.now() });
      this.enforceLimit();
      return result;
    }).finally(() => this.inflight.delete(key));

    this.inflight.set(key, promise);
    return promise;
  }

  private async withRetry<T>(fn: () => Promise<T>, service: string, retries = 2): Promise<T> {
    for (let i = 1; i <= retries; i++) {
      try {
        const start = Date.now();
        const result = await fn();
        this.setHealth(service, 'healthy', Date.now() - start);
        return result;
      } catch (e) {
        if (i === retries) {
          this.stats.errors++;
          this.setHealth(service, 'down', 0, String(e));
          throw e;
        }
        await new Promise(r => setTimeout(r, 200 * i));
      }
    }
    throw new Error('Unreachable');
  }

  private enforceLimit(): void {
    if (this.cache.size <= this.MAX_CACHE) return;
    // Evict oldest 20%
    const entries = [...this.cache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    entries.slice(0, Math.floor(this.MAX_CACHE * 0.2)).forEach(([k]) => this.cache.delete(k));
  }

  private gc(): void {
    const cutoff = Date.now() - this.TTL * 2;
    for (const [k, v] of this.cache) if (v.ts < cutoff) this.cache.delete(k);
  }

  getStats() {
    const { requests, hits, coalesced, errors, batched } = this.stats;
    return {
      requests, hits, coalesced, errors, batched,
      hit_rate: requests ? Math.round(hits / requests * 100) : 0,
      cache_size: this.cache.size,
      inflight: this.inflight.size
    };
  }

  // Batch multiple price requests together
  async getBatchPrices(tokens: string[], quote = 'USD'): Promise<Map<string, PriceResult>> {
    const results = new Map<string, PriceResult>();
    const uncached: string[] = [];

    // Check cache first
    for (const token of tokens) {
      const cached = this.cache.get(`price:${token}:${quote}`);
      if (cached && Date.now() - cached.ts < this.TTL) {
        results.set(token, cached.data);
        this.stats.hits++;
      } else {
        uncached.push(token);
      }
    }

    // Fetch uncached in parallel
    if (uncached.length > 0) {
      this.stats.batched += uncached.length;
      const fetches = await Promise.allSettled(
        uncached.map(token => this.cachedRequest(`price:${token}:${quote}`, () => priceProvider.getPrice(token, quote), 'price-api'))
      );
      uncached.forEach((token, i) => {
        const result = fetches[i];
        if (result.status === 'fulfilled') results.set(token, result.value);
      });
    }

    return results;
  }

  // ============================================
  // PUBLIC API - Simplified & Consistent
  // ============================================

  async getPrice(token: string, quote = 'USD'): Promise<PriceResult> {
    return this.cachedRequest(
      `price:${token}:${quote}`,
      () => priceProvider.getPrice(token, quote),
      'price-api'
    );
  }

  async getWalletSnapshot(address: string, network = 'solana-mainnet', options: SnapshotOptions = { include_nfts: false, include_history: false }): Promise<WalletSnapshot> {
    const key = `wallet:${address}:${network}:${options.include_nfts}:${options.include_history}`;
    return this.cachedRequest(key, () => walletProvider.getSnapshot(address, network, options), 'wallet-api', 10000);
  }

  async getSolanaBalance(address: string): Promise<number> {
    return this.cachedRequest(`balance:${address}`, () => solanaRPC.getBalance(address), 'solana-rpc');
  }

  async getTokenMetadata(mint: string): Promise<TokenMetadata | null> {
    return this.cachedRequest(`meta:${mint}`, () => solanaRPC.getTokenMetadata(mint), 'solana-rpc', 60000);
  }

  async getTransaction(sig: string): Promise<TransactionDetails | null> {
    return this.cachedRequest(`tx:${sig}`, () => solanaRPC.getTransaction(sig), 'solana-rpc', 300000);
  }

  async getTransactionHistory(address: string, limit = 10): Promise<string[]> {
    return this.cachedRequest(`history:${address}:${limit}`, () => solanaRPC.getSignaturesForAddress(address, limit), 'solana-rpc', 30000);
  }

  // WebSocket subscriptions (not cached)
  async subscribeToPriceUpdates(token: string, cb: PriceUpdateCallback): Promise<void> {
    if (!birdEyeClient.isConnected()) await birdEyeClient.connect();
    birdEyeClient.subscribe(token, cb);
    this.setHealth('birdeye-ws', 'healthy');
  }

  unsubscribeFromPriceUpdates(token: string, cb: PriceUpdateCallback): void {
    birdEyeClient.unsubscribe(token, cb);
  }

  // Health API
  getHealthStatus(): IntegrationHealth[] { return [...this.health.values()]; }
  getServiceHealth(service: string): IntegrationHealth | undefined { return this.health.get(service); }

  private setHealth(service: string, status: 'healthy' | 'degraded' | 'down', latency_ms?: number, error?: string): void {
    this.health.set(service, { service, status, latency_ms, last_check: Date.now(), error });
  }

  private async healthCheck(): Promise<void> {
    await Promise.allSettled([
      this.withRetry(() => priceProvider.getPrice('SOL', 'USD'), 'price-api', 1).catch(() => {}),
      this.withRetry(() => solanaRPC.getRecentBlockhash(), 'solana-rpc', 1).catch(() => {}),
      Promise.resolve(this.setHealth('birdeye-ws', birdEyeClient.isConnected() ? 'healthy' : 'degraded'))
    ]);
  }

  async shutdown(): Promise<void> {
    birdEyeClient.disconnect();
  }
}

export const integrationManager = new IntegrationManager();
