/**
 * Cost Estimator
 * 
 * Estimate costs before execution:
 * - Base capability cost
 * - Trust level multiplier
 * - Network fees
 * - Composition costs
 * 
 * This helps agents budget and plan their operations
 */

import { registry } from './registry';
import { TrustLevel } from './agent-identity';

interface CostEstimate {
  capability_id: string;
  base_cost: number;
  trust_multiplier: number;
  adjusted_cost: number;
  network_fee_estimate: number;
  total_estimate: number;
  currency: string;
  confidence: 'high' | 'medium' | 'low';
  breakdown: CostBreakdown[];
}

interface CostBreakdown {
  component: string;
  cost: number;
  description: string;
}

interface CompositionCostEstimate {
  template_id?: string;
  capabilities: CostEstimate[];
  total_base_cost: number;
  total_adjusted_cost: number;
  total_network_fees: number;
  grand_total: number;
  currency: string;
  savings_vs_individual: number;
}

const TRUST_MULTIPLIERS: Record<TrustLevel, number> = {
  anonymous: 1.5,
  verified: 1.0,
  trusted: 0.8,
  premium: 0.5
};

const NETWORK_FEES = {
  solana: 0.000005, // ~5000 lamports
  arcium_mpc: 0.01,
  noir_proof: 0.005,
  inco_fhe: 0.002
};

class CostEstimator {
  /**
   * Estimate cost for a single capability
   */
  estimate(
    capability_id: string,
    trust_level: TrustLevel = 'anonymous',
    inputs?: Record<string, any>
  ): CostEstimate {
    const capability = registry.getCapability(capability_id);
    
    if (!capability) {
      return {
        capability_id,
        base_cost: 0,
        trust_multiplier: TRUST_MULTIPLIERS[trust_level],
        adjusted_cost: 0,
        network_fee_estimate: 0,
        total_estimate: 0,
        currency: 'SOL',
        confidence: 'low',
        breakdown: [{
          component: 'error',
          cost: 0,
          description: 'Capability not found'
        }]
      };
    }

    const baseCost = capability.economics.cost_hint;
    const trustMultiplier = TRUST_MULTIPLIERS[trust_level];
    const adjustedCost = baseCost * trustMultiplier;

    // Estimate network fees based on execution mode
    let networkFee = NETWORK_FEES.solana;
    const breakdown: CostBreakdown[] = [
      {
        component: 'base_cost',
        cost: baseCost,
        description: `Base capability cost for ${capability.name}`
      },
      {
        component: 'trust_adjustment',
        cost: adjustedCost - baseCost,
        description: `${trust_level} trust level (${trustMultiplier}x multiplier)`
      }
    ];

    if (capability.execution.mode === 'confidential') {
      if (capability.execution.executor_hint?.includes('arcium')) {
        networkFee += NETWORK_FEES.arcium_mpc;
        breakdown.push({
          component: 'arcium_mpc',
          cost: NETWORK_FEES.arcium_mpc,
          description: 'Arcium MPC computation fee'
        });
      }
      if (capability.execution.executor_hint?.includes('noir')) {
        networkFee += NETWORK_FEES.noir_proof;
        breakdown.push({
          component: 'noir_proof',
          cost: NETWORK_FEES.noir_proof,
          description: 'Noir ZK proof generation fee'
        });
      }
      if (capability.execution.executor_hint?.includes('inco') || capability.execution.executor_hint?.includes('fhe')) {
        networkFee += NETWORK_FEES.inco_fhe;
        breakdown.push({
          component: 'inco_fhe',
          cost: NETWORK_FEES.inco_fhe,
          description: 'Inco FHE computation fee'
        });
      }
    }

    breakdown.push({
      component: 'network_fee',
      cost: networkFee,
      description: 'Estimated network transaction fees'
    });

    const totalEstimate = adjustedCost + networkFee;

    // Determine confidence based on capability type
    let confidence: 'high' | 'medium' | 'low' = 'high';
    if (capability.execution.mode === 'confidential') {
      confidence = 'medium'; // MPC costs can vary
    }
    if (capability_id.includes('swap')) {
      confidence = 'medium'; // Swap costs depend on route
    }

    return {
      capability_id,
      base_cost: baseCost,
      trust_multiplier: trustMultiplier,
      adjusted_cost: adjustedCost,
      network_fee_estimate: networkFee,
      total_estimate: totalEstimate,
      currency: capability.economics.currency,
      confidence,
      breakdown
    };
  }

  /**
   * Estimate cost for a composition of capabilities
   */
  estimateComposition(
    capability_ids: string[],
    trust_level: TrustLevel = 'anonymous',
    template_id?: string
  ): CompositionCostEstimate {
    const estimates = capability_ids.map(id => this.estimate(id, trust_level));

    const totalBaseCost = estimates.reduce((sum, e) => sum + e.base_cost, 0);
    const totalAdjustedCost = estimates.reduce((sum, e) => sum + e.adjusted_cost, 0);
    const totalNetworkFees = estimates.reduce((sum, e) => sum + e.network_fee_estimate, 0);

    // Composition discount: 10% off for batching
    const compositionDiscount = 0.1;
    const discountedTotal = (totalAdjustedCost + totalNetworkFees) * (1 - compositionDiscount);
    const individualTotal = totalAdjustedCost + totalNetworkFees;

    return {
      template_id,
      capabilities: estimates,
      total_base_cost: totalBaseCost,
      total_adjusted_cost: totalAdjustedCost,
      total_network_fees: totalNetworkFees,
      grand_total: discountedTotal,
      currency: 'SOL',
      savings_vs_individual: individualTotal - discountedTotal
    };
  }

  /**
   * Get cost comparison across trust levels
   */
  compareTrustLevels(capability_id: string): Record<TrustLevel, CostEstimate> {
    return {
      anonymous: this.estimate(capability_id, 'anonymous'),
      verified: this.estimate(capability_id, 'verified'),
      trusted: this.estimate(capability_id, 'trusted'),
      premium: this.estimate(capability_id, 'premium')
    };
  }

  /**
   * Estimate monthly cost for an agent based on usage patterns
   */
  estimateMonthlyBudget(
    usage: Array<{ capability_id: string; invocations_per_day: number }>,
    trust_level: TrustLevel
  ): {
    daily_cost: number;
    monthly_cost: number;
    top_costs: Array<{ capability_id: string; monthly_cost: number }>;
    savings_if_upgraded: number;
  } {
    let dailyCost = 0;
    const capCosts: Array<{ capability_id: string; monthly_cost: number }> = [];

    for (const item of usage) {
      const estimate = this.estimate(item.capability_id, trust_level);
      const dailyCapCost = estimate.total_estimate * item.invocations_per_day;
      dailyCost += dailyCapCost;
      capCosts.push({
        capability_id: item.capability_id,
        monthly_cost: dailyCapCost * 30
      });
    }

    // Calculate savings if upgraded to next trust level
    const trustHierarchy: TrustLevel[] = ['anonymous', 'verified', 'trusted', 'premium'];
    const currentIndex = trustHierarchy.indexOf(trust_level);
    let savingsIfUpgraded = 0;

    if (currentIndex < trustHierarchy.length - 1) {
      const nextLevel = trustHierarchy[currentIndex + 1];
      let upgradedDailyCost = 0;
      for (const item of usage) {
        const estimate = this.estimate(item.capability_id, nextLevel);
        upgradedDailyCost += estimate.total_estimate * item.invocations_per_day;
      }
      savingsIfUpgraded = (dailyCost - upgradedDailyCost) * 30;
    }

    return {
      daily_cost: dailyCost,
      monthly_cost: dailyCost * 30,
      top_costs: capCosts.sort((a, b) => b.monthly_cost - a.monthly_cost).slice(0, 5),
      savings_if_upgraded: savingsIfUpgraded
    };
  }
}

export const costEstimator = new CostEstimator();
