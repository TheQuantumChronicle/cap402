#!/usr/bin/env npx ts-node
/**
 * Real Wallet Monitor
 * 
 * Monitors wallets in real-time using actual blockchain data.
 * Sends alerts on balance changes, large transactions, and activity.
 * 
 * Usage:
 *   npx ts-node examples/wallet-monitor.ts [wallet_address]
 */

import { createMonitoringAgent, MonitoringAgent } from '../sdk/agents/monitoring-agent';

// ============================================
// CONFIGURATION
// ============================================

const DEFAULT_WALLETS = [
  '82MfBWDVuG7yB5j1kxxA8RCB6vbrJCTmQbowXPmvHv7j', // X402 wallet from .env
];

const CONFIG = {
  agent_id: `wallet-monitor-${Date.now()}`,
  name: 'Real Wallet Monitor',
  router_url: process.env.CAP402_ROUTER || 'https://cap402.com',
  
  // Wallets to monitor (from args or defaults)
  watched_wallets: process.argv.slice(2).length > 0 
    ? process.argv.slice(2) 
    : DEFAULT_WALLETS,
  
  // Protocols to monitor
  watched_protocols: ['jupiter', 'raydium', 'orca'],
  
  // Check every 30 seconds
  check_interval_ms: 30000,
  
  // Alert thresholds
  thresholds: {
    balance_change_percent: 5,   // Alert on 5%+ balance change
    gas_price_gwei: 100,         // Alert on high gas
    tvl_change_percent: 10,      // Alert on protocol TVL changes
    health_score_min: 70         // Alert if protocol health drops
  },
  
  // Alert channels
  alert_channels: [
    { type: 'console' as const, enabled: true }
    // Add webhook for production:
    // { type: 'webhook', endpoint: 'https://your-webhook.com/alerts', enabled: true }
  ]
};

// ============================================
// WALLET MONITOR
// ============================================

class RealWalletMonitor {
  private agent: MonitoringAgent;
  private isRunning = false;

  constructor() {
    this.agent = createMonitoringAgent(CONFIG);
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Alerts
    this.agent.on('alert', (alert) => {
      // Already printed by console channel, but we can add extra handling
      if (alert.severity === 'critical') {
        // Could trigger additional actions for critical alerts
        console.log(`\n🚨 CRITICAL ALERT - Immediate attention required!`);
      }
    });

    // Check completion
    this.agent.on('checks_completed', (info) => {
      // Silent - uncomment for debugging
      // console.log(`Checks completed: ${info.wallets} wallets, ${info.protocols} protocols`);
    });

    // Wallet changes
    this.agent.on('wallet_added', (address) => {
      console.log(`📍 Now monitoring: ${address}`);
    });

    this.agent.on('wallet_removed', (address) => {
      console.log(`📍 Stopped monitoring: ${address}`);
    });

    // Agent errors
    this.agent.on('agent_error', (error) => {
      console.error('❌ Agent error:', error);
    });
  }

  async start(): Promise<void> {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('           Real Wallet Monitor');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`\n📡 Router: ${CONFIG.router_url}`);
    console.log(`⏱️  Check Interval: ${CONFIG.check_interval_ms / 1000}s`);
    console.log(`\n👛 Monitoring ${CONFIG.watched_wallets.length} wallet(s):`);
    
    for (const wallet of CONFIG.watched_wallets) {
      console.log(`   • ${wallet.substring(0, 8)}...${wallet.substring(wallet.length - 8)}`);
    }
    
    console.log(`\n🔗 Monitoring ${CONFIG.watched_protocols.length} protocol(s):`);
    for (const protocol of CONFIG.watched_protocols) {
      console.log(`   • ${protocol}`);
    }
    
    console.log('\nPress Ctrl+C to stop\n');
    console.log('─────────────────────────────────────────────────────────────\n');

    this.isRunning = true;
    await this.agent.start();

    // Print initial snapshot
    await this.printWalletSnapshots();

    // Periodic status updates
    setInterval(() => {
      if (this.isRunning) {
        this.printStatus();
      }
    }, 120000); // Every 2 minutes
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    await this.agent.stop();
    
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('           Session Summary');
    console.log('═══════════════════════════════════════════════════════════');
    this.printFinalStats();
  }

  private async printWalletSnapshots(): Promise<void> {
    console.log('📊 Initial Wallet Snapshots:\n');
    
    for (const wallet of CONFIG.watched_wallets) {
      const snapshot = this.agent.getWalletSnapshot(wallet);
      if (snapshot) {
        console.log(`   ${wallet.substring(0, 8)}...`);
        console.log(`   • SOL Balance: ${snapshot.balance_sol.toFixed(4)} SOL`);
        console.log(`   • USD Value: $${snapshot.balance_usd.toLocaleString()}`);
        console.log(`   • Tokens: ${snapshot.token_count}`);
        console.log(`   • NFTs: ${snapshot.nft_count}`);
        console.log('');
      } else {
        console.log(`   ${wallet.substring(0, 8)}... - Snapshot pending\n`);
      }
    }
  }

  private printStatus(): void {
    const stats = this.agent.getStats();
    const alerts = this.agent.getAlerts({ limit: 5, unacknowledged_only: true });
    
    console.log('\n─────────────────────────────────────────');
    console.log('📈 Status Update');
    console.log('─────────────────────────────────────────');
    console.log(`   Uptime: ${Math.round(stats.uptime_ms / 1000)}s`);
    console.log(`   Checks: ${stats.checks_performed}`);
    console.log(`   Alerts: ${stats.alerts_triggered} total`);
    
    if (alerts.length > 0) {
      console.log(`\n   Recent Unacknowledged Alerts:`);
      for (const alert of alerts) {
        const icon = alert.severity === 'critical' ? '🚨' : 
                     alert.severity === 'warning' ? '⚠️' : 'ℹ️';
        console.log(`   ${icon} ${alert.title}`);
      }
    }

    // Show current wallet values
    console.log('\n   Current Values:');
    for (const wallet of CONFIG.watched_wallets) {
      const snapshot = this.agent.getWalletSnapshot(wallet);
      if (snapshot) {
        console.log(`   • ${wallet.substring(0, 8)}...: $${snapshot.balance_usd.toLocaleString()}`);
      }
    }
  }

  private printFinalStats(): void {
    const stats = this.agent.getStats();
    
    console.log(`\n   Session Duration: ${Math.round(stats.uptime_ms / 1000)}s`);
    console.log(`   Total Checks: ${stats.checks_performed}`);
    console.log(`   Total Alerts: ${stats.alerts_triggered}`);
    console.log(`   • Critical: ${stats.alerts_by_severity.critical}`);
    console.log(`   • Warning: ${stats.alerts_by_severity.warning}`);
    console.log(`   • Info: ${stats.alerts_by_severity.info}`);

    // Show wallet value changes
    console.log('\n   Wallet Changes:');
    for (const wallet of CONFIG.watched_wallets) {
      const history = this.agent.getWalletHistory(wallet);
      if (history.length >= 2) {
        const first = history[0];
        const last = history[history.length - 1];
        const change = last.balance_usd - first.balance_usd;
        const changePercent = (change / first.balance_usd) * 100;
        const sign = change >= 0 ? '+' : '';
        console.log(`   • ${wallet.substring(0, 8)}...: ${sign}$${change.toFixed(2)} (${sign}${changePercent.toFixed(2)}%)`);
      }
    }
  }

  // Add wallet dynamically
  addWallet(address: string): void {
    this.agent.addWallet(address);
  }

  // Remove wallet dynamically
  removeWallet(address: string): void {
    this.agent.removeWallet(address);
  }

  // Get all alerts
  getAlerts(): any[] {
    return this.agent.getAlerts();
  }
}

// ============================================
// SIGNAL HANDLERS
// ============================================

let monitor: RealWalletMonitor;

async function shutdown(signal: string): Promise<void> {
  console.log(`\n\n📥 Received ${signal}, shutting down...`);
  if (monitor) {
    await monitor.stop();
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ============================================
// MAIN
// ============================================

async function main(): Promise<void> {
  monitor = new RealWalletMonitor();
  
  try {
    await monitor.start();
    
    // Keep running
    await new Promise(() => {});
  } catch (error) {
    console.error('Fatal error:', error);
    await monitor.stop();
    process.exit(1);
  }
}

main();
