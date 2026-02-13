/**
 * Agent-Friendly API
 * 
 * Simplified, intuitive API for agents:
 * - Single method calls for common operations
 * - Batch operations for efficiency
 * - Auto-discovery and smart routing
 * - Built-in retry and fallback
 */

import { agentRegistry, RegisteredAgent, AgentDelegation } from './agent-registry';
import { agentCoordinator, CoordinationResponse } from './agent-coordination';
import { capabilityMarketplace } from './capability-marketplace';
import { semanticDiscovery } from './semantic-discovery';

export interface AgentSession {
  agent_id: string;
  trust_level: string;
  capabilities: string[];
  created_at: number;
}

export interface QuickInvokeOptions {
  capability: string;
  inputs?: Record<string, any>;
  prefer_agent?: string;
  min_trust?: number;
  timeout_ms?: number;
  retry_count?: number;
}

export interface BatchOperation {
  id: string;
  type: 'invoke' | 'discover' | 'delegate';
  params: Record<string, any>;
}

export interface BatchResult {
  id: string;
  success: boolean;
  result?: any;
  error?: string;
  duration_ms: number;
}

class AgentAPI {
  private sessions: Map<string, AgentSession> = new Map();
  private readonly MAX_SESSIONS = 10000;
  private readonly SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  constructor() {
    // Periodic cleanup of stale sessions
    setInterval(() => {
      const now = Date.now();
      for (const [id, session] of this.sessions) {
        if (now - session.created_at > this.SESSION_TTL_MS) {
          this.sessions.delete(id);
        }
      }
    }, 5 * 60 * 1000).unref();
  }

  /**
   * Quick start - register and get a session in one call
   */
  async quickStart(config: {
    agent_id: string;
    name: string;
    capabilities?: string[];
    description?: string;
  }): Promise<{
    success: boolean;
    session?: AgentSession;
    error?: string;
  }> {
    try {
      const agent = agentRegistry.registerAgent(
        config.agent_id,
        config.name,
        config.description || '',
        config.capabilities || [],
        [],
        undefined,
        {}
      );

      const session: AgentSession = {
        agent_id: agent.agent_id,
        trust_level: 'anonymous',
        capabilities: agent.capabilities_provided,
        created_at: Date.now()
      };

      this.sessions.set(agent.agent_id, session);

      return { success: true, session };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Quick start failed' 
      };
    }
  }

  /**
   * Quick invoke - find best agent and invoke capability in one call
   */
  async quickInvoke(
    fromAgent: string,
    options: QuickInvokeOptions
  ): Promise<{
    success: boolean;
    result?: any;
    agent_used?: string;
    duration_ms: number;
    error?: string;
  }> {
    const startTime = Date.now();

    try {
      // Find best agent for capability
      let targetAgent: string;

      if (options.prefer_agent) {
        const preferred = agentRegistry.getAgent(options.prefer_agent);
        if (preferred && preferred.capabilities_provided.includes(options.capability)) {
          targetAgent = options.prefer_agent;
        } else {
          // Fallback to discovery
          const agents = agentRegistry.discoverAgents({
            capability: options.capability,
            min_trust_score: options.min_trust || 30,
            status: 'active',
            limit: 1
          });
          if (agents.length === 0) {
            return {
              success: false,
              error: `No agent found for capability: ${options.capability}`,
              duration_ms: Date.now() - startTime
            };
          }
          targetAgent = agents[0].agent_id;
        }
      } else {
        // Auto-discover best agent
        const agents = agentRegistry.discoverAgents({
          capability: options.capability,
          min_trust_score: options.min_trust || 30,
          status: 'active',
          limit: 3
        });

        if (agents.length === 0) {
          return {
            success: false,
            error: `No agent found for capability: ${options.capability}`,
            duration_ms: Date.now() - startTime
          };
        }

        // Pick agent with best trust/response time balance
        targetAgent = agents[0].agent_id;
      }

      // Invoke with retry
      let lastError: string | undefined;
      const retryCount = options.retry_count || 1;

      for (let attempt = 0; attempt < retryCount; attempt++) {
        const response = await agentCoordinator.requestCapability({
          from_agent: fromAgent,
          to_agent: targetAgent,
          capability_id: options.capability,
          inputs: options.inputs || {},
          context: {}
        });

        if (response.status === 'completed') {
          return {
            success: true,
            result: response.aggregated_result,
            agent_used: targetAgent,
            duration_ms: Date.now() - startTime
          };
        }

        lastError = response.error;
      }

      return {
        success: false,
        error: lastError || 'Invocation failed',
        agent_used: targetAgent,
        duration_ms: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Quick invoke failed',
        duration_ms: Date.now() - startTime
      };
    }
  }

  /**
   * Batch operations - execute multiple operations in parallel
   */
  async batch(
    fromAgent: string,
    operations: BatchOperation[]
  ): Promise<{
    success: boolean;
    results: BatchResult[];
    total_duration_ms: number;
  }> {
    const startTime = Date.now();

    const resultPromises = operations.map(async (op): Promise<BatchResult> => {
      const opStart = Date.now();

      try {
        let result: any;

        switch (op.type) {
          case 'invoke':
            const invokeResult = await this.quickInvoke(fromAgent, {
              capability: op.params.capability,
              inputs: op.params.inputs,
              prefer_agent: op.params.prefer_agent
            });
            result = invokeResult;
            return {
              id: op.id,
              success: invokeResult.success,
              result: invokeResult.result,
              error: invokeResult.error,
              duration_ms: Date.now() - opStart
            };

          case 'discover':
            const agents = agentRegistry.discoverAgents({
              capability: op.params.capability,
              min_trust_score: op.params.min_trust,
              limit: op.params.limit || 5
            });
            return {
              id: op.id,
              success: true,
              result: agents.map(a => ({ agent_id: a.agent_id, name: a.name, trust_score: a.trust_score })),
              duration_ms: Date.now() - opStart
            };

          case 'delegate':
            const delegation = agentRegistry.createDelegation(
              fromAgent,
              op.params.to_agent,
              op.params.capability,
              op.params.constraints || {},
              op.params.expires_hours || 24
            );
            return {
              id: op.id,
              success: !!delegation,
              result: delegation ? { delegation_id: delegation.delegation_id } : undefined,
              error: delegation ? undefined : 'Delegation failed',
              duration_ms: Date.now() - opStart
            };

          default:
            return {
              id: op.id,
              success: false,
              error: `Unknown operation type: ${op.type}`,
              duration_ms: Date.now() - opStart
            };
        }
      } catch (error) {
        return {
          id: op.id,
          success: false,
          error: error instanceof Error ? error.message : 'Operation failed',
          duration_ms: Date.now() - opStart
        };
      }
    });

    const results = await Promise.all(resultPromises);

    return {
      success: results.every(r => r.success),
      results,
      total_duration_ms: Date.now() - startTime
    };
  }

  /**
   * Smart discover - natural language capability search
   */
  async smartDiscover(
    agentId: string,
    query: string
  ): Promise<{
    success: boolean;
    capabilities: Array<{
      id: string;
      name: string;
      description: string;
      relevance: number;
      providers: Array<{ agent_id: string; trust_score: number }>;
    }>;
  }> {
    try {
      const agent = agentRegistry.getAgent(agentId);
      const results = await semanticDiscovery.discoverForAgent(query, {
        agent_id: agentId,
        capabilities_used: agent?.capabilities_provided || [],
        trust_level: 'anonymous'
      });

      const capabilities = results.map(r => {
        const providers = agentRegistry.discoverAgents({
          capability: r.capability.id,
          status: 'active',
          limit: 3
        });

        return {
          id: r.capability.id,
          name: r.capability.name,
          description: r.capability.description,
          relevance: r.relevance_score,
          providers: providers.map(p => ({ agent_id: p.agent_id, trust_score: p.trust_score }))
        };
      });

      return { success: true, capabilities };
    } catch (error) {
      return { success: false, capabilities: [] };
    }
  }

  /**
   * Get agent dashboard - all info an agent needs in one call
   */
  async getDashboard(agentId: string): Promise<{
    success: boolean;
    agent?: {
      id: string;
      name: string;
      trust_score: number;
      reputation: any;
      capabilities: string[];
    };
    delegations?: {
      granted: number;
      received: number;
    };
    marketplace?: {
      listings: number;
      purchases: number;
      earnings_sol: number;
    };
    recommendations?: string[];
    error?: string;
  }> {
    try {
      const agent = agentRegistry.getAgent(agentId);
      if (!agent) {
        return { success: false, error: 'Agent not found' };
      }

      const delegations = agentRegistry.getAgentDelegations(agentId);
      const listings = capabilityMarketplace.getAgentListings(agentId);
      const purchases = capabilityMarketplace.getAgentPurchases(agentId);
      const earnings = capabilityMarketplace.getAgentEarnings(agentId);

      const recommendations = await semanticDiscovery.getAgentRecommendations({
        agent_id: agentId,
        capabilities_used: agent.capabilities_provided,
        trust_level: 'anonymous'
      });

      return {
        success: true,
        agent: {
          id: agent.agent_id,
          name: agent.name,
          trust_score: agent.trust_score,
          reputation: agent.reputation,
          capabilities: agent.capabilities_provided
        },
        delegations: {
          granted: delegations.granted.length,
          received: delegations.received.length
        },
        marketplace: {
          listings: listings.length,
          purchases: purchases.length,
          earnings_sol: earnings.total_revenue_sol
        },
        recommendations: recommendations.similar_agents_use
      };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Dashboard failed' 
      };
    }
  }
}

export const agentAPI = new AgentAPI();
