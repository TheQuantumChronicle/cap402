/**
 * Analytics Agent Template
 * 
 * A production-ready analytics agent that collects, processes, and reports
 * on-chain data and market analytics using CAP-402 capabilities.
 */

import { CAP402Agent, createAgent, AgentConfig } from '../agent';
import { EventEmitter } from 'events';

// ============================================
// TYPES
// ============================================

export interface AnalyticsConfig extends Partial<AgentConfig> {
  agent_id: string;
  name: string;
  data_sources?: DataSource[];
  report_interval_ms?: number;
  aggregation_window_ms?: number;
  storage_backend?: 'memory' | 'file';
  max_data_points?: number;
}

export interface DataSource {
  id: string;
  type: 'price' | 'volume' | 'tvl' | 'transactions' | 'custom';
  capability_id: string;
  inputs: Record<string, any>;
  interval_ms?: number;
  enabled: boolean;
}

export interface DataPoint {
  source_id: string;
  value: number;
  metadata?: Record<string, any>;
  timestamp: number;
}

export interface TimeSeries {
  source_id: string;
  points: DataPoint[];
  stats: TimeSeriesStats;
}

export interface TimeSeriesStats {
  count: number;
  min: number;
  max: number;
  avg: number;
  stddev: number;
  first_timestamp: number;
  last_timestamp: number;
}

export interface AnalyticsReport {
  report_id: string;
  generated_at: number;
  period_start: number;
  period_end: number;
  sources: string[];
  summaries: Record<string, SourceSummary>;
  insights: Insight[];
  correlations?: Correlation[];
}

export interface SourceSummary {
  source_id: string;
  data_points: number;
  current_value: number;
  change_percent: number;
  trend: 'up' | 'down' | 'stable';
  stats: TimeSeriesStats;
}

export interface Insight {
  type: 'anomaly' | 'trend' | 'correlation' | 'milestone';
  severity: 'low' | 'medium' | 'high';
  title: string;
  description: string;
  data?: any;
}

export interface Correlation {
  source_a: string;
  source_b: string;
  coefficient: number;
  strength: 'weak' | 'moderate' | 'strong';
}

// ============================================
// ANALYTICS AGENT
// ============================================

export class AnalyticsAgent extends EventEmitter {
  private agent: CAP402Agent;
  private config: Required<AnalyticsConfig>;
  private timeSeries: Map<string, DataPoint[]> = new Map();
  private reports: AnalyticsReport[] = [];
  private collectionTimers: Map<string, NodeJS.Timeout> = new Map();
  private reportTimer?: NodeJS.Timeout;
  private isRunning = false;
  private startTime = 0;

  constructor(config: AnalyticsConfig) {
    super();

    this.config = {
      data_sources: [],
      report_interval_ms: 300000, // 5 minutes
      aggregation_window_ms: 3600000, // 1 hour
      storage_backend: 'memory',
      max_data_points: 10000,
      router_url: 'https://cap402.com',
      description: 'Analytics agent for data collection and reporting',
      capabilities_provided: ['analytics.report', 'analytics.query'],
      capabilities_required: ['cap.price.lookup.v1'],
      ...config
    } as Required<AnalyticsConfig>;

    this.agent = createAgent({
      agent_id: this.config.agent_id,
      name: this.config.name,
      router_url: this.config.router_url,
      description: this.config.description,
      capabilities_provided: this.config.capabilities_provided,
      capabilities_required: this.config.capabilities_required,
      tags: ['analytics', 'data', 'reporting']
    });

    this.setupAgentEvents();
  }

  // ============================================
  // LIFECYCLE
  // ============================================

  async start(): Promise<void> {
    console.log(`\n📊 Starting Analytics Agent: ${this.config.name}`);
    console.log(`   Data Sources: ${this.config.data_sources.length}`);
    console.log(`   Report Interval: ${this.config.report_interval_ms / 1000}s\n`);

    this.startTime = Date.now();
    await this.agent.start();
    this.isRunning = true;

    // Start data collection for each source
    for (const source of this.config.data_sources) {
      if (source.enabled) {
        this.startCollection(source);
      }
    }

    // Start report generation
    this.reportTimer = setInterval(async () => {
      if (!this.isRunning) return;
      await this.generateReport();
    }, this.config.report_interval_ms);

    this.emit('started');
  }

  async stop(): Promise<void> {
    console.log('\n🛑 Stopping Analytics Agent...');
    this.isRunning = false;

    // Stop all collection timers
    this.collectionTimers.forEach((timer) => clearInterval(timer));
    this.collectionTimers.clear();

    if (this.reportTimer) {
      clearInterval(this.reportTimer);
    }

    // Generate final report
    await this.generateReport();

    this.printStats();
    await this.agent.stop();
    this.emit('stopped');
  }

  // ============================================
  // DATA COLLECTION
  // ============================================

  private startCollection(source: DataSource): void {
    const interval = source.interval_ms || 60000;

    // Collect immediately
    this.collectData(source);

    // Then on interval
    const timer = setInterval(() => {
      if (!this.isRunning) return;
      this.collectData(source);
    }, interval);

    this.collectionTimers.set(source.id, timer);
  }

  private async collectData(source: DataSource): Promise<void> {
    try {
      const result = await this.agent.invoke(source.capability_id, source.inputs);

      if (result.success && result.outputs) {
        const value = this.extractValue(source.type, result.outputs);
        
        if (value !== null) {
          const dataPoint: DataPoint = {
            source_id: source.id,
            value,
            metadata: result.outputs,
            timestamp: Date.now()
          };

          this.storeDataPoint(dataPoint);
          this.emit('data_collected', dataPoint);
        }
      }
    } catch (error) {
      console.error(`Failed to collect data from ${source.id}:`, error);
    }
  }

  private extractValue(type: string, outputs: any): number | null {
    switch (type) {
      case 'price':
        return outputs.price ?? null;
      case 'volume':
        return outputs.volume_24h ?? outputs.volume ?? null;
      case 'tvl':
        return outputs.tvl ?? null;
      case 'transactions':
        return outputs.tx_count ?? outputs.transactions ?? null;
      case 'custom':
        return outputs.value ?? null;
      default:
        return null;
    }
  }

  private storeDataPoint(point: DataPoint): void {
    if (!this.timeSeries.has(point.source_id)) {
      this.timeSeries.set(point.source_id, []);
    }

    const series = this.timeSeries.get(point.source_id)!;
    series.push(point);

    // Enforce max data points
    const maxPoints = this.config.max_data_points / this.config.data_sources.length;
    if (series.length > maxPoints) {
      series.shift();
    }
  }

  addDataSource(source: DataSource): void {
    this.config.data_sources.push(source);
    if (source.enabled && this.isRunning) {
      this.startCollection(source);
    }
    this.emit('source_added', source);
  }

  removeDataSource(sourceId: string): void {
    const index = this.config.data_sources.findIndex(s => s.id === sourceId);
    if (index > -1) {
      this.config.data_sources.splice(index, 1);
      
      const timer = this.collectionTimers.get(sourceId);
      if (timer) {
        clearInterval(timer);
        this.collectionTimers.delete(sourceId);
      }
      
      this.timeSeries.delete(sourceId);
      this.emit('source_removed', sourceId);
    }
  }

  // ============================================
  // ANALYTICS
  // ============================================

  getTimeSeries(sourceId: string, options?: {
    start?: number;
    end?: number;
    limit?: number;
  }): TimeSeries | null {
    const points = this.timeSeries.get(sourceId);
    if (!points || points.length === 0) return null;

    let filtered = [...points];

    if (options?.start) {
      filtered = filtered.filter(p => p.timestamp >= options.start!);
    }
    if (options?.end) {
      filtered = filtered.filter(p => p.timestamp <= options.end!);
    }
    if (options?.limit) {
      filtered = filtered.slice(-options.limit);
    }

    return {
      source_id: sourceId,
      points: filtered,
      stats: this.calculateStats(filtered)
    };
  }

  private calculateStats(points: DataPoint[]): TimeSeriesStats {
    if (points.length === 0) {
      return {
        count: 0,
        min: 0,
        max: 0,
        avg: 0,
        stddev: 0,
        first_timestamp: 0,
        last_timestamp: 0
      };
    }

    const values = points.map(p => p.value);
    const sum = values.reduce((a, b) => a + b, 0);
    const avg = sum / values.length;
    const variance = values.reduce((acc, v) => acc + Math.pow(v - avg, 2), 0) / values.length;

    return {
      count: points.length,
      min: Math.min(...values),
      max: Math.max(...values),
      avg,
      stddev: Math.sqrt(variance),
      first_timestamp: points[0].timestamp,
      last_timestamp: points[points.length - 1].timestamp
    };
  }

  async generateReport(): Promise<AnalyticsReport> {
    const now = Date.now();
    const periodStart = now - this.config.aggregation_window_ms;

    const summaries: Record<string, SourceSummary> = {};
    const insights: Insight[] = [];

    for (const source of this.config.data_sources) {
      const series = this.getTimeSeries(source.id, { start: periodStart });
      if (!series || series.points.length === 0) continue;

      const firstValue = series.points[0].value;
      const lastValue = series.points[series.points.length - 1].value;
      const changePercent = ((lastValue - firstValue) / firstValue) * 100;

      summaries[source.id] = {
        source_id: source.id,
        data_points: series.points.length,
        current_value: lastValue,
        change_percent: changePercent,
        trend: changePercent > 1 ? 'up' : changePercent < -1 ? 'down' : 'stable',
        stats: series.stats
      };

      // Generate insights
      if (Math.abs(changePercent) > 10) {
        insights.push({
          type: 'trend',
          severity: Math.abs(changePercent) > 25 ? 'high' : 'medium',
          title: `Significant ${changePercent > 0 ? 'increase' : 'decrease'} in ${source.id}`,
          description: `${source.id} changed by ${changePercent.toFixed(2)}% over the period`,
          data: { source_id: source.id, change_percent: changePercent }
        });
      }

      // Detect anomalies (values outside 2 standard deviations)
      const threshold = series.stats.avg + (2 * series.stats.stddev);
      if (lastValue > threshold || lastValue < series.stats.avg - (2 * series.stats.stddev)) {
        insights.push({
          type: 'anomaly',
          severity: 'high',
          title: `Anomaly detected in ${source.id}`,
          description: `Current value ${lastValue.toFixed(2)} is outside normal range`,
          data: { source_id: source.id, value: lastValue, expected_range: [series.stats.avg - 2 * series.stats.stddev, threshold] }
        });
      }
    }

    // Calculate correlations between sources
    const correlations = this.calculateCorrelations(periodStart);

    const report: AnalyticsReport = {
      report_id: `report_${now}`,
      generated_at: now,
      period_start: periodStart,
      period_end: now,
      sources: Object.keys(summaries),
      summaries,
      insights,
      correlations
    };

    this.reports.push(report);
    if (this.reports.length > 100) {
      this.reports.shift();
    }

    this.emit('report_generated', report);
    return report;
  }

  private calculateCorrelations(since: number): Correlation[] {
    const correlations: Correlation[] = [];
    const sourceIds = Array.from(this.timeSeries.keys());

    for (let i = 0; i < sourceIds.length; i++) {
      for (let j = i + 1; j < sourceIds.length; j++) {
        const seriesA = this.getTimeSeries(sourceIds[i], { start: since });
        const seriesB = this.getTimeSeries(sourceIds[j], { start: since });

        if (!seriesA || !seriesB || seriesA.points.length < 5 || seriesB.points.length < 5) {
          continue;
        }

        // Simple correlation calculation (Pearson)
        const coefficient = this.pearsonCorrelation(
          seriesA.points.map(p => p.value),
          seriesB.points.map(p => p.value)
        );

        if (!isNaN(coefficient)) {
          correlations.push({
            source_a: sourceIds[i],
            source_b: sourceIds[j],
            coefficient,
            strength: Math.abs(coefficient) > 0.7 ? 'strong' :
                      Math.abs(coefficient) > 0.4 ? 'moderate' : 'weak'
          });
        }
      }
    }

    return correlations.filter(c => Math.abs(c.coefficient) > 0.3);
  }

  private pearsonCorrelation(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length);
    if (n < 2) return NaN;

    const sumX = x.slice(0, n).reduce((a, b) => a + b, 0);
    const sumY = y.slice(0, n).reduce((a, b) => a + b, 0);
    const sumXY = x.slice(0, n).reduce((acc, xi, i) => acc + xi * y[i], 0);
    const sumX2 = x.slice(0, n).reduce((acc, xi) => acc + xi * xi, 0);
    const sumY2 = y.slice(0, n).reduce((acc, yi) => acc + yi * yi, 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

    return denominator === 0 ? 0 : numerator / denominator;
  }

  // ============================================
  // QUERYING
  // ============================================

  query(options: {
    sources?: string[];
    start?: number;
    end?: number;
    aggregation?: 'avg' | 'sum' | 'min' | 'max' | 'count';
    group_by?: 'minute' | 'hour' | 'day';
  }): Record<string, any> {
    const results: Record<string, any> = {};
    const sources = options.sources || Array.from(this.timeSeries.keys());

    for (const sourceId of sources) {
      const series = this.getTimeSeries(sourceId, {
        start: options.start,
        end: options.end
      });

      if (!series) continue;

      if (options.group_by) {
        results[sourceId] = this.groupByTime(series.points, options.group_by, options.aggregation || 'avg');
      } else {
        results[sourceId] = {
          points: series.points,
          stats: series.stats,
          aggregated: this.aggregate(series.points.map(p => p.value), options.aggregation || 'avg')
        };
      }
    }

    return results;
  }

  private groupByTime(
    points: DataPoint[],
    groupBy: 'minute' | 'hour' | 'day',
    aggregation: 'avg' | 'sum' | 'min' | 'max' | 'count'
  ): Array<{ period: number; value: number }> {
    const groups = new Map<number, number[]>();
    const divisor = groupBy === 'minute' ? 60000 :
                    groupBy === 'hour' ? 3600000 : 86400000;

    for (const point of points) {
      const period = Math.floor(point.timestamp / divisor) * divisor;
      if (!groups.has(period)) {
        groups.set(period, []);
      }
      groups.get(period)!.push(point.value);
    }

    const result: Array<{ period: number; value: number }> = [];
    groups.forEach((values, period) => {
      result.push({
        period,
        value: this.aggregate(values, aggregation)
      });
    });

    return result.sort((a, b) => a.period - b.period);
  }

  private aggregate(values: number[], method: 'avg' | 'sum' | 'min' | 'max' | 'count'): number {
    if (values.length === 0) return 0;

    switch (method) {
      case 'avg':
        return values.reduce((a, b) => a + b, 0) / values.length;
      case 'sum':
        return values.reduce((a, b) => a + b, 0);
      case 'min':
        return Math.min(...values);
      case 'max':
        return Math.max(...values);
      case 'count':
        return values.length;
    }
  }

  getLatestReport(): AnalyticsReport | null {
    return this.reports.length > 0 ? this.reports[this.reports.length - 1] : null;
  }

  getReports(limit?: number): AnalyticsReport[] {
    const reports = [...this.reports].reverse();
    return limit ? reports.slice(0, limit) : reports;
  }

  // ============================================
  // STATS
  // ============================================

  getStats(): {
    uptime_ms: number;
    data_points_collected: number;
    reports_generated: number;
    active_sources: number;
  } {
    let totalPoints = 0;
    this.timeSeries.forEach(points => {
      totalPoints += points.length;
    });

    return {
      uptime_ms: Date.now() - this.startTime,
      data_points_collected: totalPoints,
      reports_generated: this.reports.length,
      active_sources: this.collectionTimers.size
    };
  }

  printStats(): void {
    const stats = this.getStats();
    console.log('\n📊 Analytics Agent Stats:');
    console.log(`   Uptime: ${Math.round(stats.uptime_ms / 1000)}s`);
    console.log(`   Data Points: ${stats.data_points_collected}`);
    console.log(`   Reports: ${stats.reports_generated}`);
    console.log(`   Active Sources: ${stats.active_sources}`);
  }

  // ============================================
  // PRIVATE
  // ============================================

  private setupAgentEvents(): void {
    this.agent.on('error', (error) => {
      this.emit('agent_error', error);
    });
  }
}

// ============================================
// FACTORY
// ============================================

export function createAnalyticsAgent(config: AnalyticsConfig): AnalyticsAgent {
  return new AnalyticsAgent(config);
}
