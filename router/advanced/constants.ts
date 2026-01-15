/**
 * Shared Constants for Advanced Features
 * 
 * Centralizes magic values and configuration constants
 * for consistency across all advanced feature modules.
 */

// Privacy Levels
export const PRIVACY_LEVEL = {
  PUBLIC: 0 as const,
  OBSCURED: 1 as const,
  ENCRYPTED: 2 as const,
  ZK_VERIFIABLE: 3 as const
};

// Simple name lookup - for full metadata see PRIVACY_LEVELS in privacy-gradient.ts
export const PRIVACY_LEVEL_NAMES: Record<number, string> = {
  0: 'Public',
  1: 'Obscured',
  2: 'Encrypted',
  3: 'ZK Verifiable'
};

// Cost Multipliers by Privacy Level
export const PRIVACY_COST_MULTIPLIERS: Record<number, number> = {
  0: 1.0,
  1: 1.1,
  2: 1.5,
  3: 2.0
};

// Latency Multipliers by Privacy Level
export const PRIVACY_LATENCY_MULTIPLIERS: Record<number, number> = {
  0: 1.0,
  1: 1.2,
  2: 2.0,
  3: 3.0
};

// Proof Types
export const PROOF_TYPES = {
  ARCIUM_ATTESTATION: 'arcium-attestation' as const,
  ZK_SNARK: 'zk-snark' as const,
  DELIVERY_RECEIPT: 'delivery-receipt' as const,
  FHE_PROOF: 'fhe-proof' as const,
  NONE: 'none' as const
};

// Provider Names
export const PROVIDERS = {
  ARCIUM_MPC: 'arcium-mpc',
  ARCIUM_CSPL: 'arcium-cspl',
  NOIR_PROVER: 'noir-prover',
  INCO_FHE: 'inco-fhe',
  HELIUS_DAS: 'helius-das',
  JUPITER: 'jupiter-aggregator',
  COINMARKETCAP: 'coinmarketcap',
  SOLANA_TRACKER: 'solana-tracker'
} as const;

// Executor Names
export const EXECUTORS = {
  PUBLIC: 'public-executor',
  CONFIDENTIAL: 'confidential-executor',
  COMPOSITION: 'composition-engine',
  INTENT_GRAPH: 'intent-graph-executor'
} as const;

// Receipt Configuration
export const RECEIPT_CONFIG = {
  VERSION: '1.0.0' as const,
  ID_PREFIX: 'rcpt_',
  SIGNATURE_ALGORITHM: 'sha256'
} as const;

// Negotiation Defaults
export const NEGOTIATION_DEFAULTS = {
  BASE_COST: 0.01,
  BASE_LATENCY_MS: 200,
  MAX_OPTIONS: 10,
  DEFAULT_CONFIDENCE: 0.8
} as const;

// Intent Graph Limits
export const INTENT_GRAPH_LIMITS = {
  MAX_NODES: 50,
  MAX_EDGES: 100,
  MAX_DEPTH: 10,
  TIMEOUT_MS: 30000
} as const;

// Usage Metadata Configuration
export const USAGE_METADATA_CONFIG = {
  MAX_HISTORY_SIZE: 10000,
  LATENCY_BUCKETS: {
    FAST_MS: 200,
    MEDIUM_MS: 1000,
    SLOW_MS: 5000
  },
  COST_BUCKETS: {
    FREE: 0,
    CHEAP: 0.01,
    MODERATE: 0.1
  }
} as const;

// Capability ID Patterns
export const CAPABILITY_PATTERNS = {
  PREFIX: 'cap.',
  VERSION_REGEX: /\.v(\d+)$/,
  CONFIDENTIAL_KEYWORDS: ['confidential', 'zk.proof', 'lightning.message', 'cspl.', 'fhe.']
} as const;

// HTTP Headers
export const HEADERS = {
  AGENT_ID: 'X-Agent-ID',
  TRUST_LEVEL: 'X-Agent-Trust-Level',
  RATE_LIMIT_REMAINING: 'X-Agent-RateLimit-Remaining',
  COST_MULTIPLIER: 'X-Cost-Multiplier',
  SEMANTIC_NONCE: 'X-Semantic-Nonce',
  OBFUSCATED_ACTION: 'X-Obfuscated-Action',
  RECEIPT_ID: 'X-Receipt-ID',
  PRIVACY_LEVEL: 'X-Privacy-Level'
} as const;

// API Versions
export const API_VERSION = {
  CURRENT: '0.1.0',
  ADVANCED_FEATURES: '1.0.0'
} as const;

// Timeouts
export const TIMEOUTS = {
  DEFAULT_MS: 30000,
  CONFIDENTIAL_MS: 60000,
  ZK_PROOF_MS: 120000,
  INTENT_GRAPH_MS: 300000
} as const;

// Cache TTLs
export const CACHE_TTL = {
  PRICE_MS: 30000,
  WALLET_MS: 60000,
  CAPABILITY_MS: 300000
} as const;
