#!/usr/bin/env npx ts-node
/**
 * Multi-Agent Swarm Example
 * 
 * Demonstrates coordinating multiple agents working together on complex tasks.
 * Uses REAL data and actual agent coordination.
 * 
 * Usage:
 *   npx ts-node examples/multi-agent-swarm.ts
 */

import { createOrchestrator, MultiAgentOrchestrator } from '../sdk/orchestration/multi-agent';

// ============================================
// CONFIGURATION
// ============================================

const ROUTER_URL = process.env.CAP402_ROUTER || 'https://cap402.com';

// ============================================
// SWARM DEMO
// ============================================

class MultiAgentSwarmDemo {
  private orchestrator: MultiAgentOrchestrator;

  constructor() {
    this.orchestrator = createOrchestrator({
      orchestrator_id: `swarm-coordinator-${Date.now()}`,
      name: 'Multi-Agent Swarm Demo',
      router_url: ROUTER_URL,
      max_agents: 5,
      task_timeout_ms: 30000,
      retry_failed_tasks: true
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.orchestrator.on('agent_added', ({ agent_id }) => {
      console.log(`   ✓ Agent joined: ${agent_id}`);
    });

    this.orchestrator.on('task_started', ({ task_id, agent_id }) => {
      console.log(`   → Task ${task_id} started by ${agent_id}`);
    });

    this.orchestrator.on('task_completed', ({ task_id, success, duration_ms }) => {
      const icon = success ? '✓' : '✗';
      console.log(`   ${icon} Task ${task_id} completed (${duration_ms}ms)`);
    });

    this.orchestrator.on('workflow_completed', (result) => {
      console.log(`\n   Workflow ${result.workflow_id}: ${result.success ? 'SUCCESS' : 'FAILED'}`);
      console.log(`   Tasks: ${result.tasks_completed} completed, ${result.tasks_failed} failed`);
      console.log(`   Duration: ${result.duration_ms}ms`);
    });
  }

  async start(): Promise<void> {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('           Multi-Agent Swarm Demo');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`\n📡 Router: ${ROUTER_URL}\n`);

    await this.orchestrator.start();
  }

  async stop(): Promise<void> {
    await this.orchestrator.stop();
    console.log('\n✅ Swarm demo completed\n');
  }

  // ============================================
  // DEMO 1: PARALLEL PRICE FETCHING
  // ============================================

  async demoParallelPrices(): Promise<void> {
    console.log('\n─────────────────────────────────────────');
    console.log('Demo 1: Parallel Price Fetching');
    console.log('─────────────────────────────────────────\n');

    // Add specialized price agents
    await this.orchestrator.addAgent({
      agent_id: 'price-agent-1',
      name: 'Price Agent 1',
      capabilities_provided: ['cap.price.lookup.v1']
    }, {
      role_id: 'pricer',
      capabilities: ['cap.price.lookup.v1'],
      priority: 1
    });

    await this.orchestrator.addAgent({
      agent_id: 'price-agent-2',
      name: 'Price Agent 2',
      capabilities_provided: ['cap.price.lookup.v1']
    }, {
      role_id: 'pricer',
      capabilities: ['cap.price.lookup.v1'],
      priority: 1
    });

    // Fetch multiple prices in parallel
    const tokens = ['SOL', 'ETH', 'BTC', 'BONK', 'JUP', 'PYTH'];
    console.log(`Fetching prices for: ${tokens.join(', ')}\n`);

    const startTime = Date.now();
    const result = await this.orchestrator.executeParallel(
      tokens.map(token => ({
        capability_id: 'cap.price.lookup.v1',
        inputs: { base_token: token, quote_token: 'USD' }
      }))
    );

    console.log(`\n📊 Results (${Date.now() - startTime}ms total):`);
    result.results.forEach((r, i) => {
      if (r.success && r.outputs) {
        console.log(`   ${tokens[i]}: $${r.outputs.price?.toLocaleString() || 'N/A'}`);
      } else {
        console.log(`   ${tokens[i]}: Failed`);
      }
    });

    console.log(`\n   Success: ${result.results.filter(r => r.success).length}/${tokens.length}`);
  }

  // ============================================
  // DEMO 2: CONSENSUS PRICING
  // ============================================

  async demoConsensusPricing(): Promise<void> {
    console.log('\n─────────────────────────────────────────');
    console.log('Demo 2: Consensus Pricing');
    console.log('─────────────────────────────────────────\n');

    // Add more agents for consensus
    await this.orchestrator.addAgent({
      agent_id: 'price-agent-3',
      name: 'Price Agent 3',
      capabilities_provided: ['cap.price.lookup.v1']
    });

    console.log('Getting consensus price for SOL from 3 agents...\n');

    const result = await this.orchestrator.executeWithConsensus(
      'cap.price.lookup.v1',
      { base_token: 'SOL', quote_token: 'USD' },
      { min_agreement: 0.5 }
    );

    console.log(`   Consensus: ${result.consensus ? 'YES' : 'NO'}`);
    console.log(`   Agreement Rate: ${(result.agreement_rate * 100).toFixed(0)}%`);
    console.log(`   Responses: ${result.responses.length}`);
    
    if (result.agreed_value) {
      console.log(`   Agreed Price: $${result.agreed_value.price?.toLocaleString() || 'N/A'}`);
    }

    console.log('\n   Individual responses:');
    for (const response of result.responses) {
      console.log(`   • ${response.agent_id}: $${response.value.price?.toLocaleString() || 'N/A'}`);
    }
  }

  // ============================================
  // DEMO 3: WORKFLOW EXECUTION
  // ============================================

  async demoWorkflow(): Promise<void> {
    console.log('\n─────────────────────────────────────────');
    console.log('Demo 3: Multi-Step Workflow');
    console.log('─────────────────────────────────────────\n');

    // Add a wallet analysis agent
    await this.orchestrator.addAgent({
      agent_id: 'wallet-agent',
      name: 'Wallet Analyzer',
      capabilities_provided: ['cap.wallet.snapshot.v1']
    }, {
      role_id: 'analyzer',
      capabilities: ['cap.wallet.snapshot.v1'],
      priority: 2
    });

    // Create a workflow: Get wallet → Get prices for tokens found
    const workflow = this.orchestrator.createWorkflow('Portfolio Analysis', [
      {
        name: 'Get Wallet Snapshot',
        capability_id: 'cap.wallet.snapshot.v1',
        inputs: {
          address: '82MfBWDVuG7yB5j1kxxA8RCB6vbrJCTmQbowXPmvHv7j',
          network: 'solana-mainnet'
        }
      },
      {
        name: 'Get SOL Price',
        capability_id: 'cap.price.lookup.v1',
        inputs: { base_token: 'SOL', quote_token: 'USD' },
        depends_on: [] // Can run in parallel with wallet
      },
      {
        name: 'Get ETH Price',
        capability_id: 'cap.price.lookup.v1',
        inputs: { base_token: 'ETH', quote_token: 'USD' },
        depends_on: []
      }
    ]);

    console.log(`Executing workflow: ${workflow.name}`);
    console.log(`Tasks: ${workflow.tasks.length}\n`);

    const result = await this.orchestrator.executeWorkflow(workflow.workflow_id);

    console.log('\n📊 Workflow Results:');
    console.log(`   Success: ${result.success}`);
    console.log(`   Tasks Completed: ${result.tasks_completed}`);
    console.log(`   Duration: ${result.duration_ms}ms`);

    // Show results
    if (result.results) {
      console.log('\n   Task Outputs:');
      for (const [taskId, output] of Object.entries(result.results)) {
        const shortId = taskId.split('_')[1];
        if (output && typeof output === 'object') {
          if ('price' in output) {
            console.log(`   • Task ${shortId}: Price = $${output.price?.toLocaleString()}`);
          } else if ('address' in output) {
            console.log(`   • Task ${shortId}: Wallet ${output.address?.substring(0, 8)}...`);
          } else {
            console.log(`   • Task ${shortId}: ${JSON.stringify(output).substring(0, 50)}...`);
          }
        }
      }
    }
  }

  // ============================================
  // DEMO 4: SPECIALIZED AGENT ROLES
  // ============================================

  async demoSpecializedRoles(): Promise<void> {
    console.log('\n─────────────────────────────────────────');
    console.log('Demo 4: Specialized Agent Roles');
    console.log('─────────────────────────────────────────\n');

    // Add specialized agents with different roles
    await this.orchestrator.addAgent({
      agent_id: 'mev-specialist',
      name: 'MEV Protection Specialist',
      capabilities_provided: ['cap.mev.analyze.v1']
    }, {
      role_id: 'mev-protector',
      capabilities: ['cap.mev.analyze.v1'],
      priority: 10 // High priority for MEV tasks
    });

    console.log('Agent roles configured:');
    const agents = this.orchestrator.listAgents();
    for (const agentId of agents) {
      console.log(`   • ${agentId}`);
    }

    // Dispatch a task that requires MEV analysis
    console.log('\nDispatching MEV analysis task...\n');

    const task = {
      task_id: `mev-task-${Date.now()}`,
      name: 'Analyze MEV Risk',
      capability_id: 'cap.mev.analyze.v1',
      inputs: {
        token_in: 'SOL',
        token_out: 'USDC',
        amount: 1000,
        slippage: 0.5
      },
      status: 'pending' as const
    };

    try {
      const result = await this.orchestrator.dispatchTask(task);
      
      if (result.success && result.outputs) {
        console.log('   MEV Analysis Results:');
        console.log(`   • Risk Level: ${result.outputs.risk_level || 'unknown'}`);
        console.log(`   • Sandwich Probability: ${((result.outputs.sandwich_probability || 0) * 100).toFixed(0)}%`);
        console.log(`   • Recommendation: ${result.outputs.recommendation || 'N/A'}`);
      }
    } catch (error) {
      console.log(`   MEV analysis not available: ${error}`);
    }
  }

  // ============================================
  // RUN ALL DEMOS
  // ============================================

  async runAllDemos(): Promise<void> {
    try {
      await this.start();

      await this.demoParallelPrices();
      await this.demoConsensusPricing();
      await this.demoWorkflow();
      await this.demoSpecializedRoles();

      // Print final stats
      const stats = this.orchestrator.getStats();
      console.log('\n═══════════════════════════════════════════════════════════');
      console.log('           Final Statistics');
      console.log('═══════════════════════════════════════════════════════════');
      console.log(`   Agents Used: ${stats.agents}`);
      console.log(`   Workflows Executed: ${stats.workflows}`);
      console.log(`   Workflows Completed: ${stats.workflows_completed}`);
      console.log(`   Workflows Failed: ${stats.workflows_failed}`);

    } finally {
      await this.stop();
    }
  }
}

// ============================================
// MAIN
// ============================================

async function main(): Promise<void> {
  const demo = new MultiAgentSwarmDemo();
  await demo.runAllDemos();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
