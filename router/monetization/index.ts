/**
 * Monetization Module - Barrel Export
 * 
 * Central export point for all monetization-related functionality:
 * - Execution fees and subscriptions
 * - Agent reputation with ZK proofs
 * - Dark coordination (pools, auctions, signals)
 */

export { 
  executionFeeManager,
  CAPITAL_THRESHOLDS, 
  FEE_RATES 
} from './execution-fees';

export { 
  agentReputationManager
} from './agent-reputation';

export { 
  darkCoordinationManager
} from './dark-coordination';
