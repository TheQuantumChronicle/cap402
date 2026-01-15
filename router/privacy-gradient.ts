/**
 * Privacy Gradient System
 * 
 * Codifies privacy as a quantifiable, optimizable gradient:
 * 
 * Level 0: Public - All data visible on-chain
 * Level 1: Obscured - Metadata hidden, execution visible
 * Level 2: Encrypted - Execution encrypted (Inco FHE)
 * Level 3: ZK Verifiable - Zero-knowledge proof of execution (Noir/Arcium)
 * 
 * Agents can request: "Give me level ≥2 but cheapest"
 */

export type PrivacyLevel = 0 | 1 | 2 | 3;

export interface PrivacyRequirement {
  minimum_level: PrivacyLevel;
  preferred_level?: PrivacyLevel;
  max_cost_multiplier?: number; // e.g., 2.0 = willing to pay 2x for privacy
}

export interface PrivacyOption {
  level: PrivacyLevel;
  provider: string;
  cost_multiplier: number;
  latency_multiplier: number;
  description: string;
  proof_type: string;
}

export interface PrivacyRecommendation {
  recommended_level: PrivacyLevel;
  options: PrivacyOption[];
  reasoning: string;
}

export const PRIVACY_LEVELS: Record<PrivacyLevel, {
  name: string;
  description: string;
  guarantees: string[];
  typical_providers: string[];
}> = {
  0: {
    name: 'Public',
    description: 'All execution data visible on-chain and in logs',
    guarantees: [
      'Fast execution',
      'Lowest cost',
      'Full auditability'
    ],
    typical_providers: ['helius', 'solana-rpc']
  },
  1: {
    name: 'Obscured',
    description: 'Metadata hidden, execution visible to operator',
    guarantees: [
      'Request metadata not logged',
      'IP/identity not stored',
      'Execution still visible'
    ],
    typical_providers: ['helius-private', 'tor-relay']
  },
  2: {
    name: 'Encrypted',
    description: 'Execution encrypted, only results visible',
    guarantees: [
      'Inputs encrypted in transit',
      'Computation on encrypted data (FHE)',
      'Only final result decrypted'
    ],
    typical_providers: ['inco-fhe', 'arcium-mpc']
  },
  3: {
    name: 'ZK Verifiable',
    description: 'Zero-knowledge proof of execution, nothing revealed',
    guarantees: [
      'Inputs never revealed',
      'Execution never revealed',
      'Only proof of correctness visible',
      'Cryptographically verifiable'
    ],
    typical_providers: ['noir-zk', 'arcium-attestation']
  }
};

class PrivacyGradientManager {
  
  /**
   * Get available privacy options for a capability
   */
  getPrivacyOptions(capabilityId: string): PrivacyOption[] {
    // Different capabilities support different privacy levels
    const baseOptions: PrivacyOption[] = [
      {
        level: 0,
        provider: 'public-executor',
        cost_multiplier: 1.0,
        latency_multiplier: 1.0,
        description: 'Standard public execution',
        proof_type: 'none'
      }
    ];

    // Add privacy options based on capability type
    if (capabilityId.includes('price') || capabilityId.includes('wallet')) {
      // Public data capabilities - limited privacy options
      baseOptions.push({
        level: 1,
        provider: 'obscured-executor',
        cost_multiplier: 1.1,
        latency_multiplier: 1.2,
        description: 'Request metadata stripped',
        proof_type: 'none'
      });
    }

    if (capabilityId.includes('swap') || capabilityId.includes('transfer')) {
      // Financial capabilities - full privacy stack
      baseOptions.push(
        {
          level: 1,
          provider: 'obscured-executor',
          cost_multiplier: 1.1,
          latency_multiplier: 1.2,
          description: 'Metadata obscured',
          proof_type: 'none'
        },
        {
          level: 2,
          provider: 'inco-fhe',
          cost_multiplier: 1.5,
          latency_multiplier: 2.0,
          description: 'FHE encrypted execution',
          proof_type: 'fhe-proof'
        },
        {
          level: 3,
          provider: 'arcium-mpc',
          cost_multiplier: 2.0,
          latency_multiplier: 1.5,
          description: 'MPC with attestation',
          proof_type: 'arcium-attestation'
        }
      );
    }

    if (capabilityId.includes('zk') || capabilityId.includes('prove')) {
      // ZK capabilities - native level 3
      baseOptions.push({
        level: 3,
        provider: 'noir-prover',
        cost_multiplier: 1.2,
        latency_multiplier: 1.5,
        description: 'Native ZK proof generation',
        proof_type: 'zk-snark'
      });
    }

    if (capabilityId.includes('message') || capabilityId.includes('lightning')) {
      // Messaging capabilities
      baseOptions.push(
        {
          level: 2,
          provider: 'inco-fhe',
          cost_multiplier: 1.3,
          latency_multiplier: 1.2,
          description: 'E2E encrypted messaging',
          proof_type: 'delivery-receipt'
        }
      );
    }

    return baseOptions.sort((a, b) => a.level - b.level);
  }

  /**
   * Select optimal privacy level based on requirements
   */
  selectPrivacyLevel(
    capabilityId: string,
    requirement: PrivacyRequirement
  ): PrivacyOption | null {
    const options = this.getPrivacyOptions(capabilityId);
    
    // Filter to options meeting minimum level
    const validOptions = options.filter(o => o.level >= requirement.minimum_level);
    
    if (validOptions.length === 0) {
      return null; // No options meet requirements
    }

    // If max cost multiplier specified, filter further
    let candidates = validOptions;
    if (requirement.max_cost_multiplier !== undefined) {
      const maxMultiplier = requirement.max_cost_multiplier;
      candidates = validOptions.filter(o => o.cost_multiplier <= maxMultiplier);
      if (candidates.length === 0) {
        candidates = validOptions; // Fall back to all valid options
      }
    }

    // If preferred level specified, try to match it
    if (requirement.preferred_level !== undefined) {
      const preferred = candidates.find(o => o.level === requirement.preferred_level);
      if (preferred) return preferred;
    }

    // Return cheapest option that meets requirements
    return candidates.sort((a, b) => a.cost_multiplier - b.cost_multiplier)[0];
  }

  /**
   * Get privacy recommendation for a capability
   */
  recommendPrivacy(
    capabilityId: string,
    sensitivityHint?: 'low' | 'medium' | 'high' | 'critical'
  ): PrivacyRecommendation {
    const options = this.getPrivacyOptions(capabilityId);
    
    let recommendedLevel: PrivacyLevel = 0;
    let reasoning = '';

    switch (sensitivityHint) {
      case 'critical':
        recommendedLevel = 3;
        reasoning = 'Critical data requires ZK-verifiable execution';
        break;
      case 'high':
        recommendedLevel = 2;
        reasoning = 'High sensitivity data should use encrypted execution';
        break;
      case 'medium':
        recommendedLevel = 1;
        reasoning = 'Medium sensitivity - obscured metadata recommended';
        break;
      case 'low':
      default:
        recommendedLevel = 0;
        reasoning = 'Low sensitivity - public execution is cost-effective';
    }

    // Adjust if capability doesn't support recommended level
    const maxAvailable = Math.max(...options.map(o => o.level)) as PrivacyLevel;
    if (recommendedLevel > maxAvailable) {
      recommendedLevel = maxAvailable;
      reasoning += ` (capped at L${maxAvailable} for this capability)`;
    }

    return {
      recommended_level: recommendedLevel,
      options,
      reasoning
    };
  }

  /**
   * Calculate privacy cost for a request
   */
  calculatePrivacyCost(
    baseCost: number,
    privacyLevel: PrivacyLevel,
    capabilityId: string
  ): { total_cost: number; privacy_premium: number; breakdown: string } {
    const options = this.getPrivacyOptions(capabilityId);
    const option = options.find(o => o.level === privacyLevel);
    
    const multiplier = option?.cost_multiplier || 1.0;
    const privacyPremium = baseCost * (multiplier - 1);
    const totalCost = baseCost * multiplier;

    return {
      total_cost: totalCost,
      privacy_premium: privacyPremium,
      breakdown: `Base: $${baseCost.toFixed(4)} + Privacy L${privacyLevel}: $${privacyPremium.toFixed(4)} = $${totalCost.toFixed(4)}`
    };
  }

  /**
   * Get privacy level info
   */
  getLevelInfo(level: PrivacyLevel) {
    return PRIVACY_LEVELS[level];
  }
}

export const privacyGradient = new PrivacyGradientManager();
