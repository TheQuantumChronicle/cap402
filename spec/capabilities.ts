export type ExecutionMode = "public" | "confidential";
// Note: Canonical ProofType is in router/execution/types.ts
// This version includes legacy values for backward compatibility
export type ProofType = "arcium" | "zk" | "arcium-attestation" | "zk-snark" | "delivery-receipt" | "fhe-proof" | "none" | null;
export type LatencyHint = "low" | "medium" | "high";

export interface CapabilityInputSchema {
  schema: Record<string, any>;
  required?: string[];
}

export interface CapabilityOutputSchema {
  schema: Record<string, any>;
}

export interface CapabilityExecution {
  mode: ExecutionMode;
  proof_type?: ProofType;
  executor_hint?: string;
}

export interface X402PaymentSignal {
  enabled: boolean;
  settlement_optional: boolean;
  payment_methods: string[];
}

export interface CapabilityEconomics {
  cost_hint: number;
  currency: string;
  x402_payment_signal?: X402PaymentSignal;
  privacy_cash_compatible?: boolean;
}

export interface CapabilityPerformance {
  latency_hint: LatencyHint;
  reliability_hint: number;
  throughput_limit?: number;
}

export interface CapabilityMetadata {
  tags?: string[];
  provider_hints?: string[];
  use_cases?: string[];
  privacy_guarantees?: string[];
  status?: string;
}

export interface Capability {
  id: string;
  name: string;
  description: string;
  inputs: CapabilityInputSchema;
  outputs: CapabilityOutputSchema;
  execution: CapabilityExecution;
  economics: CapabilityEconomics;
  performance: CapabilityPerformance;
  version: string;
  deprecated?: boolean;
  composable?: boolean;
  metadata?: CapabilityMetadata;
}

import { SWAP_CAPABILITY } from './swap-capability';
import { CONFIDENTIAL_SWAP_CAPABILITY } from './confidential-swap-capability';
import { ZK_PROOF_CAPABILITY } from './zk-proof-capability';
import { ZK_BALANCE_PROOF_CAPABILITY } from './zk-balance-proof-capability';
import { LIGHTNING_MESSAGE_CAPABILITY } from './lightning-message-capability';
import { ENCRYPTED_TRADE_CAPABILITY, PRIVATE_GOVERNANCE_CAPABILITY } from './future-capabilities';
import { CSPL_WRAP_CAPABILITY, CSPL_TRANSFER_CAPABILITY, FHE_COMPUTE_CAPABILITY } from './cspl-capabilities';
import { AI_INFERENCE_CAPABILITY, AI_EMBEDDING_CAPABILITY } from './ai-inference-capability';
import { KYC_PROOF_CAPABILITY, CREDENTIAL_PROOF_CAPABILITY } from './kyc-proof-capability';
import { 
  STEALTH_LAUNCH_CAPABILITY, 
  PUMPFUN_BUY_CAPABILITY, 
  PUMPFUN_SELL_CAPABILITY, 
  PUMPFUN_QUOTE_CAPABILITY,
  BONDING_CURVE_INFO_CAPABILITY 
} from './stealthpump-capability';

export const CORE_CAPABILITIES: Capability[] = [
  {
    id: "cap.price.lookup.v1",
    name: "Price Lookup",
    description: "Retrieve current market price for a token pair",
    inputs: {
      schema: {
        type: "object",
        properties: {
          base_token: { type: "string", description: "Base token symbol or address" },
          quote_token: { type: "string", description: "Quote token symbol (default: USD)" }
        },
        required: ["base_token"]
      },
      required: ["base_token"]
    },
    outputs: {
      schema: {
        type: "object",
        properties: {
          price: { type: "number" },
          base_token: { type: "string" },
          quote_token: { type: "string" },
          timestamp: { type: "number" },
          source: { type: "string" }
        }
      }
    },
    execution: {
      mode: "public",
      proof_type: null,
      executor_hint: "public-executor"
    },
    economics: {
      cost_hint: 0.0001,
      currency: "SOL",
      x402_payment_signal: {
        enabled: true,
        settlement_optional: true,
        payment_methods: ["SOL", "USDC", "credits"]
      },
      privacy_cash_compatible: false
    },
    performance: {
      latency_hint: "low",
      reliability_hint: 0.99,
      throughput_limit: 100
    },
    version: "1.0.0",
    deprecated: false,
    composable: true,
    metadata: {
      tags: ["price", "defi", "market-data"],
      provider_hints: ["coingecko", "jupiter", "pyth"]
    }
  },
  {
    id: "cap.wallet.snapshot.v1",
    name: "Wallet Snapshot",
    description: "Retrieve complete wallet state including balances and recent transactions",
    inputs: {
      schema: {
        type: "object",
        properties: {
          address: { type: "string", description: "Wallet address to snapshot" },
          network: { type: "string", description: "Network identifier (default: solana-mainnet)" },
          include_nfts: { type: "boolean", description: "Include NFT holdings" },
          include_history: { type: "boolean", description: "Include transaction history" }
        },
        required: ["address"]
      },
      required: ["address"]
    },
    outputs: {
      schema: {
        type: "object",
        properties: {
          address: { type: "string" },
          balances: { type: "array", items: { type: "object" } },
          nfts: { type: "array", items: { type: "object" } },
          recent_transactions: { type: "array", items: { type: "object" } },
          snapshot_timestamp: { type: "number" }
        }
      }
    },
    execution: {
      mode: "public",
      proof_type: null,
      executor_hint: "public-executor"
    },
    economics: {
      cost_hint: 0.001,
      currency: "SOL",
      x402_payment_signal: {
        enabled: true,
        settlement_optional: true,
        payment_methods: ["SOL", "USDC"]
      },
      privacy_cash_compatible: false
    },
    performance: {
      latency_hint: "medium",
      reliability_hint: 0.95,
      throughput_limit: 50
    },
    version: "1.0.0",
    deprecated: false,
    composable: true,
    metadata: {
      tags: ["wallet", "blockchain", "balance"],
      provider_hints: ["helius", "alchemy", "quicknode"]
    }
  },
  {
    id: "cap.document.parse.v1",
    name: "Confidential Document Parse",
    description: "Parse and extract structured data from documents with confidential compute guarantees",
    inputs: {
      schema: {
        type: "object",
        properties: {
          document_url: { type: "string", description: "URL or reference to document" },
          document_type: { type: "string", description: "Document type hint (pdf, docx, etc)" },
          extraction_schema: { type: "object", description: "Schema for data extraction" },
          privacy_level: { type: "string", enum: ["standard", "high"], description: "Privacy guarantee level" }
        },
        required: ["document_url", "extraction_schema"]
      },
      required: ["document_url", "extraction_schema"]
    },
    outputs: {
      schema: {
        type: "object",
        properties: {
          extracted_data: { type: "object" },
          confidence_score: { type: "number" },
          execution_proof: { type: "string" },
          privacy_attestation: { type: "string" }
        }
      }
    },
    execution: {
      mode: "confidential",
      proof_type: "arcium",
      executor_hint: "arcium-executor"
    },
    economics: {
      cost_hint: 0.01,
      currency: "SOL",
      x402_payment_signal: {
        enabled: true,
        settlement_optional: true,
        payment_methods: ["SOL", "USDC", "privacy-cash"]
      },
      privacy_cash_compatible: true
    },
    performance: {
      latency_hint: "high",
      reliability_hint: 0.92,
      throughput_limit: 10
    },
    version: "1.0.0",
    deprecated: false,
    composable: true,
    metadata: {
      tags: ["document", "parsing", "confidential", "privacy"],
      provider_hints: ["arcium"]
    }
  },
  SWAP_CAPABILITY,
  CONFIDENTIAL_SWAP_CAPABILITY,
  ZK_PROOF_CAPABILITY,
  ZK_BALANCE_PROOF_CAPABILITY,
  LIGHTNING_MESSAGE_CAPABILITY,
  ENCRYPTED_TRADE_CAPABILITY,
  PRIVATE_GOVERNANCE_CAPABILITY,
  CSPL_WRAP_CAPABILITY,
  CSPL_TRANSFER_CAPABILITY,
  FHE_COMPUTE_CAPABILITY,
  // StealthPump / Pump.fun capabilities
  STEALTH_LAUNCH_CAPABILITY,
  PUMPFUN_BUY_CAPABILITY,
  PUMPFUN_SELL_CAPABILITY,
  PUMPFUN_QUOTE_CAPABILITY,
  BONDING_CURVE_INFO_CAPABILITY,
  // AI Inference capabilities
  AI_INFERENCE_CAPABILITY,
  AI_EMBEDDING_CAPABILITY,
  // KYC/Credential proof capabilities
  KYC_PROOF_CAPABILITY,
  CREDENTIAL_PROOF_CAPABILITY
];
