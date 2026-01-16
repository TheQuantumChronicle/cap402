#!/usr/bin/env npx ts-node
/**
 * Production-Ready CAP-402 Agent Example
 * 
 * Demonstrates proper patterns for building production agents:
 * - Lifecycle management (start, stop, graceful shutdown)
 * - Error handling with circuit breakers
 * - A2A protocol usage
 * - Observability and metrics
 * - Health checks and reconnection
 */

import { createAgent, CAP402Agent, AgentState } from '../sdk/agent';

// ============================================
// CONFIGURATION
// ============================================

const AGENT_CONFIG = {
  agent_id: process.env.AGENT_ID || `prod-agent-${Date.now()}`,
  name: 'Production Trading Agent',
  router_url: process.env.CAP402_ROUTER || 'https://cap402.com',
  description: 'A production-ready agent demonstrating best practices',
  capabilities_provided: ['analysis.portfolio', 'alert.price'],
  capabilities_required: ['cap.price.lookup.v1', 'cap.wallet.snapshot.v1'],
  api_key: process.env.CAP402_API_KEY,
  timeout: 30000,
  retry_attempts: 3,
  retry_delay_ms: 1000,
  health_check_interval_ms: 30000,
  auto_reconnect: true,
  log_level: (process.env.LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error',
  tags: ['trading', 'production', 'demo']
};

// ============================================
// PRODUCTION AGENT CLASS
// ============================================

class ProductionTradingAgent {
  private agent: CAP402Agent;
  private isRunning = false;
  private taskInterval?: NodeJS.Timeout;

  constructor() {
    this.agent = createAgent(AGENT_CONFIG);
    this.setupEventHandlers();
    this.setupSignalHandlers();
  }

  // ============================================
  // LIFECYCLE
  // ============================================

  async start(): Promise<void> {
    console.log('\n🚀 Starting Production Trading Agent\n');
    console.log(`   Agent ID: ${AGENT_CONFIG.agent_id}`);
    console.log(`   Router:   ${AGENT_CONFIG.router_url}`);
    console.log(`   Log Level: ${AGENT_CONFIG.log_level}\n`);

    try {
      await this.agent.start();
      this.isRunning = true;
      
      // Start main task loop
      this.startTaskLoop();
      
      console.log('\n✅ Agent is running. Press Ctrl+C to stop.\n');
    } catch (error) {
      console.error('\n❌ Failed to start agent:', error);
      process.exit(1);
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    
    console.log('\n🛑 Stopping agent...\n');
    this.isRunning = false;

    if (this.taskInterval) {
      clearInterval(this.taskInterval);
    }

    // Print final metrics
    this.printMetrics();

    await this.agent.stop(true);
    console.log('\n👋 Agent stopped gracefully\n');
  }

  // ============================================
  // EVENT HANDLERS
  // ============================================

  private setupEventHandlers(): void {
    this.agent.on('ready', () => {
      console.log('📡 Agent connected and ready');
    });

    this.agent.on('error', (error) => {
      console.error('❌ Agent error:', error);
    });

    this.agent.on('disconnected', () => {
      console.warn('⚠️  Lost connection to router');
    });

    this.agent.on('reconnected', () => {
      console.log('🔄 Reconnected to router');
    });

    this.agent.on('rate_limited', (data) => {
      console.warn(`⏳ Rate limited. Retry after: ${data.retry_after}s`);
    });

    this.agent.on('circuit_open', (data) => {
      console.warn(`🔴 Circuit breaker opened for: ${data.capability_id}`);
    });

    this.agent.on('invocation', (data) => {
      const status = data.success ? '✓' : '✗';
      console.log(`   ${status} ${data.capability_id} (${data.latency_ms}ms)`);
    });

    this.agent.on('heartbeat', () => {
      // Silent heartbeat - uncomment for debugging
      // console.log('💓 Heartbeat');
    });
  }

  private setupSignalHandlers(): void {
    const shutdown = async (signal: string) => {
      console.log(`\n📥 Received ${signal}`);
      await this.stop();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    
    process.on('uncaughtException', async (error) => {
      console.error('💥 Uncaught exception:', error);
      await this.stop();
      process.exit(1);
    });

    process.on('unhandledRejection', async (reason) => {
      console.error('💥 Unhandled rejection:', reason);
      await this.stop();
      process.exit(1);
    });
  }

  // ============================================
  // MAIN TASK LOOP
  // ============================================

  private startTaskLoop(): void {
    // Run tasks every 60 seconds
    this.taskInterval = setInterval(async () => {
      if (!this.isRunning) return;
      
      try {
        await this.runTasks();
      } catch (error) {
        console.error('Task loop error:', error);
      }
    }, 60000);

    // Run immediately on start
    this.runTasks().catch(console.error);
  }

  private async runTasks(): Promise<void> {
    console.log('\n📋 Running scheduled tasks...\n');

    // Task 1: Check prices
    await this.checkPrices(['SOL', 'ETH', 'BTC']);

    // Task 2: Discover other agents
    await this.discoverPeers();

    // Task 3: Check messages
    await this.checkMessages();

    // Print current metrics
    this.printMetrics();
  }

  // ============================================
  // TRADING TASKS
  // ============================================

  async checkPrices(tokens: string[]): Promise<void> {
    console.log('💰 Checking prices...');

    for (const token of tokens) {
      try {
        const result = await this.agent.invoke('cap.price.lookup.v1', {
          base_token: token,
          quote_token: 'USD'
        });

        if (result.success && result.outputs) {
          console.log(`   ${token}: $${result.outputs.price?.toLocaleString() || 'N/A'}`);
        }
      } catch (error) {
        console.error(`   Failed to get ${token} price:`, error instanceof Error ? error.message : error);
      }
    }
  }

  async analyzeWallet(address: string): Promise<any> {
    console.log(`\n🔍 Analyzing wallet: ${address.substring(0, 8)}...`);

    // Use workflow to chain capabilities
    const result = await this.agent.executeWorkflow([
      {
        capability_id: 'cap.wallet.snapshot.v1',
        inputs: { address, network: 'solana-mainnet', include_nfts: true },
        on_error: 'fail'
      },
      {
        capability_id: 'cap.price.lookup.v1',
        inputs: (prev) => ({
          base_token: prev?.balances?.[0]?.token || 'SOL',
          quote_token: 'USD'
        }),
        on_error: 'skip'
      }
    ]);

    if (result.success) {
      console.log(`   ✓ Workflow completed in ${result.total_time_ms}ms`);
      return result.results;
    } else {
      console.log(`   ✗ Workflow failed at step ${result.failed_step}`);
      return null;
    }
  }

  // ============================================
  // A2A INTERACTIONS
  // ============================================

  async discoverPeers(): Promise<void> {
    console.log('\n🔎 Discovering peer agents...');

    try {
      const agents = await this.agent.discoverAgents({
        capability: 'cap.price.lookup.v1',
        min_trust_score: 0.5,
        limit: 5
      });

      if (agents.length > 0) {
        console.log(`   Found ${agents.length} agents:`);
        for (const a of agents) {
          console.log(`   • ${a.name} (${a.agent_id}) - Trust: ${a.trust_score}`);
        }
      } else {
        console.log('   No peer agents found');
      }
    } catch (error) {
      console.log('   Discovery unavailable');
    }
  }

  async collaborateWithAgent(targetAgent: string, capability: string, inputs: any): Promise<any> {
    console.log(`\n🤝 Collaborating with ${targetAgent}...`);

    try {
      // First, establish trust via handshake
      const handshake = await this.agent.initiateHandshake(targetAgent);
      console.log(`   Handshake initiated: ${handshake.handshake_id}`);

      // Then invoke via A2A
      const result = await this.agent.a2aInvoke({
        to_agent: targetAgent,
        capability_id: capability,
        inputs,
        timeout_ms: 30000
      });

      if (result.success) {
        console.log(`   ✓ A2A invocation successful`);
        return result.outputs;
      } else {
        console.log(`   ✗ A2A invocation failed: ${result.error}`);
        return null;
      }
    } catch (error) {
      console.error(`   A2A error:`, error instanceof Error ? error.message : error);
      return null;
    }
  }

  async startPriceAuction(token: string, maxPrice: number): Promise<void> {
    console.log(`\n🏷️  Starting auction for ${token} price data...`);

    try {
      const result = await this.agent.startAuction({
        capability_id: 'cap.price.lookup.v1',
        inputs: { base_token: token, quote_token: 'USD' },
        max_price: maxPrice,
        min_trust_score: 0.7,
        timeout_ms: 10000
      });

      if (result.winner) {
        console.log(`   Winner: ${result.winner.agent_id} at $${result.winner.bid}`);
      } else {
        console.log(`   No bids received`);
      }
      console.log(`   Total bids: ${result.bids.length}`);
    } catch (error) {
      console.log('   Auction unavailable');
    }
  }

  async checkMessages(): Promise<void> {
    try {
      const messages = await this.agent.getMessages(Date.now() - 3600000); // Last hour
      if (messages.length > 0) {
        console.log(`\n📬 ${messages.length} new messages`);
        for (const msg of messages.slice(0, 3)) {
          console.log(`   From ${msg.from_agent}: ${JSON.stringify(msg.payload).substring(0, 50)}...`);
        }
      }
    } catch {
      // Messages endpoint may not be available
    }
  }

  // ============================================
  // OBSERVABILITY
  // ============================================

  printMetrics(): void {
    const metrics = this.agent.getMetrics();
    const state = this.agent.getState();

    console.log('\n📊 Agent Metrics:');
    console.log(`   Status: ${state.status}`);
    console.log(`   Uptime: ${Math.round(metrics.uptime_ms / 1000)}s`);
    console.log(`   Invocations: ${metrics.invocations}`);
    console.log(`   Success Rate: ${(metrics.success_rate * 100).toFixed(1)}%`);
    console.log(`   Avg Latency: ${metrics.avg_latency_ms}ms`);
    console.log(`   Errors: ${metrics.errors}`);

    if (Object.keys(metrics.by_capability).length > 0) {
      console.log('\n   By Capability:');
      for (const [cap, data] of Object.entries(metrics.by_capability)) {
        console.log(`   • ${cap}: ${data.count} calls, ${data.avg_latency_ms}ms avg`);
      }
    }
  }

  printState(): void {
    const state = this.agent.getState();
    console.log('\n🔧 Agent State:');
    console.log(`   Status: ${state.status}`);
    console.log(`   Registered: ${state.registered}`);
    console.log(`   Connected: ${state.connected}`);
    console.log(`   Requests: ${state.requests_processed}`);
    console.log(`   Errors: ${state.errors_count}`);
    if (state.current_task) {
      console.log(`   Current Task: ${state.current_task}`);
    }
  }
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('       CAP-402 Production Agent Example');
  console.log('═══════════════════════════════════════════════════════════');

  const agent = new ProductionTradingAgent();
  await agent.start();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

export { ProductionTradingAgent };
