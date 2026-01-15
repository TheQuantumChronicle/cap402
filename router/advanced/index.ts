/**
 * Advanced Features Module
 * 
 * Unified exports for CAP-402's novel features:
 * - Capability Receipts (verifiable execution memory)
 * - Privacy Gradient (quantifiable privacy levels)
 * - Capability Negotiation (economic reasoning)
 * - Usage Metadata (emergent reputation)
 * - Intent Graphs (multi-step atomic workflows)
 * 
 * Import from this module for clean access to all advanced features.
 */

// Capability Receipts
export { 
  receiptManager, 
  CapabilityReceipt, 
  ReceiptVerificationResult 
} from '../capability-receipt';

// Privacy Gradient
export { 
  privacyGradient, 
  PRIVACY_LEVELS,
  PrivacyLevel,
  PrivacyOption,
  PrivacyRequirement,
  PrivacyRecommendation
} from '../privacy-gradient';

// Capability Negotiation
export { 
  negotiator,
  NegotiationRequest,
  NegotiationOption,
  NegotiationResponse
} from '../capability-negotiation';

// Usage Metadata (Emergent Reputation)
export { 
  usageMetadataEmitter,
  UsageMetadata,
  CapabilityScore
} from '../usage-metadata';

// Intent Graphs
export { 
  intentGraphExecutor,
  IntentGraph,
  IntentNode,
  IntentEdge,
  IntentContext,
  IntentExecutionResult,
  EXAMPLE_INTENT_GRAPHS
} from '../intent-graph';

// Execution Types
export { 
  PrivacyLevel as ExecutionPrivacyLevel,
  ProofType 
} from '../execution/types';

// Validation
export {
  validatePrivacyLevel,
  validateCapabilityId,
  validateReceipt,
  validateNegotiationRequest,
  validateIntentGraph,
  validateUsageMetadata,
  validateCrossSystemConsistency,
  ValidationResult
} from './validation';

// Errors
export {
  ErrorCode,
  CAP402Error,
  AdvancedFeatureError,
  isAdvancedFeatureError,
  toCAP402Error,
  getHttpStatus
} from './errors';

// Constants
export {
  PRIVACY_LEVEL,
  PRIVACY_LEVEL_NAMES,
  PRIVACY_COST_MULTIPLIERS,
  PRIVACY_LATENCY_MULTIPLIERS,
  PROOF_TYPES,
  PROVIDERS,
  EXECUTORS,
  RECEIPT_CONFIG,
  NEGOTIATION_DEFAULTS,
  INTENT_GRAPH_LIMITS,
  USAGE_METADATA_CONFIG,
  CAPABILITY_PATTERNS,
  HEADERS,
  API_VERSION,
  TIMEOUTS,
  CACHE_TTL
} from './constants';

// Health Monitoring
export {
  advancedFeaturesHealth,
  AdvancedFeatureHealth,
  AdvancedFeaturesHealthReport
} from './health';

/**
 * Version info
 */
export const ADVANCED_FEATURES_VERSION = '1.0.0';
export const ADVANCED_FEATURES = [
  'capability-receipts',
  'privacy-gradient', 
  'capability-negotiation',
  'usage-metadata',
  'intent-graphs'
] as const;
