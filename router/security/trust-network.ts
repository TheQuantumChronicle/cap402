/**
 * Agent Trust Network
 * 
 * SECRET SAUCE #4: Reputation-based access control
 * 
 * Agents must build trust over time through:
 * - Successful invocations
 * - Peer endorsements
 * - Network participation
 * 
 * New agents/copycats cannot bootstrap without participating over time.
 * Trust decays if agents are inactive or behave badly.
 */

import * as crypto from 'crypto';

export interface TrustNode {
  agent_id: string;
  trust_score: number;
  reputation_level: 'newcomer' | 'member' | 'trusted' | 'veteran' | 'elite';
  endorsements: Endorsement[];
  violations: Violation[];
  activity_history: ActivityRecord[];
  network_connections: string[];
  joined_at: number;
  last_activity: number;
}

export interface Endorsement {
  from_agent: string;
  trust_weight: number;
  timestamp: number;
  reason: string;
  signature: string;
}

export interface Violation {
  type: 'rate_abuse' | 'invalid_proof' | 'spam' | 'malicious';
  severity: number;
  timestamp: number;
  details: string;
}

export interface ActivityRecord {
  type: 'invocation' | 'composition' | 'delegation' | 'endorsement';
  capability_id?: string;
  success: boolean;
  timestamp: number;
}

interface TrustCalculation {
  base_score: number;
  activity_bonus: number;
  endorsement_bonus: number;
  violation_penalty: number;
  decay_penalty: number;
  final_score: number;
}

class TrustNetworkManager {
  private nodes: Map<string, TrustNode> = new Map();
  
  private readonly DECAY_RATE = 0.01; // 1% per day
  private readonly MAX_TRUST = 100;
  private readonly ENDORSEMENT_WEIGHT = 5;
  private readonly VIOLATION_WEIGHT = 10;

  /**
   * Register a new agent in the trust network
   */
  registerAgent(agentId: string): TrustNode {
    const node: TrustNode = {
      agent_id: agentId,
      trust_score: 10, // Start with minimal trust
      reputation_level: 'newcomer',
      endorsements: [],
      violations: [],
      activity_history: [],
      network_connections: [],
      joined_at: Date.now(),
      last_activity: Date.now()
    };

    this.nodes.set(agentId, node);
    return node;
  }

  /**
   * Record agent activity and update trust
   */
  recordActivity(
    agentId: string,
    type: ActivityRecord['type'],
    success: boolean,
    capabilityId?: string
  ): void {
    const node = this.nodes.get(agentId);
    if (!node) return;

    node.activity_history.push({
      type,
      capability_id: capabilityId,
      success,
      timestamp: Date.now()
    });

    // Keep only last 1000 activities
    if (node.activity_history.length > 1000) {
      node.activity_history = node.activity_history.slice(-1000);
    }

    node.last_activity = Date.now();

    // Update trust based on activity
    if (success) {
      node.trust_score = Math.min(this.MAX_TRUST, node.trust_score + 0.1);
    } else {
      node.trust_score = Math.max(0, node.trust_score - 0.5);
    }

    this.updateReputationLevel(node);
  }

  /**
   * Add an endorsement from one agent to another
   */
  addEndorsement(
    fromAgentId: string,
    toAgentId: string,
    reason: string
  ): boolean {
    const fromNode = this.nodes.get(fromAgentId);
    const toNode = this.nodes.get(toAgentId);

    if (!fromNode || !toNode) return false;

    // Only trusted+ agents can endorse
    if (fromNode.trust_score < 50) return false;

    // Can't endorse yourself
    if (fromAgentId === toAgentId) return false;

    // Check for existing endorsement
    const existing = toNode.endorsements.find(e => e.from_agent === fromAgentId);
    if (existing) return false;

    // Calculate endorsement weight based on endorser's trust
    const weight = (fromNode.trust_score / 100) * this.ENDORSEMENT_WEIGHT;

    const signature = crypto
      .createHash('sha256')
      .update(`${fromAgentId}:${toAgentId}:${Date.now()}:${reason}`)
      .digest('hex');

    toNode.endorsements.push({
      from_agent: fromAgentId,
      trust_weight: weight,
      timestamp: Date.now(),
      reason,
      signature
    });

    // Update trust score
    toNode.trust_score = Math.min(this.MAX_TRUST, toNode.trust_score + weight);
    
    // Add network connection
    if (!toNode.network_connections.includes(fromAgentId)) {
      toNode.network_connections.push(fromAgentId);
    }
    if (!fromNode.network_connections.includes(toAgentId)) {
      fromNode.network_connections.push(toAgentId);
    }

    this.updateReputationLevel(toNode);
    return true;
  }

  /**
   * Record a violation
   */
  recordViolation(
    agentId: string,
    type: Violation['type'],
    details: string
  ): void {
    const node = this.nodes.get(agentId);
    if (!node) return;

    const severityMap: Record<Violation['type'], number> = {
      'rate_abuse': 5,
      'invalid_proof': 10,
      'spam': 15,
      'malicious': 50
    };

    const severity = severityMap[type];

    node.violations.push({
      type,
      severity,
      timestamp: Date.now(),
      details
    });

    // Apply penalty
    node.trust_score = Math.max(0, node.trust_score - severity);
    this.updateReputationLevel(node);
  }

  /**
   * Calculate current trust score with decay
   */
  calculateTrust(agentId: string): TrustCalculation | null {
    const node = this.nodes.get(agentId);
    if (!node) return null;

    const now = Date.now();
    const daysSinceActivity = (now - node.last_activity) / (24 * 60 * 60 * 1000);
    
    // Base score from stored value
    const base_score = node.trust_score;

    // Activity bonus (recent successful activities)
    const recentActivities = node.activity_history.filter(
      a => now - a.timestamp < 7 * 24 * 60 * 60 * 1000 && a.success
    );
    const activity_bonus = Math.min(10, recentActivities.length * 0.5);

    // Endorsement bonus
    const endorsement_bonus = node.endorsements.reduce(
      (sum, e) => sum + e.trust_weight, 0
    );

    // Violation penalty (recent violations weighted more)
    const violation_penalty = node.violations.reduce((sum, v) => {
      const daysSince = (now - v.timestamp) / (24 * 60 * 60 * 1000);
      const decayedSeverity = v.severity * Math.exp(-daysSince / 30);
      return sum + decayedSeverity;
    }, 0);

    // Decay penalty for inactivity
    const decay_penalty = daysSinceActivity * this.DECAY_RATE * base_score;

    const final_score = Math.max(0, Math.min(this.MAX_TRUST,
      base_score + activity_bonus + endorsement_bonus - violation_penalty - decay_penalty
    ));

    return {
      base_score,
      activity_bonus,
      endorsement_bonus,
      violation_penalty,
      decay_penalty,
      final_score
    };
  }

  /**
   * Update reputation level based on trust score
   */
  private updateReputationLevel(node: TrustNode): void {
    const calc = this.calculateTrust(node.agent_id);
    if (!calc) return;

    const score = calc.final_score;

    if (score >= 90) {
      node.reputation_level = 'elite';
    } else if (score >= 75) {
      node.reputation_level = 'veteran';
    } else if (score >= 50) {
      node.reputation_level = 'trusted';
    } else if (score >= 25) {
      node.reputation_level = 'member';
    } else {
      node.reputation_level = 'newcomer';
    }
  }

  /**
   * Check if agent meets trust requirements
   */
  meetsRequirements(
    agentId: string,
    requirements: {
      min_trust?: number;
      min_level?: TrustNode['reputation_level'];
      min_endorsements?: number;
      min_activities?: number;
    }
  ): { meets: boolean; missing: string[] } {
    const node = this.nodes.get(agentId);
    const missing: string[] = [];

    if (!node) {
      return { meets: false, missing: ['Agent not in trust network'] };
    }

    const calc = this.calculateTrust(agentId);
    if (!calc) {
      return { meets: false, missing: ['Cannot calculate trust'] };
    }

    if (requirements.min_trust && calc.final_score < requirements.min_trust) {
      missing.push(`Trust score ${calc.final_score.toFixed(1)} < ${requirements.min_trust}`);
    }

    const levelOrder = ['newcomer', 'member', 'trusted', 'veteran', 'elite'];
    if (requirements.min_level) {
      const currentLevel = levelOrder.indexOf(node.reputation_level);
      const requiredLevel = levelOrder.indexOf(requirements.min_level);
      if (currentLevel < requiredLevel) {
        missing.push(`Level ${node.reputation_level} < ${requirements.min_level}`);
      }
    }

    if (requirements.min_endorsements && 
        node.endorsements.length < requirements.min_endorsements) {
      missing.push(`Endorsements ${node.endorsements.length} < ${requirements.min_endorsements}`);
    }

    if (requirements.min_activities && 
        node.activity_history.length < requirements.min_activities) {
      missing.push(`Activities ${node.activity_history.length} < ${requirements.min_activities}`);
    }

    return { meets: missing.length === 0, missing };
  }

  /**
   * Get trust node for an agent
   */
  getNode(agentId: string): TrustNode | undefined {
    return this.nodes.get(agentId);
  }

  /**
   * Get network statistics
   */
  getNetworkStats(): {
    total_agents: number;
    by_level: Record<string, number>;
    total_endorsements: number;
    total_violations: number;
    avg_trust: number;
  } {
    const nodes = Array.from(this.nodes.values());
    
    const byLevel: Record<string, number> = {
      newcomer: 0,
      member: 0,
      trusted: 0,
      veteran: 0,
      elite: 0
    };

    let totalTrust = 0;
    let totalEndorsements = 0;
    let totalViolations = 0;

    for (const node of nodes) {
      byLevel[node.reputation_level]++;
      totalTrust += node.trust_score;
      totalEndorsements += node.endorsements.length;
      totalViolations += node.violations.length;
    }

    return {
      total_agents: nodes.length,
      by_level: byLevel,
      total_endorsements: totalEndorsements,
      total_violations: totalViolations,
      avg_trust: nodes.length > 0 ? totalTrust / nodes.length : 0
    };
  }
}

export const trustNetwork = new TrustNetworkManager();
