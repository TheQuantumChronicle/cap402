/**
 * Agent Social Features
 * 
 * Social layer for agents:
 * - Leaderboards (reputation, usage, badges)
 * - Agent profiles with public stats
 * - Capability sharing and delegation
 * - Agent-to-agent messaging
 * - Collaborative workflows
 * 
 * This creates network effects - agents want to be on the platform
 * where other agents are
 */

import { agentIdentityManager, AgentIdentity } from './agent-identity';

interface LeaderboardEntry {
  rank: number;
  agent_id: string;
  display_name?: string;
  score: number;
  badges: string[];
  trust_level: string;
  capabilities_count: number;
  member_since: number;
}

interface AgentPublicProfile {
  agent_id: string;
  display_name?: string;
  trust_level: string;
  reputation_score: number;
  badges: string[];
  capabilities_used: number;
  total_invocations: number;
  member_since: number;
  specialization: string;
  public_workflows?: string[];
}

interface CapabilityDelegation {
  id: string;
  from_agent: string;
  to_agent: string;
  capability_id: string;
  permissions: ('invoke' | 'compose' | 'share')[];
  expires_at?: number;
  created_at: number;
  uses_remaining?: number;
}

interface AgentMessage {
  id: string;
  from_agent: string;
  to_agent: string;
  subject: string;
  content: string;
  timestamp: number;
  read: boolean;
  type: 'direct' | 'workflow_invite' | 'delegation_request' | 'system';
}

class AgentSocialManager {
  private delegations: Map<string, CapabilityDelegation> = new Map();
  private messages: Map<string, AgentMessage[]> = new Map();
  private publicWorkflows: Map<string, { agent_id: string; workflow: any }> = new Map();

  /**
   * Get leaderboard by category
   */
  getLeaderboard(
    category: 'reputation' | 'invocations' | 'badges' | 'capabilities',
    limit: number = 10
  ): LeaderboardEntry[] {
    const agents = agentIdentityManager.getLeaderboard(100);
    
    let sorted: AgentIdentity[];
    switch (category) {
      case 'reputation':
        sorted = agents.sort((a, b) => b.reputation.score - a.reputation.score);
        break;
      case 'invocations':
        sorted = agents.sort((a, b) => b.reputation.total_invocations - a.reputation.total_invocations);
        break;
      case 'badges':
        sorted = agents.sort((a, b) => b.reputation.badges.length - a.reputation.badges.length);
        break;
      case 'capabilities':
        sorted = agents.sort((a, b) => b.reputation.capabilities_used.length - a.reputation.capabilities_used.length);
        break;
      default:
        sorted = agents;
    }

    return sorted.slice(0, limit).map((agent, index) => ({
      rank: index + 1,
      agent_id: agent.agent_id,
      display_name: agent.metadata?.name,
      score: this.getScoreForCategory(agent, category),
      badges: agent.reputation.badges,
      trust_level: agent.trust_level,
      capabilities_count: agent.reputation.capabilities_used.length,
      member_since: agent.created_at
    }));
  }

  /**
   * Get public profile for an agent
   */
  getPublicProfile(agent_id: string): AgentPublicProfile | null {
    const agent = agentIdentityManager.getAgent(agent_id);
    if (!agent) return null;

    return {
      agent_id: agent.agent_id,
      display_name: agent.metadata?.name,
      trust_level: agent.trust_level,
      reputation_score: agent.reputation.score,
      badges: agent.reputation.badges,
      capabilities_used: agent.reputation.capabilities_used.length,
      total_invocations: agent.reputation.total_invocations,
      member_since: agent.created_at,
      specialization: this.detectSpecialization(agent),
      public_workflows: this.getAgentPublicWorkflows(agent_id)
    };
  }

  /**
   * Delegate capability access to another agent
   */
  delegateCapability(
    from_agent: string,
    to_agent: string,
    capability_id: string,
    options: {
      permissions?: ('invoke' | 'compose' | 'share')[];
      expires_in_hours?: number;
      max_uses?: number;
    } = {}
  ): CapabilityDelegation {
    const id = `del_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    const delegation: CapabilityDelegation = {
      id,
      from_agent,
      to_agent,
      capability_id,
      permissions: options.permissions || ['invoke'],
      expires_at: options.expires_in_hours 
        ? Date.now() + options.expires_in_hours * 60 * 60 * 1000 
        : undefined,
      created_at: Date.now(),
      uses_remaining: options.max_uses
    };

    this.delegations.set(id, delegation);
    
    // Send notification to recipient
    this.sendMessage(from_agent, to_agent, {
      subject: 'Capability Delegation',
      content: `You have been granted access to ${capability_id}`,
      type: 'delegation_request'
    });

    return delegation;
  }

  /**
   * Check if agent has delegated access to capability
   */
  hasDelegatedAccess(agent_id: string, capability_id: string): boolean {
    for (const delegation of this.delegations.values()) {
      if (delegation.to_agent === agent_id && 
          delegation.capability_id === capability_id) {
        // Check expiry
        if (delegation.expires_at && Date.now() > delegation.expires_at) {
          continue;
        }
        // Check uses
        if (delegation.uses_remaining !== undefined && delegation.uses_remaining <= 0) {
          continue;
        }
        return true;
      }
    }
    return false;
  }

  /**
   * Use delegated access (decrements uses if limited)
   */
  useDelegatedAccess(agent_id: string, capability_id: string): boolean {
    for (const delegation of this.delegations.values()) {
      if (delegation.to_agent === agent_id && 
          delegation.capability_id === capability_id) {
        if (delegation.uses_remaining !== undefined) {
          if (delegation.uses_remaining <= 0) continue;
          delegation.uses_remaining--;
        }
        return true;
      }
    }
    return false;
  }

  /**
   * Get delegations for an agent
   */
  getDelegations(agent_id: string): {
    granted: CapabilityDelegation[];
    received: CapabilityDelegation[];
  } {
    const granted: CapabilityDelegation[] = [];
    const received: CapabilityDelegation[] = [];

    for (const delegation of this.delegations.values()) {
      if (delegation.from_agent === agent_id) {
        granted.push(delegation);
      }
      if (delegation.to_agent === agent_id) {
        received.push(delegation);
      }
    }

    return { granted, received };
  }

  /**
   * Send message between agents
   */
  sendMessage(
    from_agent: string,
    to_agent: string,
    message: {
      subject: string;
      content: string;
      type?: 'direct' | 'workflow_invite' | 'delegation_request' | 'system';
    }
  ): AgentMessage {
    const msg: AgentMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      from_agent,
      to_agent,
      subject: message.subject,
      content: message.content,
      timestamp: Date.now(),
      read: false,
      type: message.type || 'direct'
    };

    if (!this.messages.has(to_agent)) {
      this.messages.set(to_agent, []);
    }
    this.messages.get(to_agent)!.push(msg);

    return msg;
  }

  /**
   * Get messages for an agent
   */
  getMessages(agent_id: string, unread_only: boolean = false): AgentMessage[] {
    const messages = this.messages.get(agent_id) || [];
    if (unread_only) {
      return messages.filter(m => !m.read);
    }
    return messages;
  }

  /**
   * Mark message as read
   */
  markAsRead(agent_id: string, message_id: string): boolean {
    const messages = this.messages.get(agent_id);
    if (!messages) return false;

    const message = messages.find(m => m.id === message_id);
    if (message) {
      message.read = true;
      return true;
    }
    return false;
  }

  /**
   * Share a workflow publicly
   */
  shareWorkflow(
    agent_id: string,
    workflow: {
      name: string;
      description: string;
      capabilities: string[];
      template?: any;
    }
  ): string {
    const id = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.publicWorkflows.set(id, { agent_id, workflow });
    return id;
  }

  /**
   * Get community stats
   */
  getCommunityStats(): {
    total_agents: number;
    active_agents_24h: number;
    total_delegations: number;
    total_messages: number;
    public_workflows: number;
    top_badges: Array<{ badge: string; count: number }>;
  } {
    const agentStats = agentIdentityManager.getStats();
    
    // Count badges
    const badgeCounts: Record<string, number> = {};
    const agents = agentIdentityManager.getLeaderboard(100);
    for (const agent of agents) {
      for (const badge of agent.reputation.badges) {
        badgeCounts[badge] = (badgeCounts[badge] || 0) + 1;
      }
    }
    const topBadges = Object.entries(badgeCounts)
      .map(([badge, count]) => ({ badge, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    let totalMessages = 0;
    for (const msgs of this.messages.values()) {
      totalMessages += msgs.length;
    }

    return {
      total_agents: agentStats.total_agents,
      active_agents_24h: agentStats.active_agents_24h,
      total_delegations: this.delegations.size,
      total_messages: totalMessages,
      public_workflows: this.publicWorkflows.size,
      top_badges: topBadges
    };
  }

  private getScoreForCategory(agent: AgentIdentity, category: string): number {
    switch (category) {
      case 'reputation':
        return agent.reputation.score;
      case 'invocations':
        return agent.reputation.total_invocations;
      case 'badges':
        return agent.reputation.badges.length;
      case 'capabilities':
        return agent.reputation.capabilities_used.length;
      default:
        return 0;
    }
  }

  private detectSpecialization(agent: AgentIdentity): string {
    const caps = agent.reputation.capabilities_used;
    
    if (caps.some(c => c.includes('confidential') || c.includes('zk') || c.includes('cspl'))) {
      return 'Privacy Specialist';
    }
    if (caps.some(c => c.includes('swap') || c.includes('price'))) {
      return 'Trader';
    }
    if (caps.some(c => c.includes('governance'))) {
      return 'DAO Participant';
    }
    if (caps.some(c => c.includes('message'))) {
      return 'Communicator';
    }
    return 'Explorer';
  }

  private getAgentPublicWorkflows(agent_id: string): string[] {
    const workflows: string[] = [];
    for (const [id, wf] of this.publicWorkflows) {
      if (wf.agent_id === agent_id) {
        workflows.push(id);
      }
    }
    return workflows;
  }
}

export const agentSocialManager = new AgentSocialManager();
