/**
 * Agent Registry - Central registry for agent discovery and coordination
 * 
 * Enables agents to:
 * - Register themselves with capabilities they provide
 * - Discover other agents by capability
 * - Establish trust relationships
 * - Delegate capabilities to other agents
 */

import * as crypto from 'crypto';
import { AGENT_ID_PATTERN, CAPABILITY_ID_PATTERN } from './middleware/validation';

// Input validation helpers using shared patterns
function validateAgentId(id: string): boolean {
  return AGENT_ID_PATTERN.test(id);
}

function validateCapabilityId(id: string): boolean {
  return CAPABILITY_ID_PATTERN.test(id);
}

export interface RegisteredAgent {
  agent_id: string;
  name: string;
  description: string;
  endpoint?: string;
  capabilities_provided: string[];
  capabilities_required: string[];
  trust_score: number;
  reputation: RegistryReputation;
  delegations: AgentDelegation[];
  metadata: Record<string, any>;
  registered_at: number;
  last_active: number;
  status: 'active' | 'inactive' | 'suspended';
}

export interface RegistryReputation {
  total_invocations: number;
  successful_invocations: number;
  failed_invocations: number;
  average_response_time_ms: number;
  uptime_percentage: number;
  peer_ratings: PeerRating[];
}

export interface PeerRating {
  from_agent: string;
  rating: number; // 1-5
  comment?: string;
  timestamp: number;
}

export interface AgentDelegation {
  delegation_id: string;
  from_agent: string;
  to_agent: string;
  capability_id: string;
  constraints: DelegationConstraints;
  created_at: number;
  expires_at: number;
  revoked: boolean;
}

export interface DelegationConstraints {
  max_invocations?: number;
  max_cost_per_invocation?: number;
  allowed_inputs?: Record<string, any>;
  time_window_hours?: number;
}

export interface AgentDiscoveryQuery {
  capability?: string;
  min_trust_score?: number;
  min_success_rate?: number;
  max_response_time_ms?: number;
  status?: 'active' | 'inactive' | 'suspended';
  limit?: number;
}

class AgentRegistry {
  private agents: Map<string, RegisteredAgent> = new Map();
  private delegations: Map<string, AgentDelegation> = new Map();
  private capabilityIndex: Map<string, Set<string>> = new Map(); // capability -> agent_ids
  private delegationCache: Map<string, AgentDelegation | null> = new Map(); // agent:cap -> delegation
  private readonly CACHE_TTL_MS = 5000; // 5 second cache
  private readonly MAX_AGENTS = 10000;
  private readonly MAX_DELEGATIONS = 50000;
  private lastCacheClean = Date.now();

  /**
   * Register a new agent
   */
  registerAgent(
    agentId: string,
    name: string,
    description: string,
    capabilities_provided: string[],
    capabilities_required: string[] = [],
    endpoint?: string,
    metadata: Record<string, any> = {}
  ): RegisteredAgent {
    // Input validation
    if (!validateAgentId(agentId)) {
      throw new Error('Invalid agent_id: must be 1-64 alphanumeric chars, hyphens, underscores');
    }
    if (!name || name.length > 128) {
      throw new Error('Invalid name: must be 1-128 characters');
    }
    for (const cap of capabilities_provided) {
      if (!validateCapabilityId(cap)) {
        throw new Error(`Invalid capability_id: ${cap}`);
      }
    }

    // Enforce agent limit
    if (!this.agents.has(agentId) && this.agents.size >= this.MAX_AGENTS) {
      throw new Error(`Agent registry full (max ${this.MAX_AGENTS}). Contact admin for capacity increase.`);
    }

    // Check for duplicate
    if (this.agents.has(agentId)) {
      // Update existing agent
      const existing = this.agents.get(agentId)!;
      existing.name = name;
      existing.description = description;
      existing.capabilities_provided = capabilities_provided;
      existing.capabilities_required = capabilities_required;
      existing.endpoint = endpoint;
      existing.metadata = { ...existing.metadata, ...metadata };
      existing.last_active = Date.now();
      this.reindexCapabilities(agentId, capabilities_provided);
      return existing;
    }

    const agent: RegisteredAgent = {
      agent_id: agentId,
      name,
      description,
      endpoint,
      capabilities_provided,
      capabilities_required,
      trust_score: 50, // Start with neutral trust
      reputation: {
        total_invocations: 0,
        successful_invocations: 0,
        failed_invocations: 0,
        average_response_time_ms: 0,
        uptime_percentage: 100,
        peer_ratings: []
      },
      delegations: [],
      metadata,
      registered_at: Date.now(),
      last_active: Date.now(),
      status: 'active'
    };

    this.agents.set(agentId, agent);
    this.reindexCapabilities(agentId, capabilities_provided);
    return agent;
  }

  /**
   * Reindex capabilities for an agent
   */
  private reindexCapabilities(agentId: string, capabilities: string[]): void {
    // Remove from old indexes
    for (const [cap, agents] of this.capabilityIndex) {
      agents.delete(agentId);
    }
    // Add to new indexes
    for (const cap of capabilities) {
      if (!this.capabilityIndex.has(cap)) {
        this.capabilityIndex.set(cap, new Set());
      }
      this.capabilityIndex.get(cap)!.add(agentId);
    }
  }

  /**
   * Get all registered agents
   */
  getAllAgents(): RegisteredAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Discover agents by capability or criteria
   */
  discoverAgents(query: AgentDiscoveryQuery): RegisteredAgent[] {
    let results: RegisteredAgent[] = [];

    if (query.capability) {
      // Find agents that provide this capability
      const agentIds = this.capabilityIndex.get(query.capability);
      if (agentIds) {
        for (const id of agentIds) {
          const agent = this.agents.get(id);
          if (agent) results.push(agent);
        }
      }
    } else {
      // Return all agents
      results = Array.from(this.agents.values());
    }

    // Apply filters
    if (query.min_trust_score !== undefined) {
      results = results.filter(a => a.trust_score >= query.min_trust_score!);
    }

    if (query.min_success_rate !== undefined) {
      results = results.filter(a => {
        if (a.reputation.total_invocations === 0) return true;
        const rate = a.reputation.successful_invocations / a.reputation.total_invocations;
        return rate >= query.min_success_rate!;
      });
    }

    if (query.max_response_time_ms !== undefined) {
      results = results.filter(a => 
        a.reputation.average_response_time_ms <= query.max_response_time_ms!
      );
    }

    if (query.status) {
      results = results.filter(a => a.status === query.status);
    }

    // Sort by trust score descending
    results.sort((a, b) => b.trust_score - a.trust_score);

    // Apply limit
    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  /**
   * Create a capability delegation from one agent to another
   */
  createDelegation(
    fromAgent: string,
    toAgent: string,
    capabilityId: string,
    constraints: DelegationConstraints,
    expiresInHours: number = 24
  ): AgentDelegation | null {
    const from = this.agents.get(fromAgent);
    const to = this.agents.get(toAgent);

    if (!from || !to) {
      return null;
    }

    // Verify fromAgent has the capability
    if (!from.capabilities_provided.includes(capabilityId)) {
      return null;
    }

    const delegation: AgentDelegation = {
      delegation_id: `del_${crypto.randomBytes(12).toString('hex')}`,
      from_agent: fromAgent,
      to_agent: toAgent,
      capability_id: capabilityId,
      constraints,
      created_at: Date.now(),
      expires_at: Date.now() + (expiresInHours * 60 * 60 * 1000),
      revoked: false
    };

    this.delegations.set(delegation.delegation_id, delegation);
    from.delegations.push(delegation);

    return delegation;
  }

  /**
   * Check if an agent has delegated access to a capability
   */
  hasDelegatedAccess(agentId: string, capabilityId: string): AgentDelegation | null {
    // Check cache first
    const cacheKey = `${agentId}:${capabilityId}`;
    this.cleanCacheIfNeeded();
    
    if (this.delegationCache.has(cacheKey)) {
      const cached = this.delegationCache.get(cacheKey);
      if (cached && !cached.revoked && Date.now() < cached.expires_at) {
        return cached;
      }
    }

    // Search delegations
    for (const delegation of this.delegations.values()) {
      if (
        delegation.to_agent === agentId &&
        delegation.capability_id === capabilityId &&
        !delegation.revoked &&
        Date.now() < delegation.expires_at
      ) {
        this.delegationCache.set(cacheKey, delegation);
        return delegation;
      }
    }
    
    this.delegationCache.set(cacheKey, null);
    return null;
  }

  /**
   * Clean expired cache entries periodically
   */
  private cleanCacheIfNeeded(): void {
    if (Date.now() - this.lastCacheClean > this.CACHE_TTL_MS) {
      this.delegationCache.clear();
      this.lastCacheClean = Date.now();
    }
  }

  /**
   * Revoke a delegation
   */
  revokeDelegation(delegationId: string, byAgent: string): boolean {
    const delegation = this.delegations.get(delegationId);
    if (!delegation) return false;

    // Only the delegating agent can revoke
    if (delegation.from_agent !== byAgent) return false;

    delegation.revoked = true;
    return true;
  }

  /**
   * Record an invocation result for reputation tracking
   */
  recordInvocation(
    agentId: string,
    success: boolean,
    responseTimeMs: number
  ): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    agent.reputation.total_invocations++;
    if (success) {
      agent.reputation.successful_invocations++;
    } else {
      agent.reputation.failed_invocations++;
    }

    // Update average response time (exponential moving average)
    const alpha = 0.1;
    agent.reputation.average_response_time_ms = 
      alpha * responseTimeMs + (1 - alpha) * agent.reputation.average_response_time_ms;

    // Update trust score based on success rate
    const successRate = agent.reputation.successful_invocations / agent.reputation.total_invocations;
    agent.trust_score = Math.round(successRate * 100);

    agent.last_active = Date.now();
  }

  /**
   * Add a peer rating
   */
  addPeerRating(
    targetAgent: string,
    fromAgent: string,
    rating: number,
    comment?: string
  ): boolean {
    const target = this.agents.get(targetAgent);
    const from = this.agents.get(fromAgent);

    if (!target || !from) return false;
    if (rating < 1 || rating > 5) return false;

    // Remove any existing rating from this agent
    target.reputation.peer_ratings = target.reputation.peer_ratings.filter(
      r => r.from_agent !== fromAgent
    );

    target.reputation.peer_ratings.push({
      from_agent: fromAgent,
      rating,
      comment,
      timestamp: Date.now()
    });

    // Update trust score based on peer ratings
    if (target.reputation.peer_ratings.length > 0) {
      const avgRating = target.reputation.peer_ratings.reduce((sum, r) => sum + r.rating, 0) 
        / target.reputation.peer_ratings.length;
      // Blend peer ratings with success rate
      const successRate = target.reputation.total_invocations > 0
        ? target.reputation.successful_invocations / target.reputation.total_invocations
        : 0.5;
      target.trust_score = Math.round((avgRating / 5 * 50) + (successRate * 50));
    }

    return true;
  }

  /**
   * Get agent by ID
   */
  getAgent(agentId: string): RegisteredAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Update agent status
   */
  updateAgentStatus(agentId: string, status: 'active' | 'inactive' | 'suspended'): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    agent.status = status;
    return true;
  }

  /**
   * Get all delegations for an agent
   */
  getAgentDelegations(agentId: string): {
    granted: AgentDelegation[];
    received: AgentDelegation[];
  } {
    const granted: AgentDelegation[] = [];
    const received: AgentDelegation[] = [];

    for (const delegation of this.delegations.values()) {
      if (delegation.from_agent === agentId && !delegation.revoked) {
        granted.push(delegation);
      }
      if (delegation.to_agent === agentId && !delegation.revoked) {
        received.push(delegation);
      }
    }

    return { granted, received };
  }

  /**
   * Record metrics reported by an agent (for production observability)
   */
  recordMetrics(agentId: string, metrics: {
    invocations: number;
    success_rate: number;
    avg_latency_ms: number;
    errors: number;
    uptime_ms: number;
    reported_at: number;
  }): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // Update reputation based on reported metrics
    agent.reputation.total_invocations = metrics.invocations;
    agent.reputation.successful_invocations = Math.round(metrics.invocations * metrics.success_rate);
    agent.reputation.failed_invocations = metrics.errors;
    agent.reputation.average_response_time_ms = metrics.avg_latency_ms;
    
    // Calculate uptime percentage (assuming 24h window)
    const uptimeHours = metrics.uptime_ms / (1000 * 60 * 60);
    agent.reputation.uptime_percentage = Math.min(100, (uptimeHours / 24) * 100);

    // Update trust score
    agent.trust_score = Math.round(metrics.success_rate * 100);
    agent.last_active = Date.now();

    // Store in metadata for historical tracking
    if (!agent.metadata.metrics_history) {
      agent.metadata.metrics_history = [];
    }
    agent.metadata.metrics_history.push({
      ...metrics,
      recorded_at: Date.now()
    });
    // Keep only last 100 entries
    if (agent.metadata.metrics_history.length > 100) {
      agent.metadata.metrics_history = agent.metadata.metrics_history.slice(-100);
    }
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    total_agents: number;
    active_agents: number;
    total_delegations: number;
    active_delegations: number;
    capabilities_indexed: number;
  } {
    const activeDelegations = Array.from(this.delegations.values()).filter(
      d => !d.revoked && Date.now() < d.expires_at
    ).length;

    return {
      total_agents: this.agents.size,
      active_agents: Array.from(this.agents.values()).filter(a => a.status === 'active').length,
      total_delegations: this.delegations.size,
      active_delegations: activeDelegations,
      capabilities_indexed: this.capabilityIndex.size
    };
  }
}

export const agentRegistry = new AgentRegistry();
