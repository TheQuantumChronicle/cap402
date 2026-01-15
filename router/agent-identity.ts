/**
 * Agent Identity and Reputation System
 * 
 * This is a major moat - agents have persistent identities with:
 * - Reputation scores based on capability usage
 * - Trust levels for accessing sensitive capabilities
 * - Usage history and patterns
 * - Credential verification
 * 
 * This makes CAP-402 the "identity layer for agents"
 */

import * as crypto from 'crypto';

export interface AgentIdentity {
  agent_id: string;
  public_key: string;
  created_at: number;
  reputation: AgentReputation;
  credentials: AgentCredential[];
  trust_level: TrustLevel;
  metadata: Record<string, any>;
}

export interface AgentReputation {
  score: number; // 0-100
  total_invocations: number;
  successful_invocations: number;
  failed_invocations: number;
  capabilities_used: string[];
  last_active: number;
  badges: string[];
}

export interface AgentCredential {
  type: string;
  issuer: string;
  issued_at: number;
  expires_at?: number;
  claims: Record<string, any>;
  proof: string;
}

export type TrustLevel = 'anonymous' | 'verified' | 'trusted' | 'premium';

interface IdentityRegistration {
  public_key: string;
  metadata?: Record<string, any>;
}

class AgentIdentityManager {
  private agents: Map<string, AgentIdentity> = new Map();
  private apiKeyToAgent: Map<string, string> = new Map();
  private readonly MAX_AGENTS = 10000;
  private readonly MAX_CAPABILITIES_TRACKED = 100;

  /**
   * Register a new agent identity
   */
  async register(registration: IdentityRegistration): Promise<{
    agent_id: string;
    api_key: string;
  }> {
    const agent_id = this.generateAgentId(registration.public_key);
    const api_key = this.generateApiKey();

    const identity: AgentIdentity = {
      agent_id,
      public_key: registration.public_key,
      created_at: Date.now(),
      reputation: {
        score: 50, // Start at neutral
        total_invocations: 0,
        successful_invocations: 0,
        failed_invocations: 0,
        capabilities_used: [],
        last_active: Date.now(),
        badges: ['new_agent']
      },
      credentials: [],
      trust_level: 'anonymous',
      metadata: registration.metadata || {}
    };

    this.agents.set(agent_id, identity);
    this.apiKeyToAgent.set(api_key, agent_id);

    return { agent_id, api_key };
  }

  /**
   * Get agent identity by ID
   */
  getAgent(agent_id: string): AgentIdentity | undefined {
    return this.agents.get(agent_id);
  }

  /**
   * Get agent by API key
   */
  getAgentByApiKey(api_key: string): AgentIdentity | undefined {
    const agent_id = this.apiKeyToAgent.get(api_key);
    return agent_id ? this.agents.get(agent_id) : undefined;
  }

  /**
   * Record capability invocation (updates reputation)
   */
  recordInvocation(agent_id: string, capability_id: string, success: boolean): void {
    const agent = this.agents.get(agent_id);
    if (!agent) return;

    agent.reputation.total_invocations++;
    agent.reputation.last_active = Date.now();

    if (success) {
      agent.reputation.successful_invocations++;
      // Diminishing returns on reputation gain
      const gain = Math.max(0.01, 0.1 * (1 - agent.reputation.score / 100));
      agent.reputation.score = Math.min(100, agent.reputation.score + gain);
    } else {
      agent.reputation.failed_invocations++;
      agent.reputation.score = Math.max(0, agent.reputation.score - 0.5);
    }

    // Track capabilities with limit to prevent unbounded growth
    if (!agent.reputation.capabilities_used.includes(capability_id)) {
      if (agent.reputation.capabilities_used.length >= this.MAX_CAPABILITIES_TRACKED) {
        agent.reputation.capabilities_used.shift(); // Remove oldest
      }
      agent.reputation.capabilities_used.push(capability_id);
    }

    // Award badges
    this.checkBadges(agent);
  }

  /**
   * Add credential to agent
   */
  addCredential(agent_id: string, credential: AgentCredential): boolean {
    const agent = this.agents.get(agent_id);
    if (!agent) return false;

    agent.credentials.push(credential);
    
    // Upgrade trust level based on credentials
    this.updateTrustLevel(agent);
    
    return true;
  }

  /**
   * Verify agent has required trust level for capability
   */
  verifyAccess(agent_id: string, required_trust: TrustLevel): boolean {
    const agent = this.agents.get(agent_id);
    if (!agent) return false;

    const trustHierarchy: TrustLevel[] = ['anonymous', 'verified', 'trusted', 'premium'];
    const agentLevel = trustHierarchy.indexOf(agent.trust_level);
    const requiredLevel = trustHierarchy.indexOf(required_trust);

    return agentLevel >= requiredLevel;
  }

  /**
   * Get reputation leaderboard
   */
  getLeaderboard(limit: number = 10): AgentIdentity[] {
    return Array.from(this.agents.values())
      .sort((a, b) => b.reputation.score - a.reputation.score)
      .slice(0, limit);
  }

  /**
   * Get agent statistics
   */
  getStats(): {
    total_agents: number;
    active_agents_24h: number;
    average_reputation: number;
    trust_distribution: Record<TrustLevel, number>;
  } {
    const agents = Array.from(this.agents.values());
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    const activeAgents = agents.filter(a => now - a.reputation.last_active < day);
    const avgReputation = agents.reduce((sum, a) => sum + a.reputation.score, 0) / agents.length || 0;

    const trustDist: Record<TrustLevel, number> = {
      anonymous: 0,
      verified: 0,
      trusted: 0,
      premium: 0
    };
    agents.forEach(a => trustDist[a.trust_level]++);

    return {
      total_agents: agents.length,
      active_agents_24h: activeAgents.length,
      average_reputation: Math.round(avgReputation * 100) / 100,
      trust_distribution: trustDist
    };
  }

  private generateAgentId(publicKey: string): string {
    return `agent_${crypto.createHash('sha256').update(publicKey).digest('hex').slice(0, 16)}`;
  }

  private generateApiKey(): string {
    return `cap402_${crypto.randomBytes(32).toString('hex')}`;
  }

  private checkBadges(agent: AgentIdentity): void {
    const rep = agent.reputation;

    // Invocation milestones
    if (rep.total_invocations >= 100 && !rep.badges.includes('century')) {
      rep.badges.push('century');
    }
    if (rep.total_invocations >= 1000 && !rep.badges.includes('power_user')) {
      rep.badges.push('power_user');
    }

    // Capability diversity
    if (rep.capabilities_used.length >= 5 && !rep.badges.includes('explorer')) {
      rep.badges.push('explorer');
    }
    if (rep.capabilities_used.length >= 10 && !rep.badges.includes('versatile')) {
      rep.badges.push('versatile');
    }

    // Reliability
    const successRate = rep.successful_invocations / rep.total_invocations;
    if (successRate >= 0.99 && rep.total_invocations >= 50 && !rep.badges.includes('reliable')) {
      rep.badges.push('reliable');
    }

    // Privacy focus
    const privacyCaps = rep.capabilities_used.filter(c => 
      c.includes('confidential') || c.includes('zk') || c.includes('cspl')
    );
    if (privacyCaps.length >= 3 && !rep.badges.includes('privacy_advocate')) {
      rep.badges.push('privacy_advocate');
    }
  }

  private updateTrustLevel(agent: AgentIdentity): void {
    // Check for verification credentials
    const hasKYC = agent.credentials.some(c => c.type === 'kyc');
    const hasVerifiedEmail = agent.credentials.some(c => c.type === 'email_verified');
    const hasPremium = agent.credentials.some(c => c.type === 'premium_subscription');

    if (hasPremium) {
      agent.trust_level = 'premium';
    } else if (hasKYC) {
      agent.trust_level = 'trusted';
    } else if (hasVerifiedEmail) {
      agent.trust_level = 'verified';
    }
  }
}

export const agentIdentityManager = new AgentIdentityManager();
