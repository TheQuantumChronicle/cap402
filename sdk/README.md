# @cap402/sdk

**Privacy-first agent infrastructure for autonomous AI agents.**

CAP-402 is the execution monetization layer that enables agents to discover, invoke, and pay for capabilities with built-in privacy guarantees.

## Installation

```bash
npm install @cap402/sdk
# or
yarn add @cap402/sdk
# or
pnpm add @cap402/sdk
```

## Quick Start

```typescript
import { createClient, getPrice, invoke } from '@cap402/sdk';

// One-liner: Get SOL price
const price = await getPrice('SOL');
console.log(`SOL: $${price.price}`);

// Create a client for more control
const client = createClient({
  routerUrl: 'https://api.cap402.com', // or your self-hosted router
  apiKey: 'your-api-key' // optional
});

// Discover available capabilities
const capabilities = await client.discoverCapabilities();

// Invoke a capability
const result = await client.invokeCapability('cap.price.lookup.v1', {
  base_token: 'SOL',
  quote_token: 'USD'
});
```

## Core Features

### 🔒 Privacy-First Execution

```typescript
// Confidential swap - amounts hidden from MEV
const swap = await client.invokeCapability('cap.confidential.swap.v1', {
  input_token: 'SOL',
  output_token: 'USDC',
  amount: 100,
  wallet_address: 'your-wallet'
});
// Returns encrypted amounts + ZK proof
```

### 🤖 Agent Framework

```typescript
import { createAgent } from '@cap402/sdk';

const agent = createAgent({
  name: 'TradingBot',
  capabilities: ['cap.price.lookup.v1', 'cap.swap.execute.v1'],
  trustLevel: 2
});

// Register with the network
await agent.register();

// Invoke capabilities as the agent
const result = await agent.invoke('cap.price.lookup.v1', { base_token: 'ETH' });
```

### 🔐 Zero-Knowledge Proofs

```typescript
// Prove KYC compliance without revealing data
const proof = await client.invokeCapability('cap.zk.proof.v1', {
  circuit: 'kyc_compliance',
  private_inputs: {
    country_code: 'US',
    age: 25,
    accredited: true
  },
  public_inputs: {
    allowed_countries: ['US', 'UK', 'DE'],
    min_age: 18
  }
});
// Returns: { valid: true, proof: '0x...', public_outputs: [...] }
// Verifier learns: "User is compliant" but NOT their actual data
```

### 🧠 Private AI Inference

```typescript
// Run AI models with encrypted inputs
const result = await client.invokeCapability('cap.ai.inference.v1', {
  model: 'sentiment-analysis',
  input: 'Analyze this confidential document...',
  privacy_level: 2 // Encrypted execution
});
// Your prompt and data never exposed
```

## Available Capabilities

| Capability | Description | Privacy |
|------------|-------------|---------|
| `cap.price.lookup.v1` | Real-time token prices | Public |
| `cap.wallet.snapshot.v1` | Wallet balances & NFTs | Public |
| `cap.swap.execute.v1` | Token swaps via Jupiter | Public |
| `cap.confidential.swap.v1` | Private swaps (hidden amounts) | L2 |
| `cap.zk.proof.v1` | Zero-knowledge proofs | L2 |
| `cap.zk.proof.balance.v1` | Prove balance threshold | L2 |
| `cap.cspl.wrap.v1` | Wrap tokens as confidential | L2 |
| `cap.cspl.transfer.v1` | Confidential token transfer | L2 |
| `cap.fhe.compute.v1` | Fully homomorphic encryption | L3 |
| `cap.ai.inference.v1` | Private AI model execution | L2 |
| `cap.ai.embedding.v1` | Private vector embeddings | L2 |
| `cap.zk.kyc.v1` | Private KYC verification | L2 |
| `cap.zk.credential.v1` | Private credential proofs | L2 |

## Integration Examples

### AutoGPT Integration

```typescript
import { CAP402Tool } from '@cap402/sdk/integrations/autogpt';

// Add CAP-402 as an AutoGPT tool
const cap402Tool = new CAP402Tool({
  routerUrl: 'https://api.cap402.com'
});

// AutoGPT can now use: "Use CAP-402 to get SOL price"
```

### LangChain Integration

```typescript
import { CAP402Toolkit } from '@cap402/sdk/integrations/langchain';

const toolkit = new CAP402Toolkit({
  routerUrl: 'https://api.cap402.com'
});

// Returns LangChain-compatible tools
const tools = toolkit.getTools();
```

### CrewAI Integration

```typescript
import { CAP402Agent } from '@cap402/sdk/integrations/crewai';

const cap402Agent = new CAP402Agent({
  role: 'Market Analyst',
  capabilities: ['cap.price.lookup.v1', 'cap.wallet.snapshot.v1']
});
```

## Privacy Levels

| Level | Name | Technology | Use Case |
|-------|------|------------|----------|
| L0 | Public | None | Price feeds, public data |
| L1 | Pseudonymous | Encryption | Basic privacy |
| L2 | Confidential | Arcium MPC / Noir ZK | Trading, KYC proofs |
| L3 | Maximum | Inco FHE | Full encryption |

## Configuration

```typescript
const client = createClient({
  // Required
  routerUrl: 'https://api.cap402.com',
  
  // Optional
  apiKey: process.env.CAP402_API_KEY,
  timeout: 30000,
  retries: 3,
  
  // Agent identity (for A2A protocol)
  agentId: 'agent_abc123',
  agentSecret: process.env.AGENT_SECRET
});
```

## Self-Hosting

Run your own CAP-402 router:

```bash
git clone https://github.com/cap402/cap402.git
cd cap402
npm install
cp .env.example .env
# Configure API keys in .env
npm run start:dev
```

## Links

- **Website**: [cap402.com](https://cap402.com)
- **Demo**: [atracks.xyz](https://atracks.xyz)
- **Docs**: [cap402.com/docs](https://cap402.com/docs)
- **GitHub**: [github.com/cap402](https://github.com/cap402)

## License

MIT
