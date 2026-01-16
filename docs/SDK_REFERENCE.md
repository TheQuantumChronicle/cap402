# SDK & API Reference Guide

🌐 **Website**: [cap402.com](https://cap402.com)

Complete documentation for all external SDKs and APIs integrated into CAP-402.

---

## 🔐 Arcium MPC Network

**Status**: ✅ Real SDK integrated (`@arcium-hq/client` v0.1.47)  
**Purpose**: Confidential compute for privacy-preserving operations  
**Documentation**: https://docs.arcium.com/  
**Network**: Solana Devnet (testnet available)

### Overview
Arcium provides Multi-Party Computation (MPC) infrastructure for confidential computing on Solana. Applications can compute on encrypted data without exposing it.

### Key Concepts
- **MXE (Multi-Party eXecution Environment)**: Distributed compute clusters
- **MPC Protocols**: Cryptographic computation over encrypted data
- **Trustless Execution**: No single party can see the data
- **Byzantine Fault Tolerance**: Resilient to malicious nodes

### Integration Status
```typescript
// ✅ REAL SDK INTEGRATED
// Package: @arcium-hq/client v0.1.47
// Location: providers/arcium-client.ts
// Executor: router/execution/arcium-executor.ts

// Current: SDK initialized, ready for MXE program deployment
// To enable confidential compute:
// 1. ✅ Arcium SDK installed
// 2. ⏳ Deploy your MXE program using `arcium build` and `arcium deploy`
// 3. ⏳ Set ARCIUM_PROGRAM_ID in .env
// 4. ⏳ Configure MXE cluster ID
```

### Example Usage (Planned)
```typescript
import { ArciumClient } from '@arcium/sdk';

const client = new ArciumClient({
  cluster: 'mainnet',
  keypair: walletKeypair
});

// Execute confidential computation
const result = await client.execute({
  program: 'document-parser',
  inputs: encryptedData,
  mxe: 'privacy-cluster-1'
});
```

### Resources
- Installation: https://docs.arcium.com/developers/installation
- Examples: https://github.com/arcium-hq/examples
- Basic Concepts: https://docs.arcium.com/introduction/basic-concepts

---

## 💰 CoinMarketCap API

**Status**: ✅ Fully integrated with 3 rotating API keys  
**Purpose**: Major cryptocurrency price data  
**Documentation**: https://coinmarketcap.com/api/documentation/

### Implementation
- **File**: `providers/price.ts`
- **Endpoint**: `https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest`
- **Rate Limit**: 333 calls/day per key (999 total with 3 keys)

### Supported Tokens
- BTC, ETH, SOL, USDC, USDT
- 9000+ other cryptocurrencies

### API Response
```json
{
  "price": 142.05,
  "volume_24h": 5528731595.37,
  "market_cap": 80285316678.60,
  "percent_change_24h": 1.93
}
```

### Configuration
```bash
COINMARKETCAP_API_KEY=<key-1>
COINMARKETCAP_API_KEY_2=<key-2>
COINMARKETCAP_API_KEY_3=<key-3>
```

### Features
- Automatic key rotation
- Fallback to Solana Tracker for Solana tokens
- 5-second timeout
- Error handling with graceful degradation

---

## 🌊 Solana Tracker API

**Status**: ✅ Fully integrated with 3 rotating API keys  
**Purpose**: Solana-specific token prices  
**Documentation**: https://docs.solanatracker.io/

### Implementation
- **File**: `providers/price.ts`
- **Endpoint**: `https://api.solanatracker.io/tokens/{token}`
- **Rate Limit**: 1000 calls/day per key (3000 total)

### Supported Tokens
- BONK, WIF, JTO, PYTH, JUP, ORCA, RAY
- All SPL tokens by mint address

### API Response
```json
{
  "price": 0.000012,
  "volume24h": 1234567,
  "marketCap": 12000000,
  "priceChange24h": 5.2
}
```

### Configuration
```bash
SOLANA_TRACKER_API_KEY=<key-1>
SOLANA_TRACKER_API_KEY_2=<key-2>
SOLANA_TRACKER_API_KEY_3=<key-3>
```

### Usage
```typescript
// Automatically used for Solana tokens
const price = await integrationManager.getPrice('BONK', 'USD');
// Returns: { price, source: 'solana-tracker', ... }
```

---

## 🔮 Helius API

**Status**: ✅ Fully integrated  
**Purpose**: Comprehensive Solana wallet data, NFTs, transactions  
**Documentation**: https://www.helius.dev/docs

### Implementation
- **File**: `providers/wallet.ts`
- **Endpoint**: `https://mainnet.helius-rpc.com/?api-key={key}`
- **Rate Limit**: 100,000 calls/day

### SDK Available
```bash
npm install helius-sdk
```

### Key Methods

#### getAssetsByOwner
```typescript
const response = await axios.post(
  `https://mainnet.helius-rpc.com/?api-key=${apiKey}`,
  {
    jsonrpc: '2.0',
    method: 'getAssetsByOwner',
    params: {
      ownerAddress: address,
      page: 1,
      limit: 1000,
      displayOptions: {
        showFungible: true,
        showNativeBalance: true
      }
    }
  }
);
```

#### Transaction History
```typescript
const response = await axios.get(
  `https://api.helius.xyz/v0/addresses/${address}/transactions`,
  {
    params: {
      'api-key': apiKey,
      limit: 10
    }
  }
);
```

### Features
- Token balances with USD values
- NFT holdings with metadata
- Transaction history
- Real-time wallet snapshots
- Fallback to Alchemy RPC

### Configuration
```bash
HELius_API_KEY=<your-key>
```

### Response Format
```json
{
  "address": "82MfBWDVuG7yB5j1kxxA8RCB6vbrJCTmQbowXPmvHv7j",
  "balances": [
    {
      "token": "SOL",
      "mint": "So11111111111111111111111111111111111111112",
      "amount": 0.015,
      "decimals": 9,
      "usd_value": 2.13
    }
  ],
  "nfts": [...],
  "recent_transactions": [...]
}
```

---

## ⚡ Alchemy Solana RPC

**Status**: ✅ Fully integrated  
**Purpose**: Direct Solana blockchain access  
**Documentation**: https://docs.alchemy.com/reference/solana-api-quickstart

### Implementation
- **File**: `providers/solana-rpc.ts`
- **Endpoint**: `https://solana-mainnet.g.alchemy.com/v2/{apiKey}`
- **Rate Limit**: 300M compute units/month

### Supported Methods
- `getBalance` - SOL balance queries
- `getTokenAccountsByOwner` - Token accounts
- `getTransaction` - Transaction details
- `getSignaturesForAddress` - Transaction history
- `getAccountInfo` - Token metadata
- `sendTransaction` - Submit transactions
- `getLatestBlockhash` - Recent blockhash

### Configuration
```bash
SOLANA_RPC_URL=https://solana-mainnet.g.alchemy.com/v2/<key>
ALCHEMY_API_KEY=<your-key>
```

### Usage
```typescript
import { solanaRPC } from './providers/solana-rpc';

// Get balance
const balance = await solanaRPC.getBalance(address);

// Get transaction
const tx = await solanaRPC.getTransaction(signature);

// Get signatures
const sigs = await solanaRPC.getSignaturesForAddress(address, 10);
```

### Features
- High-performance RPC nodes
- 7 global endpoints
- Automatic failover
- Transaction confirmation
- Token metadata lookup

---

## 🐦 BirdEye WebSocket API

**Status**: ✅ Fully integrated with auto-reconnection  
**Purpose**: Real-time price streaming  
**Documentation**: https://docs.birdeye.so/docs/websocket

### Implementation
- **File**: `providers/birdeye-websocket.ts`
- **Endpoint**: `wss://public-api.birdeye.so/socket/solana?x-api-key={key}`
- **Rate Limit**: Unlimited WebSocket connections

### Connection
```typescript
import { birdEyeClient } from './providers/birdeye-websocket';

// Connect
await birdEyeClient.connect();

// Subscribe to price updates
birdEyeClient.subscribe('SOL', (update) => {
  console.log(`Price: $${update.price}`);
  console.log(`Volume 24h: $${update.volume_24h}`);
  console.log(`Change 24h: ${update.price_change_24h}%`);
});

// Unsubscribe
birdEyeClient.unsubscribe('SOL', callback);
```

### Supported Timeframes
- **Solana**: 1s, 15s, 30s, 1m, 3m, 5m, 15m, 30m, 1H, 2H, 4H, 6H, 8H, 12H, 1D, 3D, 1W, 1M
- **Other chains**: 1m to 1M

### Subscription Message
```json
{
  "type": "subscribe",
  "data": {
    "address": "So11111111111111111111111111111111111111112",
    "chainId": "solana"
  }
}
```

### Price Update Format
```json
{
  "type": "price_update",
  "data": {
    "address": "SOL",
    "value": 142.05,
    "unixTime": 1768299736203,
    "v24hUSD": 5528731595,
    "priceChange24h": 1.93
  }
}
```

### Configuration
```bash
BIRDEYE_API_KEY=<your-key>
BIRDEYE_WS_URL=wss://public-api.birdeye.so/socket/solana?x-api-key=<key>
```

### Features
- Automatic reconnection (5 attempts)
- Exponential backoff
- Multi-token subscriptions
- Ping-pong keepalive
- Error handling

---

## 🔑 Solana Web3.js

**Status**: ✅ Fully integrated  
**Purpose**: Solana blockchain interactions  
**Documentation**: https://solana-labs.github.io/solana-web3.js/

### Installation
```bash
npm install @solana/web3.js bs58
```

### Implementation
- **File**: `chain/solana-wallet.ts`
- **Version**: 1.87.6

### Key Features

#### Wallet Management
```typescript
import { Keypair, Connection } from '@solana/web3.js';
import bs58 from 'bs58';

// Load from private key
const decoded = bs58.decode(secretKey);
const keypair = Keypair.fromSecretKey(decoded);

// Get balance
const connection = new Connection(rpcUrl, 'confirmed');
const balance = await connection.getBalance(publicKey);
```

#### Send Transactions
```typescript
import { Transaction, SystemProgram } from '@solana/web3.js';

const transaction = new Transaction().add(
  SystemProgram.transfer({
    fromPubkey: keypair.publicKey,
    toPubkey: recipientPubkey,
    lamports: amount * LAMPORTS_PER_SOL
  })
);

const signature = await connection.sendTransaction(
  transaction,
  [keypair],
  { skipPreflight: false }
);
```

### Configuration
```bash
X402_SECRET=<base58-private-key>
X402_PUBLIC_KEY=<wallet-address>
```

### Current Wallet Status
- **Address**: 82MfBWDVuG7yB5j1kxxA8RCB6vbrJCTmQbowXPmvHv7j
- **Balance**: 0.015 SOL
- **Can Sign**: Yes
- **Network**: Solana Mainnet

---

## 📊 Integration Summary

| Service | Status | Purpose | Rate Limit | Keys |
|---------|--------|---------|------------|------|
| **CoinMarketCap** | ✅ Live | Major crypto prices | 999/day | 3 |
| **Solana Tracker** | ✅ Live | Solana token prices | 3000/day | 3 |
| **Helius** | ✅ Live | Wallet data & NFTs | 100k/day | 1 |
| **Alchemy** | ✅ Live | Solana RPC | 300M CU/mo | 1 |
| **BirdEye** | ✅ Live | Real-time prices | Unlimited | 1 |
| **Solana Web3** | ✅ Live | Blockchain ops | N/A | Wallet |
| **Arcium** | ✅ SDK Ready | Confidential compute | Testnet | Deploy MXE |

---

## 🚀 Next Steps for Arcium Integration

### 1. Install Arcium SDK
```bash
npm install @arcium/sdk
```

### 2. Configure MXE Connection
```typescript
import { ArciumClient } from '@arcium/sdk';

const client = new ArciumClient({
  cluster: process.env.ARCIUM_CLUSTER || 'mainnet',
  keypair: solanaWallet.keypair
});
```

### 3. Deploy Confidential Program
Follow: https://docs.arcium.com/developers/installation

### 4. Replace Mock Executor
Update `router/execution/arcium-executor.ts` with real MPC calls

### 5. Add Environment Variables
```bash
ARCIUM_CLUSTER=mainnet
ARCIUM_PROGRAM_ID=<your-program-id>
```

---

## 📚 Additional Resources

### Official Documentation
- **Arcium**: https://docs.arcium.com/
- **Helius**: https://www.helius.dev/docs
- **BirdEye**: https://docs.birdeye.so/
- **Solana**: https://solana.com/docs
- **CoinMarketCap**: https://coinmarketcap.com/api/

### GitHub Repositories
- **Arcium Examples**: https://github.com/arcium-hq/examples
- **Helius SDK**: https://github.com/helius-labs/helius-sdk
- **Solana Web3.js**: https://github.com/solana-labs/solana-web3.js

### Community
- **Arcium Discord**: https://discord.gg/arcium
- **Solana Discord**: https://discord.gg/solana
- **Helius Discord**: https://discord.gg/helius

---

## 🤖 CAP-402 Agent SDK

**Status**: ✅ Production Ready  
**Purpose**: Build autonomous agents that use CAP-402 capabilities  
**Location**: `sdk/` directory

### Installation

```typescript
import { 
  createAgent, 
  createTradingAgent, 
  createMonitoringAgent,
  createOrchestrator 
} from './sdk';
```

### Core Agent Class

The `CAP402Agent` class provides production-ready agent infrastructure:

```typescript
import { createAgent } from './sdk';

const agent = createAgent({
  agent_id: 'my-trading-agent',
  name: 'My Trading Agent',
  router_url: 'https://cap402.com',
  capabilities_provided: ['analysis.portfolio'],
  capabilities_required: ['cap.price.lookup.v1'],
  timeout: 30000,
  retry_attempts: 3
});

// Lifecycle
await agent.start();
await agent.pause();
await agent.resume();
await agent.stop();

// Invoke capabilities
const result = await agent.invoke('cap.price.lookup.v1', {
  base_token: 'SOL',
  quote_token: 'USD'
});

// A2A Protocol
const agents = await agent.discoverAgents({ capability: 'cap.swap.execute.v1' });
const auction = await agent.startAuction({ capability_id: 'cap.swap.execute.v1', max_price: 0.01 });
await agent.sendMessage('other-agent', 'collaboration', { proposal: 'joint-trade' });
```

### Features

| Feature | Description |
|---------|-------------|
| **Lifecycle Management** | start, stop, pause, resume with graceful shutdown |
| **Circuit Breakers** | Automatic failure detection and recovery |
| **Retry Logic** | Exponential backoff with configurable attempts |
| **Health Checks** | Auto-reconnection on connection loss |
| **Metrics** | Invocation counts, latency, success rates |
| **A2A Protocol** | Agent discovery, auctions, swarms, messaging |
| **Event System** | Subscribe to errors, rate limits, circuit opens |

### Agent Templates

Pre-built agents for common use cases:

#### Trading Agent
```typescript
import { createTradingAgent } from './sdk/agents';

const trader = createTradingAgent({
  agent_id: 'sol-trader',
  name: 'SOL Trading Bot',
  watched_tokens: ['SOL', 'ETH', 'BTC'],
  price_check_interval_ms: 30000,
  trading_limits: {
    max_position_size: 1000,
    max_daily_trades: 20
  },
  mev_protection: true,
  dry_run: true  // Set false for real trades
});

trader.on('signal', (signal) => console.log('Trade signal:', signal));
trader.on('price_alert', (alert) => console.log('Price alert:', alert));

await trader.start();
```

#### Monitoring Agent
```typescript
import { createMonitoringAgent } from './sdk/agents';

const monitor = createMonitoringAgent({
  agent_id: 'wallet-monitor',
  name: 'Wallet Monitor',
  watched_wallets: ['82MfBWDVuG7yB5j1kxxA8RCB6vbrJCTmQbowXPmvHv7j'],
  watched_protocols: ['jupiter', 'raydium'],
  check_interval_ms: 60000,
  thresholds: {
    balance_change_percent: 5,
    health_score_min: 70
  }
});

monitor.on('alert', (alert) => console.log('Alert:', alert));
await monitor.start();
```

#### Analytics Agent
```typescript
import { createAnalyticsAgent } from './sdk/agents';

const analytics = createAnalyticsAgent({
  agent_id: 'data-collector',
  name: 'Market Analytics',
  data_sources: [
    { id: 'sol-price', type: 'price', capability_id: 'cap.price.lookup.v1', 
      inputs: { base_token: 'SOL' }, interval_ms: 60000, enabled: true }
  ],
  report_interval_ms: 300000
});

analytics.on('report_generated', (report) => console.log('Report:', report));
await analytics.start();
```

### Multi-Agent Orchestration

Coordinate multiple agents for complex workflows:

```typescript
import { createOrchestrator } from './sdk/orchestration';

const orchestrator = createOrchestrator({
  orchestrator_id: 'swarm-coordinator',
  name: 'Trading Swarm',
  max_agents: 5
});

await orchestrator.start();

// Add specialized agents
await orchestrator.addAgent({ agent_id: 'pricer-1', name: 'Price Agent' });
await orchestrator.addAgent({ agent_id: 'pricer-2', name: 'Price Agent 2' });

// Parallel execution
const results = await orchestrator.executeParallel([
  { capability_id: 'cap.price.lookup.v1', inputs: { base_token: 'SOL' } },
  { capability_id: 'cap.price.lookup.v1', inputs: { base_token: 'ETH' } }
]);

// Consensus pricing
const consensus = await orchestrator.executeWithConsensus(
  'cap.price.lookup.v1',
  { base_token: 'SOL' },
  { min_agreement: 0.5 }
);

// Workflow execution
const workflow = orchestrator.createWorkflow('Portfolio Analysis', [
  { name: 'Get Wallet', capability_id: 'cap.wallet.snapshot.v1', inputs: { address: '...' } },
  { name: 'Get Prices', capability_id: 'cap.price.lookup.v1', inputs: { base_token: 'SOL' } }
]);
const result = await orchestrator.executeWorkflow(workflow.workflow_id);
```

### CLI Tool

Command-line interface for agent management:

```bash
# Health check
npm run cli health

# List capabilities
npm run cli capabilities

# Invoke capability
npm run cli invoke cap.price.lookup.v1 '{"base_token":"SOL"}'

# List agents
npm run cli agents

# Register agent
npm run cli register my-agent "My Agent" "cap1,cap2"

# Run examples
npm run example:trading
npm run example:monitor
npm run example:swarm
```

### Webhooks

Async notifications for agent events:

```typescript
import { createWebhookManager } from './sdk/webhooks';

const webhooks = createWebhookManager('my-agent');

webhooks.registerWebhook({
  id: 'slack-alerts',
  url: 'https://hooks.slack.com/...',
  events: ['alert', 'trade_executed'],
  enabled: true,
  secret: 'webhook-secret'
});

// Dispatch events
await webhooks.dispatch('trade_executed', { token: 'SOL', amount: 100 });
```

### Testing

Real integration testing against live router:

```typescript
import { AgentTester, runQuickTest } from './sdk/testing';

// Quick test
await runQuickTest('https://cap402.com');

// Custom test suite
const tester = new AgentTester({ router_url: 'https://cap402.com' });
await tester.connect();

await tester.runSuite({
  name: 'My Tests',
  tests: [
    {
      name: 'Price Check',
      capability_id: 'cap.price.lookup.v1',
      inputs: { base_token: 'SOL' },
      expected: { success: true, has_outputs: ['price'] }
    }
  ]
});

tester.printSummary();
await tester.disconnect();
```

---

**Last Updated**: January 16, 2026  
**CAP-402 Version**: 0.2.0
