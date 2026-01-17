/**
 * CAP-402 Execution Fee System
 * 
 * "We take a cut when agents make money."
 * 
 * Fee structure:
 * - Execution-as-a-Service: 0.1% of saved slippage (above $100K)
 * - Dark Coordination: 0.05% of matched volume
 * - Reputation Proofs: $10-100 per proof
 * - Subscriptions: $500-5000/month for priority execution
 */

import { generateId } from '../../utils';

// Capital thresholds that trigger mandatory confidential execution
export const CAPITAL_THRESHOLDS = {
  ARCIUM_MANDATORY: 100_000,      // $100K - must use Arcium MPC
  INCO_RECOMMENDED: 50_000,       // $50K - should use Inco FHE
  NOIR_REQUIRED_FOR_DELEGATION: 0, // Any capital delegation needs Noir proofs
} as const;

// Fee rates
export const FEE_RATES = {
  // Execution-as-a-Service
  SLIPPAGE_SAVINGS_RATE: 0.001,   // 0.1% of saved slippage
  MIN_EXECUTION_FEE_USD: 10,      // Minimum $10 per execution
  MAX_EXECUTION_FEE_USD: 10_000,  // Cap at $10K per execution
  
  // Dark Coordination
  MATCHED_VOLUME_RATE: 0.0005,    // 0.05% of matched volume
  AUCTION_WINNER_RATE: 0.001,     // 0.1% from auction winner
  
  // Reputation Proofs
  BALANCE_PROOF_USD: 10,
  KYC_PROOF_USD: 50,
  TRACK_RECORD_PROOF_USD: 100,
  CUSTOM_PROOF_USD: 25,
  
  // Subscriptions (monthly)
  TIER_BASIC_USD: 500,
  TIER_PRO_USD: 2000,
  TIER_ENTERPRISE_USD: 5000,
} as const;

export type SubscriptionTier = 'free' | 'basic' | 'pro' | 'enterprise';

export interface AgentSubscription {
  agent_id: string;
  tier: SubscriptionTier;
  started_at: number;
  expires_at: number;
  features: string[];
  monthly_fee_usd: number;
}

export interface ExecutionFee {
  fee_id: string;
  agent_id: string;
  fee_type: 'execution' | 'coordination' | 'proof' | 'subscription';
  amount_usd: number;
  basis: string;
  timestamp: number;
  paid: boolean;
  tx_hash?: string;
}

export interface SlippageSavings {
  expected_slippage_bps: number;
  actual_slippage_bps: number;
  saved_bps: number;
  trade_size_usd: number;
  saved_usd: number;
  fee_usd: number;
}

class ExecutionFeeManager {
  private fees: Map<string, ExecutionFee> = new Map();
  private subscriptions: Map<string, AgentSubscription> = new Map();
  private agentVolume: Map<string, number> = new Map();
  private agentFeesPaid: Map<string, number> = new Map();
  
  /**
   * Check if trade size requires mandatory confidential execution
   */
  requiresConfidentialExecution(tradeSizeUsd: number): {
    required: boolean;
    reason: string;
    technology: 'arcium' | 'inco' | 'public';
  } {
    if (tradeSizeUsd >= CAPITAL_THRESHOLDS.ARCIUM_MANDATORY) {
      return {
        required: true,
        reason: `Trade size $${tradeSizeUsd.toLocaleString()} exceeds $100K threshold. Public execution = 2-5% MEV loss.`,
        technology: 'arcium'
      };
    }
    
    if (tradeSizeUsd >= CAPITAL_THRESHOLDS.INCO_RECOMMENDED) {
      return {
        required: false,
        reason: `Trade size $${tradeSizeUsd.toLocaleString()} recommended for confidential execution to avoid front-running.`,
        technology: 'inco'
      };
    }
    
    return {
      required: false,
      reason: 'Trade size below threshold. Public execution acceptable.',
      technology: 'public'
    };
  }
  
  /**
   * Calculate execution fee based on slippage savings
   */
  calculateExecutionFee(
    tradeSizeUsd: number,
    expectedSlippageBps: number,
    actualSlippageBps: number
  ): SlippageSavings {
    const savedBps = Math.max(0, expectedSlippageBps - actualSlippageBps);
    const savedUsd = (savedBps / 10000) * tradeSizeUsd;
    
    // Fee is 0.1% of saved slippage
    let feeUsd = savedUsd * FEE_RATES.SLIPPAGE_SAVINGS_RATE;
    
    // Apply min/max bounds
    feeUsd = Math.max(FEE_RATES.MIN_EXECUTION_FEE_USD, feeUsd);
    feeUsd = Math.min(FEE_RATES.MAX_EXECUTION_FEE_USD, feeUsd);
    
    return {
      expected_slippage_bps: expectedSlippageBps,
      actual_slippage_bps: actualSlippageBps,
      saved_bps: savedBps,
      trade_size_usd: tradeSizeUsd,
      saved_usd: savedUsd,
      fee_usd: feeUsd
    };
  }
  
  /**
   * Calculate coordination fee for matched volume
   */
  calculateCoordinationFee(matchedVolumeUsd: number): number {
    return matchedVolumeUsd * FEE_RATES.MATCHED_VOLUME_RATE;
  }
  
  /**
   * Calculate proof fee based on type
   */
  calculateProofFee(proofType: string): number {
    switch (proofType) {
      case 'balance_threshold':
        return FEE_RATES.BALANCE_PROOF_USD;
      case 'kyc_compliance':
        return FEE_RATES.KYC_PROOF_USD;
      case 'track_record':
      case 'performance_history':
        return FEE_RATES.TRACK_RECORD_PROOF_USD;
      default:
        return FEE_RATES.CUSTOM_PROOF_USD;
    }
  }
  
  /**
   * Record a fee for an agent
   */
  recordFee(
    agentId: string,
    feeType: ExecutionFee['fee_type'],
    amountUsd: number,
    basis: string
  ): ExecutionFee {
    const fee: ExecutionFee = {
      fee_id: generateId('fee'),
      agent_id: agentId,
      fee_type: feeType,
      amount_usd: amountUsd,
      basis,
      timestamp: Date.now(),
      paid: false
    };
    
    this.fees.set(fee.fee_id, fee);
    
    // Track agent volume
    const currentVolume = this.agentVolume.get(agentId) || 0;
    this.agentVolume.set(agentId, currentVolume + amountUsd);
    
    return fee;
  }
  
  /**
   * Mark fee as paid
   */
  markFeePaid(feeId: string, txHash: string): boolean {
    const fee = this.fees.get(feeId);
    if (!fee) return false;
    
    fee.paid = true;
    fee.tx_hash = txHash;
    
    // Track total fees paid by agent
    const currentPaid = this.agentFeesPaid.get(fee.agent_id) || 0;
    this.agentFeesPaid.set(fee.agent_id, currentPaid + fee.amount_usd);
    
    return true;
  }
  
  /**
   * Get subscription tier features
   */
  getTierFeatures(tier: SubscriptionTier): string[] {
    switch (tier) {
      case 'enterprise':
        return [
          'unlimited_executions',
          'priority_routing',
          'dedicated_mpc_cluster',
          'custom_circuits',
          'api_rate_limit_10000',
          'sla_99_99',
          'dedicated_support',
          'white_label'
        ];
      case 'pro':
        return [
          'unlimited_executions',
          'priority_routing',
          'shared_mpc_cluster',
          'api_rate_limit_5000',
          'sla_99_9',
          'priority_support'
        ];
      case 'basic':
        return [
          'executions_1000_month',
          'standard_routing',
          'shared_mpc_cluster',
          'api_rate_limit_1000',
          'email_support'
        ];
      default:
        return [
          'executions_100_month',
          'standard_routing',
          'api_rate_limit_100',
          'community_support'
        ];
    }
  }
  
  /**
   * Create or update subscription
   */
  createSubscription(agentId: string, tier: SubscriptionTier): AgentSubscription {
    const monthlyFee = tier === 'enterprise' ? FEE_RATES.TIER_ENTERPRISE_USD :
                       tier === 'pro' ? FEE_RATES.TIER_PRO_USD :
                       tier === 'basic' ? FEE_RATES.TIER_BASIC_USD : 0;
    
    const subscription: AgentSubscription = {
      agent_id: agentId,
      tier,
      started_at: Date.now(),
      expires_at: Date.now() + (30 * 24 * 60 * 60 * 1000), // 30 days
      features: this.getTierFeatures(tier),
      monthly_fee_usd: monthlyFee
    };
    
    this.subscriptions.set(agentId, subscription);
    
    // Record subscription fee
    if (monthlyFee > 0) {
      this.recordFee(agentId, 'subscription', monthlyFee, `${tier} tier monthly subscription`);
    }
    
    return subscription;
  }
  
  /**
   * Get agent subscription
   */
  getSubscription(agentId: string): AgentSubscription | null {
    const sub = this.subscriptions.get(agentId);
    if (!sub) return null;
    
    // Check if expired
    if (sub.expires_at < Date.now()) {
      // Downgrade to free
      return this.createSubscription(agentId, 'free');
    }
    
    return sub;
  }
  
  /**
   * Check if agent has feature
   */
  hasFeature(agentId: string, feature: string): boolean {
    const sub = this.getSubscription(agentId);
    if (!sub) return false;
    return sub.features.includes(feature);
  }
  
  /**
   * Get agent's unpaid fees
   */
  getUnpaidFees(agentId: string): ExecutionFee[] {
    return Array.from(this.fees.values())
      .filter(f => f.agent_id === agentId && !f.paid);
  }
  
  /**
   * Get agent's total fees (paid + unpaid)
   */
  getAgentFeeStats(agentId: string): {
    total_fees_usd: number;
    paid_fees_usd: number;
    unpaid_fees_usd: number;
    total_volume_usd: number;
    fee_count: number;
  } {
    const agentFees = Array.from(this.fees.values())
      .filter(f => f.agent_id === agentId);
    
    const paidFees = agentFees.filter(f => f.paid);
    const unpaidFees = agentFees.filter(f => !f.paid);
    
    return {
      total_fees_usd: agentFees.reduce((sum, f) => sum + f.amount_usd, 0),
      paid_fees_usd: paidFees.reduce((sum, f) => sum + f.amount_usd, 0),
      unpaid_fees_usd: unpaidFees.reduce((sum, f) => sum + f.amount_usd, 0),
      total_volume_usd: this.agentVolume.get(agentId) || 0,
      fee_count: agentFees.length
    };
  }
  
  /**
   * Get protocol-wide stats
   */
  getProtocolStats(): {
    total_fees_collected_usd: number;
    total_volume_processed_usd: number;
    active_subscriptions: number;
    subscription_mrr_usd: number;
    fee_breakdown: Record<string, number>;
  } {
    const allFees = Array.from(this.fees.values());
    const paidFees = allFees.filter(f => f.paid);
    
    const feeBreakdown: Record<string, number> = {
      execution: 0,
      coordination: 0,
      proof: 0,
      subscription: 0
    };
    
    paidFees.forEach(f => {
      feeBreakdown[f.fee_type] = (feeBreakdown[f.fee_type] || 0) + f.amount_usd;
    });
    
    const activeSubscriptions = Array.from(this.subscriptions.values())
      .filter(s => s.expires_at > Date.now() && s.tier !== 'free');
    
    const mrr = activeSubscriptions.reduce((sum, s) => sum + s.monthly_fee_usd, 0);
    
    return {
      total_fees_collected_usd: paidFees.reduce((sum, f) => sum + f.amount_usd, 0),
      total_volume_processed_usd: Array.from(this.agentVolume.values()).reduce((a, b) => a + b, 0),
      active_subscriptions: activeSubscriptions.length,
      subscription_mrr_usd: mrr,
      fee_breakdown: feeBreakdown
    };
  }
}

export const executionFeeManager = new ExecutionFeeManager();
