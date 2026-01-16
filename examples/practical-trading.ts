/**
 * Practical Trading Examples
 * 
 * Real-world use cases for traders, devs, and protocols.
 * No fluff - just what you need to execute trades on Solana.
 */

import { createTradingAgent } from '../sdk/agents';

// ============================================
// USE CASE 1: Simple DCA Bot
// Buy $50 of SOL every hour, protected from MEV
// ============================================

async function dcaBot() {
  const bot = createTradingAgent({
    agent_id: 'dca-bot',
    name: 'DCA Bot',
    watched_tokens: ['SOL'],
    mev_protection: true,
    instant_mode: { enabled: true, skip_mev_under_usd: 100 }
  });

  // Execute DCA purchase
  const result = await bot.instantSwap('USDC', 'SOL', 50);
  
  console.log(`Bought ${result.amount_out} SOL for $50`);
  console.log(`Execution: ${result.latency_ms}ms`);
  
  return result;
}

// ============================================
// USE CASE 2: Arbitrage Scanner
// Monitor price differences, execute when profitable
// ============================================

async function arbScanner() {
  const bot = createTradingAgent({
    agent_id: 'arb-scanner',
    name: 'Arb Scanner',
    watched_tokens: ['SOL', 'USDC', 'USDT'],
    instant_mode: { enabled: true, max_latency_ms: 500 }
  });

  // Warm up for fastest execution
  await bot.warmUp([
    { tokenIn: 'USDC', tokenOut: 'SOL' },
    { tokenIn: 'SOL', tokenOut: 'USDT' },
    { tokenIn: 'USDT', tokenOut: 'USDC' }
  ]);

  // Start background refresh to keep routes hot
  bot.startBackgroundRefresh(5000);

  // When arb opportunity detected, execute instantly
  bot.on('signal', async (signal) => {
    if (signal.type === 'buy' && signal.confidence > 80) {
      // Race execution for fastest fill
      const result = await bot.raceSwap('USDC', signal.token, 1000);
      console.log(`Arb executed in ${result.latency_ms}ms via ${result.winning_method}`);
    }
  });

  await bot.start();
}

// ============================================
// USE CASE 3: Whale Trade with Privacy
// Large trade that needs MEV protection + stealth
// ============================================

async function whaleTrade() {
  const bot = createTradingAgent({
    agent_id: 'whale-trader',
    name: 'Whale Trader',
    watched_tokens: ['SOL'],
    mev_protection: true,
    stealth_mode: {
      enabled: true,
      auto_privacy_threshold_usd: 10000,
      auto_split_threshold_usd: 50000,
      randomize_timing: true
    }
  });

  // Analyze before executing
  const analysis = await bot.analyzeStealthOptions('SOL', 'USDC', 500);
  console.log(`MEV Risk: ${analysis.mev_risk.risk}`);
  console.log(`Potential Loss: $${analysis.mev_risk.potential_loss_usd}`);
  console.log(`Recommended: ${analysis.recommendation} privacy`);

  // Execute with stealth (auto-splits if needed)
  const result = await bot.stealthTrade('SOL', 'USDC', 500, {
    privacy_level: 'maximum'
  });

  console.log(`Executed ${result.chunks.length} chunks`);
  console.log(`MEV Savings: $${result.mev_savings_usd}`);
  console.log(`Total received: ${result.total_output} USDC`);
}

// ============================================
// USE CASE 4: Market Maker Bot
// Provide liquidity, respond to quotes
// ============================================

async function marketMaker() {
  const bot = createTradingAgent({
    agent_id: 'mm-bot',
    name: 'Market Maker',
    watched_tokens: ['SOL', 'ETH', 'BTC'],
    instant_mode: { enabled: true }
  });

  // Respond to A2A quote requests
  bot.on('a2a_quote_request', async (request) => {
    const { token_in, token_out, amount } = request;
    
    // Calculate quote with spread
    const prices = bot.getPrices();
    const marketPrice = prices.get(token_in)?.price || 100;
    const spread = 0.001; // 0.1% spread
    const quotePrice = marketPrice * (1 + spread);
    
    // Log the quote (in production, send via A2A)
    console.log(`Quote: ${amount} ${token_in} @ ${quotePrice} = ${amount / quotePrice} ${token_out}`);
  });

  await bot.start();
}

// ============================================
// USE CASE 5: Protocol Integration
// Integrate CAP-402 into your protocol
// ============================================

async function protocolIntegration() {
  const bot = createTradingAgent({
    agent_id: 'protocol-agent',
    name: 'Protocol Agent',
    watched_tokens: ['SOL'],
    router_url: 'https://cap402.com' // Production router
  });

  // Simple swap for your users
  async function swapForUser(userWallet: string, tokenIn: string, tokenOut: string, amount: number) {
    const prepared = await bot.prepareSwap(tokenIn, tokenOut, amount);
    
    // Return transaction for user to sign
    return {
      transaction: prepared.serialized_transaction,
      summary: prepared.summary.headline,
      mev_risk: prepared.mev_risk,
      expires_at: prepared.expires_at
    };
  }

  // Get best price across DEXs and A2A
  async function getBestPrice(tokenIn: string, tokenOut: string, amount: number) {
    const [dexQuote, a2aPartners] = await Promise.all([
      bot.prepareSwap(tokenIn, tokenOut, amount),
      bot.findTradingPartners(tokenIn, tokenOut, amount)
    ]);

    const bestA2A = a2aPartners[0];
    
    if (bestA2A && bestA2A.quote.amount_out > dexQuote.expected_out) {
      return { source: 'a2a', quote: bestA2A.quote };
    }
    return { source: 'dex', quote: dexQuote };
  }
}

// ============================================
// QUICK REFERENCE: One-Liners
// ============================================

async function quickReference() {
  const bot = createTradingAgent({
    agent_id: 'quick',
    name: 'Quick',
    watched_tokens: ['SOL']
  });

  // Get price
  const prices = bot.getPrices();
  const price = prices.get('SOL')?.price;

  // Instant swap (fastest)
  await bot.instantSwap('SOL', 'USDC', 10);

  // Protected swap (MEV safe)
  await bot.prepareSwap('SOL', 'USDC', 10);

  // Stealth swap (private)
  await bot.stealthTrade('SOL', 'USDC', 100, { privacy_level: 'maximum' });

  // Race swap (fastest path wins)
  await bot.raceSwap('SOL', 'USDC', 10);

  // Check latency stats
  const stats = bot.getLatencyStats();
  console.log(`Avg: ${stats.avg_ms}ms, P95: ${stats.p95_ms}ms`);
}

export {
  dcaBot,
  arbScanner,
  whaleTrade,
  marketMaker,
  protocolIntegration,
  quickReference
};
