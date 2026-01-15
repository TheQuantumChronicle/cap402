/**
 * Agent-Aware Rate Limiter
 * 
 * Rate limiting based on agent identity and reputation:
 * - Anonymous agents: 10 req/min
 * - Verified agents: 50 req/min
 * - Trusted agents: 200 req/min
 * - Premium agents: 1000 req/min
 * 
 * Also tracks usage for analytics and billing
 */

import { TrustLevel } from './agent-identity';

interface RateLimitConfig {
  requests_per_minute: number;
  burst_limit: number;
  cost_multiplier: number;
}

interface RateLimitState {
  agent_id: string;
  requests: number[];
  blocked_until?: number;
}

const RATE_LIMITS: Record<TrustLevel, RateLimitConfig> = {
  anonymous: {
    requests_per_minute: 60,
    burst_limit: 20,
    cost_multiplier: 1.5
  },
  verified: {
    requests_per_minute: 50,
    burst_limit: 20,
    cost_multiplier: 1.0
  },
  trusted: {
    requests_per_minute: 200,
    burst_limit: 50,
    cost_multiplier: 0.8
  },
  premium: {
    requests_per_minute: 1000,
    burst_limit: 200,
    cost_multiplier: 0.5
  }
};

class AgentRateLimiter {
  private states: Map<string, RateLimitState> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Clean up old entries every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
    // Prevent timer from keeping process alive
    this.cleanupInterval.unref();
  }

  /**
   * Check if request is allowed and record it
   */
  checkAndRecord(
    agent_id: string,
    trust_level: TrustLevel
  ): {
    allowed: boolean;
    remaining: number;
    reset_at: number;
    cost_multiplier: number;
    reason?: string;
  } {
    const config = RATE_LIMITS[trust_level];
    const now = Date.now();
    const windowStart = now - 60000; // 1 minute window

    let state = this.states.get(agent_id);
    if (!state) {
      state = { agent_id, requests: [] };
      this.states.set(agent_id, state);
    }

    // Check if blocked
    if (state.blocked_until && now < state.blocked_until) {
      return {
        allowed: false,
        remaining: 0,
        reset_at: state.blocked_until,
        cost_multiplier: config.cost_multiplier,
        reason: `Rate limited until ${new Date(state.blocked_until).toISOString()}`
      };
    }

    // Clean old requests
    state.requests = state.requests.filter(t => t > windowStart);

    // Check rate limit
    if (state.requests.length >= config.requests_per_minute) {
      // Block for 1 minute
      state.blocked_until = now + 60000;
      return {
        allowed: false,
        remaining: 0,
        reset_at: state.blocked_until,
        cost_multiplier: config.cost_multiplier,
        reason: `Rate limit exceeded: ${config.requests_per_minute} requests/minute for ${trust_level} agents`
      };
    }

    // Check burst limit (requests in last 5 seconds)
    const burstWindow = now - 5000;
    const burstRequests = state.requests.filter(t => t > burstWindow).length;
    if (burstRequests >= config.burst_limit) {
      return {
        allowed: false,
        remaining: config.requests_per_minute - state.requests.length,
        reset_at: now + 5000,
        cost_multiplier: config.cost_multiplier,
        reason: `Burst limit exceeded: ${config.burst_limit} requests/5s for ${trust_level} agents`
      };
    }

    // Record request
    state.requests.push(now);

    return {
      allowed: true,
      remaining: config.requests_per_minute - state.requests.length,
      reset_at: windowStart + 60000,
      cost_multiplier: config.cost_multiplier
    };
  }

  /**
   * Get rate limit info for an agent
   */
  getInfo(agent_id: string, trust_level: TrustLevel): {
    limit: number;
    remaining: number;
    reset_at: number;
    trust_level: TrustLevel;
    cost_multiplier: number;
  } {
    const config = RATE_LIMITS[trust_level];
    const state = this.states.get(agent_id);
    const now = Date.now();
    const windowStart = now - 60000;

    const recentRequests = state 
      ? state.requests.filter(t => t > windowStart).length 
      : 0;

    return {
      limit: config.requests_per_minute,
      remaining: config.requests_per_minute - recentRequests,
      reset_at: windowStart + 60000,
      trust_level,
      cost_multiplier: config.cost_multiplier
    };
  }

  /**
   * Get usage stats for all agents
   */
  getStats(): {
    total_agents: number;
    active_agents: number;
    blocked_agents: number;
    requests_last_minute: number;
  } {
    const now = Date.now();
    const windowStart = now - 60000;

    let activeAgents = 0;
    let blockedAgents = 0;
    let totalRequests = 0;

    for (const state of this.states.values()) {
      const recentRequests = state.requests.filter(t => t > windowStart).length;
      if (recentRequests > 0) activeAgents++;
      if (state.blocked_until && now < state.blocked_until) blockedAgents++;
      totalRequests += recentRequests;
    }

    return {
      total_agents: this.states.size,
      active_agents: activeAgents,
      blocked_agents: blockedAgents,
      requests_last_minute: totalRequests
    };
  }

  private cleanup(): void {
    const now = Date.now();
    const windowStart = now - 60000;

    for (const [agent_id, state] of this.states) {
      // Remove old requests
      state.requests = state.requests.filter(t => t > windowStart);
      
      // Clear expired blocks
      if (state.blocked_until && now > state.blocked_until) {
        state.blocked_until = undefined;
      }

      // Remove inactive agents
      if (state.requests.length === 0 && !state.blocked_until) {
        this.states.delete(agent_id);
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
  }
}

export const agentRateLimiter = new AgentRateLimiter();
