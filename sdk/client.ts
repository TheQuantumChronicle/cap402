import axios, { AxiosInstance } from 'axios';
import { Capability } from '../spec/capabilities';
import {
  SDKConfig,
  DiscoverOptions,
  InvokeOptions,
  CapabilityResponse,
  InvocationResponse
} from './types';

// Event types for real-time updates
type EventType = 'invocation' | 'error' | 'metrics' | 'agent' | 'capability';
type EventCallback = (data: any) => void;

export class CAP402Client {
  private client: AxiosInstance;
  private config: SDKConfig;
  private eventListeners: Map<EventType, Set<EventCallback>> = new Map();
  private pollingInterval: NodeJS.Timeout | null = null;
  private lastMetrics: any = null;

  constructor(config: SDKConfig) {
    this.config = {
      timeout: 30000,
      retry_attempts: 3,
      retries: 3,
      retryDelay: 1000,
      ...config
    };

    const baseURL = this.config.baseUrl || this.config.router_url || 'https://cap402.com';

    this.client = axios.create({
      baseURL,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey ? { 'X-API-Key': this.config.apiKey } : {})
      }
    });

    // Initialize event listener maps
    (['invocation', 'error', 'metrics', 'agent', 'capability'] as EventType[]).forEach(type => {
      this.eventListeners.set(type, new Set());
    });
  }

  async discoverCapabilities(options?: DiscoverOptions): Promise<Capability[]> {
    try {
      const params: Record<string, string> = {};
      if (options?.tag) params.tag = options.tag;
      if (options?.mode) params.mode = options.mode;

      const response = await this.client.get<CapabilityResponse>('/capabilities', { params });
      
      if (!response.data.success || !response.data.capabilities) {
        throw new Error('Failed to discover capabilities');
      }

      return response.data.capabilities;
    } catch (error) {
      throw new Error(`Discovery failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getCapability(capability_id: string): Promise<Capability> {
    try {
      const response = await this.client.get<CapabilityResponse>(`/capabilities/${capability_id}`);
      
      if (!response.data.success || !response.data.capability) {
        throw new Error(`Capability ${capability_id} not found`);
      }

      return response.data.capability;
    } catch (error) {
      throw new Error(`Lookup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async invokeCapability(
    capability_id: string,
    inputs: Record<string, any>,
    options?: InvokeOptions
  ): Promise<InvocationResponse> {
    try {
      const request = {
        capability_id,
        inputs,
        preferences: options
      };

      const response = await this.client.post<InvocationResponse>('/invoke', request);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        return error.response.data;
      }
      throw new Error(`Invocation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async invokeWithRetry(
    capability_id: string,
    inputs: Record<string, any>,
    options?: InvokeOptions
  ): Promise<InvocationResponse> {
    let lastError: Error | null = null;
    const maxAttempts = this.config.retry_attempts || 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await this.invokeCapability(capability_id, inputs, options);
        if (result.success) {
          return result;
        }
        lastError = new Error(result.error || 'Invocation failed');
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
      }

      if (attempt < maxAttempts) {
        await this.sleep(Math.pow(2, attempt) * 1000);
      }
    }

    throw lastError || new Error('All retry attempts failed');
  }

  async chainCapabilities(
    pipeline: Array<{
      capability_id: string;
      inputs: Record<string, any> | ((prev: any) => Record<string, any>);
      options?: InvokeOptions;
    }>
  ): Promise<InvocationResponse[]> {
    const results: InvocationResponse[] = [];
    let previousOutput: any = null;

    for (const step of pipeline) {
      const inputs = typeof step.inputs === 'function'
        ? step.inputs(previousOutput)
        : step.inputs;

      const result = await this.invokeCapability(step.capability_id, inputs, step.options);
      results.push(result);

      if (!result.success) {
        throw new Error(`Pipeline failed at ${step.capability_id}: ${result.error}`);
      }

      previousOutput = result.outputs;
    }

    return results;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Convenience methods
  async getPrice(baseToken: string, quoteToken: string = 'USD'): Promise<number> {
    const result = await this.invokeCapability('cap.price.lookup.v1', {
      base_token: baseToken,
      quote_token: quoteToken,
    });

    if (!result.success || !result.outputs) {
      throw new Error(result.error || 'Price lookup failed');
    }

    return result.outputs.price;
  }

  async getWallet(address: string): Promise<any> {
    const result = await this.invokeCapability('cap.wallet.snapshot.v1', {
      address,
    });

    if (!result.success) {
      throw new Error(result.error || 'Wallet snapshot failed');
    }

    return result.outputs;
  }

  async getHealth(): Promise<any> {
    const response = await this.client.get('/health');
    return response.data;
  }

  async getMetrics(): Promise<any> {
    const response = await this.client.get('/metrics');
    return response.data;
  }

  // ============================================
  // AGENT MANAGEMENT
  // ============================================

  async registerAgent(agentConfig: {
    agent_id: string;
    name: string;
    description?: string;
    capabilities_provided?: string[];
    capabilities_required?: string[];
    endpoint?: string;
  }): Promise<any> {
    const response = await this.client.post('/agents/register', agentConfig);
    return response.data;
  }

  async getAgent(agentId: string): Promise<any> {
    const response = await this.client.get(`/unified/agent/${agentId}`);
    return response.data;
  }

  async discoverAgents(query?: {
    capability?: string;
    min_trust_score?: number;
    limit?: number;
  }): Promise<any> {
    const response = await this.client.get('/discover', { params: query });
    return response.data;
  }

  // ============================================
  // BATCH OPERATIONS
  // ============================================

  async batchInvoke(requests: Array<{
    capability_id: string;
    inputs: Record<string, any>;
  }>): Promise<any> {
    const response = await this.client.post('/batch/invoke', { requests });
    return response.data;
  }

  async batchPrices(tokens: string[], quote: string = 'USD'): Promise<any> {
    const response = await this.client.post('/batch/prices', { tokens, quote });
    return response.data;
  }

  // ============================================
  // SMART INVOKE WITH RECOMMENDATIONS
  // ============================================

  async smartInvoke(
    capability_id: string,
    inputs: Record<string, any>,
    options?: { prefetch?: boolean; include_recommendations?: boolean }
  ): Promise<any> {
    const response = await this.client.post('/smart/invoke', {
      capability_id,
      inputs,
      options
    });
    return response.data;
  }

  // ============================================
  // EVENT SYSTEM
  // ============================================

  on(event: 'invocation' | 'error' | 'metrics' | 'agent' | 'capability', callback: EventCallback): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.add(callback);
    }
  }

  off(event: 'invocation' | 'error' | 'metrics' | 'agent' | 'capability', callback: EventCallback): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  private emit(event: 'invocation' | 'error' | 'metrics' | 'agent' | 'capability', data: any): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(cb => {
        try { cb(data); } catch (e) { /* ignore callback errors */ }
      });
    }
  }

  startPolling(intervalMs: number = 5000): void {
    if (this.pollingInterval) return;
    
    this.pollingInterval = setInterval(async () => {
      try {
        const metrics = await this.getMetrics();
        if (JSON.stringify(metrics) !== JSON.stringify(this.lastMetrics)) {
          this.lastMetrics = metrics;
          this.emit('metrics', metrics);
        }
      } catch (e) {
        this.emit('error', { type: 'polling', error: e });
      }
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  // ============================================
  // COMPOSITION & WORKFLOWS
  // ============================================

  async compose(composition: {
    name: string;
    steps: Array<{
      capability_id: string;
      inputs: Record<string, any>;
    }>;
    inputs?: Record<string, any>;
  }): Promise<any> {
    const response = await this.client.post('/compose', composition);
    return response.data;
  }

  async getTemplates(): Promise<any> {
    const response = await this.client.get('/templates');
    return response.data;
  }

  async executeTemplate(templateId: string, inputs: Record<string, any>): Promise<any> {
    const response = await this.client.post(`/templates/${templateId}/execute`, { inputs });
    return response.data;
  }

  // ============================================
  // SECURITY & TOKENS
  // ============================================

  async issueToken(agentId: string, capabilities?: string[], expiresInHours?: number): Promise<any> {
    const response = await this.client.post('/security/tokens/issue', {
      agent_id: agentId,
      capabilities,
      expires_in_hours: expiresInHours
    });
    return response.data;
  }

  async verifyToken(token: string, capabilityId: string): Promise<any> {
    const response = await this.client.post('/security/tokens/verify', {
      token,
      capability_id: capabilityId
    });
    return response.data;
  }

  // ============================================
  // ANALYTICS & MONITORING
  // ============================================

  async getDashboard(): Promise<any> {
    const response = await this.client.get('/analytics/dashboard');
    return response.data;
  }

  async getCapabilityAnalytics(capabilityId: string): Promise<any> {
    const response = await this.client.get(`/analytics/capability/${capabilityId}`);
    return response.data;
  }

  async getAgentAnalytics(agentId: string): Promise<any> {
    const response = await this.client.get(`/analytics/agent/${agentId}`);
    return response.data;
  }

  // ============================================
  // CLEANUP
  // ============================================

  destroy(): void {
    this.stopPolling();
    this.eventListeners.clear();
  }
}

export function createClient(router_url: string, config?: Partial<SDKConfig>): CAP402Client {
  return new CAP402Client({
    router_url,
    ...config
  });
}

// React hook helper (for use with React)
export function useCAP402(config: SDKConfig) {
  const client = new CAP402Client(config);
  return {
    client,
    invoke: client.invokeCapability.bind(client),
    discover: client.discoverCapabilities.bind(client),
    getPrice: client.getPrice.bind(client),
    getWallet: client.getWallet.bind(client),
    batchInvoke: client.batchInvoke.bind(client),
    smartInvoke: client.smartInvoke.bind(client),
    destroy: client.destroy.bind(client)
  };
}
