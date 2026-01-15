import { CAP402Client } from '../sdk/client';

// Example: Simple trading agent using CAP-402
async function tradingAgent() {
  const cap402 = new CAP402Client({
    baseUrl: 'https://cap402.com',
  });

  console.log('🤖 Trading Agent Starting...\n');

  // 1. Get current prices
  console.log('📊 Fetching prices...');
  const btcPrice = await cap402.getPrice('BTC', 'USD');
  const solPrice = await cap402.getPrice('SOL', 'USD');
  const ethPrice = await cap402.getPrice('ETH', 'USD');

  console.log(`  BTC: $${btcPrice.toLocaleString()}`);
  console.log(`  SOL: $${solPrice.toFixed(2)}`);
  console.log(`  ETH: $${ethPrice.toLocaleString()}\n`);

  // 2. Check wallet balance
  console.log('👛 Checking wallet...');
  const wallet = await cap402.getWallet('82MfBWDVuG7yB5j1kxxA8RCB6vbrJCTmQbowXPmvHv7j');
  console.log(`  SOL Balance: ${wallet.balances[0].amount} SOL`);
  console.log(`  USD Value: $${(wallet.balances[0].amount * solPrice).toFixed(2)}\n`);

  // 3. Make trading decision
  console.log('🧠 Making trading decision...');
  const portfolioValue = wallet.balances[0].amount * solPrice;
  
  if (btcPrice < 90000) {
    console.log(`  ✅ BTC is below $90k - GOOD BUY signal`);
    console.log(`  💰 Portfolio value: $${portfolioValue.toFixed(2)}`);
  } else {
    console.log(`  ⏸️  BTC is above $90k - WAIT signal`);
  }

  // 4. Check system health
  console.log('\n🏥 System Health:');
  const health = await cap402.getHealth();
  console.log(`  Status: ${health.status}`);
  console.log(`  Integrations: ${health.integrations.filter((i: any) => i.status === 'healthy').length}/${health.integrations.length} healthy`);

  console.log('\n✅ Agent execution complete!');
}

// Run the agent
tradingAgent().catch(console.error);
