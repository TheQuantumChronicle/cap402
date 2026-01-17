import axios, { AxiosInstance, AxiosError } from 'axios';
import { EventEmitter } from 'events';
import * as crypto from 'crypto';

// ============================================
// TYPES
// ============================================

export interface AgentConfig {
  agent_id: string;
  name: string;
  router_url?: string;
  description?: string;
  capabilities_provided?: string[];
  capabilities_required?: string[];
  endpoint?: string;
  api_key?: string;
  timeout?: number;
  retry_attempts?: number;
  retry_delay_ms?: number;
  health_check_interval_ms?: number;
  auto_reconnect?: boolean;
  log_level?: 'debug' | 'info' | 'warn' | 'error';
  tags?: string[];
}

export interface AgentState {
  status: 'initializing' | 'ready' | 'running' | 'paused' | 'stopping' | 'stopped' | 'error';
  registered: boolean;
  connected: boolean;
  last_heartbeat: number;
  uptime_ms: number;
  requests_processed: number;
  errors_count: number;
  current_task?: string;
}

export interface InvokeResult<T = any> {
  success: boolean;
  request_id: string;
  capability_id: string;
  outputs?: T;
  error?: string;
  metadata: {
    execution: {
      execution_time_ms: number;
      cost_actual?: number;
      currency?: string;
      provider?: string;
    };
    economic_hints?: any;
    chain_signal?: any;
    privacy_level?: number;
  };
}

export interface A2AMessage {
  from_agent: string;
  to_agent: string;
  message_type: 'request' | 'response' | 'broadcast' | 'handshake';
  payload: any;
  timestamp: number;
  signature?: string;
}

export interface A2AInvokeRequest {
  to_agent: string;
  capability_id: string;
  inputs: Record<string, any>;
  timeout_ms?: number;
  require_trust?: number;
}

export interface SwarmTask {
  capability_id: string;
  inputs: Record<string, any>;
  min_agents?: number;
  max_agents?: number;
  strategy?: 'parallel' | 'sequential' | 'consensus';
  timeout_ms?: number;
}

export interface AuctionRequest {
  capability_id: string;
  inputs?: Record<string, any>;
  max_price?: number;
  min_trust_score?: number;
  timeout_ms?: number;
}

// ============================================
// PRODUCTION AGENT CLASS
// ============================================

export class CAP402Agent extends EventEmitter {
  private config: Required<AgentConfig>;
  private client: AxiosInstance;
  private state: AgentState;
  private startTime: number = 0;
  private healthCheckTimer?: NodeJS.Timeout;
  private messageQueue: A2AMessage[] = [];
  private pendingRequests: Map<string, { resolve: Function; reject: Function; timeout: NodeJS.Timeout }> = new Map();
  private circuitBreaker: Map<string, { failures: number; lastFailure: number; open: boolean }> = new Map();
  private metrics: {
    invocations: number;
    successes: number;
    failures: number;
    total_latency_ms: number;
    by_capability: Map<string, { count: number; latency: number; errors: number }>;
  };

  constructor(config: AgentConfig) {
    super();
    
    this.config = {
      router_url: 'https://cap402.com',
      description: '',
      capabilities_provided: [],
      capabilities_required: [],
      endpoint: '',
      api_key: '',
      timeout: 30000,
      retry_attempts: 3,
      retry_delay_ms: 1000,
      health_check_interval_ms: 30000,
      auto_reconnect: true,
      log_level: 'info',
      tags: [],
      ...config
    };

    this.state = {
      status: 'initializing',
      registered: false,
      connected: false,
      last_heartbeat: 0,
      uptime_ms: 0,
      requests_processed: 0,
      errors_count: 0
    };

    this.metrics = {
      invocations: 0,
      successes: 0,
      failures: 0,
      total_latency_ms: 0,
      by_capability: new Map()
    };

    this.client = axios.create({
      baseURL: this.config.router_url,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-ID': this.config.agent_id,
        ...(this.config.api_key ? { 'X-API-Key': this.config.api_key } : {})
      }
    });

    this.setupInterceptors();
  }

  // ============================================
  // LIFECYCLE MANAGEMENT
  // ============================================

  async start(): Promise<void> {
    this.log('info', `Starting agent: ${this.config.agent_id}`);
    this.startTime = Date.now();
    this.state.status = 'initializing';

    try {
      // Check router connectivity
      await this.checkConnectivity();
      
      // Register with router
      await this.register();
      
      // Start health check loop
      this.startHealthCheck();
      
      this.state.status = 'ready';
      this.emit('ready', { agent_id: this.config.agent_id });
      this.log('info', `Agent ${this.config.agent_id} is ready`);
    } catch (error) {
      this.state.status = 'error';
      this.emit('error', error);
      throw error;
    }
  }

  async stop(graceful: boolean = true): Promise<void> {
    this.log('info', `Stopping agent: ${this.config.agent_id} (graceful: ${graceful})`);
    this.state.status = 'stopping';

    // Stop health checks
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }

    if (graceful) {
      // Wait for pending requests to complete (max 10s)
      const timeout = Date.now() + 10000;
      while (this.pendingRequests.size > 0 && Date.now() < timeout) {
        await this.sleep(100);
      }

      // Cancel remaining requests
      this.pendingRequests.forEach((req, id) => {
        clearTimeout(req.timeout);
        req.reject(new Error('Agent shutting down'));
      });
      this.pendingRequests.clear();
    }

    // Deregister from router
    try {
      await this.client.post('/agents/deregister', { agent_id: this.config.agent_id });
    } catch {
      // Ignore deregistration errors during shutdown
    }

    this.state.status = 'stopped';
    this.state.registered = false;
    this.state.connected = false;
    this.emit('stopped', { agent_id: this.config.agent_id });
    this.log('info', `Agent ${this.config.agent_id} stopped`);
    
    // Remove all event listeners to prevent memory leaks
    this.removeAllListeners();
  }

  pause(): void {
    if (this.state.status === 'running' || this.state.status === 'ready') {
      this.state.status = 'paused';
      this.emit('paused');
      this.log('info', 'Agent paused');
    }
  }

  resume(): void {
    if (this.state.status === 'paused') {
      this.state.status = 'ready';
      this.emit('resumed');
      this.log('info', 'Agent resumed');
    }
  }

  getState(): AgentState {
    return {
      ...this.state,
      uptime_ms: this.startTime ? Date.now() - this.startTime : 0
    };
  }

  // ============================================
  // CAPABILITY INVOCATION
  // ============================================

  async invoke<T = any>(
    capability_id: string,
    inputs: Record<string, any>,
    options?: {
      timeout_ms?: number;
      privacy_level?: number;
      max_cost?: number;
      skip_cache?: boolean;
    }
  ): Promise<InvokeResult<T>> {
    this.assertReady();
    
    const startTime = Date.now();
    const requestId = this.generateRequestId();

    // Check circuit breaker
    if (this.isCircuitOpen(capability_id)) {
      throw new Error(`Circuit breaker open for ${capability_id}`);
    }

    this.state.current_task = `invoke:${capability_id}`;
    this.metrics.invocations++;

    try {
      const response = await this.withRetry(async () => {
        return this.client.post<InvokeResult<T>>('/invoke', {
          capability_id,
          inputs,
          preferences: {
            privacy_level: options?.privacy_level,
            max_cost: options?.max_cost,
            skip_cache: options?.skip_cache
          }
        }, {
          timeout: options?.timeout_ms || this.config.timeout
        });
      });

      const result = response.data;
      const latency = Date.now() - startTime;

      this.recordSuccess(capability_id, latency);
      this.state.requests_processed++;
      this.state.current_task = undefined;

      this.emit('invocation', {
        capability_id,
        request_id: result.request_id,
        success: result.success,
        latency_ms: latency
      });

      return result;
    } catch (error) {
      const latency = Date.now() - startTime;
      this.recordFailure(capability_id, latency);
      this.state.errors_count++;
      this.state.current_task = undefined;

      this.emit('error', {
        type: 'invocation',
        capability_id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      throw error;
    }
  }

  async batchInvoke(
    requests: Array<{ capability_id: string; inputs: Record<string, any> }>
  ): Promise<{ success: boolean; results: InvokeResult[]; total_time_ms: number }> {
    this.assertReady();

    const startTime = Date.now();
    const response = await this.client.post('/batch/invoke', { requests });
    
    return {
      ...response.data,
      total_time_ms: Date.now() - startTime
    };
  }

  async smartInvoke<T = any>(
    capability_id: string,
    inputs: Record<string, any>,
    options?: {
      prefetch?: boolean;
      include_recommendations?: boolean;
    }
  ): Promise<InvokeResult<T> & { recommendations?: any; prefetched?: string[] }> {
    this.assertReady();

    const response = await this.client.post('/smart/invoke', {
      capability_id,
      inputs,
      options
    });

    return response.data;
  }

  // ============================================
  // A2A PROTOCOL
  // ============================================

  async a2aInvoke<T = any>(request: A2AInvokeRequest): Promise<InvokeResult<T>> {
    this.assertReady();

    const response = await this.client.post<InvokeResult<T>>('/a2a/invoke', {
      from_agent: this.config.agent_id,
      to_agent: request.to_agent,
      capability_id: request.capability_id,
      inputs: request.inputs
    }, {
      timeout: request.timeout_ms || this.config.timeout
    });

    return response.data;
  }

  async discoverAgents(query?: {
    capability?: string;
    min_trust_score?: number;
    tags?: string[];
    limit?: number;
  }): Promise<Array<{
    agent_id: string;
    name: string;
    capabilities: string[];
    trust_score: number;
    available: boolean;
  }>> {
    const response = await this.client.get('/agents/discover', { params: query });
    return response.data.agents || [];
  }

  async findAgentsByCapability(capability_id: string): Promise<string[]> {
    const response = await this.client.get(`/a2a/discover/${capability_id}`);
    return response.data.agents || [];
  }

  async startAuction(request: AuctionRequest): Promise<{
    auction_id: string;
    winner?: { agent_id: string; bid: number };
    bids: Array<{ agent_id: string; price: number; trust_score: number }>;
  }> {
    this.assertReady();

    const response = await this.client.post('/a2a/auction', {
      requester_agent: this.config.agent_id,
      capability_id: request.capability_id,
      inputs: request.inputs,
      max_price: request.max_price,
      min_trust_score: request.min_trust_score
    }, {
      timeout: request.timeout_ms || 30000
    });

    return response.data;
  }

  async coordinateSwarm(task: SwarmTask): Promise<{
    swarm_id: string;
    participants: string[];
    results: any[];
    consensus?: any;
    execution_time_ms: number;
  }> {
    this.assertReady();

    const response = await this.client.post('/a2a/swarm', {
      coordinator_agent: this.config.agent_id,
      task: {
        capability_id: task.capability_id,
        inputs: task.inputs
      },
      agents: [], // Will be auto-discovered by router
      min_agents: task.min_agents || 2,
      max_agents: task.max_agents || 10,
      strategy: task.strategy || 'parallel'
    }, {
      timeout: task.timeout_ms || 60000
    });

    return response.data;
  }

  async sendMessage(to_agent: string, payload: any): Promise<{ delivered: boolean; message_id: string }> {
    const message: A2AMessage = {
      from_agent: this.config.agent_id,
      to_agent,
      message_type: 'broadcast',
      payload,
      timestamp: Date.now()
    };

    const response = await this.client.post('/a2a/message', message);
    return response.data;
  }

  async getMessages(since?: number): Promise<A2AMessage[]> {
    const response = await this.client.get(`/agents/${this.config.agent_id}/messages`, {
      params: { since }
    });
    return response.data.messages || [];
  }

  // ============================================
  // TRUST & REPUTATION
  // ============================================

  async getTrustScore(agent_id?: string): Promise<{
    score: number;
    level: string;
    endorsements: number;
    history: { total: number; successful: number };
  }> {
    const id = agent_id || this.config.agent_id;
    const response = await this.client.get(`/security/trust/${id}`);
    return response.data;
  }

  async endorseAgent(agent_id: string, score: number, reason?: string): Promise<{ success: boolean }> {
    const response = await this.client.post('/security/trust/endorse', {
      from_agent: this.config.agent_id,
      to_agent: agent_id,
      score,
      reason
    });
    return response.data;
  }

  async getLeaderboard(category?: string): Promise<Array<{
    rank: number;
    agent_id: string;
    score: number;
    metrics: any;
  }>> {
    const response = await this.client.get('/a2a/leaderboard', {
      params: { category }
    });
    return response.data.leaderboard || [];
  }

  // ============================================
  // WORKFLOWS & COMPOSITION
  // ============================================

  async executeWorkflow(
    steps: Array<{
      capability_id: string;
      inputs: Record<string, any> | ((prev: any) => Record<string, any>);
      on_error?: 'fail' | 'skip' | 'retry';
    }>
  ): Promise<{
    success: boolean;
    results: InvokeResult[];
    failed_step?: number;
    total_time_ms: number;
  }> {
    this.assertReady();

    const results: InvokeResult[] = [];
    const startTime = Date.now();
    let previousOutput: any = null;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const inputs = typeof step.inputs === 'function'
        ? step.inputs(previousOutput)
        : step.inputs;

      try {
        const result = await this.invoke(step.capability_id, inputs);
        results.push(result);

        if (!result.success) {
          if (step.on_error === 'skip') continue;
          if (step.on_error === 'retry') {
            const retry = await this.invoke(step.capability_id, inputs);
            results[results.length - 1] = retry;
            if (!retry.success) {
              return { success: false, results, failed_step: i, total_time_ms: Date.now() - startTime };
            }
          } else {
            return { success: false, results, failed_step: i, total_time_ms: Date.now() - startTime };
          }
        }

        previousOutput = result.outputs;
      } catch (error) {
        if (step.on_error === 'skip') continue;
        return { success: false, results, failed_step: i, total_time_ms: Date.now() - startTime };
      }
    }

    return { success: true, results, total_time_ms: Date.now() - startTime };
  }

  async compose(composition: {
    name: string;
    steps: Array<{ capability_id: string; inputs: Record<string, any> }>;
  }): Promise<any> {
    const response = await this.client.post('/compose', composition);
    return response.data;
  }

  // ============================================
  // SECURITY
  // ============================================

  async issueToken(
    capabilities?: string[],
    expires_in_hours?: number
  ): Promise<{ token: string; expires_at: number }> {
    const response = await this.client.post('/security/tokens/issue', {
      agent_id: this.config.agent_id,
      capabilities,
      expires_in_hours
    });
    return response.data;
  }

  async initiateHandshake(target_agent: string): Promise<{
    handshake_id: string;
    challenge: string;
    expires_at: number;
  }> {
    const response = await this.client.post('/security/handshake/initiate', {
      initiator: this.config.agent_id,
      target: target_agent
    });
    return response.data;
  }

  async completeHandshake(handshake_id: string, response_data: any): Promise<{
    success: boolean;
    session_key?: string;
  }> {
    const response = await this.client.post('/security/handshake/respond', {
      handshake_id,
      agent_id: this.config.agent_id,
      response: response_data
    });
    return response.data;
  }

  // ============================================
  // OBSERVABILITY
  // ============================================

  getMetrics(): {
    invocations: number;
    success_rate: number;
    avg_latency_ms: number;
    errors: number;
    uptime_ms: number;
    by_capability: Record<string, { count: number; avg_latency_ms: number; error_rate: number }>;
  } {
    const byCapability: Record<string, any> = {};
    this.metrics.by_capability.forEach((data, cap) => {
      byCapability[cap] = {
        count: data.count,
        avg_latency_ms: data.count > 0 ? Math.round(data.latency / data.count) : 0,
        error_rate: data.count > 0 ? data.errors / data.count : 0
      };
    });

    return {
      invocations: this.metrics.invocations,
      success_rate: this.metrics.invocations > 0 
        ? this.metrics.successes / this.metrics.invocations 
        : 1,
      avg_latency_ms: this.metrics.invocations > 0
        ? Math.round(this.metrics.total_latency_ms / this.metrics.invocations)
        : 0,
      errors: this.metrics.failures,
      uptime_ms: this.startTime ? Date.now() - this.startTime : 0,
      by_capability: byCapability
    };
  }

  async reportMetrics(): Promise<void> {
    const metrics = this.getMetrics();
    await this.client.post('/agents/metrics', {
      agent_id: this.config.agent_id,
      metrics,
      timestamp: Date.now()
    }).catch(() => {
      // Ignore metrics reporting errors
    });
  }

  // ============================================
  // PRIVATE HELPERS
  // ============================================

  private async register(): Promise<void> {
    const response = await this.client.post('/agents/register', {
      agent_id: this.config.agent_id,
      name: this.config.name,
      description: this.config.description,
      capabilities_provided: this.config.capabilities_provided,
      capabilities_required: this.config.capabilities_required,
      endpoint: this.config.endpoint,
      tags: this.config.tags
    });

    if (!response.data.success && !response.data.agent_id) {
      throw new Error('Agent registration failed');
    }

    this.state.registered = true;
    this.log('info', `Agent registered: ${this.config.agent_id}`);
  }

  private async checkConnectivity(): Promise<void> {
    try {
      const response = await this.client.get('/health', { timeout: 5000 });
      if (response.data.status === 'healthy' || response.data.success) {
        this.state.connected = true;
        this.log('debug', 'Router connectivity confirmed');
      } else {
        throw new Error('Router unhealthy');
      }
    } catch (error) {
      this.state.connected = false;
      throw new Error(`Cannot connect to router at ${this.config.router_url}`);
    }
  }

  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(async () => {
      try {
        await this.checkConnectivity();
        this.state.last_heartbeat = Date.now();
        
        // Report metrics periodically
        await this.reportMetrics();
        
        this.emit('heartbeat', { timestamp: this.state.last_heartbeat });
      } catch (error) {
        this.state.connected = false;
        this.emit('disconnected', { error });
        
        if (this.config.auto_reconnect) {
          this.log('warn', 'Connection lost, attempting reconnect...');
          try {
            await this.checkConnectivity();
            await this.register();
            this.log('info', 'Reconnected successfully');
            this.emit('reconnected');
          } catch {
            this.log('error', 'Reconnection failed');
          }
        }
      }
    }, this.config.health_check_interval_ms);
  }

  private setupInterceptors(): void {
    // Request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        this.log('debug', `Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        this.log('error', `Request error: ${error.message}`);
        return Promise.reject(error);
      }
    );

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response?.status === 429) {
          this.emit('rate_limited', { retry_after: error.response.headers['retry-after'] });
        }
        return Promise.reject(error);
      }
    );
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.retry_attempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        
        if (attempt < this.config.retry_attempts) {
          const delay = this.config.retry_delay_ms * Math.pow(2, attempt - 1);
          this.log('debug', `Retry ${attempt}/${this.config.retry_attempts} after ${delay}ms`);
          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  private assertReady(): void {
    if (this.state.status === 'paused') {
      throw new Error('Agent is paused');
    }
    if (this.state.status !== 'ready' && this.state.status !== 'running') {
      throw new Error(`Agent not ready (status: ${this.state.status})`);
    }
  }

  private isCircuitOpen(capability_id: string): boolean {
    const breaker = this.circuitBreaker.get(capability_id);
    if (!breaker || !breaker.open) return false;
    
    // Check if enough time has passed to try again (30s)
    if (Date.now() - breaker.lastFailure > 30000) {
      breaker.open = false;
      breaker.failures = 0;
      return false;
    }
    
    return true;
  }

  private recordSuccess(capability_id: string, latency: number): void {
    this.metrics.successes++;
    this.metrics.total_latency_ms += latency;

    let capMetrics = this.metrics.by_capability.get(capability_id);
    if (!capMetrics) {
      capMetrics = { count: 0, latency: 0, errors: 0 };
      this.metrics.by_capability.set(capability_id, capMetrics);
    }
    capMetrics.count++;
    capMetrics.latency += latency;

    // Reset circuit breaker on success
    const breaker = this.circuitBreaker.get(capability_id);
    if (breaker) {
      breaker.failures = Math.max(0, breaker.failures - 1);
    }
  }

  private recordFailure(capability_id: string, latency: number): void {
    this.metrics.failures++;
    this.metrics.total_latency_ms += latency;

    let capMetrics = this.metrics.by_capability.get(capability_id);
    if (!capMetrics) {
      capMetrics = { count: 0, latency: 0, errors: 0 };
      this.metrics.by_capability.set(capability_id, capMetrics);
    }
    capMetrics.count++;
    capMetrics.latency += latency;
    capMetrics.errors++;

    // Update circuit breaker
    let breaker = this.circuitBreaker.get(capability_id);
    if (!breaker) {
      breaker = { failures: 0, lastFailure: 0, open: false };
      this.circuitBreaker.set(capability_id, breaker);
    }
    breaker.failures++;
    breaker.lastFailure = Date.now();
    
    // Open circuit after 5 failures
    if (breaker.failures >= 5) {
      breaker.open = true;
      this.emit('circuit_open', { capability_id });
      this.log('warn', `Circuit breaker opened for ${capability_id}`);
    }
  }

  private generateRequestId(): string {
    return `${this.config.agent_id}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    if (levels[level] >= levels[this.config.log_level]) {
      const prefix = `[${new Date().toISOString()}] [${this.config.agent_id}] [${level.toUpperCase()}]`;
      console[level === 'debug' ? 'log' : level](`${prefix} ${message}`);
    }
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

export function createAgent(config: AgentConfig): CAP402Agent {
  return new CAP402Agent(config);
}

// ============================================
// CONVENIENCE EXPORTS
// ============================================

export { CAP402Agent as Agent };
