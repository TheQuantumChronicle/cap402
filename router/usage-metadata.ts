/**
 * Usage Metadata Emission System
 * 
 * Emits usage metadata for emergent reputation without a registry:
 * - capability_id, version, executor type
 * - success/failure, latency bucket, proof present
 * 
 * Agents can locally score capabilities and share heuristics peer-to-peer.
 * Creates emergent trust and Darwinian capability evolution.
 */

import { EventEmitter } from 'events';

export interface UsageMetadata {
  // Execution identity
  capability_id: string;
  capability_version: string;
  executor_type: string;
  
  // Outcome
  success: boolean;
  latency_bucket: 'fast' | 'medium' | 'slow' | 'timeout';
  
  // Privacy & proof
  privacy_level: 0 | 1 | 2 | 3;
  proof_present: boolean;
  proof_type?: string;
  
  // Economics
  cost_actual?: number;
  cost_bucket: 'free' | 'cheap' | 'moderate' | 'expensive';
  
  // Context
  timestamp: number;
  agent_id?: string;
  request_id: string;
}

export interface CapabilityScore {
  capability_id: string;
  total_invocations: number;
  success_rate: number;
  avg_latency_bucket: string;
  proof_rate: number;
  avg_cost_bucket: string;
  last_updated: number;
  trend: 'improving' | 'stable' | 'degrading';
}

class UsageMetadataEmitter extends EventEmitter {
  private usageHistory: UsageMetadata[] = [];
  private capabilityScores: Map<string, CapabilityScore> = new Map();
  private maxHistorySize = 10000;

  constructor() {
    super();
  }

  /**
   * Emit usage metadata for an invocation
   * This is the core of emergent reputation
   */
  emit(event: 'usage', metadata: UsageMetadata): boolean {
    // Store in history
    this.usageHistory.push(metadata);
    if (this.usageHistory.length > this.maxHistorySize) {
      this.usageHistory.shift();
    }

    // Update capability score
    this.updateCapabilityScore(metadata);

    // Emit event for listeners (other agents, analytics, etc.)
    return super.emit(event, metadata);
  }

  /**
   * Create usage metadata from invocation result
   */
  createMetadata(
    capabilityId: string,
    result: {
      success: boolean;
      latency_ms: number;
      executor?: string;
      privacy_level?: number;
      proof?: any;
      cost?: number;
    },
    requestId: string,
    agentId?: string
  ): UsageMetadata {
    return {
      capability_id: capabilityId,
      capability_version: this.extractVersion(capabilityId),
      executor_type: result.executor || 'unknown',
      success: result.success,
      latency_bucket: this.getLatencyBucket(result.latency_ms),
      privacy_level: (result.privacy_level || 0) as 0 | 1 | 2 | 3,
      proof_present: !!result.proof,
      proof_type: result.proof?.type,
      cost_actual: result.cost,
      cost_bucket: this.getCostBucket(result.cost),
      timestamp: Date.now(),
      agent_id: agentId,
      request_id: requestId
    };
  }

  /**
   * Get local capability score (for agent decision-making)
   */
  getCapabilityScore(capabilityId: string): CapabilityScore | undefined {
    return this.capabilityScores.get(capabilityId);
  }

  /**
   * Get all capability scores (for sharing with other agents)
   */
  getAllScores(): CapabilityScore[] {
    return Array.from(this.capabilityScores.values());
  }

  /**
   * Get top capabilities by success rate
   */
  getTopCapabilities(limit: number = 10): CapabilityScore[] {
    return this.getAllScores()
      .sort((a, b) => b.success_rate - a.success_rate)
      .slice(0, limit);
  }

  /**
   * Get capabilities by trend
   */
  getCapabilitiesByTrend(trend: 'improving' | 'stable' | 'degrading'): CapabilityScore[] {
    return this.getAllScores().filter(s => s.trend === trend);
  }

  /**
   * Export scores for peer-to-peer sharing
   */
  exportScores(): string {
    const scores = this.getAllScores();
    return Buffer.from(JSON.stringify({
      exported_at: Date.now(),
      scores
    })).toString('base64');
  }

  /**
   * Import scores from another agent (peer-to-peer)
   */
  importScores(encoded: string, weight: number = 0.3): void {
    try {
      const data = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'));
      
      for (const importedScore of data.scores) {
        const existing = this.capabilityScores.get(importedScore.capability_id);
        
        if (existing) {
          // Weighted merge
          existing.success_rate = existing.success_rate * (1 - weight) + importedScore.success_rate * weight;
          existing.total_invocations += Math.floor(importedScore.total_invocations * weight);
        } else {
          // New capability from peer
          this.capabilityScores.set(importedScore.capability_id, {
            ...importedScore,
            total_invocations: Math.floor(importedScore.total_invocations * weight)
          });
        }
      }
    } catch (error) {
      // Invalid import, ignore
    }
  }

  /**
   * Get usage statistics summary
   */
  getUsageStats(): {
    total_invocations: number;
    success_rate: number;
    capabilities_tracked: number;
    avg_latency_bucket: string;
    proof_rate: number;
  } {
    const total = this.usageHistory.length;
    const successful = this.usageHistory.filter(u => u.success).length;
    const withProof = this.usageHistory.filter(u => u.proof_present).length;
    
    const latencyBuckets = this.usageHistory.map(u => u.latency_bucket);
    const avgLatency = this.getMostCommon(latencyBuckets) || 'medium';

    return {
      total_invocations: total,
      success_rate: total > 0 ? successful / total : 0,
      capabilities_tracked: this.capabilityScores.size,
      avg_latency_bucket: avgLatency,
      proof_rate: total > 0 ? withProof / total : 0
    };
  }

  private updateCapabilityScore(metadata: UsageMetadata): void {
    const existing = this.capabilityScores.get(metadata.capability_id);
    
    if (existing) {
      const newTotal = existing.total_invocations + 1;
      const newSuccessRate = (existing.success_rate * existing.total_invocations + (metadata.success ? 1 : 0)) / newTotal;
      const newProofRate = (existing.proof_rate * existing.total_invocations + (metadata.proof_present ? 1 : 0)) / newTotal;
      
      // Determine trend
      const oldSuccessRate = existing.success_rate;
      let trend: 'improving' | 'stable' | 'degrading' = 'stable';
      if (newSuccessRate > oldSuccessRate + 0.05) trend = 'improving';
      else if (newSuccessRate < oldSuccessRate - 0.05) trend = 'degrading';

      this.capabilityScores.set(metadata.capability_id, {
        capability_id: metadata.capability_id,
        total_invocations: newTotal,
        success_rate: newSuccessRate,
        avg_latency_bucket: metadata.latency_bucket,
        proof_rate: newProofRate,
        avg_cost_bucket: metadata.cost_bucket,
        last_updated: Date.now(),
        trend
      });
    } else {
      this.capabilityScores.set(metadata.capability_id, {
        capability_id: metadata.capability_id,
        total_invocations: 1,
        success_rate: metadata.success ? 1 : 0,
        avg_latency_bucket: metadata.latency_bucket,
        proof_rate: metadata.proof_present ? 1 : 0,
        avg_cost_bucket: metadata.cost_bucket,
        last_updated: Date.now(),
        trend: 'stable'
      });
    }
  }

  private extractVersion(capabilityId: string): string {
    const match = capabilityId.match(/\.v(\d+)$/);
    return match ? `v${match[1]}` : 'v1';
  }

  private getLatencyBucket(ms: number): 'fast' | 'medium' | 'slow' | 'timeout' {
    // Uses constants from advanced/constants.ts: FAST_MS=200, MEDIUM_MS=1000, SLOW_MS=5000
    if (ms < 200) return 'fast';
    if (ms < 1000) return 'medium';
    if (ms < 5000) return 'slow';
    return 'timeout';
  }

  private getCostBucket(cost?: number): 'free' | 'cheap' | 'moderate' | 'expensive' {
    // Uses constants from advanced/constants.ts: FREE=0, CHEAP=0.01, MODERATE=0.1
    if (!cost || cost === 0) return 'free';
    if (cost < 0.01) return 'cheap';
    if (cost < 0.1) return 'moderate';
    return 'expensive';
  }

  private getMostCommon<T>(arr: T[]): T | undefined {
    if (arr.length === 0) return undefined;
    const counts = new Map<T, number>();
    for (const item of arr) {
      counts.set(item, (counts.get(item) || 0) + 1);
    }
    let maxCount = 0;
    let mostCommon: T | undefined;
    for (const [item, count] of counts) {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = item;
      }
    }
    return mostCommon;
  }
}

export const usageMetadataEmitter = new UsageMetadataEmitter();
