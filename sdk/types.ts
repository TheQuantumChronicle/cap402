import { Capability } from '../spec/capabilities';

export interface SDKConfig {
  router_url?: string;
  baseUrl?: string;
  timeout?: number;
  retry_attempts?: number;
  retries?: number;
  retryDelay?: number;
  apiKey?: string;
  agentId?: string;
  enablePolling?: boolean;
  pollingInterval?: number;
}

export interface DiscoverOptions {
  tag?: string;
  mode?: 'public' | 'confidential';
}

export interface InvokeOptions {
  max_cost?: number;
  privacy_required?: boolean;
  latency_priority?: boolean;
  preferred_providers?: string[];
}

export interface CapabilityResponse {
  success: boolean;
  count?: number;
  capabilities?: Capability[];
  capability?: Capability;
  error?: string;
}

export interface InvocationResponse {
  success: boolean;
  request_id: string;
  capability_id: string;
  outputs?: Record<string, any>;
  error?: string;
  metadata: {
    execution: any;
    economic_hints?: any;
    chain_signal?: any;
  };
}
