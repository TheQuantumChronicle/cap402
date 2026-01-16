/**
 * CAP-402 Safety Module
 * 
 * Provides guardrails and safety mechanisms for agent operations.
 */

export {
  SafetyGuardrails,
  createSafetyGuardrails,
  SAFETY_PRESETS,
  DEFAULT_SAFETY_CONFIG,
  type SafetyConfig,
  type SpendingLimits,
  type RateLimits,
  type SafetyViolation,
  type SpendingRecord
} from './guardrails';
