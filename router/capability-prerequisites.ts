/**
 * Capability Prerequisites and Dependencies
 * 
 * Some capabilities require:
 * - Minimum trust level
 * - Prior capability execution
 * - Specific credentials
 * - Balance requirements
 * 
 * This ensures agents can't access sensitive capabilities without proper setup
 */

export interface CapabilityPrerequisite {
  capability_id: string;
  min_trust_level?: 'anonymous' | 'verified' | 'trusted' | 'premium';
  required_credentials?: string[];
  required_capabilities?: string[]; // Must have used these before
  min_reputation?: number;
  min_invocations?: number;
  description: string;
}

// In production, these would be enforced. For demo/hackathon, we allow anonymous access.
const ENFORCE_PREREQUISITES = process.env.ENFORCE_PREREQUISITES === 'true';

export const CAPABILITY_PREREQUISITES: CapabilityPrerequisite[] = ENFORCE_PREREQUISITES ? [
  {
    capability_id: 'cap.confidential.swap.v1',
    min_trust_level: 'verified',
    min_reputation: 30,
    description: 'Confidential swaps require verified identity to prevent abuse'
  },
  {
    capability_id: 'cap.cspl.wrap.v1',
    min_trust_level: 'verified',
    description: 'Wrapping to confidential tokens requires verified identity'
  },
  {
    capability_id: 'cap.cspl.transfer.v1',
    min_trust_level: 'verified',
    required_capabilities: ['cap.cspl.wrap.v1'],
    description: 'Must have wrapped tokens before transferring confidentially'
  },
  {
    capability_id: 'cap.private.governance.v1',
    min_trust_level: 'trusted',
    required_credentials: ['dao_member'],
    min_reputation: 50,
    description: 'Private governance requires trusted status and DAO membership'
  },
  {
    capability_id: 'cap.fhe.compute.v1',
    min_trust_level: 'verified',
    min_invocations: 10,
    description: 'FHE compute requires some platform experience'
  },
  {
    capability_id: 'cap.encrypted.trade.v1',
    min_trust_level: 'trusted',
    required_credentials: ['kyc_verified'],
    description: 'Encrypted trading requires KYC verification'
  }
] : []; // Empty array = no prerequisites in demo mode

interface PrerequisiteCheckResult {
  allowed: boolean;
  missing: string[];
  recommendations: string[];
}

class PrerequisiteChecker {
  private prerequisites: Map<string, CapabilityPrerequisite> = new Map();

  constructor() {
    for (const prereq of CAPABILITY_PREREQUISITES) {
      this.prerequisites.set(prereq.capability_id, prereq);
    }
  }

  /**
   * Check if agent meets prerequisites for a capability
   */
  check(
    capability_id: string,
    agent: {
      trust_level: string;
      reputation: { score: number; total_invocations: number; capabilities_used: string[] };
      credentials: Array<{ type: string }>;
    } | null
  ): PrerequisiteCheckResult {
    const prereq = this.prerequisites.get(capability_id);
    
    // No prerequisites for this capability
    if (!prereq) {
      return { allowed: true, missing: [], recommendations: [] };
    }

    // Anonymous access (no agent)
    if (!agent) {
      if (prereq.min_trust_level && prereq.min_trust_level !== 'anonymous') {
        return {
          allowed: false,
          missing: [`Requires ${prereq.min_trust_level} trust level`],
          recommendations: ['Register an agent identity at POST /agents/register']
        };
      }
      return { allowed: true, missing: [], recommendations: [] };
    }

    const missing: string[] = [];
    const recommendations: string[] = [];

    // Check trust level
    if (prereq.min_trust_level) {
      const trustHierarchy = ['anonymous', 'verified', 'trusted', 'premium'];
      const agentLevel = trustHierarchy.indexOf(agent.trust_level);
      const requiredLevel = trustHierarchy.indexOf(prereq.min_trust_level);
      
      if (agentLevel < requiredLevel) {
        missing.push(`Requires ${prereq.min_trust_level} trust level (you have ${agent.trust_level})`);
        recommendations.push('Add credentials to increase trust level');
      }
    }

    // Check reputation
    if (prereq.min_reputation && agent.reputation.score < prereq.min_reputation) {
      missing.push(`Requires ${prereq.min_reputation} reputation (you have ${agent.reputation.score})`);
      recommendations.push('Use more capabilities successfully to build reputation');
    }

    // Check invocations
    if (prereq.min_invocations && agent.reputation.total_invocations < prereq.min_invocations) {
      missing.push(`Requires ${prereq.min_invocations} invocations (you have ${agent.reputation.total_invocations})`);
      recommendations.push('Use the platform more to meet invocation requirements');
    }

    // Check required capabilities
    if (prereq.required_capabilities) {
      const missingCaps = prereq.required_capabilities.filter(
        cap => !agent.reputation.capabilities_used.includes(cap)
      );
      if (missingCaps.length > 0) {
        missing.push(`Must use these capabilities first: ${missingCaps.join(', ')}`);
        recommendations.push(`Invoke ${missingCaps[0]} before using this capability`);
      }
    }

    // Check credentials
    if (prereq.required_credentials) {
      const agentCredTypes = agent.credentials.map(c => c.type);
      const missingCreds = prereq.required_credentials.filter(
        cred => !agentCredTypes.includes(cred)
      );
      if (missingCreds.length > 0) {
        missing.push(`Missing credentials: ${missingCreds.join(', ')}`);
        recommendations.push('Add required credentials to your agent profile');
      }
    }

    return {
      allowed: missing.length === 0,
      missing,
      recommendations
    };
  }

  /**
   * Get prerequisites for a capability
   */
  getPrerequisites(capability_id: string): CapabilityPrerequisite | null {
    return this.prerequisites.get(capability_id) || null;
  }

  /**
   * Get all capabilities an agent can access
   */
  getAccessibleCapabilities(agent: {
    trust_level: string;
    reputation: { score: number; total_invocations: number; capabilities_used: string[] };
    credentials: Array<{ type: string }>;
  } | null): {
    accessible: string[];
    restricted: Array<{ capability_id: string; reason: string }>;
  } {
    const accessible: string[] = [];
    const restricted: Array<{ capability_id: string; reason: string }> = [];

    for (const [capability_id, prereq] of this.prerequisites) {
      const result = this.check(capability_id, agent);
      if (result.allowed) {
        accessible.push(capability_id);
      } else {
        restricted.push({
          capability_id,
          reason: result.missing[0] || prereq.description
        });
      }
    }

    return { accessible, restricted };
  }
}

export const prerequisiteChecker = new PrerequisiteChecker();
