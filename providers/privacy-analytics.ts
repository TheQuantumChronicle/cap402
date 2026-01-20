/**
 * Privacy Analytics & Trend Tracking
 * 
 * Tracks privacy metrics over time and provides trend analysis.
 * Features:
 * - Historical privacy score tracking
 * - Anonymity trend analysis
 * - Holder distribution evolution
 * - Privacy degradation detection
 * - Comparative analytics across tokens
 */

import { pumpFunProvider, AnonymitySetInfo } from './pumpfun';

export interface PrivacySnapshot {
  timestamp: number;
  privacyScore: number;
  grade: string;
  anonymityScore: number;
  totalHolders: number;
  anonymousHolders: number;
  largestHolderPercent: number;
  top10HoldersPercent: number;
  creatorRevealed: boolean;
  graduated: boolean;
}

export interface PrivacyTrend {
  mintAddress: string;
  snapshots: PrivacySnapshot[];
  currentScore: number;
  trend: 'improving' | 'stable' | 'degrading';
  trendStrength: number; // -100 to +100
  avgScore: number;
  minScore: number;
  maxScore: number;
  volatility: number; // 0-100
  firstRecorded: number;
  lastUpdated: number;
}

export interface ComparativeAnalysis {
  tokens: {
    mintAddress: string;
    currentScore: number;
    trend: string;
    rank: number;
  }[];
  averageScore: number;
  medianScore: number;
  topPerformer: string;
  bottomPerformer: string;
  timestamp: number;
}

class PrivacyAnalyticsEngine {
  private trends: Map<string, PrivacyTrend> = new Map();
  private snapshotIntervals: Map<string, NodeJS.Timeout> = new Map();
  private maxSnapshotsPerToken: number = 1000; // Limit memory usage

  /**
   * Start tracking privacy trends for a token
   */
  startTracking(mintAddress: string, snapshotIntervalMs: number = 60000): { success: boolean; trackingId: string } {
    // If already tracking, just return
    if (this.snapshotIntervals.has(mintAddress)) {
      return { success: true, trackingId: `track_${mintAddress.slice(0, 8)}` };
    }

    // Initialize trend record
    if (!this.trends.has(mintAddress)) {
      this.trends.set(mintAddress, {
        mintAddress,
        snapshots: [],
        currentScore: 0,
        trend: 'stable',
        trendStrength: 0,
        avgScore: 0,
        minScore: 100,
        maxScore: 0,
        volatility: 0,
        firstRecorded: Date.now(),
        lastUpdated: Date.now()
      });
    }

    // Take initial snapshot
    this.takeSnapshot(mintAddress).catch(err => {
      console.error(`[PrivacyAnalytics] Initial snapshot error for ${mintAddress.slice(0, 8)}:`, err);
    });

    // Start periodic snapshots
    const interval = setInterval(async () => {
      await this.takeSnapshot(mintAddress);
    }, snapshotIntervalMs);

    this.snapshotIntervals.set(mintAddress, interval);
    console.log(`[PrivacyAnalytics] 📊 Started tracking ${mintAddress.slice(0, 8)}...`);

    return { success: true, trackingId: `track_${mintAddress.slice(0, 8)}` };
  }

  /**
   * Stop tracking a token
   */
  stopTracking(mintAddress: string): boolean {
    const interval = this.snapshotIntervals.get(mintAddress);
    if (interval) {
      clearInterval(interval);
      this.snapshotIntervals.delete(mintAddress);
      console.log(`[PrivacyAnalytics] 🛑 Stopped tracking ${mintAddress.slice(0, 8)}...`);
      return true;
    }
    return false;
  }

  /**
   * Stop all tracking (cleanup)
   */
  stopAllTracking(): void {
    for (const [mintAddress, interval] of this.snapshotIntervals.entries()) {
      clearInterval(interval);
      console.log(`[PrivacyAnalytics] 🛑 Stopped tracking ${mintAddress.slice(0, 8)}...`);
    }
    this.snapshotIntervals.clear();
    console.log('[PrivacyAnalytics] All tracking stopped');
  }

  /**
   * Take a privacy snapshot
   */
  private async takeSnapshot(mintAddress: string): Promise<void> {
    try {
      const trend = this.trends.get(mintAddress);
      if (!trend) return;

      // Get current metrics
      const privacyScore = await pumpFunProvider.getPrivacyScore(mintAddress);
      const anonymityInfo = pumpFunProvider.getAnonymitySetInfo(mintAddress);
      
      // Check graduation status through bonding curve info
      const curveInfo = await pumpFunProvider.getBondingCurveInfo(mintAddress);

      const snapshot: PrivacySnapshot = {
        timestamp: Date.now(),
        privacyScore: privacyScore.overallScore,
        grade: privacyScore.grade,
        anonymityScore: anonymityInfo?.anonymityScore || 0,
        totalHolders: anonymityInfo?.totalHolders || 0,
        anonymousHolders: anonymityInfo?.anonymousHolders || 0,
        largestHolderPercent: anonymityInfo?.largestHolderPercent || 0,
        top10HoldersPercent: anonymityInfo?.top10HoldersPercent || 0,
        creatorRevealed: !privacyScore.factors.creatorHidden,
        graduated: curveInfo?.complete || false
      };

      // Add snapshot (limit size)
      trend.snapshots.push(snapshot);
      if (trend.snapshots.length > this.maxSnapshotsPerToken) {
        trend.snapshots.shift(); // Remove oldest
      }

      // Update trend metrics
      this.updateTrendMetrics(trend);

      console.log(`[PrivacyAnalytics] 📸 Snapshot: ${mintAddress.slice(0, 8)}... - Score: ${snapshot.privacyScore} (${snapshot.grade})`);
    } catch (error) {
      console.error(`[PrivacyAnalytics] Snapshot error for ${mintAddress.slice(0, 8)}:`, error);
    }
  }

  /**
   * Update trend metrics based on snapshots
   */
  private updateTrendMetrics(trend: PrivacyTrend): void {
    const { snapshots } = trend;
    if (snapshots.length === 0) return;

    // Current score
    trend.currentScore = snapshots[snapshots.length - 1].privacyScore;
    trend.lastUpdated = Date.now();

    // Average, min, max
    const scores = snapshots.map(s => s.privacyScore);
    trend.avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    trend.minScore = Math.min(...scores);
    trend.maxScore = Math.max(...scores);

    // Volatility (standard deviation)
    const variance = scores.reduce((sum, score) => sum + Math.pow(score - trend.avgScore, 2), 0) / scores.length;
    trend.volatility = Math.min(100, Math.sqrt(variance));

    // Trend direction (linear regression slope)
    if (snapshots.length >= 3) {
      const n = snapshots.length;
      const recentSnapshots = snapshots.slice(-10); // Use last 10 for trend
      const x = recentSnapshots.map((_, i) => i);
      const y = recentSnapshots.map(s => s.privacyScore);
      
      const sumX = x.reduce((a, b) => a + b, 0);
      const sumY = y.reduce((a, b) => a + b, 0);
      const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
      const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
      
      const slope = (recentSnapshots.length * sumXY - sumX * sumY) / (recentSnapshots.length * sumX2 - sumX * sumX);
      
      trend.trendStrength = Math.round(slope * 10); // Scale to -100 to +100
      
      if (slope > 0.5) {
        trend.trend = 'improving';
      } else if (slope < -0.5) {
        trend.trend = 'degrading';
      } else {
        trend.trend = 'stable';
      }
    }
  }

  /**
   * Get trend data for a token
   */
  getTrend(mintAddress: string, options?: {
    limit?: number;
    since?: number;
  }): PrivacyTrend | null {
    const trend = this.trends.get(mintAddress);
    if (!trend) return null;

    // Filter snapshots if needed
    let snapshots = trend.snapshots;
    
    if (options?.since) {
      snapshots = snapshots.filter(s => s.timestamp >= options.since!);
    }
    
    if (options?.limit) {
      snapshots = snapshots.slice(-options.limit);
    }

    return {
      ...trend,
      snapshots
    };
  }

  /**
   * Get comparative analysis across multiple tokens
   */
  getComparativeAnalysis(mintAddresses: string[]): ComparativeAnalysis {
    const tokens = mintAddresses
      .map(addr => {
        const trend = this.trends.get(addr);
        return trend ? {
          mintAddress: addr,
          currentScore: trend.currentScore,
          trend: trend.trend,
          rank: 0 // Will be set below
        } : null;
      })
      .filter(t => t !== null) as ComparativeAnalysis['tokens'];

    // Sort by score and assign ranks
    tokens.sort((a, b) => b.currentScore - a.currentScore);
    tokens.forEach((t, i) => t.rank = i + 1);

    const scores = tokens.map(t => t.currentScore);
    const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    
    // Median
    const sorted = [...scores].sort((a, b) => a - b);
    const medianScore = sorted.length > 0
      ? sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)]
      : 0;

    return {
      tokens,
      averageScore: Math.round(avgScore),
      medianScore: Math.round(medianScore),
      topPerformer: tokens[0]?.mintAddress || '',
      bottomPerformer: tokens[tokens.length - 1]?.mintAddress || '',
      timestamp: Date.now()
    };
  }

  /**
   * Detect privacy degradation events
   */
  detectDegradationEvents(mintAddress: string, thresholdDrop: number = 10): {
    detected: boolean;
    events: {
      timestamp: number;
      scoreBefore: number;
      scoreAfter: number;
      drop: number;
    }[];
  } {
    const trend = this.trends.get(mintAddress);
    if (!trend || trend.snapshots.length < 2) {
      return { detected: false, events: [] };
    }

    const events: any[] = [];
    
    for (let i = 1; i < trend.snapshots.length; i++) {
      const before = trend.snapshots[i - 1];
      const after = trend.snapshots[i];
      const drop = before.privacyScore - after.privacyScore;
      
      if (drop >= thresholdDrop) {
        events.push({
          timestamp: after.timestamp,
          scoreBefore: before.privacyScore,
          scoreAfter: after.privacyScore,
          drop: Math.round(drop)
        });
      }
    }

    return {
      detected: events.length > 0,
      events
    };
  }

  /**
   * Get privacy score forecast (simple moving average)
   */
  getForecast(mintAddress: string, periodsAhead: number = 3): {
    forecasted: boolean;
    predictions: {
      period: number;
      score: number;
      confidence: number;
    }[];
  } {
    const trend = this.trends.get(mintAddress);
    if (!trend || trend.snapshots.length < 5) {
      return { forecasted: false, predictions: [] };
    }

    const recentScores = trend.snapshots.slice(-10).map(s => s.privacyScore);
    const avgChange = recentScores.length > 1
      ? (recentScores[recentScores.length - 1] - recentScores[0]) / (recentScores.length - 1)
      : 0;

    const predictions = [];
    let currentScore = trend.currentScore;
    
    for (let i = 1; i <= periodsAhead; i++) {
      currentScore += avgChange;
      currentScore = Math.max(0, Math.min(100, currentScore)); // Clamp 0-100
      
      // Confidence decreases with distance
      const confidence = Math.max(20, 100 - (i * 20));
      
      predictions.push({
        period: i,
        score: Math.round(currentScore),
        confidence
      });
    }

    return {
      forecasted: true,
      predictions
    };
  }

  /**
   * Cleanup old snapshots (prevent memory leak)
   */
  cleanupOldSnapshots(maxAgeMs: number = 30 * 24 * 60 * 60 * 1000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [mintAddress, trend] of this.trends.entries()) {
      const originalLength = trend.snapshots.length;
      trend.snapshots = trend.snapshots.filter(s => now - s.timestamp < maxAgeMs);
      cleaned += originalLength - trend.snapshots.length;
      
      // Remove trend if no snapshots left
      if (trend.snapshots.length === 0) {
        this.trends.delete(mintAddress);
      }
    }

    if (cleaned > 0) {
      console.log(`[PrivacyAnalytics] Cleaned up ${cleaned} old snapshots`);
    }

    return cleaned;
  }

  /**
   * Get all tracked tokens
   */
  getTrackedTokens(): string[] {
    return Array.from(this.snapshotIntervals.keys());
  }

  /**
   * Export trend data for external analysis
   */
  exportTrendData(mintAddress: string): PrivacyTrend | null {
    return this.trends.get(mintAddress) || null;
  }
}

// Export singleton instance
export const privacyAnalytics = new PrivacyAnalyticsEngine();
