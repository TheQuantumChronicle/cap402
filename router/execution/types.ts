export interface ExecutionContext {
  capability_id: string;
  inputs: Record<string, any>;
  preferences?: ExecutionPreferences;
  request_id: string;
  timestamp: number;
}

export interface ExecutionPreferences {
  max_cost?: number;
  privacy_required?: boolean;
  latency_priority?: boolean;
  preferred_providers?: string[];
  privacy_level?: 0 | 1 | 2 | 3; // Privacy gradient level
  execution_mode?: 'public' | 'confidential';
}

export interface ExecutionResult {
  success: boolean;
  outputs?: Record<string, any>;
  error?: string;
  metadata: ExecutionMetadata;
}

export interface ExecutionMetadata {
  executor: string;
  execution_time_ms: number;
  cost_actual?: number;
  cost_estimate?: number;
  currency?: string;
  proof_type?: 'arcium-attestation' | 'zk-snark' | 'delivery-receipt' | 'fhe-proof' | 'none';
  proof?: ConfidentialProof;
  provider_used?: string;
  arcium_status?: string;
  privacy_level?: 0 | 1 | 2 | 3;
  note?: string;
}

export interface ConfidentialProof {
  proof_type: "arcium" | "zk";
  proof_data: string;
  attestation: string;
  verification_url?: string;
}

export interface Executor {
  name: string;
  canExecute(capability_id: string): boolean;
  execute(context: ExecutionContext): Promise<ExecutionResult>;
  
  // Optional: Privacy-aware execution hints
  getPrivacyLevel?(): 0 | 1 | 2 | 3;
  supportsProofType?(proofType: string): boolean;
}

// Re-export common types for convenience
// Note: PrivacyLevel is canonically defined in privacy-gradient.ts
export type { PrivacyLevel } from '../privacy-gradient';
export type ProofType = 'arcium-attestation' | 'zk-snark' | 'delivery-receipt' | 'fhe-proof' | 'none';
