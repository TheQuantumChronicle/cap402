/**
 * Common Types Module
 * 
 * Shared type definitions used across the codebase for consistency
 * and interoperability between modules.
 */

// ============================================
// RESULT TYPES
// ============================================

/**
 * Standard result type for operations that can succeed or fail
 */
export interface Result<T, E = Error> {
  success: boolean;
  data?: T;
  error?: E;
}

/**
 * Async operation result with timing info
 */
export interface TimedResult<T> extends Result<T> {
  duration_ms: number;
  timestamp: number;
}

// ============================================
// AGENT TYPES
// ============================================

export type AgentStatus = 'active' | 'inactive' | 'suspended' | 'pending';

export interface AgentIdentifier {
  agent_id: string;
  name?: string;
}

export interface AgentMetrics {
  total_invocations: number;
  successful_invocations: number;
  failed_invocations: number;
  average_response_time_ms: number;
}

// ============================================
// EXECUTION TYPES
// ============================================

export type ExecutionTier = 'public' | 'protected' | 'confidential' | 'maximum';

export type PrivacyLevel = 0 | 1 | 2 | 3;

export interface ExecutionContext {
  agent_id: string;
  capability_id: string;
  inputs: Record<string, unknown>;
  privacy_level?: PrivacyLevel;
  timeout_ms?: number;
}

export interface ExecutionMetadata {
  execution_id: string;
  started_at: number;
  completed_at?: number;
  tier: ExecutionTier;
  proof_type?: string;
}

// ============================================
// FEE & ECONOMIC TYPES
// ============================================

export interface FeeBreakdown {
  base_fee_usd: number;
  execution_fee_usd: number;
  privacy_premium_usd: number;
  total_fee_usd: number;
}

export interface EconomicThresholds {
  inco_recommended: number;
  arcium_mandatory: number;
}

// ============================================
// PROOF TYPES
// ============================================

export type ProofType = 
  | 'arcium' 
  | 'arcium-attestation' 
  | 'zk' 
  | 'zk-snark' 
  | 'fhe-proof' 
  | 'delivery-receipt' 
  | 'none' 
  | null;

export interface ProofData {
  proof_id: string;
  proof_type: ProofType;
  proof: string;
  public_inputs: Record<string, unknown>;
  verified: boolean;
  created_at: number;
}

// ============================================
// PAGINATION & QUERY TYPES
// ============================================

export interface PaginationParams {
  limit?: number;
  offset?: number;
  cursor?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  has_more: boolean;
  next_cursor?: string;
}

export interface SortParams {
  field: string;
  order: 'asc' | 'desc';
}

// ============================================
// API RESPONSE TYPES
// ============================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  error_code?: string;
  timestamp?: number;
}

export interface ApiError {
  success: false;
  error: string;
  error_code: string;
  status: number;
  details?: Record<string, unknown>;
}

// ============================================
// EVENT TYPES
// ============================================

export interface BaseEvent {
  event_id: string;
  event_type: string;
  timestamp: number;
  source: string;
}

export interface AgentEvent extends BaseEvent {
  agent_id: string;
  capability_id?: string;
  metadata?: Record<string, unknown>;
}

// ============================================
// SUBSCRIPTION TYPES
// ============================================

export type SubscriptionTier = 'free' | 'basic' | 'pro' | 'enterprise';

export interface SubscriptionFeatures {
  max_requests_per_day: number;
  max_concurrent_executions: number;
  priority_routing: boolean;
  advanced_analytics: boolean;
  custom_integrations: boolean;
}

// ============================================
// COORDINATION TYPES
// ============================================

export interface CoordinationRequest {
  initiator: string;
  participants: string[];
  operation: string;
  parameters: Record<string, unknown>;
  timeout_ms?: number;
}

export interface CoordinationResult {
  success: boolean;
  participants_responded: string[];
  consensus_reached: boolean;
  result?: unknown;
  errors?: Record<string, string>;
}
