/**
 * Monitoring Agent Template
 * 
 * A production-ready monitoring agent that tracks system health,
 * wallet activity, and protocol metrics using CAP-402 capabilities.
 */

import { CAP402Agent, createAgent, AgentConfig } from '../agent';
import { EventEmitter } from 'events';

// ============================================
// TYPES
// ============================================

export interface MonitoringConfig extends Partial<AgentConfig> {
  agent_id: string;
  name: string;
  watched_wallets?: string[];
  watched_protocols?: string[];
  alert_channels?: AlertChannel[];
  check_interval_ms?: number;
  thresholds?: {
    balance_change_percent?: number;
    gas_price_gwei?: number;
    tvl_change_percent?: number;
    health_score_min?: number;
  };
}

export interface AlertChannel {
  type: 'webhook' | 'email' | 'slack' | 'telegram' | 'console';
  endpoint?: string;
  enabled: boolean;
}

export interface WalletSnapshot {
  address: string;
  balance_sol: number;
  balance_usd: number;
  token_count: number;
  nft_count: number;
  last_activity?: number;
  timestamp: number;
}

export interface ProtocolHealth {
  protocol: string;
  tvl: number;
  tvl_change_24h: number;
  active_users_24h: number;
  health_score: number;
  status: 'healthy' | 'degraded' | 'critical';
  timestamp: number;
}

export interface Alert {
  id: string;
  type: 'wallet' | 'protocol' | 'price' | 'system';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  data?: any;
  timestamp: number;
  acknowledged: boolean;
}

export interface MonitoringStats {
  uptime_ms: number;
  checks_performed: number;
  alerts_triggered: number;
  alerts_by_severity: { info: number; warning: number; critical: number };
  last_check: number;
}

// ============================================
// MONITORING AGENT
// ============================================

export class MonitoringAgent extends EventEmitter {
  private agent: CAP402Agent;
  private config: Required<MonitoringConfig>;
  private walletSnapshots: Map<string, WalletSnapshot[]> = new Map();
  private protocolHealth: Map<string, ProtocolHealth> = new Map();
  private alerts: Alert[] = [];
  private stats: MonitoringStats;
  private checkTimer?: NodeJS.Timeout;
  private isRunning = false;
  private startTime = 0;

  constructor(config: MonitoringConfig) {
    super();

    this.config = {
      watched_wallets: [],
      watched_protocols: [],
      alert_channels: [{ type: 'console', enabled: true }],
      check_interval_ms: 60000,
      thresholds: {
        balance_change_percent: 10,
        gas_price_gwei: 100,
        tvl_change_percent: 15,
        health_score_min: 70,
        ...config.thresholds
      },
      router_url: 'https://cap402.com',
      description: 'Monitoring agent for wallets and protocols',
      capabilities_provided: ['monitoring.alerts', 'monitoring.health'],
      capabilities_required: ['cap.wallet.snapshot.v1', 'cap.price.lookup.v1'],
      ...config
    } as Required<MonitoringConfig>;

    this.stats = {
      uptime_ms: 0,
      checks_performed: 0,
      alerts_triggered: 0,
      alerts_by_severity: { info: 0, warning: 0, critical: 0 },
      last_check: 0
    };

    this.agent = createAgent({
      agent_id: this.config.agent_id,
      name: this.config.name,
      router_url: this.config.router_url,
      description: this.config.description,
      capabilities_provided: this.config.capabilities_provided,
      capabilities_required: this.config.capabilities_required,
      tags: ['monitoring', 'alerts', 'health']
    });

    this.setupAgentEvents();
  }

  // ============================================
  // LIFECYCLE
  // ============================================

  async start(): Promise<void> {
    console.log(`\n👁️  Starting Monitoring Agent: ${this.config.name}`);
    console.log(`   Wallets: ${this.config.watched_wallets.length}`);
    console.log(`   Protocols: ${this.config.watched_protocols.length}`);
    console.log(`   Check Interval: ${this.config.check_interval_ms / 1000}s\n`);

    this.startTime = Date.now();
    await this.agent.start();
    this.isRunning = true;

    // Initial check
    await this.performChecks();

    // Start monitoring loop
    this.checkTimer = setInterval(async () => {
      if (!this.isRunning) return;
      await this.performChecks();
    }, this.config.check_interval_ms);

    this.emit('started');
  }

  async stop(): Promise<void> {
    console.log('\n🛑 Stopping Monitoring Agent...');
    this.isRunning = false;

    if (this.checkTimer) {
      clearInterval(this.checkTimer);
    }

    this.printStats();
    await this.agent.stop();
    this.emit('stopped');
    
    // Remove all event listeners to prevent memory leaks
    this.removeAllListeners();
  }

  // ============================================
  // MONITORING
  // ============================================

  async performChecks(): Promise<void> {
    this.stats.checks_performed++;
    this.stats.last_check = Date.now();
    this.stats.uptime_ms = Date.now() - this.startTime;

    // Check wallets
    for (const wallet of this.config.watched_wallets) {
      await this.checkWallet(wallet);
    }

    // Check protocols
    for (const protocol of this.config.watched_protocols) {
      await this.checkProtocol(protocol);
    }

    // Check system health
    await this.checkSystemHealth();

    this.emit('checks_completed', {
      wallets: this.config.watched_wallets.length,
      protocols: this.config.watched_protocols.length,
      timestamp: Date.now()
    });
  }

  private async checkWallet(address: string): Promise<void> {
    try {
      const result = await this.agent.invoke<{
        address: string;
        balances: Array<{ token: string; amount: number; value_usd: number }>;
        nfts?: Array<{ collection: string; count: number }>;
        last_activity?: number;
      }>('cap.wallet.snapshot.v1', {
        address,
        network: 'solana-mainnet',
        include_nfts: true
      });

      if (!result.success || !result.outputs) return;

      const totalUsd = result.outputs.balances.reduce((sum, b) => sum + (b.value_usd || 0), 0);
      const solBalance = result.outputs.balances.find(b => b.token === 'SOL')?.amount || 0;

      const snapshot: WalletSnapshot = {
        address,
        balance_sol: solBalance,
        balance_usd: totalUsd,
        token_count: result.outputs.balances.length,
        nft_count: result.outputs.nfts?.reduce((sum, n) => sum + n.count, 0) || 0,
        last_activity: result.outputs.last_activity,
        timestamp: Date.now()
      };

      // Store snapshot
      if (!this.walletSnapshots.has(address)) {
        this.walletSnapshots.set(address, []);
      }
      const history = this.walletSnapshots.get(address)!;
      
      // Check for significant changes
      if (history.length > 0) {
        const lastSnapshot = history[history.length - 1];
        const changePercent = ((snapshot.balance_usd - lastSnapshot.balance_usd) / lastSnapshot.balance_usd) * 100;
        
        const threshold = this.config.thresholds?.balance_change_percent ?? 10;
        if (Math.abs(changePercent) >= threshold) {
          this.triggerAlert({
            type: 'wallet',
            severity: Math.abs(changePercent) > 25 ? 'critical' : 'warning',
            title: `Wallet Balance ${changePercent > 0 ? 'Increased' : 'Decreased'}`,
            message: `${address.substring(0, 8)}... balance changed by ${changePercent.toFixed(2)}%`,
            data: { address, old_balance: lastSnapshot.balance_usd, new_balance: snapshot.balance_usd, change_percent: changePercent }
          });
        }
      }

      history.push(snapshot);
      if (history.length > 100) history.shift();

    } catch (error) {
      console.error(`Failed to check wallet ${address}:`, error);
    }
  }

  private async checkProtocol(protocol: string): Promise<void> {
    try {
      // This would use a protocol health capability
      const result = await this.agent.invoke<{
        tvl: number;
        tvl_change_24h: number;
        active_users_24h: number;
        health_score: number;
      }>('cap.protocol.health.v1', {
        protocol
      });

      if (!result.success || !result.outputs) return;

      const health: ProtocolHealth = {
        protocol,
        tvl: result.outputs.tvl,
        tvl_change_24h: result.outputs.tvl_change_24h,
        active_users_24h: result.outputs.active_users_24h,
        health_score: result.outputs.health_score,
        status: result.outputs.health_score >= 80 ? 'healthy' : 
                result.outputs.health_score >= 50 ? 'degraded' : 'critical',
        timestamp: Date.now()
      };

      const oldHealth = this.protocolHealth.get(protocol);
      this.protocolHealth.set(protocol, health);

      // Check for health degradation
      const minHealthScore = this.config.thresholds?.health_score_min ?? 70;
      if (health.health_score < minHealthScore) {
        this.triggerAlert({
          type: 'protocol',
          severity: health.status === 'critical' ? 'critical' : 'warning',
          title: `Protocol Health Degraded: ${protocol}`,
          message: `Health score: ${health.health_score}/100, Status: ${health.status}`,
          data: health
        });
      }

      // Check for TVL changes
      const tvlThreshold = this.config.thresholds?.tvl_change_percent ?? 15;
      if (Math.abs(health.tvl_change_24h) >= tvlThreshold) {
        this.triggerAlert({
          type: 'protocol',
          severity: Math.abs(health.tvl_change_24h) > 30 ? 'critical' : 'warning',
          title: `TVL ${health.tvl_change_24h > 0 ? 'Surge' : 'Drop'}: ${protocol}`,
          message: `TVL changed by ${health.tvl_change_24h.toFixed(2)}% in 24h`,
          data: health
        });
      }

    } catch (error) {
      // Protocol health capability may not exist - that's ok
    }
  }

  private async checkSystemHealth(): Promise<void> {
    try {
      const health = await this.agent.invoke('cap.system.health.v1', {});
      
      if (health.success && health.outputs) {
        if (health.outputs.status !== 'healthy') {
          this.triggerAlert({
            type: 'system',
            severity: health.outputs.status === 'critical' ? 'critical' : 'warning',
            title: 'System Health Issue',
            message: `Router status: ${health.outputs.status}`,
            data: health.outputs
          });
        }
      }
    } catch {
      // System health check failed - could be network issue
    }
  }

  // ============================================
  // ALERTS
  // ============================================

  private triggerAlert(alert: Omit<Alert, 'id' | 'timestamp' | 'acknowledged'>): void {
    const fullAlert: Alert = {
      ...alert,
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      acknowledged: false
    };

    this.alerts.push(fullAlert);
    this.stats.alerts_triggered++;
    this.stats.alerts_by_severity[alert.severity]++;

    // Keep only last 1000 alerts
    if (this.alerts.length > 1000) {
      this.alerts = this.alerts.slice(-1000);
    }

    // Send to channels
    this.sendAlert(fullAlert);

    this.emit('alert', fullAlert);
  }

  private sendAlert(alert: Alert): void {
    for (const channel of this.config.alert_channels) {
      if (!channel.enabled) continue;

      switch (channel.type) {
        case 'console':
          const icon = alert.severity === 'critical' ? '🚨' : 
                       alert.severity === 'warning' ? '⚠️' : 'ℹ️';
          console.log(`${icon} [${alert.severity.toUpperCase()}] ${alert.title}: ${alert.message}`);
          break;
        case 'webhook':
          if (channel.endpoint) {
            this.sendWebhook(channel.endpoint, alert).catch(() => {});
          }
          break;
        // Other channels would be implemented similarly
      }
    }
  }

  private async sendWebhook(endpoint: string, alert: Alert): Promise<void> {
    try {
      const axios = (await import('axios')).default;
      await axios.post(endpoint, {
        ...alert,
        agent_id: this.config.agent_id,
        agent_name: this.config.name
      }, { timeout: 5000 });
    } catch (error) {
      console.error('Failed to send webhook:', error);
    }
  }

  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      return true;
    }
    return false;
  }

  getAlerts(options?: {
    severity?: 'info' | 'warning' | 'critical';
    type?: 'wallet' | 'protocol' | 'price' | 'system';
    unacknowledged_only?: boolean;
    limit?: number;
  }): Alert[] {
    let filtered = [...this.alerts];

    if (options?.severity) {
      filtered = filtered.filter(a => a.severity === options.severity);
    }
    if (options?.type) {
      filtered = filtered.filter(a => a.type === options.type);
    }
    if (options?.unacknowledged_only) {
      filtered = filtered.filter(a => !a.acknowledged);
    }

    filtered.sort((a, b) => b.timestamp - a.timestamp);

    if (options?.limit) {
      filtered = filtered.slice(0, options.limit);
    }

    return filtered;
  }

  // ============================================
  // WATCH MANAGEMENT
  // ============================================

  addWallet(address: string): void {
    if (!this.config.watched_wallets.includes(address)) {
      this.config.watched_wallets.push(address);
      this.emit('wallet_added', address);
    }
  }

  removeWallet(address: string): void {
    const index = this.config.watched_wallets.indexOf(address);
    if (index > -1) {
      this.config.watched_wallets.splice(index, 1);
      this.walletSnapshots.delete(address);
      this.emit('wallet_removed', address);
    }
  }

  addProtocol(protocol: string): void {
    if (!this.config.watched_protocols.includes(protocol)) {
      this.config.watched_protocols.push(protocol);
      this.emit('protocol_added', protocol);
    }
  }

  removeProtocol(protocol: string): void {
    const index = this.config.watched_protocols.indexOf(protocol);
    if (index > -1) {
      this.config.watched_protocols.splice(index, 1);
      this.protocolHealth.delete(protocol);
      this.emit('protocol_removed', protocol);
    }
  }

  // ============================================
  // DATA ACCESS
  // ============================================

  getWalletSnapshot(address: string): WalletSnapshot | undefined {
    const history = this.walletSnapshots.get(address);
    return history?.[history.length - 1];
  }

  getWalletHistory(address: string): WalletSnapshot[] {
    return this.walletSnapshots.get(address) || [];
  }

  getProtocolHealth(protocol: string): ProtocolHealth | undefined {
    return this.protocolHealth.get(protocol);
  }

  getAllProtocolHealth(): ProtocolHealth[] {
    return Array.from(this.protocolHealth.values());
  }

  getStats(): MonitoringStats {
    return { ...this.stats, uptime_ms: Date.now() - this.startTime };
  }

  /**
   * Print formatted monitoring statistics to console
   */
  printStats(): void {
    const stats = this.getStats();
    const uptimeHours = (stats.uptime_ms / 3600000).toFixed(1);
    const uptimeDisplay = stats.uptime_ms > 3600000 
      ? `${uptimeHours} hours` 
      : `${Math.round(stats.uptime_ms / 1000)}s`;
    
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║      👁️ Monitoring Agent Stats          ║');
    console.log('╠════════════════════════════════════════╣');
    console.log(`║  Uptime:          ${uptimeDisplay.padStart(12)}      ║`);
    console.log(`║  Wallets:         ${String(this.config.watched_wallets.length).padStart(12)}      ║`);
    console.log(`║  Protocols:       ${String(this.config.watched_protocols.length).padStart(12)}      ║`);
    console.log(`║  Checks:          ${String(stats.checks_performed).padStart(12)}      ║`);
    console.log('╠════════════════════════════════════════╣');
    console.log('║  Alerts:                               ║');
    console.log(`║    🚨 Critical:   ${String(stats.alerts_by_severity.critical).padStart(12)}      ║`);
    console.log(`║    ⚠️  Warning:    ${String(stats.alerts_by_severity.warning).padStart(12)}      ║`);
    console.log(`║    ℹ️  Info:       ${String(stats.alerts_by_severity.info).padStart(12)}      ║`);
    console.log(`║    Total:         ${String(stats.alerts_triggered).padStart(12)}      ║`);
    console.log('╚════════════════════════════════════════╝');
  }

  // ============================================
  // PRIVATE
  // ============================================

  private setupAgentEvents(): void {
    this.agent.on('error', (error) => {
      this.emit('agent_error', error);
    });

    this.agent.on('disconnected', () => {
      this.triggerAlert({
        type: 'system',
        severity: 'critical',
        title: 'Router Connection Lost',
        message: 'Monitoring agent lost connection to CAP-402 router'
      });
    });

    this.agent.on('reconnected', () => {
      this.triggerAlert({
        type: 'system',
        severity: 'info',
        title: 'Router Connection Restored',
        message: 'Monitoring agent reconnected to CAP-402 router'
      });
    });
  }
}

// ============================================
// FACTORY
// ============================================

export function createMonitoringAgent(config: MonitoringConfig): MonitoringAgent {
  return new MonitoringAgent(config);
}
