# CAP-402 Quick Start Guide

🌐 **Website**: [cap402.com](https://cap402.com)

## Installation

```bash
cd CAP-402
npm install
```

## Running the System

### 1. Start the Reference Router

```bash
npm start
```

The router will start on `http://localhost:3402`

### 2. Run the Demo Agent (in a new terminal)

```bash
npm run demo
```

## Testing the API

### Discover Capabilities

```bash
curl http://localhost:3402/capabilities
```

### Get Specific Capability

```bash
curl http://localhost:3402/capabilities/cap.price.lookup.v1
```

### Invoke a Capability

```bash
curl -X POST http://localhost:3402/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "capability_id": "cap.price.lookup.v1",
    "inputs": {
      "base_token": "SOL",
      "quote_token": "USD"
    },
    "preferences": {
      "latency_priority": true
    }
  }'
```

### Invoke Wallet Snapshot

```bash
curl -X POST http://localhost:3402/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "capability_id": "cap.wallet.snapshot.v1",
    "inputs": {
      "address": "YourWalletAddress123",
      "network": "solana-mainnet",
      "include_nfts": true
    }
  }'
```

### Invoke Confidential Document Parse

```bash
curl -X POST http://localhost:3402/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "capability_id": "cap.document.parse.v1",
    "inputs": {
      "document_url": "https://example.com/doc.pdf",
      "extraction_schema": {
        "fields": [
          {"name": "title", "type": "string"},
          {"name": "amount", "type": "number"}
        ]
      }
    },
    "preferences": {
      "privacy_required": true
    }
  }'
```

## Project Structure

```
CAP-402/
├── spec/                    # Capability schema definitions
│   ├── capabilities.schema.json
│   └── capabilities.ts
├── router/                  # Reference router implementation
│   ├── server.ts           # HTTP API server
│   ├── registry.ts         # Capability registry
│   ├── router.ts           # Core routing logic
│   ├── execution/          # Execution layer
│   │   ├── public-executor.ts
│   │   ├── arcium-executor.ts
│   │   └── types.ts
│   ├── payments/           # Economic layer
│   │   ├── x402.ts
│   │   └── privacy-cash.ts
│   └── observability.ts
├── providers/              # Mock provider implementations
│   ├── price.ts
│   ├── wallet.ts
│   └── document.ts
├── sdk/                    # Client SDK
│   ├── client.ts
│   └── types.ts
├── demo-agent/            # Demo autonomous agent
│   └── agent.ts
└── chain/                 # Chain signaling
    └── usage-signal.ts
```

## Key Concepts

### Capabilities
Semantic contracts that define what can be done, not how to do it.

### Execution Modes
- **Public**: Standard API/RPC execution
- **Confidential**: Arcium MPC execution with proofs

### Economic Hints
- **X.402**: Payment hints with ephemeral addresses
- **Privacy Cash**: Private payment notes

### Chain Signals
Usage commitments emitted to Solana for future verification

## Next Steps

1. Explore the capability schema in `spec/capabilities.ts`
2. Add new capabilities by extending the schema
3. Implement custom executors in `router/execution/`
4. Build your own agent using the SDK in `sdk/client.ts`

## For Hackathon Judges

This is a production-ready protocol foundation, not a demo:
- Formal capability schema with JSON Schema validation
- Modular execution layer (public + confidential)
- Non-custodial economic signaling (X.402 + Privacy Cash)
- Chain-ready usage commitments
- Clean SDK for agent developers

See README.md for full technical details and roadmap.
