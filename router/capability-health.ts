/**
 * Real-Time Capability Health Monitoring
 * 
 * Monitors the health of each capability in real-time:
 * - Success rates
 * - Latency percentiles
 * - Error patterns
 * - Provider status
 * - Degradation detection
 * 
 * Agents can check health before invoking to avoid failures
 */

interface CapabilityHealthMetrics {
  capability_id: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  success_rate_1h: number;
  success_rate_24h: number;
  latency_p50_ms: number;
  latency_p95_ms: number;
  latency_p99_ms: number;
  invocations_1h: number;
  invocations_24h: number;
  last_success: number | null;
  last_failure: number | null;
  error_types: Record<string, number>;
  provider_status: 'up' | 'degraded' | 'down';
  recommendation: string;
}

interface HealthEvent {
  capability_id: string;
  timestamp: number;
  success: boolean;
  latency_ms: number;
  error?: string;
}

class CapabilityHealthMonitor {
  private events: HealthEvent[] = [];
  private maxEvents = 10000;
  private alertThresholds = {
    success_rate_warning: 0.95,
    success_rate_critical: 0.80,
    latency_warning_ms: 2000,
    latency_critical_ms: 5000
  };

  /**
   * Record a health event
   */
  recordEvent(event: HealthEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
  }

  /**
   * Get health metrics for a capability
   */
  getHealth(capability_id: string): CapabilityHealthMetrics {
    const now = Date.now();
    const hour = 60 * 60 * 1000;
    const day = 24 * hour;

    const allEvents = this.events.filter(e => e.capability_id === capability_id);
    const events1h = allEvents.filter(e => now - e.timestamp < hour);
    const events24h = allEvents.filter(e => now - e.timestamp < day);

    if (allEvents.length === 0) {
      return {
        capability_id,
        status: 'unknown',
        success_rate_1h: 0,
        success_rate_24h: 0,
        latency_p50_ms: 0,
        latency_p95_ms: 0,
        latency_p99_ms: 0,
        invocations_1h: 0,
        invocations_24h: 0,
        last_success: null,
        last_failure: null,
        error_types: {},
        provider_status: 'up',
        recommendation: 'No data available yet'
      };
    }

    // Calculate success rates
    const successRate1h = events1h.length > 0 
      ? events1h.filter(e => e.success).length / events1h.length 
      : 0;
    const successRate24h = events24h.length > 0 
      ? events24h.filter(e => e.success).length / events24h.length 
      : 0;

    // Calculate latency percentiles
    const latencies = events24h.map(e => e.latency_ms).sort((a, b) => a - b);
    const p50 = this.percentile(latencies, 50);
    const p95 = this.percentile(latencies, 95);
    const p99 = this.percentile(latencies, 99);

    // Find last success/failure
    const successes = allEvents.filter(e => e.success);
    const failures = allEvents.filter(e => !e.success);
    const lastSuccess = successes.length > 0 ? successes[successes.length - 1].timestamp : null;
    const lastFailure = failures.length > 0 ? failures[failures.length - 1].timestamp : null;

    // Count error types
    const errorTypes: Record<string, number> = {};
    for (const event of failures) {
      const errorType = event.error || 'unknown';
      errorTypes[errorType] = (errorTypes[errorType] || 0) + 1;
    }

    // Determine status
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    let recommendation = 'Capability is operating normally';

    if (successRate1h < this.alertThresholds.success_rate_critical) {
      status = 'unhealthy';
      recommendation = 'High failure rate detected. Consider using alternative capability.';
    } else if (successRate1h < this.alertThresholds.success_rate_warning) {
      status = 'degraded';
      recommendation = 'Elevated failure rate. Monitor closely.';
    } else if (p95 > this.alertThresholds.latency_critical_ms) {
      status = 'degraded';
      recommendation = 'High latency detected. Expect slower responses.';
    }

    // Determine provider status based on recent failures
    let providerStatus: 'up' | 'degraded' | 'down' = 'up';
    const recentEvents = events1h.slice(-10);
    const recentFailures = recentEvents.filter(e => !e.success).length;
    if (recentFailures >= 8) {
      providerStatus = 'down';
    } else if (recentFailures >= 3) {
      providerStatus = 'degraded';
    }

    return {
      capability_id,
      status,
      success_rate_1h: Math.round(successRate1h * 1000) / 10,
      success_rate_24h: Math.round(successRate24h * 1000) / 10,
      latency_p50_ms: Math.round(p50),
      latency_p95_ms: Math.round(p95),
      latency_p99_ms: Math.round(p99),
      invocations_1h: events1h.length,
      invocations_24h: events24h.length,
      last_success: lastSuccess,
      last_failure: lastFailure,
      error_types: errorTypes,
      provider_status: providerStatus,
      recommendation
    };
  }

  /**
   * Get health for all capabilities
   */
  getAllHealth(): CapabilityHealthMetrics[] {
    const capabilityIds = [...new Set(this.events.map(e => e.capability_id))];
    return capabilityIds.map(id => this.getHealth(id));
  }

  /**
   * Get system-wide health summary
   */
  getSystemHealth(): {
    overall_status: 'healthy' | 'degraded' | 'unhealthy';
    healthy_capabilities: number;
    degraded_capabilities: number;
    unhealthy_capabilities: number;
    total_invocations_1h: number;
    avg_success_rate_1h: number;
    avg_latency_ms: number;
    top_errors: Array<{ error: string; count: number }>;
  } {
    const allHealth = this.getAllHealth();
    
    const healthy = allHealth.filter(h => h.status === 'healthy').length;
    const degraded = allHealth.filter(h => h.status === 'degraded').length;
    const unhealthy = allHealth.filter(h => h.status === 'unhealthy').length;

    const totalInvocations = allHealth.reduce((sum, h) => sum + h.invocations_1h, 0);
    const avgSuccessRate = allHealth.length > 0
      ? allHealth.reduce((sum, h) => sum + h.success_rate_1h, 0) / allHealth.length
      : 0;
    const avgLatency = allHealth.length > 0
      ? allHealth.reduce((sum, h) => sum + h.latency_p50_ms, 0) / allHealth.length
      : 0;

    // Aggregate errors
    const errorCounts: Record<string, number> = {};
    for (const health of allHealth) {
      for (const [error, count] of Object.entries(health.error_types)) {
        errorCounts[error] = (errorCounts[error] || 0) + count;
      }
    }
    const topErrors = Object.entries(errorCounts)
      .map(([error, count]) => ({ error, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (unhealthy > 0) {
      overallStatus = 'unhealthy';
    } else if (degraded > 0) {
      overallStatus = 'degraded';
    }

    return {
      overall_status: overallStatus,
      healthy_capabilities: healthy,
      degraded_capabilities: degraded,
      unhealthy_capabilities: unhealthy,
      total_invocations_1h: totalInvocations,
      avg_success_rate_1h: Math.round(avgSuccessRate * 10) / 10,
      avg_latency_ms: Math.round(avgLatency),
      top_errors: topErrors
    };
  }

  /**
   * Check if capability is safe to use
   */
  isSafeToUse(capability_id: string): {
    safe: boolean;
    reason: string;
    alternative?: string;
  } {
    const health = this.getHealth(capability_id);

    if (health.status === 'unknown') {
      return { safe: true, reason: 'No health data available - proceed with caution' };
    }

    if (health.status === 'unhealthy') {
      return {
        safe: false,
        reason: `Capability is unhealthy: ${health.recommendation}`,
        alternative: this.findAlternative(capability_id)
      };
    }

    if (health.provider_status === 'down') {
      return {
        safe: false,
        reason: 'Provider appears to be down',
        alternative: this.findAlternative(capability_id)
      };
    }

    if (health.status === 'degraded') {
      return {
        safe: true,
        reason: `Capability is degraded: ${health.recommendation}`
      };
    }

    return { safe: true, reason: 'Capability is healthy' };
  }

  private percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const index = Math.ceil((p / 100) * arr.length) - 1;
    return arr[Math.max(0, index)];
  }

  private findAlternative(capability_id: string): string | undefined {
    const alternatives: Record<string, string> = {
      'cap.swap.execute.v1': 'cap.confidential.swap.v1',
      'cap.confidential.swap.v1': 'cap.swap.execute.v1',
      'cap.lightning.message.v1': 'cap.fhe.compute.v1'
    };
    return alternatives[capability_id];
  }
}

export const capabilityHealthMonitor = new CapabilityHealthMonitor();
