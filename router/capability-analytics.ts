/**
 * Capability Analytics and Insights
 * 
 * Provides deep analytics on capability usage:
 * - Usage patterns and trends
 * - Cost optimization recommendations
 * - Performance insights
 * - Anomaly detection
 * 
 * Enhanced with:
 * - Integration with usage metadata for emergent reputation
 * - Privacy level tracking
 * - Proof rate analytics
 * 
 * This makes CAP-402 invaluable for understanding agent behavior
 */

import { usageMetadataEmitter, UsageMetadata } from './usage-metadata';

interface UsageEvent {
  capability_id: string;
  agent_id?: string;
  timestamp: number;
  success: boolean;
  latency_ms: number;
  cost: number;
  inputs_hash: string;
  privacy_level?: number;
  proof_present?: boolean;
}

interface CapabilityInsight {
  capability_id: string;
  total_invocations: number;
  success_rate: number;
  avg_latency_ms: number;
  total_cost: number;
  peak_hours: number[];
  common_errors: string[];
  trend: 'increasing' | 'stable' | 'decreasing';
  // New: Privacy and proof analytics
  privacy_distribution: Record<number, number>;
  proof_rate: number;
}

interface CostOptimization {
  recommendation: string;
  potential_savings: number;
  affected_capabilities: string[];
  implementation: string;
}

interface AnomalyAlert {
  type: 'latency_spike' | 'error_rate' | 'unusual_pattern' | 'cost_spike';
  capability_id: string;
  severity: 'low' | 'medium' | 'high';
  message: string;
  timestamp: number;
  data: any;
}

class CapabilityAnalytics {
  private events: UsageEvent[] = [];
  private anomalies: AnomalyAlert[] = [];
  private maxEvents = 10000;

  /**
   * Record a usage event
   */
  recordEvent(event: UsageEvent): void {
    this.events.push(event);

    // Trim old events
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    // Check for anomalies
    this.detectAnomalies(event);
  }

  /**
   * Get insights for a specific capability
   */
  getCapabilityInsight(capability_id: string): CapabilityInsight {
    const capEvents = this.events.filter(e => e.capability_id === capability_id);
    
    if (capEvents.length === 0) {
      return {
        capability_id,
        total_invocations: 0,
        success_rate: 0,
        avg_latency_ms: 0,
        total_cost: 0,
        peak_hours: [],
        common_errors: [],
        trend: 'stable',
        privacy_distribution: { 0: 0, 1: 0, 2: 0, 3: 0 },
        proof_rate: 0
      };
    }

    const successCount = capEvents.filter(e => e.success).length;
    const totalLatency = capEvents.reduce((sum, e) => sum + e.latency_ms, 0);
    const totalCost = capEvents.reduce((sum, e) => sum + e.cost, 0);

    // Calculate peak hours
    const hourCounts = new Array(24).fill(0);
    capEvents.forEach(e => {
      const hour = new Date(e.timestamp).getHours();
      hourCounts[hour]++;
    });
    const maxCount = Math.max(...hourCounts);
    const peakHours = hourCounts
      .map((count, hour) => ({ hour, count }))
      .filter(h => h.count >= maxCount * 0.8)
      .map(h => h.hour);

    // Calculate trend
    const recentEvents = capEvents.filter(e => 
      Date.now() - e.timestamp < 24 * 60 * 60 * 1000
    );
    const olderEvents = capEvents.filter(e => 
      Date.now() - e.timestamp >= 24 * 60 * 60 * 1000 &&
      Date.now() - e.timestamp < 48 * 60 * 60 * 1000
    );
    
    let trend: 'increasing' | 'stable' | 'decreasing' = 'stable';
    if (recentEvents.length > olderEvents.length * 1.2) {
      trend = 'increasing';
    } else if (recentEvents.length < olderEvents.length * 0.8) {
      trend = 'decreasing';
    }

    // Calculate privacy distribution
    const privacyDist: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
    capEvents.forEach(e => {
      const level = e.privacy_level || 0;
      privacyDist[level] = (privacyDist[level] || 0) + 1;
    });

    // Calculate proof rate
    const proofCount = capEvents.filter(e => e.proof_present).length;

    return {
      capability_id,
      total_invocations: capEvents.length,
      success_rate: successCount / capEvents.length,
      avg_latency_ms: totalLatency / capEvents.length,
      total_cost: totalCost,
      peak_hours: peakHours,
      common_errors: [], // Would need error tracking
      trend,
      privacy_distribution: privacyDist,
      proof_rate: proofCount / capEvents.length
    };
  }

  /**
   * Get all capability insights
   */
  getAllInsights(): CapabilityInsight[] {
    const capabilityIds = [...new Set(this.events.map(e => e.capability_id))];
    return capabilityIds.map(id => this.getCapabilityInsight(id));
  }

  /**
   * Get cost optimization recommendations
   */
  getCostOptimizations(): CostOptimization[] {
    const optimizations: CostOptimization[] = [];
    const insights = this.getAllInsights();

    // Check for high-cost capabilities with low success rates
    for (const insight of insights) {
      if (insight.success_rate < 0.9 && insight.total_cost > 0.1) {
        optimizations.push({
          recommendation: `Improve error handling for ${insight.capability_id}`,
          potential_savings: insight.total_cost * (1 - insight.success_rate),
          affected_capabilities: [insight.capability_id],
          implementation: 'Add retry logic and input validation'
        });
      }
    }

    // Check for redundant capability usage
    const capabilityPairs = this.findRedundantPatterns();
    for (const pair of capabilityPairs) {
      optimizations.push({
        recommendation: `Consider using composition for ${pair.join(' + ')}`,
        potential_savings: 0.01, // Estimated
        affected_capabilities: pair,
        implementation: 'Use /compose endpoint to batch these capabilities'
      });
    }

    // Check for off-peak opportunities
    for (const insight of insights) {
      if (insight.peak_hours.length > 0 && insight.total_invocations > 100) {
        optimizations.push({
          recommendation: `Schedule non-urgent ${insight.capability_id} calls off-peak`,
          potential_savings: insight.total_cost * 0.1, // 10% savings estimate
          affected_capabilities: [insight.capability_id],
          implementation: `Avoid hours: ${insight.peak_hours.join(', ')}`
        });
      }
    }

    return optimizations;
  }

  /**
   * Get usage patterns for an agent
   */
  getAgentPatterns(agent_id: string): {
    favorite_capabilities: string[];
    usage_by_hour: number[];
    avg_session_length: number;
    capability_sequences: string[][];
  } {
    const agentEvents = this.events.filter(e => e.agent_id === agent_id);
    
    // Favorite capabilities
    const capCounts = new Map<string, number>();
    agentEvents.forEach(e => {
      capCounts.set(e.capability_id, (capCounts.get(e.capability_id) || 0) + 1);
    });
    const favorites = [...capCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([cap]) => cap);

    // Usage by hour
    const hourCounts = new Array(24).fill(0);
    agentEvents.forEach(e => {
      const hour = new Date(e.timestamp).getHours();
      hourCounts[hour]++;
    });

    // Find common sequences
    const sequences = this.findCapabilitySequences(agentEvents);

    return {
      favorite_capabilities: favorites,
      usage_by_hour: hourCounts,
      avg_session_length: this.calculateAvgSessionLength(agentEvents),
      capability_sequences: sequences
    };
  }

  /**
   * Get recent anomalies
   */
  getAnomalies(limit: number = 10): AnomalyAlert[] {
    return this.anomalies.slice(-limit);
  }

  /**
   * Get dashboard summary
   */
  getDashboard(): {
    total_events_24h: number;
    success_rate_24h: number;
    total_cost_24h: number;
    top_capabilities: Array<{ id: string; count: number }>;
    recent_anomalies: AnomalyAlert[];
    optimizations: CostOptimization[];
  } {
    const day = 24 * 60 * 60 * 1000;
    const recentEvents = this.events.filter(e => Date.now() - e.timestamp < day);

    const successCount = recentEvents.filter(e => e.success).length;
    const totalCost = recentEvents.reduce((sum, e) => sum + e.cost, 0);

    // Top capabilities
    const capCounts = new Map<string, number>();
    recentEvents.forEach(e => {
      capCounts.set(e.capability_id, (capCounts.get(e.capability_id) || 0) + 1);
    });
    const topCaps = [...capCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => ({ id, count }));

    return {
      total_events_24h: recentEvents.length,
      success_rate_24h: recentEvents.length > 0 ? successCount / recentEvents.length : 0,
      total_cost_24h: totalCost,
      top_capabilities: topCaps,
      recent_anomalies: this.anomalies.slice(-5),
      optimizations: this.getCostOptimizations().slice(0, 3)
    };
  }

  private detectAnomalies(event: UsageEvent): void {
    const recentEvents = this.events.filter(e => 
      e.capability_id === event.capability_id &&
      Date.now() - e.timestamp < 60 * 60 * 1000 // Last hour
    );

    if (recentEvents.length < 10) return;

    // Latency spike detection
    const avgLatency = recentEvents.reduce((sum, e) => sum + e.latency_ms, 0) / recentEvents.length;
    if (event.latency_ms > avgLatency * 3) {
      this.anomalies.push({
        type: 'latency_spike',
        capability_id: event.capability_id,
        severity: event.latency_ms > avgLatency * 5 ? 'high' : 'medium',
        message: `Latency spike: ${event.latency_ms}ms vs avg ${Math.round(avgLatency)}ms`,
        timestamp: Date.now(),
        data: { actual: event.latency_ms, average: avgLatency }
      });
    }

    // Error rate spike
    const recentErrors = recentEvents.filter(e => !e.success).length;
    const errorRate = recentErrors / recentEvents.length;
    if (errorRate > 0.2 && !event.success) {
      this.anomalies.push({
        type: 'error_rate',
        capability_id: event.capability_id,
        severity: errorRate > 0.5 ? 'high' : 'medium',
        message: `High error rate: ${(errorRate * 100).toFixed(1)}%`,
        timestamp: Date.now(),
        data: { error_rate: errorRate, sample_size: recentEvents.length }
      });
    }
  }

  private findRedundantPatterns(): string[][] {
    // Find capabilities that are often called together
    const pairs: string[][] = [];
    const pairCounts = new Map<string, number>();

    for (let i = 1; i < this.events.length; i++) {
      const prev = this.events[i - 1];
      const curr = this.events[i];
      
      // If same agent and within 5 seconds
      if (prev.agent_id === curr.agent_id && 
          curr.timestamp - prev.timestamp < 5000 &&
          prev.capability_id !== curr.capability_id) {
        const key = [prev.capability_id, curr.capability_id].sort().join('|');
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }
    }

    // Return pairs that occur frequently
    for (const [key, count] of pairCounts) {
      if (count >= 5) {
        pairs.push(key.split('|'));
      }
    }

    return pairs;
  }

  private findCapabilitySequences(events: UsageEvent[]): string[][] {
    const sequences: string[][] = [];
    let currentSequence: string[] = [];
    let lastTimestamp = 0;

    for (const event of events) {
      if (event.timestamp - lastTimestamp > 60000) { // 1 minute gap = new sequence
        if (currentSequence.length >= 2) {
          sequences.push(currentSequence);
        }
        currentSequence = [];
      }
      currentSequence.push(event.capability_id);
      lastTimestamp = event.timestamp;
    }

    if (currentSequence.length >= 2) {
      sequences.push(currentSequence);
    }

    return sequences.slice(-10);
  }

  private calculateAvgSessionLength(events: UsageEvent[]): number {
    if (events.length < 2) return 0;

    let totalLength = 0;
    let sessionCount = 0;
    let sessionStart = events[0].timestamp;
    let lastTimestamp = events[0].timestamp;

    for (const event of events) {
      if (event.timestamp - lastTimestamp > 60000) { // 1 minute gap = new session
        totalLength += lastTimestamp - sessionStart;
        sessionCount++;
        sessionStart = event.timestamp;
      }
      lastTimestamp = event.timestamp;
    }

    // Add last session
    totalLength += lastTimestamp - sessionStart;
    sessionCount++;

    return totalLength / sessionCount;
  }
}

export const capabilityAnalytics = new CapabilityAnalytics();

// Connect usage metadata to analytics
usageMetadataEmitter.on('usage', (metadata: UsageMetadata) => {
  capabilityAnalytics.recordEvent({
    capability_id: metadata.capability_id,
    agent_id: metadata.agent_id,
    timestamp: metadata.timestamp,
    success: metadata.success,
    latency_ms: metadata.latency_bucket === 'fast' ? 100 : 
               metadata.latency_bucket === 'medium' ? 500 : 
               metadata.latency_bucket === 'slow' ? 2000 : 5000,
    cost: metadata.cost_actual || 0,
    inputs_hash: metadata.request_id.slice(-8),
    privacy_level: metadata.privacy_level,
    proof_present: metadata.proof_present
  });
});
