/**
 * Unified Agent Service
 * 
 * Bridges the three agent systems to ensure consistency:
 * - AgentIdentityManager (identity, credentials, badges)
 * - AgentRegistry (capabilities, delegations)
 * - TrustNetworkManager (trust scores, endorsements)
 * 
 * This ensures an agent registered in one system is visible in all.
 */

import { agentIdentityManager, AgentIdentity } from './agent-identity';
import { agentRegistry, RegisteredAgent } from './agent-registry';
import { trustNetwork } from './security/trust-network';
import { activityFeed } from './activity-feed';

export interface UnifiedAgent {
  agent_id: string;
  name?: string;
  
  // From identity
  trust_level: string;
  badges: string[];
  credentials_count: number;
  
  // From registry
  capabilities_provided: string[];
  capabilities_required: string[];
  delegations_granted: number;
  delegations_received: number;
  
  // From trust network
  trust_score: number;
  reputation_level: string;
  endorsements_count: number;
  violations_count: number;
  network_connections: number;
  
  // Computed
  overall_score: number;
  activity_24h: number;
  registered_at: number;
  last_active: number;
}

class UnifiedAgentService {
  /**
   * Register agent across all systems
   */
  async registerAgent(config: {
    agent_id: string;
    name: string;
    description?: string;
    capabilities?: string[];
    public_key?: string;
    metadata?: Record<string, any>;
  }): Promise<UnifiedAgent> {
    const { agent_id, name, description, capabilities, public_key, metadata } = config;

    // 1. Register in identity manager (if public_key provided)
    if (public_key) {
      try {
        await agentIdentityManager.register({ public_key, metadata: { name, ...metadata } });
      } catch (e) {
        // May already exist
      }
    }

    // 2. Register in agent registry
    try {
      agentRegistry.registerAgent(
        agent_id,
        name,
        description || '',
        capabilities || [],
        [],
        undefined,
        metadata || {}
      );
    } catch (e) {
      // May already exist or validation error
    }

    // 3. Register in trust network
    const existingNode = trustNetwork.getNode(agent_id);
    if (!existingNode) {
      trustNetwork.registerAgent(agent_id);
    }

    // 4. Record in activity feed
    activityFeed.record('agent_registered', agent_id, {
      name,
      capabilities_count: (capabilities || []).length
    });

    return this.getUnifiedAgent(agent_id)!;
  }

  /**
   * Get unified view of an agent from all systems
   */
  getUnifiedAgent(agentId: string): UnifiedAgent | null {
    // Use dynamic imports to ensure we get the same instances as the server
    // This is necessary because Node.js module caching can create separate instances
    const { agentRegistry: registry } = require('./agent-registry');
    const { trustNetwork: trust } = require('./security/trust-network');
    const { agentIdentityManager: identity } = require('./agent-identity');
    
    // Try to get from each system
    const identityAgent = identity.getAgent(agentId);
    const registered = registry.getAgent(agentId);
    const trustNode = trust.getNode(agentId);

    // Must exist in at least one system
    if (!identityAgent && !registered && !trustNode) {
      return null;
    }

    // Get delegations if registered
    const delegations = registered ? registry.getAgentDelegations(agentId) : { granted: [], received: [] };

    // Calculate trust from trust network
    const trustCalc = trustNode ? trust.calculateTrust(agentId) : null;

    // Get activity count
    const activitySummary = activityFeed.getAgentSummary(agentId, 24);

    // Compute overall score (weighted average)
    const identityScore = identityAgent?.reputation?.score || 50;
    const registryScore = registered?.trust_score || 50;
    const networkScore = trustCalc?.final_score || trustNode?.trust_score || 50;
    const overallScore = Math.round((identityScore * 0.3 + registryScore * 0.3 + networkScore * 0.4));

    return {
      agent_id: agentId,
      name: registered?.name || identityAgent?.metadata?.name,
      
      // Identity
      trust_level: identityAgent?.trust_level || 'anonymous',
      badges: identityAgent?.reputation?.badges || [],
      credentials_count: identityAgent?.credentials?.length || 0,
      
      // Registry
      capabilities_provided: registered?.capabilities_provided || [],
      capabilities_required: registered?.capabilities_required || [],
      delegations_granted: delegations.granted.length,
      delegations_received: delegations.received.length,
      
      // Trust network
      trust_score: trustCalc?.final_score || trustNode?.trust_score || 50,
      reputation_level: trustNode?.reputation_level || 'newcomer',
      endorsements_count: trustNode?.endorsements.length || 0,
      violations_count: trustNode?.violations.length || 0,
      network_connections: trustNode?.network_connections.length || 0,
      
      // Computed
      overall_score: overallScore,
      activity_24h: activitySummary.total_events,
      registered_at: identityAgent?.created_at || registered?.registered_at || trustNode?.joined_at || Date.now(),
      last_active: Math.max(
        identityAgent?.reputation?.last_active || 0,
        registered?.last_active || 0,
        trustNode?.last_activity || 0
      )
    };
  }

  /**
   * Record invocation across all systems
   */
  recordInvocation(
    agentId: string,
    capabilityId: string,
    success: boolean,
    executionTimeMs: number
  ): void {
    // Update identity manager
    agentIdentityManager.recordInvocation(agentId, capabilityId, success);

    // Update registry
    agentRegistry.recordInvocation(agentId, success, executionTimeMs);

    // Update trust network
    trustNetwork.recordActivity(agentId, 'invocation', success, capabilityId);

    // Record in activity feed
    activityFeed.record('capability_invoked', agentId, {
      capability_id: capabilityId,
      success,
      execution_time_ms: executionTimeMs
    });
  }

  /**
   * Sync trust scores across systems
   */
  syncTrustScores(agentId: string): void {
    const trustNode = trustNetwork.getNode(agentId);
    if (!trustNode) return;

    const trustCalc = trustNetwork.calculateTrust(agentId);
    if (!trustCalc) return;

    // Update registry trust score to match trust network
    const registered = agentRegistry.getAgent(agentId);
    if (registered) {
      registered.trust_score = Math.round(trustCalc.final_score);
    }
  }

  /**
   * Get all agents with unified view
   */
  getAllAgents(limit: number = 100): UnifiedAgent[] {
    const agentIds = new Set<string>();

    // Collect from all systems
    const identityStats = agentIdentityManager.getStats();
    const registryStats = agentRegistry.getStats();

    // Get IDs from registry (most complete)
    const registeredAgents = agentRegistry.discoverAgents({ limit: 1000 });
    registeredAgents.forEach(a => agentIds.add(a.agent_id));

    // Get from identity leaderboard
    const identityLeaderboard = agentIdentityManager.getLeaderboard(1000);
    identityLeaderboard.forEach(a => agentIds.add(a.agent_id));

    // Build unified views
    const unified: UnifiedAgent[] = [];
    for (const agentId of agentIds) {
      const agent = this.getUnifiedAgent(agentId);
      if (agent) unified.push(agent);
    }

    // Sort by overall score
    unified.sort((a, b) => b.overall_score - a.overall_score);

    return unified.slice(0, limit);
  }

  /**
   * Get unified stats across all systems
   */
  getUnifiedStats(): {
    total_agents: number;
    active_24h: number;
    average_trust: number;
    total_capabilities: number;
    total_delegations: number;
    total_endorsements: number;
    by_trust_level: Record<string, number>;
    by_reputation_level: Record<string, number>;
  } {
    const identityStats = agentIdentityManager.getStats();
    const registryStats = agentRegistry.getStats();
    const networkStats = trustNetwork.getNetworkStats();

    return {
      total_agents: Math.max(identityStats.total_agents, registryStats.total_agents, networkStats.total_agents),
      active_24h: identityStats.active_agents_24h,
      average_trust: networkStats.avg_trust,
      total_capabilities: registryStats.capabilities_indexed,
      total_delegations: registryStats.total_delegations,
      total_endorsements: networkStats.total_endorsements,
      by_trust_level: identityStats.trust_distribution,
      by_reputation_level: networkStats.by_level
    };
  }
}

export const unifiedAgentService = new UnifiedAgentService();
