/**
 * Capability Negotiation System
 * 
 * Allows agents to ask:
 * "What would this cost if I:
 *  - relax privacy?
 *  - wait longer?
 *  - batch calls?"
 * 
 * Router responds with OPTIONS, not execution.
 * This mirrors human negotiation and enables economic reasoning.
 */

import { privacyGradient, PrivacyLevel, PrivacyOption } from './privacy-gradient';
import { registry } from './registry';

export interface NegotiationRequest {
  capability_id: string;
  inputs: Record<string, any>;
  
  // What the agent is willing to negotiate on
  negotiate: {
    privacy?: boolean;      // Willing to adjust privacy level
    latency?: boolean;      // Willing to wait longer
    batching?: boolean;     // Willing to batch with other calls
    provider?: boolean;     // Willing to use different provider
  };
  
  // Constraints
  constraints?: {
    max_cost?: number;
    max_latency_ms?: number;
    min_privacy_level?: PrivacyLevel;
    preferred_providers?: string[];
    excluded_providers?: string[];
  };
}

export interface NegotiationOption {
  option_id: string;
  
  // Execution parameters
  privacy_level: PrivacyLevel;
  provider: string;
  estimated_latency_ms: number;
  
  // Cost breakdown
  cost: {
    base: number;
    privacy_premium: number;
    latency_discount: number;
    batch_discount: number;
    total: number;
    currency: string;
  };
  
  // Trade-offs
  trade_offs: string[];
  
  // Confidence in estimate
  confidence: 'high' | 'medium' | 'low';
}

export interface NegotiationResponse {
  success: boolean;
  capability_id: string;
  
  // Available options sorted by total cost
  options: NegotiationOption[];
  
  // Recommendation
  recommended: {
    option_id: string;
    reasoning: string;
  };
  
  // Negotiation metadata
  metadata: {
    options_generated: number;
    constraints_applied: string[];
    negotiation_time_ms: number;
  };
  
  // Optional warnings
  warnings?: string[];
}

class CapabilityNegotiator {
  
  /**
   * Negotiate execution options for a capability
   */
  async negotiate(request: NegotiationRequest): Promise<NegotiationResponse> {
    const startTime = Date.now();
    const options: NegotiationOption[] = [];
    const constraintsApplied: string[] = [];

    // Default negotiate options if not provided
    if (!request.negotiate) {
      request.negotiate = { privacy: true, latency: true, batching: false, provider: true };
    }

    // Get capability info
    const capability = registry.getCapability(request.capability_id);
    if (!capability) {
      return {
        success: false,
        capability_id: request.capability_id,
        options: [],
        recommended: { option_id: '', reasoning: 'Capability not found' },
        metadata: {
          options_generated: 0,
          constraints_applied: [],
          negotiation_time_ms: Date.now() - startTime
        }
      };
    }

    // Base cost estimation (handle various schema formats)
    const baseCost = 0.01;
    const baseLatency = this.estimateBaseLatency(request.capability_id);

    // Generate privacy options if negotiable
    if (request.negotiate.privacy) {
      const privacyOptions = privacyGradient.getPrivacyOptions(request.capability_id);
      
      for (const po of privacyOptions) {
        // Apply min privacy constraint
        if (request.constraints?.min_privacy_level !== undefined && 
            po.level < request.constraints.min_privacy_level) {
          continue;
        }

        const option = this.createOption(
          `privacy_l${po.level}`,
          po,
          baseCost,
          baseLatency,
          request
        );

        // Apply max cost constraint
        if (request.constraints?.max_cost && option.cost.total > request.constraints.max_cost) {
          constraintsApplied.push(`Excluded L${po.level} privacy (cost $${option.cost.total.toFixed(4)} > max $${request.constraints.max_cost})`);
          continue;
        }

        options.push(option);
      }
    } else {
      // Default option without privacy negotiation
      options.push(this.createOption(
        'default',
        { level: 0, provider: 'default', cost_multiplier: 1, latency_multiplier: 1, description: 'Standard execution', proof_type: 'none' },
        baseCost,
        baseLatency,
        request
      ));
    }

    // Generate latency options if negotiable
    if (request.negotiate.latency && options.length > 0) {
      const baseOption = options[0];
      
      // Slow option (cheaper)
      options.push({
        ...baseOption,
        option_id: `${baseOption.option_id}_slow`,
        estimated_latency_ms: baseOption.estimated_latency_ms * 2,
        cost: {
          ...baseOption.cost,
          latency_discount: baseOption.cost.base * 0.1,
          total: baseOption.cost.total - (baseOption.cost.base * 0.1)
        },
        trade_offs: [...baseOption.trade_offs, '2x latency for 10% cost reduction'],
        confidence: 'medium'
      });

      // Very slow option (cheapest)
      options.push({
        ...baseOption,
        option_id: `${baseOption.option_id}_batch`,
        estimated_latency_ms: baseOption.estimated_latency_ms * 5,
        cost: {
          ...baseOption.cost,
          latency_discount: baseOption.cost.base * 0.2,
          batch_discount: baseOption.cost.base * 0.1,
          total: baseOption.cost.total - (baseOption.cost.base * 0.3)
        },
        trade_offs: [...baseOption.trade_offs, '5x latency for 30% cost reduction', 'Batched with other requests'],
        confidence: 'low'
      });
    }

    // Apply max latency constraint
    if (request.constraints?.max_latency_ms) {
      const filtered = options.filter(o => o.estimated_latency_ms <= request.constraints!.max_latency_ms!);
      if (filtered.length < options.length) {
        constraintsApplied.push(`Excluded ${options.length - filtered.length} options exceeding ${request.constraints.max_latency_ms}ms latency`);
      }
      options.length = 0;
      options.push(...filtered);
    }

    // Sort by total cost
    options.sort((a, b) => a.cost.total - b.cost.total);

    // Generate recommendation
    const recommended = this.generateRecommendation(options, request);

    return {
      success: true,
      capability_id: request.capability_id,
      options,
      recommended,
      metadata: {
        options_generated: options.length,
        constraints_applied: constraintsApplied,
        negotiation_time_ms: Date.now() - startTime
      }
    };
  }

  /**
   * Quick cost estimate without full negotiation
   */
  estimateCost(
    capabilityId: string,
    privacyLevel: PrivacyLevel = 0
  ): { estimated_cost: number; confidence: string } {
    const baseCost = 0.01;
    
    const privacyCost = privacyGradient.calculatePrivacyCost(baseCost, privacyLevel, capabilityId);
    
    return {
      estimated_cost: privacyCost.total_cost,
      confidence: 'medium'
    };
  }

  /**
   * Compare costs across privacy levels
   */
  compareCosts(capabilityId: string): Array<{
    privacy_level: PrivacyLevel;
    cost: number;
    latency_multiplier: number;
    provider: string;
  }> {
    const options = privacyGradient.getPrivacyOptions(capabilityId);
    const baseCost = 0.01;

    return options.map(o => ({
      privacy_level: o.level,
      cost: baseCost * o.cost_multiplier,
      latency_multiplier: o.latency_multiplier,
      provider: o.provider
    }));
  }

  private createOption(
    id: string,
    privacyOption: PrivacyOption,
    baseCost: number,
    baseLatency: number,
    request: NegotiationRequest
  ): NegotiationOption {
    const privacyPremium = baseCost * (privacyOption.cost_multiplier - 1);
    
    return {
      option_id: id,
      privacy_level: privacyOption.level,
      provider: privacyOption.provider,
      estimated_latency_ms: Math.round(baseLatency * privacyOption.latency_multiplier),
      cost: {
        base: baseCost,
        privacy_premium: privacyPremium,
        latency_discount: 0,
        batch_discount: 0,
        total: baseCost + privacyPremium,
        currency: 'USD'
      },
      trade_offs: privacyOption.level > 0 
        ? [`Privacy L${privacyOption.level}: ${privacyOption.description}`]
        : ['Standard public execution'],
      confidence: 'high'
    };
  }

  private estimateBaseLatency(capabilityId: string): number {
    // Estimate based on capability type
    if (capabilityId.includes('price')) return 200;
    if (capabilityId.includes('wallet')) return 500;
    if (capabilityId.includes('swap')) return 1000;
    if (capabilityId.includes('zk') || capabilityId.includes('prove')) return 2000;
    if (capabilityId.includes('message')) return 300;
    return 500; // Default
  }

  private generateRecommendation(
    options: NegotiationOption[],
    request: NegotiationRequest
  ): { option_id: string; reasoning: string } {
    if (options.length === 0) {
      return { option_id: '', reasoning: 'No options available within constraints' };
    }

    // If privacy is important, recommend highest privacy within budget
    if (request.constraints?.min_privacy_level && request.constraints.min_privacy_level >= 2) {
      const highPrivacy = options.filter(o => o.privacy_level >= 2);
      if (highPrivacy.length > 0) {
        return {
          option_id: highPrivacy[0].option_id,
          reasoning: 'Recommended for sensitive data: highest privacy at lowest cost'
        };
      }
    }

    // Default: cheapest option
    return {
      option_id: options[0].option_id,
      reasoning: 'Most cost-effective option meeting all constraints'
    };
  }
}

export const negotiator = new CapabilityNegotiator();
