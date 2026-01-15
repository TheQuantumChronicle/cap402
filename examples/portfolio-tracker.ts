import { CAP402Client } from '../sdk/client';

// Example: Portfolio tracking agent
async function portfolioTracker() {
  const cap402 = new CAP402Client({
    baseUrl: 'http://localhost:3001',
    timeout: 10000,
    retries: 3,
  });

  console.log('📈 Portfolio Tracker Agent\n');

  const walletAddress = '82MfBWDVuG7yB5j1kxxA8RCB6vbrJCTmQbowXPmvHv7j';

  // Get wallet data
  const wallet = await cap402.getWallet(walletAddress);
  
  console.log(`Wallet: ${walletAddress.slice(0, 8)}...${walletAddress.slice(-8)}\n`);

  // Calculate portfolio value
  let totalValue = 0;

  for (const balance of wallet.balances) {
    const price = await cap402.getPrice(balance.token, 'USD');
    const value = balance.amount * price;
    totalValue += value;

    console.log(`${balance.token}:`);
    console.log(`  Amount: ${balance.amount}`);
    console.log(`  Price: $${price.toFixed(2)}`);
    console.log(`  Value: $${value.toFixed(2)}\n`);
  }

  console.log(`Total Portfolio Value: $${totalValue.toFixed(2)}`);

  // Performance metrics
  const metrics = await cap402.getMetrics();
  console.log(`\nAPI Performance:`);
  console.log(`  Total Requests: ${metrics.system.total_requests}`);
  console.log(`  Requests/min: ${metrics.system.requests_per_minute}`);
  console.log(`  Uptime: ${Math.floor(metrics.system.uptime_seconds / 60)} minutes`);
}

portfolioTracker().catch(console.error);
