export interface CapMetrics {
  id: string;
  total: number;
  success: number;
  failed: number;
  latency: { avg: number; min: number; max: number };
  cost: number;
  last: number;
}

class MetricsCollector {
  private caps = new Map<string, CapMetrics>();
  private timestamps: number[] = [];
  private start = Date.now();
  private readonly MAX = { caps: 500, ts: 1000 };

  record(id: string, success: boolean, latency_ms: number, cost = 0): void {
    const now = Date.now();
    
    // Manage timestamps (ring buffer style)
    if (this.timestamps.length >= this.MAX.ts) {
      this.timestamps = this.timestamps.slice(-this.MAX.ts / 2);
    }
    this.timestamps.push(now);

    let m = this.caps.get(id);
    if (!m) {
      m = { id, total: 0, success: 0, failed: 0, latency: { avg: 0, min: Infinity, max: 0 }, cost: 0, last: now };
      this.caps.set(id, m);
    }

    m.total++;
    success ? m.success++ : m.failed++;
    m.latency.avg = (m.latency.avg * (m.total - 1) + latency_ms) / m.total;
    m.latency.min = Math.min(m.latency.min, latency_ms);
    m.latency.max = Math.max(m.latency.max, latency_ms);
    m.cost += cost;
    m.last = now;
  }

  // Aliases for backward compatibility
  recordInvocation = this.record.bind(this);

  get(id: string): CapMetrics | undefined { return this.caps.get(id); }
  getCapabilityMetrics = this.get.bind(this);
  
  all(): CapMetrics[] { return [...this.caps.values()]; }
  getAllMetrics = this.all.bind(this);

  system() {
    const now = Date.now();
    const rpm = this.timestamps.filter(t => t > now - 60000).length;
    const total = [...this.caps.values()].reduce((s, m) => s + m.total, 0);
    return { uptime_ms: now - this.start, total, rpm, caps: this.caps.size };
  }
  getSystemMetrics() {
    const s = this.system();
    return { uptime_ms: s.uptime_ms, total_requests: s.total, requests_per_minute: s.rpm, capabilities: this.caps };
  }

  top(n = 10): CapMetrics[] { return this.all().sort((a, b) => b.total - a.total).slice(0, n); }
  getTopCapabilities = this.top.bind(this);

  slowest(n = 10): CapMetrics[] { return this.all().filter(m => m.total > 0).sort((a, b) => b.latency.avg - a.latency.avg).slice(0, n); }
  getSlowestCapabilities = this.slowest.bind(this);

  successRate(id: string): number {
    const m = this.caps.get(id);
    return m && m.total > 0 ? Math.round(m.success / m.total * 100) : 0;
  }
  getSuccessRate = this.successRate.bind(this);

  // Aggregated summary for dashboards
  summary() {
    const all = this.all();
    const s = this.system();
    return {
      ...s,
      success_rate: all.length ? Math.round(all.reduce((s, m) => s + m.success, 0) / all.reduce((s, m) => s + m.total, 0) * 100) : 100,
      avg_latency: all.length ? Math.round(all.reduce((s, m) => s + m.latency.avg, 0) / all.length) : 0,
      total_cost: all.reduce((s, m) => s + m.cost, 0),
      top_3: this.top(3).map(m => ({ id: m.id, total: m.total })),
      slowest_3: this.slowest(3).map(m => ({ id: m.id, avg_ms: Math.round(m.latency.avg) }))
    };
  }

  reset(): void {
    this.caps.clear();
    this.timestamps = [];
    this.start = Date.now();
  }
}

export const metricsCollector = new MetricsCollector();

// Re-export types for compatibility
export type PerformanceMetrics = CapMetrics;
export interface SystemMetrics {
  uptime_ms: number;
  total_requests: number;
  requests_per_minute: number;
  capabilities: Map<string, CapMetrics>;
}
