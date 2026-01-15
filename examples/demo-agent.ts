import { createClient } from '../sdk/client';
import { Capability } from '../spec/capabilities';

class DemoAgent {
  private client = createClient('http://localhost:3402');
  private agentId = 'demo-agent-001';

  async run(): Promise<void> {
    console.log('\n🤖 CAP-402 Demo Agent Starting...\n');
    console.log(`Agent ID: ${this.agentId}`);
    console.log(`Router: http://localhost:3402\n`);

    try {
      await this.discoverPhase();
      await this.executionPhase();
      await this.compositionPhase();
      
      console.log('\n✅ Demo agent completed successfully\n');
    } catch (error) {
      console.error('\n❌ Demo agent failed:', error);
      throw error;
    }
  }

  private async discoverPhase(): Promise<void> {
    console.log('═══════════════════════════════════════');
    console.log('PHASE 1: CAPABILITY DISCOVERY');
    console.log('═══════════════════════════════════════\n');

    const capabilities = await this.client.discoverCapabilities();
    console.log(`📋 Discovered ${capabilities.length} capabilities:\n`);

    for (const cap of capabilities) {
      console.log(`  • ${cap.name} (${cap.id})`);
      console.log(`    Mode: ${cap.execution.mode}`);
      console.log(`    Cost: ${cap.economics.cost_hint} ${cap.economics.currency}`);
      console.log(`    Latency: ${cap.performance.latency_hint}`);
      console.log('');
    }

    const reasoning = this.selectCapabilitiesForTask(capabilities);
    console.log('🧠 Agent Reasoning:');
    console.log(reasoning);
    console.log('');
  }

  private selectCapabilitiesForTask(capabilities: Capability[]): string {
    return `
  Task: Analyze a wallet and assess its value
  
  Selected capabilities:
  1. cap.price.lookup.v1 - Get current token prices
  2. cap.wallet.snapshot.v1 - Get wallet holdings
  
  Reasoning:
  - Need wallet data first (snapshot)
  - Then need price data to calculate value
  - Both are public execution (low cost, high reliability)
  - Can chain outputs: wallet tokens → price lookup
    `;
  }

  private async executionPhase(): Promise<void> {
    console.log('═══════════════════════════════════════');
    console.log('PHASE 2: CAPABILITY EXECUTION');
    console.log('═══════════════════════════════════════\n');

    console.log('🔍 Invoking: cap.wallet.snapshot.v1');
    const walletResult = await this.client.invokeCapability(
      'cap.wallet.snapshot.v1',
      {
        address: 'DemoWallet123abc...',
        network: 'solana-mainnet',
        include_nfts: true,
        include_history: false
      },
      {
        latency_priority: false,
        max_cost: 0.01
      }
    );

    if (!walletResult.success) {
      throw new Error(`Wallet snapshot failed: ${walletResult.error}`);
    }

    console.log('✓ Wallet snapshot completed');
    console.log(`  Request ID: ${walletResult.request_id}`);
    console.log(`  Execution time: ${walletResult.metadata.execution.execution_time_ms}ms`);
    console.log(`  Cost: ${walletResult.metadata.execution.cost_actual} ${walletResult.metadata.execution.currency}`);
    console.log(`  Balances found: ${walletResult.outputs?.balances?.length || 0}`);
    console.log('');

    console.log('💰 Invoking: cap.price.lookup.v1');
    const priceResult = await this.client.invokeCapability(
      'cap.price.lookup.v1',
      {
        base_token: 'SOL',
        quote_token: 'USD'
      },
      {
        latency_priority: true
      }
    );

    if (!priceResult.success) {
      throw new Error(`Price lookup failed: ${priceResult.error}`);
    }

    console.log('✓ Price lookup completed');
    console.log(`  Request ID: ${priceResult.request_id}`);
    console.log(`  Price: $${priceResult.outputs?.price}`);
    console.log(`  Source: ${priceResult.outputs?.source}`);
    console.log('');

    console.log('📊 Economic Signals:');
    if (walletResult.metadata.economic_hints?.x402) {
      console.log(`  X.402 Hint ID: ${walletResult.metadata.economic_hints.x402.hint_id}`);
      console.log(`  Settlement: ${walletResult.metadata.economic_hints.x402.settlement_optional ? 'Optional' : 'Required'}`);
    }
    console.log('');

    console.log('⛓️  Chain Signals:');
    console.log(`  Signal ID: ${walletResult.metadata.chain_signal.signal_id}`);
    console.log(`  Network: ${walletResult.metadata.chain_signal.network}`);
    console.log(`  Commitment: ${walletResult.metadata.chain_signal.commitment_hash.substring(0, 16)}...`);
    console.log('');
  }

  private async compositionPhase(): Promise<void> {
    console.log('═══════════════════════════════════════');
    console.log('PHASE 3: CAPABILITY COMPOSITION');
    console.log('═══════════════════════════════════════\n');

    console.log('🔗 Chaining capabilities: wallet → price analysis\n');

    const results = await this.client.chainCapabilities([
      {
        capability_id: 'cap.wallet.snapshot.v1',
        inputs: {
          address: 'ChainedWallet456def...',
          network: 'solana-mainnet',
          include_nfts: false,
          include_history: false
        }
      },
      {
        capability_id: 'cap.price.lookup.v1',
        inputs: (prevOutput: any) => ({
          base_token: prevOutput.balances[0].token,
          quote_token: 'USD'
        })
      }
    ]);

    console.log('✓ Pipeline completed successfully');
    console.log(`  Total steps: ${results.length}`);
    console.log(`  Total cost: ${results.reduce((sum, r) => sum + (r.metadata.execution.cost_actual || 0), 0)} SOL`);
    console.log('');

    console.log('🎯 Final Analysis:');
    const walletData = results[0].outputs;
    const priceData = results[1].outputs;
    
    if (walletData && priceData) {
      const totalValue = walletData.balances.reduce((sum: number, b: any) => {
        return sum + (b.amount * (b.token === priceData.base_token ? priceData.price : 0));
      }, 0);
      
      console.log(`  Wallet: ${walletData.address}`);
      console.log(`  Primary Token: ${priceData.base_token} @ $${priceData.price}`);
      console.log(`  Estimated Value: $${totalValue.toFixed(2)}`);
    }
    console.log('');
  }
}

async function main() {
  const agent = new DemoAgent();
  await agent.run();
}

if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { DemoAgent };
