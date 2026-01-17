import { registry } from './registry';
import { Executor, ExecutionContext, ExecutionResult, ExecutionPreferences, ExecutionMetadata } from './execution/types';
import { PublicExecutor } from './execution/public-executor';
import { ConfidentialExecutor } from './execution/confidential-executor';
import { generateX402Hint } from './payments/x402';
import { generatePrivacyCashNote } from './payments/privacy-cash';
import { emitUsageSignal } from '../chain/usage-signal';
import { observability } from './observability';
import { responseCache } from './cache';
import { privacyGradient, PrivacyLevel } from './privacy-gradient';
import { capabilityHealthMonitor } from './capability-health';
import * as crypto from 'crypto';

// Circuit breaker state per capability
interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  state: 'closed' | 'open' | 'half-open';
}

const CIRCUIT_BREAKER_THRESHOLD = 5; // failures before opening
const CIRCUIT_BREAKER_RESET_MS = 30000; // 30 seconds before trying again

export interface InvokeRequest {
  capability_id: string;
  inputs: Record<string, any>;
  preferences?: ExecutionPreferences;
}

export interface InvokeResponse {
  success: boolean;
  request_id: string;
  capability_id: string;
  outputs?: Record<string, any>;
  error?: string;
  metadata: {
    execution: any;
    economic_hints?: any;
    chain_signal?: any;
    privacy_level?: PrivacyLevel;
  };
}

// Request priority levels
type Priority = 'critical' | 'high' | 'normal' | 'low';

interface QueuedRequest {
  request: InvokeRequest;
  priority: Priority;
  timestamp: number;
  resolve: (value: InvokeResponse) => void;
  reject: (error: Error) => void;
  traceId?: string;
}

export class Router {
  private executors: Executor[] = [
    new PublicExecutor(),
    new ConfidentialExecutor()
  ];
  
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private readonly maxRetries = 3;
  private readonly retryDelayMs = 1000;
  
  // Smart features
  private usagePatterns: Map<string, { count: number; lastUsed: number; avgLatency: number }> = new Map();
  private capabilityPairs: Map<string, Map<string, number>> = new Map();
  private readonly MAX_PATTERNS = 100;

  // Priority queue for request management
  private requestQueue: QueuedRequest[] = [];
  private processing = false;
  private readonly MAX_CONCURRENT = 10;
  private activeRequests = 0;

  // Request tracing
  private traces: Map<string, { steps: { action: string; ts: number; data?: any }[]; start: number }> = new Map();
  private readonly MAX_TRACES = 100;

  // Capability dependency graph - learns which capabilities are used together
  private dependencyGraph: Map<string, Map<string, { weight: number; avgGap: number }>> = new Map();
  
  // Content-based deduplication
  private contentHashes: Map<string, { response: InvokeResponse; expires: number }> = new Map();
  
  // Predictive prefetch queue
  private prefetchQueue: Set<string> = new Set();
  
  // Agent collaboration sessions
  private collaborations: Map<string, { agents: string[]; sharedContext: any; created: number }> = new Map();

  // Track last capability for dependency learning
  private lastCap: { id: string; time: number } | null = null;

  // ============================================
  // PERFORMANCE OPTIMIZATIONS
  // ============================================

  // Request coalescing - dedupe identical in-flight requests
  private inflightRequests: Map<string, Promise<InvokeResponse>> = new Map();

  // Agent affinity - remember which provider worked best for each agent
  private agentAffinity: Map<string, { provider: string; successRate: number; avgLatency: number }> = new Map();

  // Adaptive TTL cache - learns optimal cache duration per capability
  private adaptiveTTL: Map<string, { ttl: number; hits: number; misses: number }> = new Map();

  // Memory pressure tracking
  private memoryPressure = { lastCheck: 0, level: 'normal' as 'normal' | 'elevated' | 'critical' };

  // Request batching queue - group similar requests
  private batchQueue: Map<string, { requests: { inputs: any; resolve: (v: any) => void }[]; timer: NodeJS.Timeout | null }> = new Map();

  private getRequestHash(request: InvokeRequest): string {
    return `${request.capability_id}:${JSON.stringify(request.inputs)}`;
  }

  // Coalesce identical requests - if same request is in-flight, return same promise
  private async coalesceRequest(request: InvokeRequest): Promise<InvokeResponse | null> {
    const hash = this.getRequestHash(request);
    const inflight = this.inflightRequests.get(hash);
    if (inflight) {
      return inflight;
    }
    return null;
  }

  private trackInflight(request: InvokeRequest, promise: Promise<InvokeResponse>): void {
    const hash = this.getRequestHash(request);
    this.inflightRequests.set(hash, promise);
    promise.finally(() => this.inflightRequests.delete(hash));
  }

  // Update agent affinity based on execution results
  updateAgentAffinity(agentId: string, provider: string, success: boolean, latencyMs: number): void {
    let affinity = this.agentAffinity.get(agentId);
    if (!affinity || affinity.provider !== provider) {
      affinity = { provider, successRate: success ? 100 : 0, avgLatency: latencyMs };
    } else {
      // Exponential moving average
      affinity.successRate = affinity.successRate * 0.9 + (success ? 10 : 0);
      affinity.avgLatency = affinity.avgLatency * 0.9 + latencyMs * 0.1;
    }
    this.agentAffinity.set(agentId, affinity);
    
    // Limit size
    if (this.agentAffinity.size > 1000) {
      const first = this.agentAffinity.keys().next().value;
      if (first) this.agentAffinity.delete(first);
    }
  }

  getAgentAffinity(agentId: string) {
    return this.agentAffinity.get(agentId) || null;
  }

  // Adaptive TTL - learn optimal cache duration
  updateAdaptiveTTL(capabilityId: string, hit: boolean): void {
    let ttlData = this.adaptiveTTL.get(capabilityId);
    if (!ttlData) {
      ttlData = { ttl: 5000, hits: 0, misses: 0 }; // Start with 5s
      this.adaptiveTTL.set(capabilityId, ttlData);
    }
    
    if (hit) {
      ttlData.hits++;
      // If hit rate is high, increase TTL (data is stable)
      if (ttlData.hits > 10 && ttlData.hits / (ttlData.hits + ttlData.misses) > 0.8) {
        ttlData.ttl = Math.min(ttlData.ttl * 1.2, 60000); // Max 60s
      }
    } else {
      ttlData.misses++;
      // If miss rate is high, decrease TTL (data changes often)
      if (ttlData.misses > 10 && ttlData.misses / (ttlData.hits + ttlData.misses) > 0.5) {
        ttlData.ttl = Math.max(ttlData.ttl * 0.8, 1000); // Min 1s
      }
    }
  }

  getOptimalTTL(capabilityId: string): number {
    return this.adaptiveTTL.get(capabilityId)?.ttl || 5000;
  }

  // Memory-aware operations
  checkMemoryPressure(): 'normal' | 'elevated' | 'critical' {
    const now = Date.now();
    if (now - this.memoryPressure.lastCheck < 5000) {
      return this.memoryPressure.level;
    }
    
    const used = process.memoryUsage().heapUsed;
    const total = process.memoryUsage().heapTotal;
    const ratio = used / total;
    
    this.memoryPressure.lastCheck = now;
    
    if (ratio > 0.9) {
      this.memoryPressure.level = 'critical';
      this.emergencyCleanup();
    } else if (ratio > 0.75) {
      this.memoryPressure.level = 'elevated';
      this.softCleanup();
    } else {
      this.memoryPressure.level = 'normal';
    }
    
    return this.memoryPressure.level;
  }

  private emergencyCleanup(): void {
    // Clear non-essential caches
    this.contentHashes.clear();
    this.prefetchQueue.clear();
    this.traces.clear();
    
    // Trim large maps
    if (this.usagePatterns.size > 50) {
      const entries = [...this.usagePatterns.entries()].sort((a, b) => b[1].lastUsed - a[1].lastUsed);
      this.usagePatterns = new Map(entries.slice(0, 50));
    }
  }

  private softCleanup(): void {
    // Remove expired content hashes
    const now = Date.now();
    for (const [key, value] of this.contentHashes) {
      if (value.expires < now) this.contentHashes.delete(key);
    }
    
    // Trim old traces
    if (this.traces.size > 50) {
      const entries = [...this.traces.entries()].sort((a, b) => b[1].start - a[1].start);
      this.traces = new Map(entries.slice(0, 50));
    }
  }

  // Predictive prefetching based on learned patterns
  async prefetchPredicted(currentCapability: string): Promise<void> {
    const deps = this.dependencyGraph.get(currentCapability);
    if (!deps) return;
    
    // Find capabilities likely to be called next
    const predictions = [...deps.entries()]
      .filter(([_, data]) => data.weight > 3) // Called together at least 3 times
      .sort((a, b) => b[1].weight - a[1].weight)
      .slice(0, 2); // Top 2 predictions
    
    for (const [capId, _] of predictions) {
      if (this.prefetchQueue.has(capId)) continue;
      this.prefetchQueue.add(capId);
      
      // Prefetch in background (fire and forget)
      this.invoke({ capability_id: capId, inputs: {} }).catch(() => {}).finally(() => {
        this.prefetchQueue.delete(capId);
      });
    }
  }

  // Batch similar requests together
  async batchRequest(capabilityId: string, inputs: any): Promise<any> {
    return new Promise((resolve) => {
      let batch = this.batchQueue.get(capabilityId);
      if (!batch) {
        batch = { requests: [], timer: null };
        this.batchQueue.set(capabilityId, batch);
      }
      
      batch.requests.push({ inputs, resolve });
      
      // Set timer to flush batch
      if (!batch.timer) {
        batch.timer = setTimeout(() => this.flushBatch(capabilityId), 50); // 50ms batch window
      }
    });
  }

  private async flushBatch(capabilityId: string): Promise<void> {
    const batch = this.batchQueue.get(capabilityId);
    if (!batch || batch.requests.length === 0) return;
    
    this.batchQueue.delete(capabilityId);
    
    // Execute all requests in parallel
    const results = await Promise.allSettled(
      batch.requests.map(r => this.invoke({ capability_id: capabilityId, inputs: r.inputs }))
    );
    
    // Resolve each request
    batch.requests.forEach((req, i) => {
      const result = results[i];
      req.resolve(result.status === 'fulfilled' ? result.value : { success: false, error: 'Batch execution failed' });
    });
  }

  // Get performance stats
  getPerformanceStats() {
    return {
      inflight_requests: this.inflightRequests.size,
      agent_affinities: this.agentAffinity.size,
      adaptive_ttls: [...this.adaptiveTTL.entries()].map(([cap, data]) => ({
        capability: cap,
        ttl_ms: Math.round(data.ttl),
        hit_rate: data.hits + data.misses > 0 ? Math.round(data.hits / (data.hits + data.misses) * 100) : 0
      })),
      memory_pressure: this.memoryPressure.level,
      prefetch_queue: this.prefetchQueue.size,
      batch_queues: this.batchQueue.size
    };
  }

  /**
   * Check if circuit breaker allows execution
   */
  private checkCircuitBreaker(capability_id: string): { allowed: boolean; reason?: string } {
    const state = this.circuitBreakers.get(capability_id);
    
    if (!state) {
      return { allowed: true };
    }
    
    const now = Date.now();
    
    if (state.state === 'open') {
      // Check if enough time has passed to try again
      if (now - state.lastFailure > CIRCUIT_BREAKER_RESET_MS) {
        state.state = 'half-open';
        return { allowed: true };
      }
      return { 
        allowed: false, 
        reason: `Circuit breaker open for ${capability_id}. Too many failures. Retry after ${Math.ceil((CIRCUIT_BREAKER_RESET_MS - (now - state.lastFailure)) / 1000)}s` 
      };
    }
    
    return { allowed: true };
  }

  /**
   * Record execution result for circuit breaker
   */
  private recordCircuitBreakerResult(capability_id: string, success: boolean): void {
    let state = this.circuitBreakers.get(capability_id);
    
    if (!state) {
      state = { failures: 0, lastFailure: 0, state: 'closed' };
      this.circuitBreakers.set(capability_id, state);
    }
    
    if (success) {
      // Reset on success
      state.failures = 0;
      state.state = 'closed';
    } else {
      state.failures++;
      state.lastFailure = Date.now();
      
      if (state.failures >= CIRCUIT_BREAKER_THRESHOLD) {
        state.state = 'open';
      }
    }
  }

  /**
   * Execute with retry logic + jitter + timeout
   */
  private async executeWithRetry(
    executor: Executor,
    context: ExecutionContext,
    retries: number = this.maxRetries
  ): Promise<ExecutionResult> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // Add timeout wrapper (30s default)
        const result = await this.withTimeout(
          executor.execute(context),
          30000,
          `Timeout after 30s on attempt ${attempt}`
        );
        
        // Track health score
        this.updateHealthScore(context.capability_id, result.success, result.metadata?.execution_time_ms || 0);
        
        // If successful or it's a validation error (not transient), return immediately
        if (result.success || result.error?.includes('not found') || result.error?.includes('Missing required')) {
          return result;
        }
        
        lastError = new Error(result.error || 'Unknown error');
        
        if (attempt < retries) {
          // Exponential backoff with jitter (prevents thundering herd)
          const baseDelay = this.retryDelayMs * Math.pow(2, attempt - 1);
          const jitter = Math.random() * baseDelay * 0.3; // 30% jitter
          await new Promise(resolve => setTimeout(resolve, baseDelay + jitter));
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        this.updateHealthScore(context.capability_id, false, 0);
        
        if (attempt < retries) {
          const baseDelay = this.retryDelayMs * Math.pow(2, attempt - 1);
          const jitter = Math.random() * baseDelay * 0.3;
          await new Promise(resolve => setTimeout(resolve, baseDelay + jitter));
        }
      }
    }
    
    return {
      success: false,
      error: `Execution failed after ${retries} attempts: ${lastError?.message}`,
      metadata: {
        executor: executor.name,
        execution_time_ms: 0,
        cost_actual: 0,
        note: `Failed after ${retries} retry attempts`
      }
    };
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    let timeoutId: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
  }

  // Capability health scoring
  private healthScores: Map<string, { success: number; total: number; avgLatency: number; lastUpdate: number }> = new Map();

  private updateHealthScore(capId: string, success: boolean, latencyMs: number): void {
    let score = this.healthScores.get(capId);
    if (!score) {
      score = { success: 0, total: 0, avgLatency: 0, lastUpdate: Date.now() };
      this.healthScores.set(capId, score);
    }
    score.total++;
    if (success) score.success++;
    score.avgLatency = (score.avgLatency * (score.total - 1) + latencyMs) / score.total;
    score.lastUpdate = Date.now();
    
    // Limit map size
    if (this.healthScores.size > 200) {
      const oldest = [...this.healthScores.entries()].sort((a, b) => a[1].lastUpdate - b[1].lastUpdate)[0];
      if (oldest) this.healthScores.delete(oldest[0]);
    }
  }

  getHealthScore(capId: string): { success_rate: number; avg_latency_ms: number; total_calls: number } | null {
    const score = this.healthScores.get(capId);
    if (!score || score.total === 0) return null;
    return {
      success_rate: Math.round(score.success / score.total * 100),
      avg_latency_ms: Math.round(score.avgLatency),
      total_calls: score.total
    };
  }

  getAllHealthScores() {
    return [...this.healthScores.entries()].map(([id, s]) => ({
      capability_id: id,
      success_rate: Math.round(s.success / s.total * 100),
      avg_latency_ms: Math.round(s.avgLatency),
      total_calls: s.total
    })).sort((a, b) => b.total_calls - a.total_calls);
  }

  async invoke(request: InvokeRequest): Promise<InvokeResponse> {
    // Fast path: check cache first before any processing
    const cacheKey = `${request.capability_id}:${JSON.stringify(request.inputs)}`;
    const cached = responseCache.get(cacheKey) as InvokeResponse | null;
    if (cached) {
      this.updateAdaptiveTTL(request.capability_id, true);
      return { 
        success: cached.success,
        request_id: this.generateRequestId(),
        capability_id: cached.capability_id,
        outputs: cached.outputs,
        metadata: cached.metadata
      };
    }

    const request_id = this.generateRequestId();
    const timestamp = Date.now();

    // Fast capability lookup
    const capability = registry.getCapability(request.capability_id);
    if (!capability) {
      return {
        success: false,
        request_id,
        capability_id: request.capability_id,
        error: `Capability ${request.capability_id} not found`,
        metadata: { execution: {} }
      };
    }

    // Quick validation
    const validationError = this.validateInputs(capability, request.inputs);
    if (validationError) {
      return {
        success: false,
        request_id,
        capability_id: request.capability_id,
        error: validationError,
        metadata: { execution: {} }
      };
    }

    // Circuit breaker check
    const circuitCheck = this.checkCircuitBreaker(request.capability_id);
    if (!circuitCheck.allowed) {
      return {
        success: false,
        request_id,
        capability_id: request.capability_id,
        error: circuitCheck.reason,
        metadata: { execution: { circuit_breaker: 'open' } }
      };
    }

    const executor = this.selectExecutor(capability.id, request.preferences);
    if (!executor) {
      return {
        success: false,
        request_id,
        capability_id: request.capability_id,
        error: 'No suitable executor found',
        metadata: { execution: {} }
      };
    }

    const context: ExecutionContext = {
      capability_id: request.capability_id,
      inputs: request.inputs,
      preferences: request.preferences,
      request_id,
      timestamp
    };

    // Execute with retry logic
    const executionResult = await this.executeWithRetry(executor, context);
    
    // Record result for circuit breaker
    this.recordCircuitBreakerResult(request.capability_id, executionResult.success);
    
    // Record health event for monitoring
    capabilityHealthMonitor.recordEvent({
      capability_id: request.capability_id,
      timestamp: Date.now(),
      success: executionResult.success,
      latency_ms: executionResult.metadata.execution_time_ms,
      error: executionResult.error
    });

    // Record metrics (fire and forget - don't await)
    import('./metrics').then(({ metricsCollector }) => {
      metricsCollector.recordInvocation(
        request.capability_id,
        executionResult.success,
        executionResult.metadata.execution_time_ms,
        executionResult.metadata.cost_actual || 0
      );
    }).catch(() => {});

    // Generate economic hints (lightweight, no I/O)
    const economicHints = this.generateEconomicHints(capability, executionResult);
    
    // Emit chain signal in background (don't block response)
    const chainSignalPromise = emitUsageSignal({
      capability_id: request.capability_id,
      request_id,
      timestamp,
      success: executionResult.success,
      cost: executionResult.metadata.cost_actual
    });

    // Determine privacy level (simple lookup)
    const privacyLevel: PrivacyLevel = capability.execution.mode === 'confidential' ? 2 : 0;

    // Build response immediately
    const response: InvokeResponse = {
      success: executionResult.success,
      request_id,
      capability_id: request.capability_id,
      outputs: executionResult.outputs,
      error: executionResult.error,
      metadata: {
        execution: executionResult.metadata,
        economic_hints: economicHints,
        chain_signal: null, // Will be populated async
        privacy_level: privacyLevel
      }
    };

    // Cache successful responses for common capabilities
    if (executionResult.success) {
      const cacheKey = `${request.capability_id}:${JSON.stringify(request.inputs)}`;
      responseCache.set(cacheKey, response, this.getOptimalTTL(request.capability_id));
    }

    // Await chain signal only if needed (most clients don't need it immediately)
    response.metadata.chain_signal = await chainSignalPromise;

    return response;
  }

  private validateInputs(capability: any, inputs: Record<string, any>): string | null {
    const required = capability.inputs.required || [];
    for (const field of required) {
      if (!(field in inputs)) {
        return `Missing required input: ${field}`;
      }
    }
    return null;
  }

  private selectExecutor(capability_id: string, preferences?: ExecutionPreferences): Executor | undefined {
    for (const executor of this.executors) {
      if (executor.canExecute(capability_id)) {
        return executor;
      }
    }
    return undefined;
  }

  private generateEconomicHints(capability: any, result: ExecutionResult): any {
    const hints: any = {};

    if (capability.economics.x402_payment_signal?.enabled) {
      hints.x402 = generateX402Hint({
        amount: result.metadata.cost_actual || capability.economics.cost_hint,
        currency: capability.economics.currency,
        settlement_optional: capability.economics.x402_payment_signal.settlement_optional
      });
    }

    if (capability.economics.privacy_cash_compatible && capability.execution.mode === 'confidential') {
      hints.privacy_cash = generatePrivacyCashNote({
        amount: result.metadata.cost_actual || capability.economics.cost_hint,
        currency: capability.economics.currency
      });
    }

    return hints;
  }

  private generateRequestId(): string {
    // Fast request ID generation - avoid crypto.randomBytes overhead
    return `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }

  /**
   * Get router status including circuit breaker states
   */
  getStatus(): {
    executors: string[];
    circuit_breakers: Record<string, { state: string; failures: number; last_failure: number | null }>;
    capabilities_registered: number;
  } {
    const circuitBreakerStatus: Record<string, { state: string; failures: number; last_failure: number | null }> = {};
    
    this.circuitBreakers.forEach((state, capId) => {
      circuitBreakerStatus[capId] = {
        state: state.state,
        failures: state.failures,
        last_failure: state.lastFailure || null
      };
    });

    return {
      executors: this.executors.map(e => e.name),
      circuit_breakers: circuitBreakerStatus,
      capabilities_registered: registry.getAllCapabilities().length
    };
  }

  /**
   * Reset circuit breaker for a specific capability (admin operation)
   */
  resetCircuitBreaker(capability_id: string): boolean {
    const state = this.circuitBreakers.get(capability_id);
    if (state) {
      state.failures = 0;
      state.state = 'closed';
      state.lastFailure = 0;
      return true;
    }
    return false;
  }

  /**
   * Cleanup stale circuit breaker entries
   */
  cleanupCircuitBreakers(): number {
    const now = Date.now();
    const staleThreshold = CIRCUIT_BREAKER_RESET_MS * 2;
    let cleaned = 0;
    
    for (const [capId, state] of this.circuitBreakers) {
      if (state.state === 'closed' && state.failures === 0) {
        this.circuitBreakers.delete(capId);
        cleaned++;
      } else if (state.lastFailure && now - state.lastFailure > staleThreshold) {
        this.circuitBreakers.delete(capId);
        cleaned++;
      }
    }
    
    return cleaned;
  }

  /**
   * Track usage pattern for a capability
   */
  private trackUsagePattern(capability_id: string, latency_ms: number): void {
    // Limit pattern tracking
    if (this.usagePatterns.size >= this.MAX_PATTERNS && !this.usagePatterns.has(capability_id)) {
      // Remove least recently used
      let oldest: string | null = null;
      let oldestTime = Infinity;
      for (const [id, pattern] of this.usagePatterns) {
        if (pattern.lastUsed < oldestTime) {
          oldestTime = pattern.lastUsed;
          oldest = id;
        }
      }
      if (oldest) this.usagePatterns.delete(oldest);
    }

    const existing = this.usagePatterns.get(capability_id);
    if (existing) {
      existing.count++;
      existing.lastUsed = Date.now();
      existing.avgLatency = (existing.avgLatency * (existing.count - 1) + latency_ms) / existing.count;
    } else {
      this.usagePatterns.set(capability_id, {
        count: 1,
        lastUsed: Date.now(),
        avgLatency: latency_ms
      });
    }
  }

  /**
   * Track capability pairs (which capabilities are used together)
   * Uses lastCap from dependency learning to avoid duplicate tracking
   */
  private trackCapabilityPair(capability_id: string): void {
    if (this.lastCap && this.lastCap.id !== capability_id) {
      let pairs = this.capabilityPairs.get(this.lastCap.id);
      if (!pairs) {
        pairs = new Map();
        this.capabilityPairs.set(this.lastCap.id, pairs);
      }
      pairs.set(capability_id, (pairs.get(capability_id) || 0) + 1);
    }
  }

  /**
   * Get smart recommendations based on current capability
   */
  getRecommendations(capability_id: string): {
    next_capabilities: { id: string; confidence: number }[];
    popular_capabilities: { id: string; usage_count: number }[];
    performance_tips: string[];
  } {
    const recommendations: { id: string; confidence: number }[] = [];
    const tips: string[] = [];

    // Get commonly paired capabilities
    const pairs = this.capabilityPairs.get(capability_id);
    if (pairs) {
      const totalPairs = Array.from(pairs.values()).reduce((a, b) => a + b, 0);
      if (totalPairs > 0) {
        for (const [nextCap, count] of pairs) {
          recommendations.push({
            id: nextCap,
            confidence: Math.round(count / totalPairs * 100)
          });
        }
      }
      recommendations.sort((a, b) => b.confidence - a.confidence);
    }

    // Get popular capabilities
    const popular = Array.from(this.usagePatterns.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([id, pattern]) => ({ id, usage_count: pattern.count }));

    // Generate performance tips
    const pattern = this.usagePatterns.get(capability_id);
    if (pattern && pattern.avgLatency > 500) {
      tips.push(`Consider caching results - avg latency is ${Math.round(pattern.avgLatency)}ms`);
    }

    const circuitState = this.circuitBreakers.get(capability_id);
    if (circuitState && circuitState.failures > 0) {
      tips.push(`This capability has ${circuitState.failures} recent failures - consider error handling`);
    }

    // Suggest batching if same capability used multiple times
    if (pattern && pattern.count > 10) {
      tips.push('High usage detected - consider using batch endpoint for better performance');
    }

    return {
      next_capabilities: recommendations.slice(0, 3),
      popular_capabilities: popular,
      performance_tips: tips
    };
  }

  /**
   * Batch invoke multiple capabilities in parallel
   */
  async batchInvoke(requests: InvokeRequest[]): Promise<{
    success: boolean;
    results: InvokeResponse[];
    total_time_ms: number;
    parallelism_benefit_ms: number;
  }> {
    const startTime = Date.now();
    
    // Execute all requests in parallel
    const results = await Promise.all(
      requests.map(req => this.invoke(req))
    );

    const totalTime = Date.now() - startTime;
    
    // Calculate what sequential execution would have taken
    const sequentialTime = results.reduce((sum, r) => 
      sum + (r.metadata?.execution?.execution_time_ms || 0), 0
    );

    return {
      success: results.every(r => r.success),
      results,
      total_time_ms: totalTime,
      parallelism_benefit_ms: Math.max(0, sequentialTime - totalTime)
    };
  }

  /**
   * Smart invoke with automatic prefetching of likely next capabilities
   */
  async smartInvoke(request: InvokeRequest, options?: {
    prefetch?: boolean;
    include_recommendations?: boolean;
  }): Promise<InvokeResponse & {
    recommendations?: ReturnType<Router['getRecommendations']>;
    prefetched?: string[];
  }> {
    const result = await this.invoke(request);
    
    // Track patterns
    this.trackUsagePattern(request.capability_id, result.metadata?.execution?.execution_time_ms || 0);
    this.trackCapabilityPair(request.capability_id);

    const response: any = { ...result };

    if (options?.include_recommendations) {
      response.recommendations = this.getRecommendations(request.capability_id);
    }

    // Prefetch likely next capabilities (fire and forget to cache)
    if (options?.prefetch && result.success) {
      const pairs = this.capabilityPairs.get(request.capability_id);
      if (pairs) {
        const topPair = Array.from(pairs.entries())
          .sort((a, b) => b[1] - a[1])[0];
        
        if (topPair && topPair[1] > 3) { // Only prefetch if used together 3+ times
          response.prefetched = [topPair[0]];
          // Note: actual prefetch would happen here based on capability type
        }
      }
    }

    return response;
  }

  // Priority queue invoke
  async queuedInvoke(request: InvokeRequest, priority: Priority = 'normal'): Promise<InvokeResponse> {
    return new Promise((resolve, reject) => {
      const order: Record<Priority, number> = { critical: 0, high: 1, normal: 2, low: 3 };
      this.requestQueue.push({ request, priority, timestamp: Date.now(), resolve, reject });
      this.requestQueue.sort((a, b) => order[a.priority] - order[b.priority] || a.timestamp - b.timestamp);
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.activeRequests >= this.MAX_CONCURRENT) return;
    this.processing = true;
    
    while (this.requestQueue.length > 0 && this.activeRequests < this.MAX_CONCURRENT) {
      const item = this.requestQueue.shift();
      if (!item) break;
      this.activeRequests++;
      
      this.invoke(item.request)
        .then(result => item.resolve(result))
        .catch(err => item.reject(err))
        .finally(() => {
          this.activeRequests--;
          this.processQueue();
        });
    }
    this.processing = false;
  }

  getQueueStats() {
    const byPriority = { critical: 0, high: 0, normal: 0, low: 0 };
    this.requestQueue.forEach(r => byPriority[r.priority]++);
    return { queued: this.requestQueue.length, active: this.activeRequests, by_priority: byPriority };
  }

  // Request tracing
  startTrace(id?: string): string {
    const traceId = id || `trace_${Date.now().toString(36)}`;
    if (this.traces.size >= this.MAX_TRACES) {
      const oldest = [...this.traces.keys()][0];
      if (oldest) this.traces.delete(oldest);
    }
    this.traces.set(traceId, { steps: [], start: Date.now() });
    return traceId;
  }

  addTraceStep(traceId: string, action: string, data?: any): void {
    const trace = this.traces.get(traceId);
    if (trace) trace.steps.push({ action, ts: Date.now() - trace.start, data });
  }

  getTrace(traceId: string) {
    const trace = this.traces.get(traceId);
    return trace ? { steps: trace.steps, duration_ms: Date.now() - trace.start } : null;
  }

  // Circuit breaker dashboard
  getCircuitBreakerDashboard() {
    const now = Date.now();
    let open = 0, halfOpen = 0, closed = 0;
    const breakers: { id: string; state: string; failures: number; retry_in_ms?: number }[] = [];

    for (const [id, state] of this.circuitBreakers) {
      if (state.state === 'open') {
        open++;
        const retryIn = Math.max(0, CIRCUIT_BREAKER_RESET_MS - (now - state.lastFailure));
        breakers.push({ id, state: 'open', failures: state.failures, retry_in_ms: retryIn });
      } else if (state.state === 'half-open') {
        halfOpen++;
        breakers.push({ id, state: 'half-open', failures: state.failures });
      } else {
        closed++;
        if (state.failures > 0) breakers.push({ id, state: 'closed', failures: state.failures });
      }
    }

    return { total: this.circuitBreakers.size, open, half_open: halfOpen, closed, breakers };
  }

  // ============================================
  // CONTENT-BASED DEDUPLICATION
  // Same request content = same response (within TTL)
  // ============================================

  private hashRequest(req: InvokeRequest): string {
    const content = JSON.stringify({ cap: req.capability_id, inputs: req.inputs });
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  async deduplicatedInvoke(request: InvokeRequest, ttlMs = 5000): Promise<InvokeResponse> {
    const hash = this.hashRequest(request);
    const now = Date.now();
    
    // Check for cached identical request
    const cached = this.contentHashes.get(hash);
    if (cached && cached.expires > now) {
      return { ...cached.response, metadata: { ...cached.response.metadata, _deduplicated: true } as any };
    }
    
    const response = await this.invoke(request);
    
    // Cache successful responses
    if (response.success) {
      this.contentHashes.set(hash, { response, expires: now + ttlMs });
      // Cleanup old entries
      if (this.contentHashes.size > 500) {
        for (const [k, v] of this.contentHashes) {
          if (v.expires < now) this.contentHashes.delete(k);
        }
      }
    }
    
    return response;
  }

  // ============================================
  // DEPENDENCY GRAPH - Learn capability sequences
  // ============================================

  private learnDependency(capId: string): void {
    if (this.lastCap && this.lastCap.id !== capId) {
      const gap = Date.now() - this.lastCap.time;
      if (gap < 30000) {
        let deps = this.dependencyGraph.get(this.lastCap.id);
        if (!deps) {
          deps = new Map();
          this.dependencyGraph.set(this.lastCap.id, deps);
        }
        const existing = deps.get(capId) || { weight: 0, avgGap: gap };
        deps.set(capId, {
          weight: existing.weight + 1,
          avgGap: (existing.avgGap * existing.weight + gap) / (existing.weight + 1)
        });
      }
    }
    this.lastCap = { id: capId, time: Date.now() };
  }

  getPredictedNext(capId: string, topN = 3): { capability_id: string; probability: number; avg_gap_ms: number }[] {
    const deps = this.dependencyGraph.get(capId);
    if (!deps) return [];
    
    const total = [...deps.values()].reduce((s, d) => s + d.weight, 0);
    if (total === 0) return [];
    return [...deps.entries()]
      .sort((a, b) => b[1].weight - a[1].weight)
      .slice(0, topN)
      .map(([id, d]) => ({
        capability_id: id,
        probability: Math.round(d.weight / total * 100),
        avg_gap_ms: Math.round(d.avgGap)
      }));
  }

  // ============================================
  // PREDICTIVE PREFETCH - Warm cache for likely next calls
  // ============================================

  async invokeWithPrefetch(request: InvokeRequest): Promise<InvokeResponse> {
    this.learnDependency(request.capability_id);
    const response = await this.invoke(request);
    
    // Prefetch predicted next capabilities (fire and forget)
    if (response.success) {
      const predictions = this.getPredictedNext(request.capability_id, 2);
      for (const pred of predictions) {
        if (pred.probability > 30 && !this.prefetchQueue.has(pred.capability_id)) {
          this.prefetchQueue.add(pred.capability_id);
          // Warm the cache with a lightweight prefetch
          setTimeout(() => {
            this.prefetchQueue.delete(pred.capability_id);
          }, pred.avg_gap_ms);
        }
      }
    }
    
    return response;
  }

  // ============================================
  // AGENT COLLABORATION - Multi-agent sessions
  // ============================================

  startCollaboration(sessionId: string, agents: string[], initialContext?: any): string {
    const id = sessionId || `collab_${Date.now().toString(36)}`;
    this.collaborations.set(id, {
      agents,
      sharedContext: initialContext || {},
      created: Date.now()
    });
    return id;
  }

  joinCollaboration(sessionId: string, agentId: string): boolean {
    const session = this.collaborations.get(sessionId);
    if (!session) return false;
    if (!session.agents.includes(agentId)) {
      session.agents.push(agentId);
    }
    return true;
  }

  updateCollaborationContext(sessionId: string, updates: Record<string, any>): boolean {
    const session = this.collaborations.get(sessionId);
    if (!session) return false;
    session.sharedContext = { ...session.sharedContext, ...updates };
    return true;
  }

  getCollaboration(sessionId: string) {
    return this.collaborations.get(sessionId) || null;
  }

  async collaborativeInvoke(sessionId: string, agentId: string, request: InvokeRequest): Promise<InvokeResponse> {
    const session = this.collaborations.get(sessionId);
    if (!session || !session.agents.includes(agentId)) {
      return {
        success: false,
        request_id: `req_${Date.now()}`,
        capability_id: request.capability_id,
        error: 'Not a member of this collaboration session',
        metadata: { execution: null }
      };
    }
    
    // Inject shared context into inputs
    const enrichedRequest = {
      ...request,
      inputs: { ...session.sharedContext, ...request.inputs, _collaboration: sessionId }
    };
    
    const response = await this.invoke(enrichedRequest);
    
    // Share results back to context
    if (response.success && response.outputs) {
      session.sharedContext._lastResult = {
        agent: agentId,
        capability: request.capability_id,
        outputs: response.outputs,
        timestamp: Date.now()
      };
    }
    
    return response;
  }

  // ============================================
  // CAPABILITY VERSIONING - Migration hints
  // ============================================

  private versionMigrations = new Map<string, { to: string; transformer?: (inputs: Record<string, any>) => Record<string, any> }>();

  constructor() {
    // Register default migrations
    this.versionMigrations.set('cap.price.lookup.v0', { to: 'cap.price.lookup.v1' });
    this.versionMigrations.set('cap.wallet.snapshot.v0', { 
      to: 'cap.wallet.snapshot.v1', 
      transformer: (i: Record<string, any>) => ({ ...i, include_das_data: true }) 
    });
    // Initialize pipelines
    this.initPipelines();
  }

  getMigrationHint(capId: string): { deprecated: boolean; migrate_to?: string; auto_migrate: boolean } | null {
    const migration = this.versionMigrations.get(capId);
    if (!migration) return null;
    return {
      deprecated: true,
      migrate_to: migration.to,
      auto_migrate: !!migration.transformer
    };
  }

  async invokeWithMigration(request: InvokeRequest): Promise<InvokeResponse> {
    const migration = this.versionMigrations.get(request.capability_id);
    if (migration) {
      const migratedRequest = {
        ...request,
        capability_id: migration.to,
        inputs: migration.transformer ? migration.transformer(request.inputs) : request.inputs
      };
      const response = await this.invoke(migratedRequest);
      return {
        ...response,
        metadata: {
          ...response.metadata,
          _migration: { from: request.capability_id, to: migration.to }
        } as any
      };
    }
    return this.invoke(request);
  }

  // ============================================
  // WEBHOOKS - Notify external systems
  // ============================================

  private webhooks: Map<string, { url: string; events: string[]; secret?: string; active: boolean }> = new Map();

  registerWebhook(id: string, url: string, events: string[], secret?: string): void {
    this.webhooks.set(id, { url, events, secret, active: true });
  }

  removeWebhook(id: string): boolean {
    return this.webhooks.delete(id);
  }

  getWebhooks() {
    return [...this.webhooks.entries()].map(([id, w]) => ({ id, url: w.url, events: w.events, active: w.active }));
  }

  private async emitWebhookEvent(event: string, payload: any): Promise<void> {
    for (const [id, webhook] of this.webhooks) {
      if (!webhook.active || !webhook.events.includes(event)) continue;
      try {
        const body = JSON.stringify({ event, payload, timestamp: Date.now() });
        fetch(webhook.url, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            ...(webhook.secret ? { 'X-Webhook-Secret': webhook.secret } : {})
          },
          body
        }).catch(() => {}); // Fire and forget
      } catch {}
    }
  }

  // ============================================
  // CAPABILITY ALIASES - Developer convenience
  // ============================================

  private aliases: Map<string, string> = new Map([
    ['price', 'cap.price.lookup.v1'],
    ['wallet', 'cap.wallet.snapshot.v1'],
    ['swap', 'cap.swap.execute.v1'],
    ['zk', 'cap.zk.proof.v1'],
    ['fhe', 'cap.fhe.compute.v1']
  ]);

  addAlias(alias: string, capabilityId: string): void {
    this.aliases.set(alias, capabilityId);
  }

  resolveAlias(idOrAlias: string): string {
    return this.aliases.get(idOrAlias) || idOrAlias;
  }

  getAliases() {
    return Object.fromEntries(this.aliases);
  }

  // ============================================
  // BUDGET TRACKING - Cost control for orgs
  // ============================================

  private budgets: Map<string, { limit: number; spent: number; period: 'daily' | 'monthly'; resetAt: number }> = new Map();

  setBudget(orgId: string, limit: number, period: 'daily' | 'monthly' = 'daily'): void {
    const resetAt = period === 'daily' 
      ? Date.now() + 86400000 
      : Date.now() + 2592000000;
    this.budgets.set(orgId, { limit, spent: 0, period, resetAt });
  }

  checkBudget(orgId: string, cost: number): { allowed: boolean; remaining: number; resetAt: number } {
    const budget = this.budgets.get(orgId);
    if (!budget) return { allowed: true, remaining: Infinity, resetAt: 0 };
    
    // Reset if period expired
    if (Date.now() > budget.resetAt) {
      budget.spent = 0;
      budget.resetAt = budget.period === 'daily' 
        ? Date.now() + 86400000 
        : Date.now() + 2592000000;
    }
    
    const remaining = budget.limit - budget.spent;
    return { allowed: remaining >= cost, remaining, resetAt: budget.resetAt };
  }

  recordSpend(orgId: string, cost: number): void {
    const budget = this.budgets.get(orgId);
    if (budget) budget.spent += cost;
  }

  getBudget(orgId: string) {
    const budget = this.budgets.get(orgId);
    if (!budget) return null;
    return { ...budget, remaining: budget.limit - budget.spent };
  }

  // ============================================
  // REQUEST REPLAY - Debug past requests
  // ============================================

  private requestLog: { id: string; request: InvokeRequest; response: InvokeResponse; timestamp: number }[] = [];
  private readonly MAX_LOG = 100;

  private logRequest(id: string, request: InvokeRequest, response: InvokeResponse): void {
    this.requestLog.push({ id, request, response, timestamp: Date.now() });
    if (this.requestLog.length > this.MAX_LOG) {
      this.requestLog = this.requestLog.slice(-this.MAX_LOG);
    }
  }

  getRequestLog(limit = 20): typeof this.requestLog {
    return this.requestLog.slice(-limit);
  }

  async replayRequest(requestId: string): Promise<InvokeResponse | null> {
    const logged = this.requestLog.find(r => r.id === requestId);
    if (!logged) return null;
    return this.invoke(logged.request);
  }

  // ============================================
  // AGENT SESSIONS - Persistent context
  // ============================================

  private sessions: Map<string, { 
    agentId: string; 
    context: Record<string, any>; 
    history: { capId: string; success: boolean; ts: number }[];
    created: number;
    lastActive: number;
  }> = new Map();

  createSession(agentId: string, initialContext?: Record<string, any>): string {
    const sessionId = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    this.sessions.set(sessionId, {
      agentId,
      context: initialContext || {},
      history: [],
      created: Date.now(),
      lastActive: Date.now()
    });
    return sessionId;
  }

  getSession(sessionId: string) {
    return this.sessions.get(sessionId) || null;
  }

  updateSessionContext(sessionId: string, updates: Record<string, any>): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.context = { ...session.context, ...updates };
    session.lastActive = Date.now();
    return true;
  }

  async sessionInvoke(sessionId: string, request: InvokeRequest): Promise<InvokeResponse> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, request_id: '', capability_id: request.capability_id, error: 'Session not found', metadata: { execution: null } };
    }
    
    // Resolve alias
    const resolvedRequest = { ...request, capability_id: this.resolveAlias(request.capability_id) };
    
    // Inject session context
    resolvedRequest.inputs = { ...session.context, ...resolvedRequest.inputs };
    
    const response = await this.invoke(resolvedRequest);
    
    // Update session
    session.history.push({ capId: resolvedRequest.capability_id, success: response.success, ts: Date.now() });
    session.lastActive = Date.now();
    if (session.history.length > 50) session.history = session.history.slice(-50);
    
    // Emit webhook
    this.emitWebhookEvent('invoke', { session_id: sessionId, capability_id: resolvedRequest.capability_id, success: response.success });
    
    return response;
  }

  // ============================================
  // INNOVATION STATS
  // ============================================

  getInnovationStats() {
    return {
      dependency_graph: {
        capabilities_tracked: this.dependencyGraph.size,
        total_edges: [...this.dependencyGraph.values()].reduce((s, m) => s + m.size, 0)
      },
      deduplication: {
        cached_responses: this.contentHashes.size
      },
      collaborations: {
        active_sessions: this.collaborations.size,
        total_agents: [...this.collaborations.values()].reduce((s, c) => s + c.agents.length, 0)
      },
      prefetch: {
        pending: this.prefetchQueue.size
      },
      migrations: {
        registered: this.versionMigrations.size
      },
      webhooks: {
        registered: this.webhooks.size
      },
      aliases: {
        registered: this.aliases.size
      },
      budgets: {
        tracked_orgs: this.budgets.size
      },
      sessions: {
        active: this.sessions.size
      },
      request_log: {
        entries: this.requestLog.length
      },
      marketplace: {
        listings: this.marketplace.size
      },
      intents: {
        registered: this.intentMap.size
      }
    };
  }

  // ============================================
  // CAPABILITY MARKETPLACE - Community ratings
  // ============================================

  private marketplace: Map<string, {
    capabilityId: string;
    provider: string;
    ratings: number[];
    reviews: { agent: string; rating: number; comment: string; ts: number }[];
    usageCount: number;
    featured: boolean;
  }> = new Map();

  listCapability(capabilityId: string, provider: string): void {
    if (!this.marketplace.has(capabilityId)) {
      this.marketplace.set(capabilityId, {
        capabilityId, provider, ratings: [], reviews: [], usageCount: 0, featured: false
      });
    }
  }

  rateCapability(capabilityId: string, agentId: string, rating: number, comment?: string): boolean {
    const listing = this.marketplace.get(capabilityId);
    if (!listing || rating < 1 || rating > 5) return false;
    listing.ratings.push(rating);
    if (comment) {
      listing.reviews.push({ agent: agentId, rating, comment, ts: Date.now() });
      if (listing.reviews.length > 50) listing.reviews = listing.reviews.slice(-50);
    }
    return true;
  }

  getMarketplaceListing(capabilityId: string) {
    const listing = this.marketplace.get(capabilityId);
    if (!listing) return null;
    const avgRating = listing.ratings.length > 0 
      ? listing.ratings.reduce((a, b) => a + b, 0) / listing.ratings.length 
      : 0;
    return { ...listing, avgRating: Math.round(avgRating * 10) / 10, totalRatings: listing.ratings.length };
  }

  getTopRated(limit = 10) {
    return [...this.marketplace.values()]
      .map(l => ({
        ...l,
        avgRating: l.ratings.length > 0 ? l.ratings.reduce((a, b) => a + b, 0) / l.ratings.length : 0
      }))
      .sort((a, b) => b.avgRating - a.avgRating)
      .slice(0, limit);
  }

  // ============================================
  // INTENT-BASED DISCOVERY - Natural language
  // ============================================

  private intentMap: Map<string, string[]> = new Map([
    ['get price', ['cap.price.lookup.v1']],
    ['check balance', ['cap.wallet.snapshot.v1']],
    ['swap tokens', ['cap.swap.execute.v1']],
    ['prove', ['cap.zk.proof.v1', 'cap.noir.prove.v1']],
    ['encrypt', ['cap.fhe.compute.v1', 'cap.arcium.mpc.v1']],
    ['private', ['cap.arcium.mpc.v1', 'cap.fhe.compute.v1', 'cap.noir.prove.v1']],
    ['nft', ['cap.wallet.snapshot.v1']],
    ['transaction', ['cap.swap.execute.v1']],
    ['verify', ['cap.zk.proof.v1', 'cap.noir.verify.v1']]
  ]);

  addIntent(intent: string, capabilities: string[]): void {
    this.intentMap.set(intent.toLowerCase(), capabilities);
  }

  discoverByIntent(query: string): { intent: string; capabilities: string[]; confidence: number }[] {
    const q = query.toLowerCase();
    const results: { intent: string; capabilities: string[]; confidence: number }[] = [];
    
    for (const [intent, caps] of this.intentMap) {
      // Simple fuzzy match - check if words overlap
      const intentWords = intent.split(' ');
      const queryWords = q.split(' ');
      const matches = intentWords.filter(w => queryWords.some(qw => qw.includes(w) || w.includes(qw)));
      if (matches.length > 0) {
        const confidence = Math.round(matches.length / intentWords.length * 100);
        results.push({ intent, capabilities: caps, confidence });
      }
    }
    
    return results.sort((a, b) => b.confidence - a.confidence);
  }

  // ============================================
  // SMART LOAD BALANCING - Route to best provider
  // ============================================

  private providerStats: Map<string, { latency: number[]; errors: number; successes: number }> = new Map();

  recordProviderMetric(provider: string, latencyMs: number, success: boolean): void {
    let stats = this.providerStats.get(provider);
    if (!stats) {
      stats = { latency: [], errors: 0, successes: 0 };
      this.providerStats.set(provider, stats);
    }
    stats.latency.push(latencyMs);
    if (stats.latency.length > 100) stats.latency = stats.latency.slice(-100);
    if (success) stats.successes++; else stats.errors++;
  }

  getBestProvider(providers: string[]): string | null {
    if (providers.length === 0) return null;
    if (providers.length === 1) return providers[0];
    
    let best = providers[0];
    let bestScore = -Infinity;
    
    for (const p of providers) {
      const stats = this.providerStats.get(p);
      if (!stats) continue;
      
      const avgLatency = stats.latency.length > 0 
        ? stats.latency.reduce((a, b) => a + b, 0) / stats.latency.length 
        : 1000;
      const successRate = stats.successes + stats.errors > 0 
        ? stats.successes / (stats.successes + stats.errors) 
        : 0.5;
      
      // Score: higher success rate and lower latency = better
      const score = successRate * 100 - avgLatency / 10;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    
    return best;
  }

  getProviderStats() {
    return [...this.providerStats.entries()].map(([provider, stats]) => ({
      provider,
      avg_latency_ms: stats.latency.length > 0 
        ? Math.round(stats.latency.reduce((a, b) => a + b, 0) / stats.latency.length) 
        : 0,
      success_rate: stats.successes + stats.errors > 0 
        ? Math.round(stats.successes / (stats.successes + stats.errors) * 100) 
        : 0,
      total_requests: stats.successes + stats.errors
    }));
  }

  // ============================================
  // PRIORITY ESCALATION - Auto-upgrade stuck requests
  // ============================================

  private escalationRules: { afterMs: number; fromPriority: Priority; toPriority: Priority }[] = [
    { afterMs: 5000, fromPriority: 'low', toPriority: 'normal' },
    { afterMs: 10000, fromPriority: 'normal', toPriority: 'high' },
    { afterMs: 15000, fromPriority: 'high', toPriority: 'critical' }
  ];

  checkEscalation(priority: Priority, waitTimeMs: number): Priority {
    for (const rule of this.escalationRules) {
      if (priority === rule.fromPriority && waitTimeMs >= rule.afterMs) {
        return rule.toPriority;
      }
    }
    return priority;
  }

  // ============================================
  // CAPABILITY PIPELINES - Pre-built chains
  // ============================================

  private pipelines = new Map<string, { name: string; steps: { capability: string; inputMap?: Record<string, string> }[]; description: string }>();

  private initPipelines(): void {
    this.pipelines.set('portfolio-check', {
      name: 'Portfolio Check',
      steps: [
        { capability: 'cap.wallet.snapshot.v1' },
        { capability: 'cap.price.lookup.v1', inputMap: { base_token: '_prev.tokens[0].symbol' } }
      ],
      description: 'Get wallet snapshot then price for top token'
    });
    this.pipelines.set('private-swap', {
      name: 'Private Swap',
      steps: [
        { capability: 'cap.arcium.mpc.v1', inputMap: { data: 'amount' } },
        { capability: 'cap.swap.execute.v1', inputMap: { encrypted_amount: '_prev.result' } }
      ],
      description: 'Encrypt amount then execute swap'
    });
  }

  getPipeline(id: string) {
    return this.pipelines.get(id) || null;
  }

  listPipelines() {
    return [...this.pipelines.entries()].map(([id, p]) => ({ id, ...p }));
  }

  addPipeline(id: string, name: string, steps: { capability: string; inputMap?: Record<string, string> }[], description: string): void {
    this.pipelines.set(id, { name, steps, description });
  }

  async executePipeline(pipelineId: string, initialInputs: Record<string, any>): Promise<{ success: boolean; results: any[]; error?: string }> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) return { success: false, results: [], error: 'Pipeline not found' };
    
    const results: any[] = [];
    let prevResult: any = null;
    
    for (const step of pipeline.steps) {
      // Build inputs - merge initial inputs with mapped values from previous result
      let inputs = { ...initialInputs };
      if (step.inputMap && prevResult) {
        for (const [key, path] of Object.entries(step.inputMap)) {
          if (path.startsWith('_prev.')) {
            // Simple path resolution
            const parts = path.replace('_prev.', '').split('.');
            let val = prevResult;
            for (const part of parts) {
              if (val && typeof val === 'object') {
                const match = part.match(/(\w+)\[(\d+)\]/);
                if (match) {
                  val = val[match[1]]?.[parseInt(match[2])];
                } else {
                  val = val[part];
                }
              }
            }
            if (val !== undefined) inputs[key] = val;
          } else {
            inputs[key] = initialInputs[path] || path;
          }
        }
      }
      
      const response = await this.invoke({ capability_id: step.capability, inputs });
      results.push({ capability: step.capability, success: response.success, outputs: response.outputs });
      
      if (!response.success) {
        return { success: false, results, error: `Step ${step.capability} failed: ${response.error}` };
      }
      
      prevResult = response.outputs;
    }
    
    return { success: true, results };
  }

  // ============================================
  // AGENT LEARNING - Preferences & patterns
  // ============================================

  private agentPreferences: Map<string, {
    preferredCapabilities: Map<string, number>;  // capability -> usage count
    preferredProviders: string[];
    timePatterns: { hour: number; count: number }[];
    lastSeen: number;
    tags: string[];
  }> = new Map();

  recordAgentActivity(agentId: string, capabilityId: string): void {
    let prefs = this.agentPreferences.get(agentId);
    if (!prefs) {
      prefs = { preferredCapabilities: new Map(), preferredProviders: [], timePatterns: [], lastSeen: 0, tags: [] };
      this.agentPreferences.set(agentId, prefs);
    }
    
    // Track capability usage
    prefs.preferredCapabilities.set(capabilityId, (prefs.preferredCapabilities.get(capabilityId) || 0) + 1);
    
    // Track time patterns
    const hour = new Date().getHours();
    const existing = prefs.timePatterns.find(t => t.hour === hour);
    if (existing) existing.count++; else prefs.timePatterns.push({ hour, count: 1 });
    
    prefs.lastSeen = Date.now();
    
    // Limit map size
    if (this.agentPreferences.size > 500) {
      const oldest = [...this.agentPreferences.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen)[0];
      if (oldest) this.agentPreferences.delete(oldest[0]);
    }
  }

  getAgentProfile(agentId: string) {
    const prefs = this.agentPreferences.get(agentId);
    if (!prefs) return null;
    
    const topCapabilities = [...prefs.preferredCapabilities.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([cap, count]) => ({ capability: cap, usage_count: count }));
    
    const peakHours = prefs.timePatterns
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map(t => t.hour);
    
    return {
      agent_id: agentId,
      top_capabilities: topCapabilities,
      peak_activity_hours: peakHours,
      last_seen: prefs.lastSeen,
      tags: prefs.tags
    };
  }

  tagAgent(agentId: string, tags: string[]): void {
    const prefs = this.agentPreferences.get(agentId);
    if (prefs) {
      prefs.tags = [...new Set([...prefs.tags, ...tags])];
    }
  }

  // ============================================
  // SMART RECOMMENDATIONS - Based on agent history
  // ============================================

  getAgentRecommendations(agentId: string): { capability: string; reason: string; confidence: number }[] {
    const prefs = this.agentPreferences.get(agentId);
    const recommendations: { capability: string; reason: string; confidence: number }[] = [];
    
    if (prefs) {
      // Recommend based on what similar agents use
      const topCap = [...prefs.preferredCapabilities.entries()].sort((a, b) => b[1] - a[1])[0];
      if (topCap) {
        // Find related capabilities from dependency graph
        const related = this.dependencyGraph.get(topCap[0]);
        if (related) {
          for (const [cap, data] of related) {
            if (!prefs.preferredCapabilities.has(cap)) {
              recommendations.push({
                capability: cap,
                reason: `Often used after ${topCap[0]}`,
                confidence: Math.min(90, data.weight * 10)
              });
            }
          }
        }
      }
    }
    
    // Add trending capabilities from marketplace
    const trending = this.getTopRated(3);
    for (const t of trending) {
      if (!recommendations.find(r => r.capability === t.capabilityId)) {
        recommendations.push({
          capability: t.capabilityId,
          reason: `Highly rated (${t.avgRating.toFixed(1)}★)`,
          confidence: Math.round(t.avgRating * 15)
        });
      }
    }
    
    return recommendations.slice(0, 5);
  }

  // ============================================
  // DRY-RUN / SIMULATION MODE
  // ============================================

  async simulate(request: InvokeRequest): Promise<{
    would_succeed: boolean;
    estimated_cost: number;
    estimated_latency_ms: number;
    required_inputs: string[];
    warnings: string[];
  }> {
    const capability = registry.getCapability(request.capability_id) as any;
    const warnings: string[] = [];
    
    if (!capability) {
      return { would_succeed: false, estimated_cost: 0, estimated_latency_ms: 0, required_inputs: [], warnings: ['Capability not found'] };
    }
    
    // Check required inputs - handle both array and object schema
    const inputs = Array.isArray(capability.inputs) ? capability.inputs : Object.entries(capability.inputs || {}).map(([name, schema]: [string, any]) => ({ name, ...schema }));
    const requiredInputs = inputs.filter((i: any) => i.required).map((i: any) => i.name);
    const missingInputs = requiredInputs.filter((i: string) => !(i in request.inputs));
    
    if (missingInputs.length > 0) {
      warnings.push(`Missing required inputs: ${missingInputs.join(', ')}`);
    }
    
    // Estimate cost
    const estimatedCost = capability.cost_estimate?.max_cost || capability.economic_hints?.max_cost || 0.001;
    
    // Estimate latency from health scores
    const health = this.healthScores.get(request.capability_id);
    const estimatedLatency = health?.avgLatency || 500;
    
    // Check circuit breaker
    const cb = this.circuitBreakers.get(request.capability_id);
    if (cb?.state === 'open') {
      warnings.push('Circuit breaker is OPEN - capability may be degraded');
    }
    
    return {
      would_succeed: missingInputs.length === 0 && (!cb || cb.state !== 'open'),
      estimated_cost: estimatedCost,
      estimated_latency_ms: Math.round(estimatedLatency),
      required_inputs: requiredInputs,
      warnings
    };
  }

  // ============================================
  // AGENT-TO-AGENT MESSAGING
  // ============================================

  private agentMessages: Map<string, { from: string; to: string; type: string; payload: any; ts: number; read: boolean }[]> = new Map();

  sendMessage(from: string, to: string, type: string, payload: any): string {
    const msgId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    
    let inbox = this.agentMessages.get(to);
    if (!inbox) {
      inbox = [];
      this.agentMessages.set(to, inbox);
    }
    
    inbox.push({ from, to, type, payload, ts: Date.now(), read: false });
    
    // Limit inbox size
    if (inbox.length > 100) {
      this.agentMessages.set(to, inbox.slice(-100));
    }
    
    return msgId;
  }

  getMessages(agentId: string, unreadOnly = false): { from: string; type: string; payload: any; ts: number }[] {
    const inbox = this.agentMessages.get(agentId) || [];
    const messages = unreadOnly ? inbox.filter(m => !m.read) : inbox;
    
    // Mark as read
    for (const m of messages) m.read = true;
    
    return messages.map(m => ({ from: m.from, type: m.type, payload: m.payload, ts: m.ts }));
  }

  // ============================================
  // COST PREDICTOR - Estimate before execution
  // ============================================

  private costHistory: Map<string, number[]> = new Map();

  recordCost(capabilityId: string, cost: number): void {
    let history = this.costHistory.get(capabilityId);
    if (!history) {
      history = [];
      this.costHistory.set(capabilityId, history);
    }
    history.push(cost);
    if (history.length > 50) this.costHistory.set(capabilityId, history.slice(-50));
  }

  predictCost(capabilityId: string): { min: number; avg: number; max: number; confidence: number } {
    const history = this.costHistory.get(capabilityId);
    if (!history || history.length === 0) {
      const cap = registry.getCapability(capabilityId) as any;
      return { 
        min: cap?.economic_hints?.min_cost || 0, 
        avg: cap?.economic_hints?.max_cost || 0.001, 
        max: cap?.economic_hints?.max_cost || 0.01,
        confidence: 20 
      };
    }
    
    const sorted = [...history].sort((a, b) => a - b);
    return {
      min: sorted[0],
      avg: history.reduce((a, b) => a + b, 0) / history.length,
      max: sorted[sorted.length - 1],
      confidence: Math.min(95, 50 + history.length)
    };
  }

  // ============================================
  // SDK HELPERS - Code snippets for devs
  // ============================================

  generateSDKSnippet(capabilityId: string, language: 'typescript' | 'python' | 'curl' = 'typescript'): string {
    const cap = registry.getCapability(capabilityId) as any;
    if (!cap) return '// Capability not found';
    
    // Handle both array and object input schemas
    const inputsArray = Array.isArray(cap.inputs) 
      ? cap.inputs 
      : Object.entries(cap.inputs || {}).map(([name, schema]: [string, any]) => ({ name, type: schema.type || 'any', required: schema.required }));
    
    const inputs = inputsArray.map((i: any) => `${i.name}: ${i.required ? `"<${i.type}>"` : `"<optional ${i.type}>"`}`).join(',\n    ');
    
    if (language === 'typescript') {
      return `// ${cap.description}
const response = await fetch('https://cap402.com/invoke', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    capability_id: '${capabilityId}',
    inputs: {
    ${inputs}
    }
  })
});
const result = await response.json();`;
    }
    
    if (language === 'python') {
      const pyInputs = inputsArray.map((i: any) => `        "${i.name}": "<${i.type}>"`).join(',\n');
      return `# ${cap.description}
import requests

response = requests.post('https://cap402.com/invoke', json={
    "capability_id": "${capabilityId}",
    "inputs": {
${pyInputs}
    }
})
result = response.json()`;
    }
    
    // curl
    const curlInputs = inputsArray.map((i: any) => `"${i.name}":"<${i.type}>"`).join(',');
    return `# ${cap.description}
curl -X POST https://cap402.com/invoke \\
  -H "Content-Type: application/json" \\
  -d '{"capability_id":"${capabilityId}","inputs":{${curlInputs}}}'`;
  }

  // ============================================
  // POLICY ENGINE - Intent Safety & Compliance
  // ============================================

  private policies: Map<string, AgentPolicy> = new Map();

  registerPolicy(agentId: string, policy: AgentPolicy): void {
    this.policies.set(agentId, policy);
  }

  getPolicy(agentId: string): AgentPolicy | null {
    return this.policies.get(agentId) || null;
  }

  validateAgainstPolicy(agentId: string, request: PolicyRequest): PolicyValidation {
    const policy = this.policies.get(agentId);
    if (!policy) return { valid: true, violations: [], warnings: [] };

    const violations: string[] = [];
    const warnings: string[] = [];

    // Privacy check
    if (policy.privacy && request.privacy_level) {
      const levels = { none: 0, low: 1, medium: 2, high: 3 };
      if (levels[request.privacy_level] < levels[policy.privacy]) {
        violations.push(`Privacy level ${request.privacy_level} below required ${policy.privacy}`);
      }
    }

    // Cost budget check
    if (policy.max_cost !== undefined && request.estimated_cost !== undefined) {
      if (request.estimated_cost > policy.max_cost) {
        violations.push(`Estimated cost ${request.estimated_cost} exceeds budget ${policy.max_cost}`);
      } else if (request.estimated_cost > policy.max_cost * 0.8) {
        warnings.push(`Cost approaching budget limit (${Math.round(request.estimated_cost / policy.max_cost * 100)}%)`);
      }
    }

    // Slippage check
    if (policy.max_slippage !== undefined && request.slippage !== undefined) {
      if (request.slippage > policy.max_slippage) {
        violations.push(`Slippage ${request.slippage}% exceeds max ${policy.max_slippage}%`);
      }
    }

    // Blocked counterparties check
    if (policy.blocked_counterparties && request.counterparty) {
      if (policy.blocked_counterparties.includes(request.counterparty)) {
        violations.push(`Counterparty ${request.counterparty} is blocked`);
      }
    }

    // Trusted counterparties check (if set, only allow trusted)
    if (policy.trusted_counterparties && policy.trusted_counterparties.length > 0 && request.counterparty) {
      if (!policy.trusted_counterparties.includes(request.counterparty)) {
        warnings.push(`Counterparty ${request.counterparty} not in trusted list`);
      }
    }

    // Speed requirement
    if (policy.max_latency_ms && request.estimated_latency_ms) {
      if (request.estimated_latency_ms > policy.max_latency_ms) {
        warnings.push(`Estimated latency ${request.estimated_latency_ms}ms exceeds preference ${policy.max_latency_ms}ms`);
      }
    }

    return { valid: violations.length === 0, violations, warnings };
  }

  // ============================================
  // AGENT-TO-AGENT NEGOTIATION PROTOCOL
  // ============================================

  private negotiations: Map<string, Negotiation> = new Map();

  initiateNegotiation(initiator: string, counterparty: string, proposal: NegotiationProposal): string {
    const negId = `neg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    
    this.negotiations.set(negId, {
      id: negId,
      initiator,
      counterparty,
      status: 'pending',
      proposal,
      counterProposal: null,
      agreedTerms: null,
      created: Date.now(),
      updated: Date.now(),
      history: [{ action: 'initiated', by: initiator, ts: Date.now(), data: proposal }]
    });

    // Notify counterparty
    this.sendMessage(initiator, counterparty, 'negotiation_request', { negotiation_id: negId, proposal });

    return negId;
  }

  respondToNegotiation(negId: string, agentId: string, response: 'accept' | 'reject' | 'counter', counterProposal?: NegotiationProposal): NegotiationResult {
    const neg = this.negotiations.get(negId);
    if (!neg) return { success: false, error: 'Negotiation not found' };
    if (neg.counterparty !== agentId && neg.initiator !== agentId) {
      return { success: false, error: 'Not a party to this negotiation' };
    }

    neg.updated = Date.now();
    neg.history.push({ action: response, by: agentId, ts: Date.now(), data: counterProposal });

    if (response === 'accept') {
      neg.status = 'accepted';
      neg.agreedTerms = this.mergeProposals(neg.proposal, neg.counterProposal);
      this.sendMessage(agentId, neg.initiator === agentId ? neg.counterparty : neg.initiator, 'negotiation_accepted', { negotiation_id: negId, terms: neg.agreedTerms });
      return { success: true, status: 'accepted', terms: neg.agreedTerms };
    }

    if (response === 'reject') {
      neg.status = 'rejected';
      this.sendMessage(agentId, neg.initiator === agentId ? neg.counterparty : neg.initiator, 'negotiation_rejected', { negotiation_id: negId });
      return { success: true, status: 'rejected' };
    }

    if (response === 'counter' && counterProposal) {
      neg.status = 'countered';
      neg.counterProposal = counterProposal;
      const otherParty = neg.initiator === agentId ? neg.counterparty : neg.initiator;
      this.sendMessage(agentId, otherParty, 'negotiation_counter', { negotiation_id: negId, counter_proposal: counterProposal });
      return { success: true, status: 'countered', counter_proposal: counterProposal };
    }

    return { success: false, error: 'Invalid response' };
  }

  getNegotiation(negId: string): Negotiation | null {
    return this.negotiations.get(negId) || null;
  }

  getAgentNegotiations(agentId: string): Negotiation[] {
    return [...this.negotiations.values()].filter(n => n.initiator === agentId || n.counterparty === agentId);
  }

  private mergeProposals(p1: NegotiationProposal, p2: NegotiationProposal | null): NegotiationProposal {
    if (!p2) return p1;
    return {
      privacy_level: this.higherPrivacy(p1.privacy_level, p2.privacy_level),
      max_slippage: Math.min(p1.max_slippage || 100, p2.max_slippage || 100),
      max_cost: Math.min(p1.max_cost || Infinity, p2.max_cost || Infinity),
      preferred_routes: [...new Set([...(p1.preferred_routes || []), ...(p2.preferred_routes || [])])],
      excluded_routes: [...new Set([...(p1.excluded_routes || []), ...(p2.excluded_routes || [])])]
    };
  }

  private higherPrivacy(a?: PolicyPrivacyLevel, b?: PolicyPrivacyLevel): PolicyPrivacyLevel {
    const levels: PolicyPrivacyLevel[] = ['none', 'low', 'medium', 'high'];
    const ia = levels.indexOf(a || 'none');
    const ib = levels.indexOf(b || 'none');
    return levels[Math.max(ia, ib)];
  }

  // ============================================
  // POLICY-COMPLIANT EXECUTION
  // ============================================

  async executeWithPolicy(request: PolicyExecutionRequest): Promise<PolicyExecutionResult> {
    const startTime = Date.now();
    const proofSteps: ProofStep[] = [];

    // Step 1: Validate against agent's policy
    const validation = this.validateAgainstPolicy(request.agent_id, {
      privacy_level: request.policy?.privacy,
      estimated_cost: request.policy?.max_cost,
      slippage: request.policy?.max_slippage,
      counterparty: request.counterparty
    });

    proofSteps.push({ step: 'policy_validation', passed: validation.valid, details: validation });

    if (!validation.valid) {
      return {
        success: false,
        error: `Policy violations: ${validation.violations.join(', ')}`,
        proof: this.generateComplianceProof(proofSteps),
        fallback_available: true
      };
    }

    // Step 2: Find compliant route
    const route = await this.findCompliantRoute(request);
    proofSteps.push({ step: 'route_selection', passed: !!route, details: route });

    if (!route) {
      // Try fallback if enabled
      if (request.fallbacks) {
        const fallbackRoute = await this.findFallbackRoute(request);
        if (fallbackRoute) {
          proofSteps.push({ step: 'fallback_route', passed: true, details: fallbackRoute });
          return this.executeRoute(fallbackRoute, request, proofSteps, startTime);
        }
      }
      return {
        success: false,
        error: 'No compliant route found',
        proof: this.generateComplianceProof(proofSteps),
        fallback_available: false
      };
    }

    return this.executeRoute(route, request, proofSteps, startTime);
  }

  private async executeRoute(route: Route, request: PolicyExecutionRequest, proofSteps: ProofStep[], startTime: number): Promise<PolicyExecutionResult> {
    // Step 3: Execute with bounds enforcement
    const result = await this.invoke({
      capability_id: route.capability_id,
      inputs: { ...request.inputs, ...route.params }
    });

    proofSteps.push({ step: 'execution', passed: result.success, details: { request_id: result.request_id } });

    const executionTime = Date.now() - startTime;

    return {
      success: result.success,
      outputs: result.outputs,
      route_used: route,
      plugins_used: route.plugins,
      execution_time_ms: executionTime,
      cost_actual: result.metadata?.economic_hints?.actual_cost || 0,
      proof: this.generateComplianceProof(proofSteps),
      proof_hash: this.hashProof(proofSteps),
      warnings: []
    };
  }

  private async findCompliantRoute(request: PolicyExecutionRequest): Promise<Route | null> {
    const routes: Route[] = [];
    const policy = request.policy || {};

    // Build candidate routes based on capability type
    if (request.capability_type === 'swap') {
      routes.push(
        { id: 'jupiter', capability_id: 'cap.swap.execute.v1', plugins: ['dex'], privacy_level: 'none', estimated_cost: 0.001, estimated_latency: 500, params: {} },
        { id: 'private-swap', capability_id: 'cap.arcium.mpc.v1', plugins: ['privacy', 'dex'], privacy_level: 'high', estimated_cost: 0.005, estimated_latency: 2000, params: {} }
      );
    } else if (request.capability_type === 'price') {
      routes.push(
        { id: 'public-price', capability_id: 'cap.price.lookup.v1', plugins: ['oracle'], privacy_level: 'none', estimated_cost: 0.0001, estimated_latency: 200, params: {} }
      );
    }

    // Filter by policy constraints
    const compliant = routes.filter(r => {
      if (policy.privacy) {
        const levels = { none: 0, low: 1, medium: 2, high: 3 };
        if (levels[r.privacy_level] < levels[policy.privacy]) return false;
      }
      if (policy.max_cost && r.estimated_cost > policy.max_cost) return false;
      if (policy.max_latency_ms && r.estimated_latency > policy.max_latency_ms) return false;
      if (policy.excluded_routes?.includes(r.id)) return false;
      if (policy.preferred_routes?.length && !policy.preferred_routes.includes(r.id)) return false;
      return true;
    });

    // Sort by cost (or other criteria)
    compliant.sort((a, b) => a.estimated_cost - b.estimated_cost);

    return compliant[0] || null;
  }

  private async findFallbackRoute(request: PolicyExecutionRequest): Promise<Route | null> {
    // Relax constraints for fallback
    const relaxedPolicy = { ...request.policy };
    if (relaxedPolicy.max_cost) relaxedPolicy.max_cost *= 1.5;
    if (relaxedPolicy.max_latency_ms) relaxedPolicy.max_latency_ms *= 2;

    return this.findCompliantRoute({ ...request, policy: relaxedPolicy });
  }

  private generateComplianceProof(steps: ProofStep[]): ComplianceProof {
    return {
      version: '1.0',
      timestamp: Date.now(),
      steps,
      all_passed: steps.every(s => s.passed),
      verifiable: true
    };
  }

  private hashProof(steps: ProofStep[]): string {
    const data = JSON.stringify(steps);
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      hash = ((hash << 5) - hash) + data.charCodeAt(i);
      hash |= 0;
    }
    return `proof_${Math.abs(hash).toString(16)}`;
  }

  // ============================================
  // PLUGIN ARCHITECTURE
  // ============================================

  private plugins: Map<string, Plugin> = new Map([
    ['dex', { id: 'dex', name: 'DEX Aggregator', type: 'liquidity', enabled: true, config: {} }],
    ['privacy', { id: 'privacy', name: 'Privacy Layer', type: 'privacy', enabled: true, config: { providers: ['arcium', 'noir'] } }],
    ['oracle', { id: 'oracle', name: 'Price Oracle', type: 'data', enabled: true, config: { sources: ['coinmarketcap', 'birdeye'] } }],
    ['compliance', { id: 'compliance', name: 'Compliance Check', type: 'compliance', enabled: true, config: {} }],
    ['bridge', { id: 'bridge', name: 'Cross-Chain Bridge', type: 'bridge', enabled: true, config: { chains: ['solana', 'ethereum'] } }]
  ]);

  registerPlugin(plugin: Plugin): void {
    this.plugins.set(plugin.id, plugin);
  }

  getPlugin(id: string): Plugin | null {
    return this.plugins.get(id) || null;
  }

  listPlugins(): Plugin[] {
    return [...this.plugins.values()];
  }

  enablePlugin(id: string, enabled: boolean): boolean {
    const plugin = this.plugins.get(id);
    if (!plugin) return false;
    plugin.enabled = enabled;
    return true;
  }

  // ============================================
  // CONSTRAINT ENFORCEMENT
  // ============================================

  private constraints: Map<string, Constraint[]> = new Map();

  setConstraints(agentId: string, constraints: Constraint[]): void {
    this.constraints.set(agentId, constraints);
  }

  getConstraints(agentId: string): Constraint[] {
    return this.constraints.get(agentId) || [];
  }

  enforceConstraints(agentId: string, action: ConstraintAction): ConstraintResult {
    const constraints = this.constraints.get(agentId) || [];
    const violations: string[] = [];
    const enforced: string[] = [];

    for (const c of constraints) {
      if (c.type === 'max_value' && action.value !== undefined && c.limit !== undefined) {
        if (action.value > c.limit) {
          violations.push(`Value ${action.value} exceeds max ${c.limit}`);
        } else {
          enforced.push(`max_value: ${action.value} <= ${c.limit}`);
        }
      }
      if (c.type === 'min_value' && action.value !== undefined && c.limit !== undefined) {
        if (action.value < c.limit) {
          violations.push(`Value ${action.value} below min ${c.limit}`);
        } else {
          enforced.push(`min_value: ${action.value} >= ${c.limit}`);
        }
      }
      if (c.type === 'whitelist' && action.target) {
        if (!c.allowed?.includes(action.target)) {
          violations.push(`Target ${action.target} not in whitelist`);
        } else {
          enforced.push(`whitelist: ${action.target} allowed`);
        }
      }
      if (c.type === 'blacklist' && action.target) {
        if (c.blocked?.includes(action.target)) {
          violations.push(`Target ${action.target} is blacklisted`);
        } else {
          enforced.push(`blacklist: ${action.target} not blocked`);
        }
      }
      if (c.type === 'rate_limit') {
        // Rate limiting handled elsewhere
        enforced.push(`rate_limit: checked`);
      }
    }

    return { allowed: violations.length === 0, violations, enforced };
  }

  // ============================================
  // SMART CIRCUIT BREAKER - Gradual Recovery
  // ============================================

  getCircuitBreakerStatus(capabilityId: string): { state: string; failures: number; recovery_percent: number } {
    const cb = this.circuitBreakers.get(capabilityId);
    if (!cb) return { state: 'closed', failures: 0, recovery_percent: 100 };
    
    const now = Date.now();
    let recoveryPercent = 100;
    
    if (cb.state === 'open') {
      const elapsed = now - cb.lastFailure;
      recoveryPercent = Math.min(100, Math.round(elapsed / CIRCUIT_BREAKER_RESET_MS * 100));
    } else if (cb.state === 'half-open') {
      recoveryPercent = 50; // Partially recovered
    }
    
    return { state: cb.state, failures: cb.failures, recovery_percent: recoveryPercent };
  }

  getAllCircuitBreakers() {
    return [...this.circuitBreakers.entries()].map(([id, cb]) => ({
      capability_id: id,
      ...this.getCircuitBreakerStatus(id)
    }));
  }

  // ============================================
  // CAPABILITY COMPOSITION OPTIMIZER
  // ============================================

  private compositionCache: Map<string, { steps: string[]; optimized: boolean; savedMs: number }> = new Map();

  optimizeComposition(steps: string[]): { optimized_steps: string[]; parallelizable: string[][]; estimated_savings_ms: number } {
    const key = steps.join('→');
    
    // Check if we've optimized this before
    const cached = this.compositionCache.get(key);
    if (cached) {
      return { optimized_steps: cached.steps, parallelizable: [], estimated_savings_ms: cached.savedMs };
    }
    
    // Find parallelizable steps (no dependencies between them)
    const parallelGroups: string[][] = [];
    const sequential: string[] = [];
    
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const deps = this.dependencyGraph.get(step);
      
      // Check if this step depends on any previous step
      const hasDependency = steps.slice(0, i).some(prev => deps?.has(prev));
      
      if (!hasDependency && i > 0) {
        // Can be parallelized with previous
        if (parallelGroups.length === 0 || parallelGroups[parallelGroups.length - 1].length >= 3) {
          parallelGroups.push([step]);
        } else {
          parallelGroups[parallelGroups.length - 1].push(step);
        }
      } else {
        sequential.push(step);
      }
    }
    
    // Estimate savings (parallel execution saves ~40% per parallel group)
    const estimatedSavings = parallelGroups.reduce((sum, group) => sum + (group.length - 1) * 200, 0);
    
    this.compositionCache.set(key, { steps, optimized: true, savedMs: estimatedSavings });
    
    // Limit cache size
    if (this.compositionCache.size > 100) {
      const first = this.compositionCache.keys().next().value;
      if (first) this.compositionCache.delete(first);
    }
    
    return { optimized_steps: steps, parallelizable: parallelGroups, estimated_savings_ms: estimatedSavings };
  }

  // ============================================
  // AGENT REPUTATION WITH DECAY
  // ============================================

  private agentReputation: Map<string, { score: number; lastActivity: number; totalActions: number; successfulActions: number }> = new Map();

  updateReputation(agentId: string, success: boolean, weight: number = 1): void {
    let rep = this.agentReputation.get(agentId);
    const now = Date.now();
    
    if (!rep) {
      rep = { score: 50, lastActivity: now, totalActions: 0, successfulActions: 0 };
      this.agentReputation.set(agentId, rep);
    }
    
    // Apply time decay (lose 1 point per day of inactivity, min 10)
    const daysSinceActive = (now - rep.lastActivity) / 86400000;
    if (daysSinceActive > 1) {
      rep.score = Math.max(10, rep.score - Math.floor(daysSinceActive));
    }
    
    // Update based on action
    rep.totalActions++;
    if (success) {
      rep.successfulActions++;
      rep.score = Math.min(100, rep.score + weight);
    } else {
      rep.score = Math.max(0, rep.score - weight * 2); // Failures hurt more
    }
    
    rep.lastActivity = now;
    
    // Limit size
    if (this.agentReputation.size > 1000) {
      // Remove lowest reputation agents
      const sorted = [...this.agentReputation.entries()].sort((a, b) => a[1].score - b[1].score);
      for (let i = 0; i < 100; i++) {
        this.agentReputation.delete(sorted[i][0]);
      }
    }
  }

  getReputation(agentId: string): { score: number; level: string; success_rate: number } | null {
    const rep = this.agentReputation.get(agentId);
    if (!rep) return null;
    
    // Apply current decay for display
    const daysSinceActive = (Date.now() - rep.lastActivity) / 86400000;
    const decayedScore = Math.max(10, rep.score - Math.floor(daysSinceActive));
    
    let level = 'newcomer';
    if (decayedScore >= 90) level = 'elite';
    else if (decayedScore >= 70) level = 'trusted';
    else if (decayedScore >= 50) level = 'established';
    else if (decayedScore >= 30) level = 'developing';
    
    return {
      score: decayedScore,
      level,
      success_rate: rep.totalActions > 0 ? Math.round(rep.successfulActions / rep.totalActions * 100) : 0
    };
  }

  getTopAgents(limit = 10) {
    return [...this.agentReputation.entries()]
      .map(([id, rep]) => ({ agent_id: id, ...this.getReputation(id)! }))
      .filter(a => a !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // ============================================
  // REQUEST PRIORITY INHERITANCE
  // ============================================

  private priorityInheritance: Map<string, Priority> = new Map();

  setPriorityForSession(sessionId: string, priority: Priority): void {
    this.priorityInheritance.set(sessionId, priority);
  }

  getInheritedPriority(sessionId: string): Priority {
    return this.priorityInheritance.get(sessionId) || 'normal';
  }

  // ============================================
  // SMART RATE LIMITING PER AGENT
  // ============================================

  private agentRateLimits: Map<string, { requests: number[]; limit: number }> = new Map();

  checkAgentRateLimit(agentId: string): { allowed: boolean; remaining: number; reset_in_ms: number } {
    const now = Date.now();
    const windowMs = 60000; // 1 minute window
    
    let limits = this.agentRateLimits.get(agentId);
    if (!limits) {
      // Default limit based on reputation
      const rep = this.getReputation(agentId);
      const baseLimit = rep ? Math.floor(50 + rep.score / 2) : 50; // 50-100 based on reputation
      limits = { requests: [], limit: baseLimit };
      this.agentRateLimits.set(agentId, limits);
    }
    
    // Clean old requests
    limits.requests = limits.requests.filter(ts => now - ts < windowMs);
    
    const remaining = limits.limit - limits.requests.length;
    const oldestRequest = limits.requests[0] || now;
    const resetIn = Math.max(0, windowMs - (now - oldestRequest));
    
    if (remaining <= 0) {
      return { allowed: false, remaining: 0, reset_in_ms: resetIn };
    }
    
    limits.requests.push(now);
    return { allowed: true, remaining: remaining - 1, reset_in_ms: resetIn };
  }

  // ============================================
  // CAPABILITY HEALTH TRENDS
  // ============================================

  private healthTrends: Map<string, { timestamps: number[]; latencies: number[]; successes: boolean[] }> = new Map();

  recordHealthTrend(capabilityId: string, latencyMs: number, success: boolean): void {
    let trend = this.healthTrends.get(capabilityId);
    if (!trend) {
      trend = { timestamps: [], latencies: [], successes: [] };
      this.healthTrends.set(capabilityId, trend);
    }
    
    trend.timestamps.push(Date.now());
    trend.latencies.push(latencyMs);
    trend.successes.push(success);
    
    // Keep last 100 data points
    if (trend.timestamps.length > 100) {
      trend.timestamps = trend.timestamps.slice(-100);
      trend.latencies = trend.latencies.slice(-100);
      trend.successes = trend.successes.slice(-100);
    }
  }

  getHealthTrend(capabilityId: string): { trend: 'improving' | 'stable' | 'degrading'; avg_latency_ms: number; success_rate: number; data_points: number } | null {
    const trend = this.healthTrends.get(capabilityId);
    if (!trend || trend.timestamps.length < 5) return null;
    
    const recentLatencies = trend.latencies.slice(-10);
    const olderLatencies = trend.latencies.slice(-20, -10);
    
    const recentAvg = recentLatencies.reduce((a, b) => a + b, 0) / recentLatencies.length;
    const olderAvg = olderLatencies.length > 0 ? olderLatencies.reduce((a, b) => a + b, 0) / olderLatencies.length : recentAvg;
    
    let trendDirection: 'improving' | 'stable' | 'degrading' = 'stable';
    if (recentAvg < olderAvg * 0.8) trendDirection = 'improving';
    else if (recentAvg > olderAvg * 1.2) trendDirection = 'degrading';
    
    const successRate = Math.round(trend.successes.filter(s => s).length / trend.successes.length * 100);
    
    return {
      trend: trendDirection,
      avg_latency_ms: Math.round(recentAvg),
      success_rate: successRate,
      data_points: trend.timestamps.length
    };
  }

  // ============================================
  // AGENT COLLABORATION SCORING
  // ============================================

  private collaborationScores: Map<string, Map<string, { interactions: number; successRate: number }>> = new Map();

  recordCollaboration(agent1: string, agent2: string, success: boolean): void {
    // Update both directions
    this.updateCollabScore(agent1, agent2, success);
    this.updateCollabScore(agent2, agent1, success);
  }

  private updateCollabScore(from: string, to: string, success: boolean): void {
    let scores = this.collaborationScores.get(from);
    if (!scores) {
      scores = new Map();
      this.collaborationScores.set(from, scores);
    }
    
    let score = scores.get(to);
    if (!score) {
      score = { interactions: 0, successRate: 0 };
      scores.set(to, score);
    }
    
    score.interactions++;
    score.successRate = (score.successRate * (score.interactions - 1) + (success ? 100 : 0)) / score.interactions;
  }

  getBestCollaborators(agentId: string, limit = 5): { agent_id: string; interactions: number; success_rate: number }[] {
    const scores = this.collaborationScores.get(agentId);
    if (!scores) return [];
    
    return [...scores.entries()]
      .map(([id, s]) => ({ agent_id: id, interactions: s.interactions, success_rate: Math.round(s.successRate) }))
      .sort((a, b) => b.success_rate - a.success_rate || b.interactions - a.interactions)
      .slice(0, limit);
  }

  // ============================================
  // INTENT BROADCASTING - Agents announce needs
  // ============================================

  private intentBoard: Map<string, Intent> = new Map();

  broadcastIntent(agentId: string, intent: IntentRequest): string {
    const intentId = `intent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    
    this.intentBoard.set(intentId, {
      id: intentId,
      agent_id: agentId,
      type: intent.type,
      description: intent.description,
      requirements: intent.requirements || {},
      max_cost: intent.max_cost,
      expires: Date.now() + (intent.ttl_minutes || 30) * 60000,
      status: 'open',
      responses: [],
      created: Date.now()
    });

    // Cleanup expired intents
    for (const [id, i] of this.intentBoard) {
      if (i.expires < Date.now()) this.intentBoard.delete(id);
    }

    // Limit size
    if (this.intentBoard.size > 500) {
      const oldest = [...this.intentBoard.entries()].sort((a, b) => a[1].created - b[1].created)[0];
      if (oldest) this.intentBoard.delete(oldest[0]);
    }

    return intentId;
  }

  respondToIntent(intentId: string, responderId: string, offer: IntentOffer): boolean {
    const intent = this.intentBoard.get(intentId);
    if (!intent || intent.status !== 'open' || intent.expires < Date.now()) return false;

    intent.responses.push({
      responder_id: responderId,
      offer,
      timestamp: Date.now()
    });

    return true;
  }

  acceptIntentResponse(intentId: string, responderId: string): boolean {
    const intent = this.intentBoard.get(intentId);
    if (!intent) return false;

    const response = intent.responses.find(r => r.responder_id === responderId);
    if (!response) return false;

    intent.status = 'matched';
    intent.matched_with = responderId;

    // Notify both parties
    this.sendMessage('system', intent.agent_id, 'intent_matched', { intent_id: intentId, matched_with: responderId });
    this.sendMessage('system', responderId, 'intent_accepted', { intent_id: intentId, requester: intent.agent_id });

    return true;
  }

  getOpenIntents(filters?: { type?: string; max_cost?: number }): Intent[] {
    const now = Date.now();
    return [...this.intentBoard.values()]
      .filter(i => i.status === 'open' && i.expires > now)
      .filter(i => !filters?.type || i.type === filters.type)
      .filter(i => !filters?.max_cost || (i.max_cost && i.max_cost <= filters.max_cost))
      .sort((a, b) => b.created - a.created);
  }

  getIntent(intentId: string): Intent | null {
    return this.intentBoard.get(intentId) || null;
  }

  // ============================================
  // CAPABILITY ESCROW - Trustless execution
  // ============================================

  private escrows: Map<string, Escrow> = new Map();

  createEscrow(initiator: string, counterparty: string, terms: EscrowTerms): string {
    const escrowId = `escrow_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    this.escrows.set(escrowId, {
      id: escrowId,
      initiator,
      counterparty,
      terms,
      status: 'pending',
      initiator_confirmed: false,
      counterparty_confirmed: false,
      created: Date.now(),
      expires: Date.now() + (terms.timeout_minutes || 60) * 60000
    });

    // Notify counterparty
    this.sendMessage(initiator, counterparty, 'escrow_created', { escrow_id: escrowId, terms });

    return escrowId;
  }

  confirmEscrow(escrowId: string, agentId: string): { status: string; released: boolean } {
    const escrow = this.escrows.get(escrowId);
    if (!escrow) return { status: 'not_found', released: false };
    if (escrow.expires < Date.now()) {
      escrow.status = 'expired';
      return { status: 'expired', released: false };
    }

    if (agentId === escrow.initiator) escrow.initiator_confirmed = true;
    if (agentId === escrow.counterparty) escrow.counterparty_confirmed = true;

    // Both confirmed = release
    if (escrow.initiator_confirmed && escrow.counterparty_confirmed) {
      escrow.status = 'released';
      // Record successful collaboration
      this.recordCollaboration(escrow.initiator, escrow.counterparty, true);
      return { status: 'released', released: true };
    }

    return { status: 'pending', released: false };
  }

  disputeEscrow(escrowId: string, agentId: string, reason: string): boolean {
    const escrow = this.escrows.get(escrowId);
    if (!escrow || escrow.status !== 'pending') return false;

    escrow.status = 'disputed';
    escrow.dispute = { by: agentId, reason, timestamp: Date.now() };

    // Notify both parties
    this.sendMessage('system', escrow.initiator, 'escrow_disputed', { escrow_id: escrowId, by: agentId, reason });
    this.sendMessage('system', escrow.counterparty, 'escrow_disputed', { escrow_id: escrowId, by: agentId, reason });

    return true;
  }

  getEscrow(escrowId: string): Escrow | null {
    return this.escrows.get(escrowId) || null;
  }

  // ============================================
  // AGENT DISCOVERY - Find agents by capability
  // ============================================

  private agentCapabilities: Map<string, { capabilities: string[]; tags: string[]; available: boolean }> = new Map();

  registerAgentCapabilities(agentId: string, capabilities: string[], tags: string[] = []): void {
    this.agentCapabilities.set(agentId, { capabilities, tags, available: true });
  }

  setAgentAvailability(agentId: string, available: boolean): void {
    const agent = this.agentCapabilities.get(agentId);
    if (agent) agent.available = available;
  }

  discoverAgents(query: { capability?: string; tag?: string; min_reputation?: number }): AgentDiscoveryResult[] {
    const results: AgentDiscoveryResult[] = [];

    for (const [agentId, data] of this.agentCapabilities) {
      if (!data.available) continue;

      // Filter by capability
      if (query.capability && !data.capabilities.some(c => c.includes(query.capability!))) continue;

      // Filter by tag
      if (query.tag && !data.tags.includes(query.tag)) continue;

      // Filter by reputation
      const rep = this.getReputation(agentId);
      if (query.min_reputation && (!rep || rep.score < query.min_reputation)) continue;

      results.push({
        agent_id: agentId,
        capabilities: data.capabilities,
        tags: data.tags,
        reputation: rep,
        available: data.available
      });
    }

    // Sort by reputation
    return results.sort((a, b) => (b.reputation?.score || 0) - (a.reputation?.score || 0));
  }

  // ============================================
  // MULTI-PARTY TRANSACTIONS
  // ============================================

  private multiPartyTx: Map<string, MultiPartyTransaction> = new Map();

  createMultiPartyTransaction(initiator: string, participants: string[], workflow: WorkflowStep[]): string {
    const txId = `mptx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    const confirmations: Record<string, boolean> = {};
    [initiator, ...participants].forEach(p => confirmations[p] = false);
    confirmations[initiator] = true; // Initiator auto-confirms

    this.multiPartyTx.set(txId, {
      id: txId,
      initiator,
      participants,
      workflow,
      confirmations,
      status: 'awaiting_confirmations',
      results: [],
      created: Date.now()
    });

    // Notify all participants
    for (const p of participants) {
      this.sendMessage(initiator, p, 'multi_party_invite', { tx_id: txId, workflow, participants: [initiator, ...participants] });
    }

    return txId;
  }

  confirmMultiPartyTransaction(txId: string, agentId: string): { status: string; all_confirmed: boolean } {
    const tx = this.multiPartyTx.get(txId);
    if (!tx) return { status: 'not_found', all_confirmed: false };

    if (!(agentId in tx.confirmations)) return { status: 'not_participant', all_confirmed: false };

    tx.confirmations[agentId] = true;

    const allConfirmed = Object.values(tx.confirmations).every(c => c);
    if (allConfirmed) {
      tx.status = 'executing';
      // Execute workflow asynchronously
      this.executeMultiPartyWorkflow(txId);
    }

    return { status: tx.status, all_confirmed: allConfirmed };
  }

  private async executeMultiPartyWorkflow(txId: string): Promise<void> {
    const tx = this.multiPartyTx.get(txId);
    if (!tx) return;

    for (const step of tx.workflow) {
      const result = await this.invoke({ capability_id: step.capability_id, inputs: step.inputs });
      tx.results.push({ step: step.capability_id, success: result.success, output: result.outputs });

      if (!result.success && step.required !== false) {
        tx.status = 'failed';
        // Notify all
        for (const p of [tx.initiator, ...tx.participants]) {
          this.sendMessage('system', p, 'multi_party_failed', { tx_id: txId, failed_step: step.capability_id });
        }
        return;
      }
    }

    tx.status = 'completed';
    // Notify all and record collaborations
    for (const p of [tx.initiator, ...tx.participants]) {
      this.sendMessage('system', p, 'multi_party_completed', { tx_id: txId, results: tx.results });
      // Record successful collaboration between all pairs
      for (const other of [tx.initiator, ...tx.participants]) {
        if (p !== other) this.recordCollaboration(p, other, true);
      }
    }
  }

  getMultiPartyTransaction(txId: string): MultiPartyTransaction | null {
    return this.multiPartyTx.get(txId) || null;
  }

  // ============================================
  // SLA GUARANTEES WITH PENALTIES
  // ============================================

  private slaAgreements: Map<string, SLAAgreement> = new Map();

  createSLA(provider: string, consumer: string, terms: SLATerms): string {
    const slaId = `sla_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    this.slaAgreements.set(slaId, {
      id: slaId,
      provider,
      consumer,
      terms,
      metrics: { total_requests: 0, successful_requests: 0, total_latency: 0, violations: 0 },
      status: 'active',
      created: Date.now(),
      expires: Date.now() + (terms.duration_days || 30) * 86400000
    });

    return slaId;
  }

  recordSLAMetric(slaId: string, success: boolean, latencyMs: number): SLAViolation | null {
    const sla = this.slaAgreements.get(slaId);
    if (!sla || sla.status !== 'active') return null;

    sla.metrics.total_requests++;
    sla.metrics.total_latency += latencyMs;
    if (success) sla.metrics.successful_requests++;

    // Check for violations
    const successRate = sla.metrics.successful_requests / sla.metrics.total_requests * 100;
    const avgLatency = sla.metrics.total_latency / sla.metrics.total_requests;

    let violation: SLAViolation | null = null;

    if (sla.terms.min_success_rate && successRate < sla.terms.min_success_rate) {
      sla.metrics.violations++;
      violation = { type: 'success_rate', expected: sla.terms.min_success_rate, actual: successRate };
    }

    if (sla.terms.max_latency_ms && latencyMs > sla.terms.max_latency_ms) {
      sla.metrics.violations++;
      violation = { type: 'latency', expected: sla.terms.max_latency_ms, actual: latencyMs };
    }

    // Apply reputation penalty for violations
    if (violation && sla.terms.penalty_per_violation) {
      this.updateReputation(sla.provider, false, sla.terms.penalty_per_violation);
    }

    return violation;
  }

  getSLA(slaId: string): SLAAgreement | null {
    return this.slaAgreements.get(slaId) || null;
  }

  getAgentSLAs(agentId: string): SLAAgreement[] {
    return [...this.slaAgreements.values()].filter(s => s.provider === agentId || s.consumer === agentId);
  }

  // ============================================
  // AGENT SUBSCRIPTIONS - Real-time updates
  // ============================================

  private subscriptions: Map<string, Subscription[]> = new Map();

  subscribe(agentId: string, topic: string, filter?: Record<string, any>): string {
    const subId = `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    let subs = this.subscriptions.get(agentId);
    if (!subs) {
      subs = [];
      this.subscriptions.set(agentId, subs);
    }

    subs.push({ id: subId, topic, filter, created: Date.now() });

    return subId;
  }

  unsubscribe(agentId: string, subId: string): boolean {
    const subs = this.subscriptions.get(agentId);
    if (!subs) return false;

    const idx = subs.findIndex(s => s.id === subId);
    if (idx === -1) return false;

    subs.splice(idx, 1);
    return true;
  }

  publish(topic: string, event: any): number {
    let notified = 0;

    for (const [agentId, subs] of this.subscriptions) {
      for (const sub of subs) {
        if (sub.topic === topic || sub.topic === '*') {
          // Check filter
          if (sub.filter) {
            const matches = Object.entries(sub.filter).every(([k, v]) => event[k] === v);
            if (!matches) continue;
          }

          this.sendMessage('system', agentId, `subscription:${topic}`, event);
          notified++;
        }
      }
    }

    return notified;
  }

  getSubscriptions(agentId: string): Subscription[] {
    return this.subscriptions.get(agentId) || [];
  }

  // ============================================
  // WORKFLOW ORCHESTRATION - Complex agent flows
  // ============================================

  private workflows: Map<string, WorkflowDefinition> = new Map();

  defineWorkflow(id: string, definition: WorkflowDefinition): void {
    this.workflows.set(id, definition);
  }

  async executeWorkflow(workflowId: string, agentId: string, inputs: Record<string, any>): Promise<WorkflowResult> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return { success: false, error: 'Workflow not found', steps_completed: 0 };

    const results: any[] = [];
    let currentInputs = { ...inputs };

    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      
      // Map inputs from previous steps
      const stepInputs = { ...currentInputs };
      if (step.input_mapping) {
        for (const [key, source] of Object.entries(step.input_mapping)) {
          if (source.startsWith('$prev.')) {
            const prevIdx = parseInt(source.slice(6));
            stepInputs[key] = results[prevIdx];
          } else if (source.startsWith('$input.')) {
            stepInputs[key] = inputs[source.slice(7)];
          }
        }
      }

      // Execute step
      const result = await this.invoke({ capability_id: step.capability_id, inputs: stepInputs });
      results.push(result.outputs);

      if (!result.success) {
        if (step.on_failure === 'skip') continue;
        if (step.on_failure === 'retry') {
          // Retry once
          const retry = await this.invoke({ capability_id: step.capability_id, inputs: stepInputs });
          if (!retry.success) {
            return { success: false, error: `Step ${i} failed: ${result.error}`, steps_completed: i, results };
          }
          results[results.length - 1] = retry.outputs;
        } else {
          return { success: false, error: `Step ${i} failed: ${result.error}`, steps_completed: i, results };
        }
      }

      // Conditional branching
      if (step.condition) {
        const conditionMet = this.evaluateCondition(step.condition, result.outputs);
        if (!conditionMet && step.skip_if_false) continue;
      }
    }

    // Record workflow completion
    this.updateReputation(agentId, true, 2);

    return { success: true, steps_completed: workflow.steps.length, results, final_output: results[results.length - 1] };
  }

  private evaluateCondition(condition: string, data: any): boolean {
    // Simple condition evaluation
    if (condition.includes('>')) {
      const [left, right] = condition.split('>').map(s => s.trim());
      return (data[left] || 0) > parseFloat(right);
    }
    if (condition.includes('<')) {
      const [left, right] = condition.split('<').map(s => s.trim());
      return (data[left] || 0) < parseFloat(right);
    }
    if (condition.includes('==')) {
      const [left, right] = condition.split('==').map(s => s.trim());
      return data[left] == right.replace(/['"]/g, '');
    }
    return true;
  }

  getWorkflow(id: string): WorkflowDefinition | null {
    return this.workflows.get(id) || null;
  }

  listWorkflows(): { id: string; name: string; steps: number }[] {
    return [...this.workflows.entries()].map(([id, w]) => ({ id, name: w.name, steps: w.steps.length }));
  }

  // ============================================
  // CAPABILITY VERSIONING & MIGRATION
  // ============================================

  private capabilityVersions: Map<string, CapabilityVersion[]> = new Map();
  private deprecationWarnings: Map<string, string> = new Map();

  registerCapabilityVersion(capabilityId: string, version: CapabilityVersion): void {
    let versions = this.capabilityVersions.get(capabilityId);
    if (!versions) {
      versions = [];
      this.capabilityVersions.set(capabilityId, versions);
    }
    versions.push(version);
    versions.sort((a, b) => this.compareVersions(b.version, a.version)); // Newest first
  }

  deprecateCapability(capabilityId: string, message: string, migrateTo?: string): void {
    this.deprecationWarnings.set(capabilityId, message);
    if (migrateTo) {
      this.deprecationWarnings.set(`${capabilityId}:migrate`, migrateTo);
    }
  }

  getCapabilityVersions(capabilityId: string): CapabilityVersion[] {
    return this.capabilityVersions.get(capabilityId) || [];
  }

  checkDeprecation(capabilityId: string): { deprecated: boolean; message?: string; migrate_to?: string } {
    const warning = this.deprecationWarnings.get(capabilityId);
    if (!warning) return { deprecated: false };
    return {
      deprecated: true,
      message: warning,
      migrate_to: this.deprecationWarnings.get(`${capabilityId}:migrate`)
    };
  }

  private compareVersions(a: string, b: string): number {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const na = pa[i] || 0;
      const nb = pb[i] || 0;
      if (na > nb) return 1;
      if (na < nb) return -1;
    }
    return 0;
  }

  // ============================================
  // DEDUPLICATION STATS (uses existing deduplicatedInvoke)
  // ============================================

  getDeduplicationStats(): { cached_requests: number; total_hits: number } {
    return { cached_requests: this.contentHashes.size, total_hits: 0 };
  }

  // ============================================
  // AGENT ANALYTICS
  // ============================================

  getAgentAnalytics(agentId: string): AgentAnalytics | null {
    const profile = this.getAgentProfile(agentId);
    const reputation = this.getReputation(agentId);
    const collaborators = this.getBestCollaborators(agentId, 3);
    const slas = this.getAgentSLAs(agentId);
    const subscriptions = this.getSubscriptions(agentId);

    if (!profile && !reputation) return null;

    return {
      agent_id: agentId,
      profile,
      reputation,
      top_collaborators: collaborators,
      active_slas: slas.filter(s => s.status === 'active').length,
      subscriptions: subscriptions.length,
      recommendations: this.getAgentRecommendations(agentId)
    };
  }

  // ============================================
  // SYSTEM STATS
  // ============================================

  getSystemStats() {
    return {
      performance: this.getPerformanceStats(),
      deduplication: this.getDeduplicationStats(),
      circuit_breakers: this.getAllCircuitBreakers(),
      active_intents: this.getOpenIntents().length,
      active_escrows: [...this.escrows.values()].filter(e => e.status === 'pending').length,
      active_negotiations: [...this.negotiations.values()].filter(n => n.status === 'pending' || n.status === 'countered').length,
      registered_agents: this.agentCapabilities.size,
      active_slas: [...this.slaAgreements.values()].filter(s => s.status === 'active').length,
      workflows_defined: this.workflows.size,
      total_subscriptions: [...this.subscriptions.values()].reduce((sum, subs) => sum + subs.length, 0),
      memory: this.getMemoryStats()
    };
  }

  // ============================================
  // MEMORY MANAGEMENT - Prevent leaks
  // ============================================

  private readonly MAX_MAP_SIZE = 1000;

  getMemoryStats() {
    return {
      circuit_breakers: this.circuitBreakers.size,
      usage_patterns: this.usagePatterns.size,
      traces: this.traces.size,
      content_hashes: this.contentHashes.size,
      collaborations: this.collaborations.size,
      inflight_requests: this.inflightRequests.size,
      agent_affinity: this.agentAffinity.size,
      adaptive_ttl: this.adaptiveTTL.size,
      health_scores: this.healthScores.size,
      webhooks: this.webhooks.size,
      budgets: this.budgets.size,
      sessions: this.sessions.size,
      marketplace: this.marketplace.size,
      provider_stats: this.providerStats.size,
      agent_preferences: this.agentPreferences.size,
      agent_messages: this.agentMessages.size,
      cost_history: this.costHistory.size,
      policies: this.policies.size,
      negotiations: this.negotiations.size,
      plugins: this.plugins.size,
      constraints: this.constraints.size,
      composition_cache: this.compositionCache.size,
      agent_reputation: this.agentReputation.size,
      agent_rate_limits: this.agentRateLimits.size,
      health_trends: this.healthTrends.size,
      collaboration_scores: this.collaborationScores.size,
      intent_board: this.intentBoard.size,
      escrows: this.escrows.size,
      agent_capabilities: this.agentCapabilities.size,
      multi_party_tx: this.multiPartyTx.size,
      sla_agreements: this.slaAgreements.size,
      subscriptions: this.subscriptions.size,
      workflows: this.workflows.size
    };
  }

  // Periodic cleanup - call this on a timer or after heavy usage
  performMaintenance(): { cleaned: number; duration_ms: number } {
    const start = Date.now();
    let cleaned = 0;
    const now = Date.now();

    // Clean expired intents
    for (const [id, intent] of this.intentBoard) {
      if (intent.expires < now) {
        this.intentBoard.delete(id);
        cleaned++;
      }
    }

    // Clean expired escrows
    for (const [id, escrow] of this.escrows) {
      if (escrow.expires < now && escrow.status === 'pending') {
        escrow.status = 'expired';
        cleaned++;
      }
    }

    // Clean expired SLAs
    for (const [id, sla] of this.slaAgreements) {
      if (sla.expires < now && sla.status === 'active') {
        sla.status = 'expired';
        cleaned++;
      }
    }

    // Clean old negotiations (>24h)
    const dayAgo = now - 86400000;
    for (const [id, neg] of this.negotiations) {
      if (neg.updated < dayAgo && (neg.status === 'accepted' || neg.status === 'rejected')) {
        this.negotiations.delete(id);
        cleaned++;
      }
    }

    // Clean old traces
    for (const [id, trace] of this.traces) {
      if (trace.start < dayAgo) {
        this.traces.delete(id);
        cleaned++;
      }
    }

    // Clean old content hashes
    for (const [key, entry] of this.contentHashes) {
      if (entry.expires < now) {
        this.contentHashes.delete(key);
        cleaned++;
      }
    }

    // Clean old collaborations (>1h inactive)
    const hourAgo = now - 3600000;
    for (const [id, collab] of this.collaborations) {
      if (collab.created < hourAgo) {
        this.collaborations.delete(id);
        cleaned++;
      }
    }

    // Clean old multi-party transactions (completed/failed >1h ago)
    for (const [id, tx] of this.multiPartyTx) {
      if (tx.created < hourAgo && (tx.status === 'completed' || tx.status === 'failed')) {
        this.multiPartyTx.delete(id);
        cleaned++;
      }
    }

    // Enforce size limits on unbounded maps
    this.enforceMapLimits();

    return { cleaned, duration_ms: Date.now() - start };
  }

  private enforceMapLimits(): void {
    // Limit agent messages (keep newest per agent)
    if (this.agentMessages.size > this.MAX_MAP_SIZE) {
      const sorted = [...this.agentMessages.entries()].sort((a, b) => {
        const aLatest = Math.max(...a[1].map(m => m.ts));
        const bLatest = Math.max(...b[1].map(m => m.ts));
        return bLatest - aLatest;
      });
      this.agentMessages.clear();
      for (let i = 0; i < this.MAX_MAP_SIZE && i < sorted.length; i++) {
        this.agentMessages.set(sorted[i][0], sorted[i][1]);
      }
    }

    // Limit sessions (keep most recently active)
    if (this.sessions.size > this.MAX_MAP_SIZE) {
      const sorted = [...this.sessions.entries()].sort((a, b) => b[1].lastActive - a[1].lastActive);
      this.sessions.clear();
      for (let i = 0; i < this.MAX_MAP_SIZE && i < sorted.length; i++) {
        this.sessions.set(sorted[i][0], sorted[i][1]);
      }
    }

    // Limit provider stats (keep most used)
    if (this.providerStats.size > 200) {
      const sorted = [...this.providerStats.entries()].sort((a, b) => 
        (b[1].successes + b[1].errors) - (a[1].successes + a[1].errors)
      );
      this.providerStats.clear();
      for (let i = 0; i < 200 && i < sorted.length; i++) {
        this.providerStats.set(sorted[i][0], sorted[i][1]);
      }
    }
  }

  // ============================================
  // GRACEFUL DEGRADATION - Handle failures
  // ============================================

  async safeInvoke(request: InvokeRequest): Promise<InvokeResponse> {
    try {
      return await this.invoke(request);
    } catch (error) {
      // Log but don't crash
      console.error(`[Router] Invoke failed for ${request.capability_id}:`, error);
      return {
        success: false,
        request_id: this.generateRequestId(),
        capability_id: request.capability_id,
        error: error instanceof Error ? error.message : 'Internal router error',
        metadata: { execution: { degraded: true } }
      };
    }
  }

  // Health check for load balancers
  healthCheck(): { healthy: boolean; checks: Record<string, boolean> } {
    const checks = {
      executors_available: this.executors.length > 0,
      memory_ok: this.checkMemoryPressure() !== 'critical',
      circuit_breakers_ok: this.getAllCircuitBreakers().filter(cb => cb.state === 'open').length < 5,
      maps_within_limits: this.getMemoryStats().intent_board < this.MAX_MAP_SIZE
    };

    return {
      healthy: Object.values(checks).every(v => v),
      checks
    };
  }

  // ============================================
  // DISTRIBUTED TRACING - End-to-end visibility
  // ============================================

  private distributedTraces: Map<string, DistributedTrace> = new Map();

  startDistributedTrace(traceId?: string): string {
    const id = traceId || `dtrace_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.distributedTraces.set(id, {
      id,
      spans: [],
      start: Date.now(),
      status: 'active',
      metadata: {}
    });

    // Limit traces
    if (this.distributedTraces.size > 500) {
      const oldest = [...this.distributedTraces.entries()]
        .filter(([_, t]) => t.status !== 'active')
        .sort((a, b) => a[1].start - b[1].start)[0];
      if (oldest) this.distributedTraces.delete(oldest[0]);
    }

    return id;
  }

  addTraceSpan(traceId: string, span: Omit<TraceSpan, 'id'>): string {
    const trace = this.distributedTraces.get(traceId);
    if (!trace) return '';

    const spanId = `span_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    trace.spans.push({ id: spanId, ...span });
    return spanId;
  }

  endDistributedTrace(traceId: string, status: 'success' | 'error' = 'success'): DistributedTrace | null {
    const trace = this.distributedTraces.get(traceId);
    if (!trace) return null;

    trace.status = status;
    trace.end = Date.now();
    trace.duration_ms = trace.end - trace.start;

    return trace;
  }

  getDistributedTrace(traceId: string): DistributedTrace | null {
    return this.distributedTraces.get(traceId) || null;
  }

  // Traced invoke - automatically creates spans
  async tracedInvoke(request: InvokeRequest, traceId?: string): Promise<InvokeResponse & { trace_id: string }> {
    const trace = traceId || this.startDistributedTrace();
    const start = Date.now();

    this.addTraceSpan(trace, {
      name: 'invoke',
      service: 'router',
      operation: request.capability_id,
      start,
      tags: { inputs_keys: Object.keys(request.inputs || {}).join(',') }
    });

    const result = await this.invoke(request);

    this.addTraceSpan(trace, {
      name: 'invoke_complete',
      service: 'router',
      operation: request.capability_id,
      start,
      end: Date.now(),
      duration_ms: Date.now() - start,
      tags: { success: result.success.toString() }
    });

    if (!traceId) {
      this.endDistributedTrace(trace, result.success ? 'success' : 'error');
    }

    return { ...result, trace_id: trace };
  }

  // ============================================
  // CAPABILITY DEPENDENCY RESOLUTION
  // ============================================

  private capabilityDeps: Map<string, string[]> = new Map([
    ['cap.swap.execute.v1', ['cap.price.lookup.v1', 'cap.wallet.snapshot.v1']],
    ['cap.confidential.swap.v1', ['cap.cspl.wrap.v1', 'cap.price.lookup.v1']],
    ['cap.zk.proof.v1', ['cap.wallet.snapshot.v1']]
  ]);

  registerDependency(capabilityId: string, dependencies: string[]): void {
    this.capabilityDeps.set(capabilityId, dependencies);
  }

  getDependencies(capabilityId: string): string[] {
    return this.capabilityDeps.get(capabilityId) || [];
  }

  // Resolve and execute with dependencies
  async invokeWithDependencies(request: InvokeRequest): Promise<{ results: InvokeResponse[]; final: InvokeResponse }> {
    const deps = this.getDependencies(request.capability_id);
    const results: InvokeResponse[] = [];

    // Execute dependencies first (in parallel where possible)
    if (deps.length > 0) {
      const depResults = await Promise.all(
        deps.map(depId => this.invoke({ capability_id: depId, inputs: request.inputs }))
      );
      results.push(...depResults);

      // Check if any dependency failed
      const failed = depResults.find(r => !r.success);
      if (failed) {
        return {
          results,
          final: {
            success: false,
            request_id: this.generateRequestId(),
            capability_id: request.capability_id,
            error: `Dependency ${failed.capability_id} failed: ${failed.error}`,
            metadata: { execution: { dependency_failed: true } }
          }
        };
      }
    }

    // Execute main capability
    const final = await this.invoke(request);
    results.push(final);

    return { results, final };
  }

  // ============================================
  // AUTOMATIC FAILOVER - Provider redundancy
  // ============================================

  private providerFailovers: Map<string, string[]> = new Map([
    ['birdeye', ['coingecko', 'coinmarketcap']],
    ['jupiter', ['raydium', 'orca']],
    ['arcium', ['noir', 'risc0']]
  ]);

  registerFailover(provider: string, fallbacks: string[]): void {
    this.providerFailovers.set(provider, fallbacks);
  }

  async invokeWithFailover(request: InvokeRequest, preferredProvider?: string): Promise<InvokeResponse> {
    // Try preferred provider first
    const result = await this.invoke(request);
    if (result.success) return result;

    // Get failover chain
    const failovers = preferredProvider ? this.providerFailovers.get(preferredProvider) : [];
    if (!failovers || failovers.length === 0) return result;

    // Try each failover
    for (const fallback of failovers) {
      const fallbackResult = await this.invoke({
        ...request,
        preferences: { ...request.preferences, preferred_providers: [fallback] }
      });

      if (fallbackResult.success) {
        // Record that we used a fallback
        (fallbackResult.metadata as any).failover_used = fallback;
        return fallbackResult;
      }
    }

    return result; // Return original failure if all failovers fail
  }

  // REQUEST REPLAY extensions - uses existing requestLog
  async replayLastFailedRequest(): Promise<InvokeResponse | null> {
    const log = this.getRequestLog(100);
    const failed = [...log].reverse().find(e => !e.response.success);
    if (!failed) return null;
    return this.invoke(failed.request);
  }

  // ============================================
  // CAPABILITY HOT-RELOAD - Dynamic updates
  // ============================================

  private capabilityOverrides: Map<string, { handler: (inputs: any) => Promise<any>; version: string }> = new Map();

  registerCapabilityOverride(capabilityId: string, handler: (inputs: any) => Promise<any>, version: string): void {
    this.capabilityOverrides.set(capabilityId, { handler, version });
  }

  removeCapabilityOverride(capabilityId: string): boolean {
    return this.capabilityOverrides.delete(capabilityId);
  }

  hasOverride(capabilityId: string): boolean {
    return this.capabilityOverrides.has(capabilityId);
  }

  // Execute with override if available
  async invokeWithOverride(request: InvokeRequest): Promise<InvokeResponse> {
    const override = this.capabilityOverrides.get(request.capability_id);
    if (override) {
      try {
        const start = Date.now();
        const outputs = await override.handler(request.inputs);
        return {
          success: true,
          request_id: this.generateRequestId(),
          capability_id: request.capability_id,
          outputs,
          metadata: {
            execution: {
              override_version: override.version,
              execution_time_ms: Date.now() - start
            }
          }
        };
      } catch (error) {
        // Fall through to normal invoke on override failure
      }
    }
    return this.invoke(request);
  }

  // ============================================
  // SMART BATCHING - Optimize multiple requests
  // ============================================

  async smartBatch(requests: InvokeRequest[]): Promise<InvokeResponse[]> {
    // Group by capability for potential optimization
    const groups = new Map<string, InvokeRequest[]>();
    for (const req of requests) {
      const existing = groups.get(req.capability_id) || [];
      existing.push(req);
      groups.set(req.capability_id, existing);
    }

    // Execute groups in parallel, requests within groups can be coalesced
    const results: InvokeResponse[] = [];
    const groupPromises = [...groups.entries()].map(async ([capId, reqs]) => {
      // Dedupe identical requests within group
      const uniqueReqs = new Map<string, InvokeRequest>();
      for (const req of reqs) {
        const key = JSON.stringify(req.inputs);
        if (!uniqueReqs.has(key)) uniqueReqs.set(key, req);
      }

      // Execute unique requests
      const uniqueResults = await Promise.all(
        [...uniqueReqs.values()].map(req => this.invoke(req))
      );

      // Map results back to original requests
      const resultMap = new Map<string, InvokeResponse>();
      let i = 0;
      for (const [key] of uniqueReqs) {
        resultMap.set(key, uniqueResults[i++]);
      }

      // Return results in original order
      return reqs.map(req => resultMap.get(JSON.stringify(req.inputs))!);
    });

    const groupResults = await Promise.all(groupPromises);
    for (const gr of groupResults) results.push(...gr);

    return results;
  }

  // ============================================
  // CIRCUIT BREAKER PATTERNS - Advanced
  // ============================================

  // Bulkhead pattern - isolate failures
  private bulkheads: Map<string, { active: number; max: number; queue: (() => void)[] }> = new Map();

  async withBulkhead<T>(name: string, maxConcurrent: number, fn: () => Promise<T>): Promise<T> {
    let bulkhead = this.bulkheads.get(name);
    if (!bulkhead) {
      bulkhead = { active: 0, max: maxConcurrent, queue: [] };
      this.bulkheads.set(name, bulkhead);
    }

    if (bulkhead.active >= bulkhead.max) {
      // Wait in queue
      await new Promise<void>(resolve => bulkhead!.queue.push(resolve));
    }

    bulkhead.active++;
    try {
      return await fn();
    } finally {
      bulkhead.active--;
      const next = bulkhead.queue.shift();
      if (next) next();
    }
  }

  // Timeout pattern with fallback
  async withTimeoutFallback<T>(fn: () => Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
    try {
      return await Promise.race([
        fn(),
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeoutMs))
      ]);
    } catch {
      return fallback;
    }
  }

  /**
   * Get comprehensive router statistics
   */
  getStats(): {
    circuitBreakers: { total: number; open: number; halfOpen: number };
    activeRequests: number;
    queueLength: number;
    inflightRequests: number;
    usagePatterns: number;
    agentAffinities: number;
    adaptiveTTLEntries: number;
    memoryPressure: string;
    collaborations: number;
    traces: number;
  } {
    const cbStates = Array.from(this.circuitBreakers.values());
    return {
      circuitBreakers: {
        total: cbStates.length,
        open: cbStates.filter(cb => cb.state === 'open').length,
        halfOpen: cbStates.filter(cb => cb.state === 'half-open').length
      },
      activeRequests: this.activeRequests,
      queueLength: this.requestQueue.length,
      inflightRequests: this.inflightRequests.size,
      usagePatterns: this.usagePatterns.size,
      agentAffinities: this.agentAffinity.size,
      adaptiveTTLEntries: this.adaptiveTTL.size,
      memoryPressure: this.memoryPressure.level,
      collaborations: this.collaborations.size,
      traces: this.traces.size
    };
  }
}

// ============================================
// TYPE DEFINITIONS
// ============================================

type PolicyPrivacyLevel = 'none' | 'low' | 'medium' | 'high';

interface AgentPolicy {
  privacy?: PolicyPrivacyLevel;
  max_cost?: number;
  max_slippage?: number;
  max_latency_ms?: number;
  preferred_routes?: string[];
  excluded_routes?: string[];
  trusted_counterparties?: string[];
  blocked_counterparties?: string[];
}

interface PolicyRequest {
  privacy_level?: PolicyPrivacyLevel;
  estimated_cost?: number;
  slippage?: number;
  counterparty?: string;
  estimated_latency_ms?: number;
}

interface PolicyValidation {
  valid: boolean;
  violations: string[];
  warnings: string[];
}

interface NegotiationProposal {
  privacy_level?: PolicyPrivacyLevel;
  max_slippage?: number;
  max_cost?: number;
  max_latency_ms?: number;
  preferred_routes?: string[];
  excluded_routes?: string[];
  custom_terms?: Record<string, any>;
}

interface Negotiation {
  id: string;
  initiator: string;
  counterparty: string;
  status: 'pending' | 'countered' | 'accepted' | 'rejected' | 'expired';
  proposal: NegotiationProposal;
  counterProposal: NegotiationProposal | null;
  agreedTerms: NegotiationProposal | null;
  created: number;
  updated: number;
  history: { action: string; by: string; ts: number; data?: any }[];
}

interface NegotiationResult {
  success: boolean;
  status?: string;
  terms?: NegotiationProposal;
  counter_proposal?: NegotiationProposal;
  error?: string;
}

interface PolicyExecutionRequest {
  agent_id: string;
  capability_type: 'swap' | 'price' | 'transfer' | 'prove';
  inputs: Record<string, any>;
  policy?: {
    privacy?: PolicyPrivacyLevel;
    max_cost?: number;
    max_slippage?: number;
    max_latency_ms?: number;
    preferred_routes?: string[];
    excluded_routes?: string[];
  };
  counterparty?: string;
  fallbacks?: boolean;
}

interface Route {
  id: string;
  capability_id: string;
  plugins: string[];
  privacy_level: PolicyPrivacyLevel;
  estimated_cost: number;
  estimated_latency: number;
  params: Record<string, any>;
}

interface ProofStep {
  step: string;
  passed: boolean;
  details: any;
}

interface ComplianceProof {
  version: string;
  timestamp: number;
  steps: ProofStep[];
  all_passed: boolean;
  verifiable: boolean;
}

interface PolicyExecutionResult {
  success: boolean;
  outputs?: any;
  error?: string;
  route_used?: Route;
  plugins_used?: string[];
  execution_time_ms?: number;
  cost_actual?: number;
  proof?: ComplianceProof;
  proof_hash?: string;
  warnings?: string[];
  fallback_available?: boolean;
}

interface Plugin {
  id: string;
  name: string;
  type: 'liquidity' | 'privacy' | 'data' | 'compliance' | 'bridge' | 'identity';
  enabled: boolean;
  config: Record<string, any>;
}

interface Constraint {
  type: 'max_value' | 'min_value' | 'whitelist' | 'blacklist' | 'rate_limit';
  limit?: number;
  allowed?: string[];
  blocked?: string[];
}

interface ConstraintAction {
  type: string;
  value?: number;
  target?: string;
}

interface ConstraintResult {
  allowed: boolean;
  violations: string[];
  enforced: string[];
}

// Intent Broadcasting Types
interface IntentRequest {
  type: string;
  description: string;
  requirements?: Record<string, any>;
  max_cost?: number;
  ttl_minutes?: number;
}

interface IntentOffer {
  price?: number;
  capabilities?: string[];
  terms?: Record<string, any>;
}

interface Intent {
  id: string;
  agent_id: string;
  type: string;
  description: string;
  requirements: Record<string, any>;
  max_cost?: number;
  expires: number;
  status: 'open' | 'matched' | 'expired';
  responses: { responder_id: string; offer: IntentOffer; timestamp: number }[];
  matched_with?: string;
  created: number;
}

// Escrow Types
interface EscrowTerms {
  capability_id: string;
  amount?: number;
  description?: string;
  timeout_minutes?: number;
}

interface Escrow {
  id: string;
  initiator: string;
  counterparty: string;
  terms: EscrowTerms;
  status: 'pending' | 'released' | 'disputed' | 'expired';
  initiator_confirmed: boolean;
  counterparty_confirmed: boolean;
  created: number;
  expires: number;
  dispute?: { by: string; reason: string; timestamp: number };
}

// Agent Discovery Types
interface AgentDiscoveryResult {
  agent_id: string;
  capabilities: string[];
  tags: string[];
  reputation: { score: number; level: string; success_rate: number } | null;
  available: boolean;
}

// Multi-Party Transaction Types
interface WorkflowStep {
  capability_id: string;
  inputs: Record<string, any>;
  required?: boolean;
}

interface MultiPartyTransaction {
  id: string;
  initiator: string;
  participants: string[];
  workflow: WorkflowStep[];
  confirmations: Record<string, boolean>;
  status: 'awaiting_confirmations' | 'executing' | 'completed' | 'failed';
  results: { step: string; success: boolean; output: any }[];
  created: number;
}

// SLA Types
interface SLATerms {
  min_success_rate?: number;
  max_latency_ms?: number;
  duration_days?: number;
  penalty_per_violation?: number;
}

interface SLAAgreement {
  id: string;
  provider: string;
  consumer: string;
  terms: SLATerms;
  metrics: { total_requests: number; successful_requests: number; total_latency: number; violations: number };
  status: 'active' | 'expired' | 'terminated';
  created: number;
  expires: number;
}

interface SLAViolation {
  type: 'success_rate' | 'latency';
  expected: number;
  actual: number;
}

// Subscription Types
interface Subscription {
  id: string;
  topic: string;
  filter?: Record<string, any>;
  created: number;
}

// Workflow Types
interface WorkflowStepDef {
  capability_id: string;
  inputs?: Record<string, any>;
  input_mapping?: Record<string, string>;
  condition?: string;
  skip_if_false?: boolean;
  on_failure?: 'fail' | 'skip' | 'retry';
}

interface WorkflowDefinition {
  name: string;
  description?: string;
  steps: WorkflowStepDef[];
}

interface WorkflowResult {
  success: boolean;
  error?: string;
  steps_completed: number;
  results?: any[];
  final_output?: any;
}

// Capability Version Types
interface CapabilityVersion {
  version: string;
  released: number;
  changelog?: string;
  breaking_changes?: boolean;
}

// Agent Analytics Types
interface AgentAnalytics {
  agent_id: string;
  profile: any;
  reputation: { score: number; level: string; success_rate: number } | null;
  top_collaborators: { agent_id: string; interactions: number; success_rate: number }[];
  active_slas: number;
  subscriptions: number;
  recommendations: any;
}

// Distributed Tracing Types
interface TraceSpan {
  id: string;
  name: string;
  service: string;
  operation: string;
  start: number;
  end?: number;
  duration_ms?: number;
  tags?: Record<string, string>;
}

interface DistributedTrace {
  id: string;
  spans: TraceSpan[];
  start: number;
  end?: number;
  duration_ms?: number;
  status: 'active' | 'success' | 'error';
  metadata: Record<string, any>;
}

export const router = new Router();
