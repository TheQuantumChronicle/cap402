# CAP-402 Architecture

🌐 **Website**: [cap402.com](https://cap402.com)

## System Overview

CAP-402 is a multi-layer protocol for semantic capability routing between autonomous agents.

## Layer 1: Capability Schema

**Location**: `spec/`

The capability schema is the foundation. Every capability is a formal contract with:

- **Identity**: Stable ID (e.g., `cap.price.lookup.v1`)
- **Interface**: Typed inputs/outputs (JSON Schema)
- **Execution**: Mode (public/confidential) + proof type
- **Economics**: Cost hints, currency, payment methods
- **Performance**: Latency, reliability, throughput SLAs

**Design Decision**: Schema-first approach ensures capabilities are semantic, not implementation-specific.

## Layer 2: Reference Router

**Location**: `router/`

The router is the orchestration layer:

### Registry (`registry.ts`)
- Maintains capability definitions
- Provides discovery by tag, mode, etc.
- Validates capability IDs

### Router (`router.ts`)
- Validates inputs against schema
- Selects appropriate executor
- Generates economic hints
- Emits chain signals
- Returns normalized responses

**Design Decision**: Router is opinionated but replaceable. Future versions could be decentralized.

## Layer 3: Execution Layer

**Location**: `router/execution/`

Executors are pluggable implementations:

### Public Executor (`public-executor.ts`)
- Handles public capabilities
- Calls provider APIs
- Returns standard execution results

### Arcium Executor (`arcium-executor.ts`)
- Handles confidential capabilities
- Simulates MPC execution (v0.1)
- Generates cryptographic proofs
- Returns execution + attestation

**Design Decision**: Executor interface is abstract. New executors can be added without changing router logic.

## Layer 4: Provider Layer

**Location**: `providers/`

Providers are the actual implementation of capability logic:

- **Price Provider**: Real API calls to CoinMarketCap, Solana Tracker with fallback
- **Wallet Provider**: Real Helius DAS API integration
- **Document Provider**: Arcium MPC integration
- **AI Inference Provider**: Private AI execution via Arcium MPC (sentiment, classification, embeddings)
- **KYC Provider**: Zero-knowledge proofs via Noir (age, jurisdiction, accreditation verification)

**Design Decision**: All providers are REAL integrations with graceful fallback for rate limits.

## Layer 5: Economic Layer

**Location**: `router/payments/`

Economic signaling is non-custodial and optional:

### X.402 Hints (`x402.ts`)
- Ephemeral payer addresses
- Suggested amounts
- Settlement optional
- Multiple payment methods

### Privacy Cash (`privacy-cash.ts`)
- Private note references
- Amount commitments (Pedersen-style)
- Nullifier hints
- Zero-knowledge compatible

**Design Decision**: Hints, not enforcement. Agents can choose to pay or not. No custody, ever.

## Layer 6: Chain Signaling

**Location**: `chain/`

Usage signals are emitted for future verification:

- Capability ID + Request ID + Timestamp
- Commitment hash (SHA-256)
- Network identifier (Solana devnet)
- Verifiable without revealing inputs/outputs

**Design Decision**: Signaling-first, settlement-later. Commitments prove usage without on-chain execution.

## Layer 7: SDK

**Location**: `sdk/`

Agent-facing SDK abstracts complexity:

- `discoverCapabilities()`: Find available capabilities
- `invokeCapability()`: Execute a capability
- `chainCapabilities()`: Pipeline multiple capabilities

**Design Decision**: SDK should feel obvious to agent developers. Hide router complexity.

## Data Flow

```
1. Agent discovers capabilities via SDK
   ↓
2. Agent invokes capability with inputs + preferences
   ↓
3. Router validates inputs against schema
   ↓
4. Router selects executor based on capability mode
   ↓
5. Executor calls provider implementation
   ↓
6. Provider returns outputs
   ↓
7. Executor wraps outputs with metadata (proofs, cost, etc.)
   ↓
8. Router generates economic hints (X.402, Privacy Cash)
   ↓
9. Router emits chain signal (usage commitment)
   ↓
10. Router returns normalized response to SDK
    ↓
11. SDK returns to agent
```

## Key Design Principles

### 1. Separation of Concerns
- Schema ≠ Router ≠ Executor ≠ Provider
- Each layer is replaceable independently

### 2. Privacy as First-Class
- Public and confidential execution coexist
- Privacy is opt-in, not mandatory
- Proofs are generated and verifiable

### 3. Economics Without Custody
- Hints guide behavior
- No intermediary holds funds
- Settlement is optional

### 4. Chain-Ready, Not Chain-Dependent
- Usage signals can be verified on-chain
- But execution doesn't require chain interaction
- Future: ZK proofs, on-chain settlement

### 5. Extensibility
- New capabilities: Add to schema
- New executors: Implement executor interface
- New payment methods: Add to economic layer
- New chains: Add to signaling module

## Security Model

### v0.1 (Current)
- Schema validation prevents malformed inputs
- Executor isolation prevents cross-contamination
- Mock proofs demonstrate future security

### v0.2 (Planned)
- Real Arcium MPC for confidential execution
- Cryptographic proof verification
- On-chain capability registry

### v1.0 (Future)
- Decentralized router network
- ZK proof verification on-chain
- Slashing for malicious executors
- Agent reputation system

## Performance Considerations

### Latency
- Public execution: 50-200ms (mock)
- Confidential execution: 500-1500ms (mock)
- Real Arcium: TBD based on MPC overhead

### Throughput
- Router: Stateless, horizontally scalable
- Executors: Can be parallelized
- Providers: Rate-limited by external APIs

### Cost
- Public capabilities: 0.0001-0.001 SOL
- Confidential capabilities: 0.01+ SOL
- Actual costs depend on provider pricing

## Future Architecture Evolution

### Phase 1: Real Integrations
- Replace mock providers with real APIs
- Integrate actual Arcium MPC
- Deploy to testnet

### Phase 2: Decentralization
- Multiple router instances
- Capability registry on-chain
- Executor reputation system

### Phase 3: Protocol Standard
- Formal specification document
- Reference implementations in multiple languages
- Compliance tooling

## Comparison to Alternatives

### vs Direct API Calls
- CAP-402: Semantic, versioned, privacy-aware
- Direct: Tight coupling, no privacy, no standards

### vs Traditional Service Mesh
- CAP-402: Agent-first, economic signals, chain-ready
- Service Mesh: Infrastructure-first, no economics, no chain

### vs Smart Contract Calls
- CAP-402: Off-chain execution, flexible, low latency
- Smart Contracts: On-chain only, rigid, high latency

## Why This Architecture Matters

1. **Agents need standards**: As AI agents proliferate, they need a common language
2. **Privacy is essential**: Many agent use cases require confidential compute
3. **Economics drive behavior**: Payment hints align incentives without custody
4. **Chains enable trust**: Usage commitments provide verifiability

CAP-402 is the first protocol to combine all four.
