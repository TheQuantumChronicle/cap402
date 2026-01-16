#!/usr/bin/env npx ts-node
/**
 * CAP-402 Trade CLI
 * 
 * Fast, practical trading from the command line.
 * 
 * Usage:
 *   npx ts-node cli/trade.ts swap SOL USDC 10
 *   npx ts-node cli/trade.ts price SOL
 *   npx ts-node cli/trade.ts analyze SOL USDC 100
 */

import { createTradingAgent } from '../sdk/agents';

const ROUTER_URL = process.env.CAP402_ROUTER || 'http://localhost:3001';

async function main() {
  const [,, command, ...args] = process.argv;

  const bot = createTradingAgent({
    agent_id: 'cli-trader',
    name: 'CLI Trader',
    watched_tokens: ['SOL', 'USDC', 'ETH'],
    router_url: ROUTER_URL,
    instant_mode: { enabled: true, skip_mev_under_usd: 500 }
  });

  switch (command) {
    case 'swap':
    case 's': {
      const [tokenIn, tokenOut, amount] = args;
      if (!tokenIn || !tokenOut || !amount) {
        console.log('Usage: trade swap <tokenIn> <tokenOut> <amount>');
        console.log('Example: trade swap SOL USDC 10');
        process.exit(1);
      }
      
      console.log(`⚡ Swapping ${amount} ${tokenIn} → ${tokenOut}...`);
      const start = Date.now();
      
      const result = await bot.instantSwap(tokenIn, tokenOut, parseFloat(amount));
      
      if (result.status === 'executed') {
        console.log(`✅ Success in ${result.latency_ms}ms`);
        console.log(`   Received: ${result.amount_out} ${tokenOut}`);
        console.log(`   Price: ${result.execution_price}`);
        if (result.tx_signature) {
          console.log(`   Tx: ${result.tx_signature}`);
        }
      } else {
        console.log(`❌ Failed: ${result.error}`);
      }
      break;
    }

    case 'stealth':
    case 'st': {
      const [tokenIn, tokenOut, amount] = args;
      if (!tokenIn || !tokenOut || !amount) {
        console.log('Usage: trade stealth <tokenIn> <tokenOut> <amount>');
        process.exit(1);
      }
      
      console.log(`🥷 Stealth swap ${amount} ${tokenIn} → ${tokenOut}...`);
      
      const result = await bot.stealthTrade(tokenIn, tokenOut, parseFloat(amount), {
        privacy_level: 'maximum'
      });
      
      console.log(`✅ Completed in ${result.execution_time_ms}ms`);
      console.log(`   Chunks: ${result.chunks.length}`);
      console.log(`   Received: ${result.total_output} ${tokenOut}`);
      console.log(`   MEV Savings: $${result.mev_savings_usd.toFixed(2)}`);
      console.log(`   Features: ${result.stealth_features_used.join(', ')}`);
      break;
    }

    case 'analyze':
    case 'a': {
      const [tokenIn, tokenOut, amount] = args;
      if (!tokenIn || !tokenOut || !amount) {
        console.log('Usage: trade analyze <tokenIn> <tokenOut> <amount>');
        process.exit(1);
      }
      
      console.log(`📊 Analyzing ${amount} ${tokenIn} → ${tokenOut}...`);
      
      const analysis = await bot.analyzeStealthOptions(tokenIn, tokenOut, parseFloat(amount));
      
      console.log(`\nTrade: ${analysis.trade.amount} ${tokenIn} (~$${analysis.trade.usd_value.toFixed(0)})`);
      console.log(`MEV Risk: ${analysis.mev_risk.risk}`);
      console.log(`Potential Loss: $${analysis.mev_risk.potential_loss_usd}`);
      console.log(`\nOptions:`);
      
      for (const opt of analysis.options) {
        console.log(`  ${opt.level.toUpperCase()}: ${opt.method}`);
        console.log(`    Protection: ${opt.protection_percent}%`);
        console.log(`    Cost: $${opt.estimated_cost_usd.toFixed(2)}`);
        console.log(`    Net Benefit: $${opt.net_benefit_usd.toFixed(2)}`);
      }
      
      console.log(`\n✨ Recommendation: ${analysis.recommendation}`);
      if (analysis.split_recommended) {
        console.log(`   Split into ${analysis.recommended_chunks} chunks`);
      }
      break;
    }

    case 'price':
    case 'p': {
      const [token] = args;
      if (!token) {
        console.log('Usage: trade price <token>');
        process.exit(1);
      }
      
      await bot.warmUp([{ tokenIn: token, tokenOut: 'USDC' }]);
      const prices = bot.getPrices();
      const priceData = prices.get(token);
      
      if (priceData) {
        console.log(`${token}: $${priceData.price.toFixed(2)}`);
      } else {
        console.log(`Price not available for ${token}`);
      }
      break;
    }

    case 'stats': {
      const stats = bot.getInstantStats();
      const latency = bot.getLatencyStats();
      
      console.log('📈 Trading Stats:');
      console.log(`   Cached Routes: ${stats.cached_routes}`);
      console.log(`   Cached Prices: ${stats.cached_prices}`);
      console.log(`   Avg Latency: ${latency.avg_ms}ms`);
      console.log(`   P95 Latency: ${latency.p95_ms}ms`);
      console.log(`   Samples: ${latency.samples}`);
      break;
    }

    default:
      console.log('CAP-402 Trade CLI\n');
      console.log('Commands:');
      console.log('  swap <in> <out> <amount>     Fast swap (instant mode)');
      console.log('  stealth <in> <out> <amount>  Private swap (MEV protected)');
      console.log('  analyze <in> <out> <amount>  Analyze trade options');
      console.log('  price <token>                Get current price');
      console.log('  stats                        Show trading stats');
      console.log('\nExamples:');
      console.log('  trade swap SOL USDC 10');
      console.log('  trade stealth SOL USDC 100');
      console.log('  trade analyze SOL USDC 1000');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
