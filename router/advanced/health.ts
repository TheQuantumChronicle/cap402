/**
 * Advanced Features Health Check
 * 
 * Monitors the health and status of all advanced feature modules:
 * - Capability Receipts
 * - Privacy Gradient
 * - Capability Negotiation
 * - Usage Metadata
 * - Intent Graphs
 */

import { ADVANCED_FEATURES_VERSION, ADVANCED_FEATURES } from './index';

export interface AdvancedFeatureHealth {
  feature: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency_ms?: number;
  last_used?: number;
  error?: string;
}

export interface AdvancedFeaturesHealthReport {
  version: string;
  overall_status: 'healthy' | 'degraded' | 'unhealthy';
  features: AdvancedFeatureHealth[];
  timestamp: number;
  uptime_ms: number;
}

const startTime = Date.now();

class AdvancedFeaturesHealthMonitor {
  private featureStats: Map<string, {
    invocations: number;
    errors: number;
    last_latency_ms: number;
    last_used: number;
  }> = new Map();

  /**
   * Record a feature usage
   */
  recordUsage(feature: string, success: boolean, latency_ms: number): void {
    const stats = this.featureStats.get(feature) || {
      invocations: 0,
      errors: 0,
      last_latency_ms: 0,
      last_used: 0
    };

    stats.invocations++;
    if (!success) stats.errors++;
    stats.last_latency_ms = latency_ms;
    stats.last_used = Date.now();

    this.featureStats.set(feature, stats);
  }

  /**
   * Get health status for a single feature
   */
  getFeatureHealth(feature: string): AdvancedFeatureHealth {
    const stats = this.featureStats.get(feature);

    if (!stats || stats.invocations === 0) {
      return {
        feature,
        status: 'healthy', // No usage = assume healthy
        last_used: undefined
      };
    }

    const errorRate = stats.errors / stats.invocations;
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    if (errorRate > 0.5) {
      status = 'unhealthy';
    } else if (errorRate > 0.1 || stats.last_latency_ms > 5000) {
      status = 'degraded';
    }

    return {
      feature,
      status,
      latency_ms: stats.last_latency_ms,
      last_used: stats.last_used
    };
  }

  /**
   * Get full health report
   */
  getHealthReport(): AdvancedFeaturesHealthReport {
    const features = ADVANCED_FEATURES.map(f => this.getFeatureHealth(f));
    
    // Determine overall status
    let overall_status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (features.some(f => f.status === 'unhealthy')) {
      overall_status = 'unhealthy';
    } else if (features.some(f => f.status === 'degraded')) {
      overall_status = 'degraded';
    }

    return {
      version: ADVANCED_FEATURES_VERSION,
      overall_status,
      features,
      timestamp: Date.now(),
      uptime_ms: Date.now() - startTime
    };
  }

  /**
   * Check if all features are healthy
   */
  isHealthy(): boolean {
    return this.getHealthReport().overall_status === 'healthy';
  }

  /**
   * Run self-test on all features
   */
  async runSelfTest(): Promise<{
    passed: boolean;
    results: Array<{ feature: string; passed: boolean; error?: string }>;
  }> {
    const results: Array<{ feature: string; passed: boolean; error?: string }> = [];

    // Test Capability Receipts
    try {
      const { receiptManager } = await import('../capability-receipt');
      const testReceipt = receiptManager.generateReceipt(
        'cap.test.v1',
        { test: true },
        { result: 'ok' },
        { executor: 'test', privacy_level: 0, duration_ms: 1, success: true }
      );
      const verification = receiptManager.verifyReceipt(testReceipt, { test: true }, { result: 'ok' });
      results.push({ feature: 'capability-receipts', passed: verification.valid });
      this.recordUsage('capability-receipts', verification.valid, 1);
    } catch (error) {
      results.push({ feature: 'capability-receipts', passed: false, error: String(error) });
      this.recordUsage('capability-receipts', false, 0);
    }

    // Test Privacy Gradient
    try {
      const { privacyGradient } = await import('../privacy-gradient');
      const options = privacyGradient.getPrivacyOptions('cap.test.v1');
      results.push({ feature: 'privacy-gradient', passed: Array.isArray(options) });
      this.recordUsage('privacy-gradient', true, 1);
    } catch (error) {
      results.push({ feature: 'privacy-gradient', passed: false, error: String(error) });
      this.recordUsage('privacy-gradient', false, 0);
    }

    // Test Capability Negotiation
    try {
      const { negotiator } = await import('../capability-negotiation');
      const result = await negotiator.negotiate({
        capability_id: 'cap.test.v1',
        inputs: {},
        negotiate: { privacy: true }
      });
      results.push({ feature: 'capability-negotiation', passed: result.success });
      this.recordUsage('capability-negotiation', result.success, 1);
    } catch (error) {
      results.push({ feature: 'capability-negotiation', passed: false, error: String(error) });
      this.recordUsage('capability-negotiation', false, 0);
    }

    // Test Usage Metadata
    try {
      const { usageMetadataEmitter } = await import('../usage-metadata');
      const stats = usageMetadataEmitter.getUsageStats();
      results.push({ feature: 'usage-metadata', passed: typeof stats.total_invocations === 'number' });
      this.recordUsage('usage-metadata', true, 1);
    } catch (error) {
      results.push({ feature: 'usage-metadata', passed: false, error: String(error) });
      this.recordUsage('usage-metadata', false, 0);
    }

    // Test Intent Graphs
    try {
      const { intentGraphExecutor } = await import('../intent-graph');
      const validation = intentGraphExecutor.validate({
        nodes: [{ id: 'test', capability_id: 'cap.test.v1', inputs: {} }],
        edges: []
      });
      results.push({ feature: 'intent-graphs', passed: validation.valid });
      this.recordUsage('intent-graphs', validation.valid, 1);
    } catch (error) {
      results.push({ feature: 'intent-graphs', passed: false, error: String(error) });
      this.recordUsage('intent-graphs', false, 0);
    }

    return {
      passed: results.every(r => r.passed),
      results
    };
  }
}

export const advancedFeaturesHealth = new AdvancedFeaturesHealthMonitor();
