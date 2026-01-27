# CAP-402: Agent Infrastructure Standard

## A Protocol for Semantic Capability Routing Between Autonomous Agents

**Version 1.0** | January 2026

🌐 **Website**: [cap402.com](https://cap402.com)

---

## Abstract

As autonomous AI agents proliferate across industries, a critical infrastructure gap has emerged: there is no standard protocol for agents to discover, negotiate, and execute capabilities from other agents or services. CAP-402 addresses this gap by introducing a semantic capability routing protocol that provides privacy-aware, economically-signaled execution with verifiable receipts.

CAP-402 uniquely combines three complementary cryptographic technologies—**Noir** for zero-knowledge proofs, **Arcium** for confidential computation, and **Inco** for encrypted on-chain state—to deliver a complete privacy stack that enables fully private, verifiable, agent-driven authorization and execution.

This whitepaper presents the CAP-402 protocol specification, its architecture, security model, and economic framework. We demonstrate how CAP-402 enables a new paradigm where **agents do not call APIs directly—agents call capabilities**.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Problem Statement](#2-problem-statement)
3. [Protocol Overview](#3-protocol-overview)
4. [Architecture](#4-architecture)
5. [Cryptographic Foundation](#5-cryptographic-foundation)
6. [Privacy Gradient](#6-privacy-gradient)
7. [Capability Schema](#7-capability-schema)
8. [Economic Model](#8-economic-model)
9. [Security Framework](#9-security-framework)
10. [Advanced Features](#10-advanced-features)
11. [Implementation](#11-implementation)
12. [Use Cases](#12-use-cases)
13. [Market Opportunity](#13-market-opportunity)
14. [Roadmap](#14-roadmap)
15. [Conclusion](#15-conclusion)

---

## 1. Introduction

The emergence of autonomous AI agents represents a fundamental shift in how software systems interact. Unlike traditional APIs designed for human developers, agent-to-agent communication requires:

- **Semantic understanding**: Agents need to discover capabilities by intent, not by endpoint
- **Privacy preservation**: Sensitive operations must be executable without exposing data
- **Economic coordination**: Agents must negotiate costs and value exchange
- **Verifiability**: Execution results must be provable and auditable
- **Composability**: Complex workflows must be expressible as capability chains

CAP-402 provides the infrastructure layer that enables all of these requirements through a unified protocol.

### 1.1 Design Principles

1. **Capabilities over APIs**: Abstract what can be done, not how it's implemented
2. **Privacy by default**: Support confidential execution as a first-class feature
3. **Economic signaling**: Enable value exchange without custody
4. **Verifiable execution**: Every invocation produces a cryptographic receipt
5. **Progressive decentralization**: Start centralized, evolve to fully decentralized

### 1.2 Key Innovation

CAP-402's primary differentiator is its unified privacy stack. While most applications choose a single privacy technology, CAP-402 integrates three complementary systems:

| Technology | Role | Output |
|------------|------|--------|
| **Noir** | Proves private facts | ZK Proofs |
| **Arcium** | Decides privately using hidden logic | Signed Decisions |
| **Inco** | Stores & executes privately on-chain | Encrypted State |

This combination enables capabilities that are impossible with any single technology alone.

---

## 2. Problem Statement

### 2.1 The Current Landscape

Today's agent ecosystem suffers from critical limitations:

| Problem | Impact |
|---------|--------|
| **No discovery standard** | Agents must hard-code API endpoints |
| **No privacy layer** | All operations are visible, enabling front-running |
| **No economic coordination** | Ad-hoc pricing, no micropayments |
| **No trust framework** | No way to verify agent capabilities |
| **No composability** | Each integration built from scratch |

### 2.2 The Privacy Crisis

Traditional blockchain applications leak everything:

- **Trading strategies** — Competitors can copy or front-run
- **User balances** — Portfolio exposure to adversaries
- **Order logic** — MEV bots exploit visible intents
- **Risk models** — Proprietary algorithms become public
- **AI prompts/weights** — Intellectual property exposed

This transparency is a non-starter for:
- Institutional trading operations
- AI agent deployments
- Compliance-heavy applications
- Private user data handling

### 2.3 Consequences

Without a standard protocol:

- **MEV extraction**: Trading agents lose $500+ per large swap to front-runners
- **Data exposure**: Portfolio queries reveal positions to competitors
- **Vendor lock-in**: Agents tied to specific service providers
- **Integration overhead**: 10x development time for each new capability
- **Trust vacuum**: No reputation system for agent reliability

### 2.4 The CAP-402 Solution

CAP-402 introduces a semantic capability layer with integrated privacy infrastructure:

```
┌─────────────┐     ┌─────────────────────────────────┐     ┌─────────────┐
│   Agent A   │────▶│         CAP-402 Router          │────▶│  Service X  │
└─────────────┘     │  ┌─────────────────────────┐   │     └─────────────┘
                    │  │   Privacy Stack          │   │     ┌─────────────┐
┌─────────────┐     │  │  ┌─────┐ ┌──────┐ ┌────┐│   │────▶│  Service Y  │
│   Agent B   │────▶│  │  │Noir │ │Arcium│ │Inco││   │     └─────────────┘
└─────────────┘     │  │  └─────┘ └──────┘ └────┘│   │     ┌─────────────┐
                    │  └─────────────────────────┘   │────▶│  Service Z  │
                    └─────────────────────────────────┘     └─────────────┘
```

---

## 3. Protocol Overview

### 3.1 Core Concepts

#### Capability
A versioned, semantic contract defining:
- **Identity**: Stable ID (e.g., `cap.price.lookup.v1`)
- **Interface**: Typed inputs/outputs (JSON Schema)
- **Execution**: Mode (public/confidential) + proof type
- **Economics**: Cost hints, currency, payment methods

#### Invocation
A request to execute a capability with specific inputs, returning:
- **Outputs**: Capability-specific results
- **Receipt**: Cryptographic proof of execution
- **Economic hints**: Payment information

#### Composition
Chaining multiple capabilities into a single workflow with:
- Automatic data flow between steps
- Error handling and rollback
- Single receipt for entire chain

### 3.2 Protocol Flow

```
1. Discovery    Agent queries: "I need to swap tokens privately"
                Router returns: [cap.confidential.swap.v1, cap.cspl.wrap.v1, ...]

2. Negotiation  Agent requests options for cap.confidential.swap.v1
                Router returns: [{privacy: 2, cost: 0.01}, {privacy: 3, cost: 0.05}]

3. Invocation   Agent invokes with selected option
                Router executes via appropriate executor

4. Receipt      Agent receives cryptographic receipt
                Receipt can be verified without re-execution

5. Settlement   Economic hints enable payment (X.402 or on-chain)
```

---

## 4. Architecture

### 4.1 Layer Model

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                         │
│              (Agents, SDKs, Integrations)                   │
├─────────────────────────────────────────────────────────────┤
│                    Protocol Layer                            │
│     (Capability Schema, Routing, Composition, Receipts)     │
├─────────────────────────────────────────────────────────────┤
│                    Execution Layer                           │
│        (Public Executor, Confidential Executor)             │
├─────────────────────────────────────────────────────────────┤
│                    Privacy Layer                             │
│         (Noir ZK Proofs, Arcium MPC, Inco FHE)             │
├─────────────────────────────────────────────────────────────┤
│                    Security Layer                            │
│   (Tokens, Trust Network, Handshake, Semantic Encryption)   │
├─────────────────────────────────────────────────────────────┤
│                    Economic Layer                            │
│           (X.402 Hints, Privacy Cash, Pricing)              │
├─────────────────────────────────────────────────────────────┤
│                    Settlement Layer                          │
│              (Solana, Future: Multi-chain)                  │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Detailed Request Flow

```
                                    CAP-402 INVOCATION FLOW
                                    ═══════════════════════

    ┌──────────┐                                                    ┌──────────────┐
    │  Agent   │                                                    │   Provider   │
    │          │                                                    │   (DEX/API)  │
    └────┬─────┘                                                    └──────┬───────┘
         │                                                                 │
         │ 1. POST /invoke                                                 │
         │    {capability_id, inputs, preferences}                         │
         ▼                                                                 │
    ┌─────────────────────────────────────────────────────────────────────┐│
    │                         CAP-402 ROUTER                              ││
    │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ ││
    │  │   Schema    │  │   Route     │  │  Security   │  │  Economic  │ ││
    │  │ Validation  │─▶│  Selection  │─▶│   Check     │─▶│   Hints    │ ││
    │  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘ ││
    │         │                │                │                │        ││
    │         ▼                ▼                ▼                ▼        ││
    │  ┌──────────────────────────────────────────────────────────────┐  ││
    │  │                    EXECUTOR SELECTION                         │  ││
    │  │  ┌─────────────────┐              ┌─────────────────────┐    │  ││
    │  │  │ PUBLIC EXECUTOR │              │ CONFIDENTIAL EXECUTOR│    │  ││
    │  │  │                 │              │                     │    │  ││
    │  │  │ • Direct API    │              │ • Arcium MPC        │    │  ││
    │  │  │ • Helius DAS    │              │ • Noir ZK Proofs    │    │  ││
    │  │  │ • Price Feeds   │              │ • Inco FHE          │    │  ││
    │  │  └────────┬────────┘              └──────────┬──────────┘    │  ││
    │  └───────────┼──────────────────────────────────┼───────────────┘  ││
    │              │                                  │                   ││
    └──────────────┼──────────────────────────────────┼───────────────────┘│
                   │                                  │                    │
                   │ 2a. Public                       │ 2b. Confidential   │
                   │     Execution                    │     Execution      │
                   ▼                                  ▼                    │
         ┌─────────────────┐              ┌─────────────────────┐         │
         │   API/RPC Call  │              │   PRIVACY STACK     │         │
         │                 │              │  ┌───────────────┐  │         │
         │  Helius, CMC,   │              │  │     Noir      │  │         │
         │  Jupiter, etc.  │              │  │  (ZK Proofs)  │  │         │
         └────────┬────────┘              │  └───────┬───────┘  │         │
                  │                       │          ▼          │         │
                  │                       │  ┌───────────────┐  │         │
                  │                       │  │    Arcium     │  │         │
                  │                       │  │ (MPC Compute) │  │         │
                  │                       │  └───────┬───────┘  │         │
                  │                       │          ▼          │         │
                  │                       │  ┌───────────────┐  │         │
                  │                       │  │     Inco      │  │         │
                  │                       │  │ (FHE State)   │  │         │
                  │                       │  └───────┬───────┘  │         │
                  │                       └──────────┼──────────┘         │
                  │                                  │                    │
                  │◀─────────────────────────────────┘                    │
                  │                                                       │
                  │ 3. Generate Receipt                                   │
                  ▼                                                       │
         ┌─────────────────┐                                              │
         │ RECEIPT MANAGER │                                              │
         │                 │                                              │
         │ • Commitment    │                                              │
         │ • Proof         │                                              │
         │ • Chain Signal  │                                              │
         └────────┬────────┘                                              │
                  │                                                       │
                  │ 4. Response                                           │
                  ▼                                                       │
    ┌──────────┐                                                          │
    │  Agent   │◀─────────────────────────────────────────────────────────┘
    │          │  {success, outputs, receipt, economic_hints}
    └──────────┘
```

### 4.3 Component Overview

| Component | Purpose | Implementation |
|-----------|---------|----------------|
| **Registry** | Stores capability definitions | In-memory + future on-chain |
| **Router** | Routes invocations to executors | Express.js middleware chain |
| **Public Executor** | Standard API/RPC execution | Axios HTTP client |
| **Confidential Executor** | Privacy-preserving via Arcium MPC | Arcium SDK |
| **Receipt Manager** | Generates and verifies receipts | HMAC-SHA256 signatures |
| **Token Manager** | Issues and validates capability tokens | JWT-like tokens |
| **Trust Network** | Manages agent reputation | Graph-based scoring |
| **Rate Limiter** | Prevents abuse | Token bucket algorithm |
| **Circuit Breaker** | Handles failures gracefully | State machine pattern |

### 4.4 Data Flow Diagram

```
                              DATA FLOW ARCHITECTURE
    ┌─────────────────────────────────────────────────────────────────────┐
    │                                                                     │
    │   ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐        │
    │   │ Agent 1 │    │ Agent 2 │    │ Agent 3 │    │ Agent N │        │
    │   └────┬────┘    └────┬────┘    └────┬────┘    └────┬────┘        │
    │        │              │              │              │              │
    │        └──────────────┴──────────────┴──────────────┘              │
    │                              │                                      │
    │                              ▼                                      │
    │                    ┌─────────────────┐                             │
    │                    │   LOAD BALANCER │                             │
    │                    │   (Future: DNS) │                             │
    │                    └────────┬────────┘                             │
    │                             │                                       │
    │              ┌──────────────┼──────────────┐                       │
    │              ▼              ▼              ▼                       │
    │      ┌───────────┐  ┌───────────┐  ┌───────────┐                  │
    │      │  Router 1 │  │  Router 2 │  │  Router N │                  │
    │      │  (Primary)│  │ (Replica) │  │ (Replica) │                  │
    │      └─────┬─────┘  └─────┬─────┘  └─────┬─────┘                  │
    │            │              │              │                         │
    │            └──────────────┴──────────────┘                         │
    │                           │                                        │
    │         ┌─────────────────┼─────────────────┐                     │
    │         ▼                 ▼                 ▼                     │
    │  ┌────────────┐   ┌────────────┐   ┌────────────┐                │
    │  │   CACHE    │   │  REGISTRY  │   │   QUEUE    │                │
    │  │  (Redis)   │   │ (Postgres) │   │  (Redis)   │                │
    │  │            │   │            │   │            │                │
    │  │ • Prices   │   │ • Caps     │   │ • Pending  │                │
    │  │ • Sessions │   │ • Agents   │   │ • Retries  │                │
    │  │ • Tokens   │   │ • Trust    │   │ • Batches  │                │
    │  └────────────┘   └────────────┘   └────────────┘                │
    │                                                                   │
    │         ┌─────────────────────────────────────┐                  │
    │         │          EXECUTOR POOL              │                  │
    │         │  ┌─────────┐ ┌─────────┐ ┌───────┐ │                  │
    │         │  │ Public  │ │ Arcium  │ │ Inco  │ │                  │
    │         │  │Executor │ │Executor │ │Executor│ │                  │
    │         │  └────┬────┘ └────┬────┘ └───┬───┘ │                  │
    │         └───────┼───────────┼──────────┼─────┘                  │
    │                 │           │          │                         │
    │                 ▼           ▼          ▼                         │
    │         ┌───────────────────────────────────┐                   │
    │         │        EXTERNAL PROVIDERS         │                   │
    │         │  Helius │ CMC │ Jupiter │ Arcium  │                   │
    │         └───────────────────────────────────┘                   │
    │                                                                  │
    └──────────────────────────────────────────────────────────────────┘
```

---

## 5. Cryptographic Foundation

CAP-402's privacy guarantees are built on three complementary cryptographic systems. Understanding their distinct roles is essential to appreciating the protocol's capabilities.

### 5.1 Noir — Zero-Knowledge Proof Generation

**What It Is**: Noir is a domain-specific programming language designed for writing zero-knowledge programs—code that can prove something is true without revealing the underlying data.

**Technical Foundation**:
- Rust-inspired syntax optimized for ZK circuit development
- Compiles to ACIR (Abstract Circuit Intermediate Representation)
- Backend-agnostic: supports PLONK, Groth16, and other proving systems
- Developer-friendly abstractions over complex cryptographic primitives

**Role in CAP-402**:

Noir answers the question: *"Can you prove you're allowed to do this?"*

```
User generates ZK proof that:
  → They own a specific credential
  → Their balance exceeds a threshold
  → Their identity satisfies a condition
  
Result: Verifier learns ONLY that the condition is satisfied
        No wallet balances, identities, or secrets exposed
```

**Key Properties**:
- **Privacy**: Secrets never leave the prover's device
- **Verifiability**: Proofs are mathematically sound
- **Portability**: Proofs can be verified anywhere (browser, on-chain, backend)

**Why It Matters**: Traditional verification requires exposing data. Noir enables verification without disclosure—essential for compliance, creditworthiness checks, and identity verification in agent workflows.

---

### 5.2 Arcium — Confidential Computation

**What It Is**: Arcium provides encrypted compute on-chain. Unlike traditional blockchains where data and computation are public, Arcium enables computation on encrypted data while keeping inputs private and producing verifiable results.

**Technical Foundation**:
- Multi-Party Computation (MPC) across distributed nodes
- Confidential Programs (CPs) execute in encrypted environments
- No single node ever sees raw data
- Cryptographic proofs of correct execution

**Mental Model**:

```
User → encrypts data
         ↓
Arcium network → computes on encrypted data
         ↓
Result → decrypted only by authorized party
         ↓
Blockchain → verifies computation happened correctly
```

**Role in CAP-402**:

Arcium answers the question: *"Given everything we know privately, should this be allowed?"*

```
Arcium receives:
  → Verified Noir proof
  → Encrypted strategy state
  → Encrypted thresholds and parameters
  
Arcium computes:
  → Whether request satisfies all private rules
  
Result: ALLOW or DENY (signed/attested)
        Nobody learns: strategy details, thresholds, 
        risk models, or why it passed/failed
```

**What Arcium Protects**:
- Authorization rules and logic
- Risk checks and thresholds
- Strategy conditions
- AI/scoring logic
- User behavior signals

**Why It Matters**: Without Arcium, all decision logic is public. Attackers can game thresholds, clone logic, and probe edge cases. With Arcium, the decision engine itself is opaque—only the yes/no result emerges.

**Important Clarification**: Arcium is NOT a privacy coin, mixer, or simple ZK system. It's distributed MPC with cryptographic guarantees and blockchain verifiability.

---

### 5.3 Inco — Confidential On-Chain State

**What It Is**: Inco is the confidentiality layer for Web3—infrastructure that enables private smart contracts and encrypted on-chain state without sacrificing composability.

**Technical Foundation**:
- **Inco Lightning**: Fast privacy via Trusted Execution Environments (TEEs)
- **Inco Atlas** (upcoming): Fully Homomorphic Encryption (FHE) + MPC
- Solidity-compatible development
- Selective access control for compliance

**Role in CAP-402**:

Inco answers the question: *"Where do we safely store and execute this without leaking it on-chain?"*

```
If authorization ALLOWED:
  → Inco executes the action
  → Updates private balances
  → Updates private usage counters
  → Updates private permissions
  → Stores everything confidentially
  
Public visibility: Only that something happened
                   NOT what or why
```

**What Inco Enables**:
- Confidential token balances (ERC-20 with hidden amounts)
- Private DeFi positions (lending, AMMs, dark pools)
- Hidden game logic (card hands, random outcomes)
- Selective disclosure (auditors see data, public doesn't)
- Confidential payroll and voting systems

**Why It Matters**: Even with private proofs (Noir) and private decisions (Arcium), on-chain state exposure defeats privacy. Inco ensures the entire execution path—from authorization to settlement—remains confidential.

---

### 5.4 Concrete Example: Private AI Trading Agent

To illustrate how all three technologies work together, consider a real-world scenario:

**Scenario**: An AI trading agent needs to execute a large swap, but only if:
- User owns a specific NFT credential
- Daily risk exposure is below the limit
- Strategy confidence exceeds threshold
- Internal compliance rules are satisfied

**Without CAP-402**: All checks are public. Attackers can:
- Game the thresholds by probing edge cases
- Clone the strategy logic
- Front-run trades based on visible conditions
- Infer portfolio positions from transaction patterns

**With CAP-402's Privacy Stack**:

```
┌─────────────────────────────────────────────────────────────────┐
│ STEP 1: Noir (Proof Layer)                                      │
├─────────────────────────────────────────────────────────────────┤
│ User generates ZK proof that:                                   │
│   • They own NFT credential X                                   │
│   • Their identity satisfies KYC requirements                   │
│   • Their personal risk tolerance allows this trade             │
│                                                                 │
│ OUTPUT: Compact proof (no secrets revealed)                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 2: Arcium (Decision Layer)                                 │
├─────────────────────────────────────────────────────────────────┤
│ Arcium receives:                                                │
│   • Verified Noir proof                                         │
│   • Encrypted strategy parameters                               │
│   • Encrypted risk thresholds                                   │
│   • Encrypted daily exposure counters                           │
│                                                                 │
│ Arcium computes (on encrypted data):                            │
│   • Is risk_exposure < daily_limit?                             │
│   • Is strategy_confidence > threshold?                         │
│   • Do all compliance rules pass?                               │
│                                                                 │
│ OUTPUT: ALLOW (signed attestation)                              │
│ LEAKED: Nothing about thresholds, strategy, or why it passed    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 3: Inco (Execution Layer)                                  │
├─────────────────────────────────────────────────────────────────┤
│ If ALLOW:                                                       │
│   • Execute swap with hidden amount                             │
│   • Update encrypted daily exposure counter                     │
│   • Update encrypted position balances                          │
│   • Log encrypted audit trail                                   │
│                                                                 │
│ PUBLIC VISIBILITY: "A transaction occurred"                     │
│ HIDDEN: Amount, strategy, positions, exposure, everything else  │
└─────────────────────────────────────────────────────────────────┘
```

**Result**: 
- Zero MEV extraction (amount hidden)
- Strategy remains proprietary
- Compliance is verifiable without surveillance
- Competitors learn nothing about positions or logic

---

### 5.5 The Unified Privacy Architecture

**The One-Sentence Mental Model**:

> *Noir proves things privately, Arcium decides things privately, Inco stores and executes things privately.*

**Why All Three Are Required**:

| Technology | What Happens If Removed |
|------------|------------------------|
| **Noir** | Cannot generate portable proofs; users must expose data to prove conditions |
| **Arcium** | Decision logic becomes public; strategies can be copied or gamed |
| **Inco** | On-chain state leaks; execution results expose private information |

**The Complete Flow**:

```
User / Agent
     │
     │ 1️⃣ Proves something privately (identity, limits, ownership)
     ↓
Noir ZK Proof
     │
     │ 2️⃣ Proof + encrypted context sent to private decision logic
     ↓
Arcium Confidential Program
     │
     │ 3️⃣ Decision + state update in confidential execution layer
     ↓
Inco Confidential Contract
     │
     │ 4️⃣ Minimal result exposed on-chain
     ↓
Transaction Executes (or fails)
```

**CAP-402's Differentiator**: Most applications choose one privacy technology. CAP-402 combines proof-based authorization, private decision engines, and confidential execution into one unified intent standard. This is rare positioning in the market.

---

## 6. Privacy Gradient

### 6.1 Privacy Levels

CAP-402 introduces a 4-level privacy gradient that maps to the cryptographic foundation:

| Level | Name | Technology | Description | Cost Multiplier |
|-------|------|------------|-------------|-----------------|
| 0 | **Public** | Direct execution | Standard execution, visible results | 1.0x |
| 1 | **Obscured** | Router attestation | Basic obfuscation, limited visibility | 1.1x |
| 2 | **Encrypted** | Arcium MPC | Strong encryption, authorized access only | 1.5x |
| 3 | **ZK Verifiable** | Noir + Inco | Zero-knowledge proofs, maximum privacy | 2.0x |

### 6.2 Privacy Selection

Agents can negotiate privacy levels based on their requirements:

```json
{
  "capability_id": "cap.wallet.snapshot.v1",
  "negotiate": {
    "privacy": {
      "minimum_level": 2,
      "prefer_cheapest": true
    }
  }
}
```

### 6.3 Proof Types by Level

| Level | Proof Type | Verification |
|-------|------------|--------------|
| 0 | None | Direct result |
| 1 | Delivery Receipt | Router signature |
| 2 | Arcium Attestation | MPC consensus |
| 3 | ZK-SNARK | On-chain verification |

---

## 7. Capability Schema

### 7.1 Schema Definition

Every capability follows a formal schema:

```typescript
interface Capability {
  id: string;              // e.g., "cap.price.lookup.v1"
  name: string;            // Human-readable name
  description: string;     // What this capability does
  version: string;         // Semantic version
  
  execution: {
    mode: "public" | "confidential";
    proof_type: ProofType;
    timeout_ms: number;
  };
  
  inputs: {
    schema: JSONSchema;
    required: string[];
  };
  
  outputs: {
    schema: JSONSchema;
  };
  
  economics: {
    cost_hint: string;
    currency: string;
    payment_methods: string[];
  };
}
```

### 7.2 Capability Categories

| Category | Examples | Execution Mode | Privacy Stack |
|----------|----------|----------------|---------------|
| **Price Data** | `cap.price.lookup.v1` | Public | — |
| **Wallet Operations** | `cap.wallet.snapshot.v1` | Public/Confidential | Inco |
| **Confidential Compute** | `cap.fhe.compute.v1` | Confidential | Inco FHE |
| **Private Swaps** | `cap.confidential.swap.v1` | Confidential | Arcium MPC |
| **ZK Proofs** | `cap.zk.proof.balance.v1` | Confidential | Noir |
| **Messaging** | `cap.lightning.message.v1` | Confidential | Inco + Arcium |
| **Private AI** | `cap.ai.inference.v1`, `cap.ai.embedding.v1` | Confidential | Arcium MPC |
| **Private KYC** | `cap.zk.kyc.v1`, `cap.zk.credential.v1` | Confidential | Noir ZK |

### 7.3 Versioning

Capabilities use semantic versioning:
- **Major**: Breaking changes to inputs/outputs
- **Minor**: New optional features
- **Patch**: Bug fixes, no interface changes

---

## 8. Economic Model

### 8.1 Cost Structure

Capability costs are influenced by:
- **Base cost**: Minimum execution cost
- **Privacy multiplier**: Higher privacy = higher cost
- **Trust discount**: Trusted agents get reduced rates
- **Composition discount**: Batched calls get 10% off

### 8.2 Trust-Based Pricing

| Trust Level | Rate Limit | Discount |
|-------------|------------|----------|
| Anonymous | 10 req/min | 0% |
| Verified | 50 req/min | 10% |
| Trusted | 200 req/min | 20% |
| Premium | 1000 req/min | 50% |

### 8.3 Payment Methods

CAP-402 supports multiple payment mechanisms:

1. **X.402 Payment Hints**: HTTP-native micropayments
2. **Privacy Cash**: Anonymous payment notes
3. **On-chain Settlement**: Solana SPL tokens
4. **Subscription**: Pre-paid capability bundles

### 8.4 Economic Hints

Every invocation returns economic hints:

```json
{
  "economic_hints": {
    "x402": {
      "payment_address": "CAP402...",
      "amount": "0.001",
      "currency": "SOL"
    },
    "privacy_cash": {
      "note_hash": "0x...",
      "denomination": "0.001"
    }
  }
}
```

---

## 9. Security Framework

### 9.1 Authentication Layers

```
┌─────────────────────────────────────────────┐
│           Multi-Layer Security              │
├─────────────────────────────────────────────┤
│ Layer 1: API Key Authentication             │
│          - Agent identity verification      │
├─────────────────────────────────────────────┤
│ Layer 2: Capability Tokens                  │
│          - Fine-grained access control      │
│          - Scoped to specific capabilities  │
├─────────────────────────────────────────────┤
│ Layer 3: Handshake Protocol                 │
│          - Multi-step authentication        │
│          - Required for confidential ops    │
├─────────────────────────────────────────────┤
│ Layer 4: Semantic Encryption                │
│          - Payload-level encryption         │
│          - Intent obfuscation               │
└─────────────────────────────────────────────┘
```

### 9.2 Capability Tokens

Tokens provide fine-grained access:

```typescript
interface CapabilityToken {
  token_id: string;
  agent_id: string;
  capabilities: string[];      // Scoped capabilities
  permissions: {
    can_invoke: boolean;
    can_compose: boolean;
    can_delegate: boolean;
    max_invocations_per_hour: number;
  };
  expires_at: number;
  signature: string;           // HMAC-SHA256
}
```

### 9.3 Trust Network

Decentralized reputation system:

- **Endorsements**: Agents vouch for each other
- **Violations**: Bad behavior reduces trust
- **Decay**: Trust scores decay without activity
- **Thresholds**: Minimum trust for certain capabilities

### 9.4 Security Properties

| Property | Mechanism |
|----------|-----------|
| **Timing-safe comparisons** | `crypto.timingSafeEqual` for all secrets |
| **Request signing** | HMAC-SHA256 signatures |
| **Input sanitization** | XSS/injection prevention |
| **Rate limiting** | IP + agent-based limits |
| **Audit logging** | Full event trail |

---

## 10. Advanced Features

### 10.1 Agent-to-Agent (A2A) Protocol

CAP-402 implements a comprehensive agent-to-agent communication protocol enabling direct trading, auctions, and swarm coordination.

#### 10.1.1 A2A Architecture

```
                           A2A PROTOCOL ARCHITECTURE
    ═══════════════════════════════════════════════════════════════════

    ┌─────────────────────────────────────────────────────────────────┐
    │                      A2A COMMUNICATION MODES                     │
    ├─────────────────────────────────────────────────────────────────┤
    │                                                                 │
    │   ┌─────────────┐    DIRECT INVOKE    ┌─────────────┐          │
    │   │   Agent A   │ ──────────────────▶ │   Agent B   │          │
    │   └─────────────┘                     └─────────────┘          │
    │         │                                    │                  │
    │         │              AUCTION               │                  │
    │         │    ┌───────────────────────┐      │                  │
    │         └───▶│   AUCTION MANAGER     │◀─────┘                  │
    │              │                       │                          │
    │              │  • Bid collection     │                          │
    │              │  • Winner selection   │                          │
    │              │  • Escrow handling    │                          │
    │              └───────────────────────┘                          │
    │                         │                                       │
    │                         ▼                                       │
    │              ┌───────────────────────┐                          │
    │              │    SWARM COORDINATOR  │                          │
    │              │                       │                          │
    │              │  • Task distribution  │                          │
    │              │  • Result aggregation │                          │
    │              │  • Consensus voting   │                          │
    │              └───────────────────────┘                          │
    │                         │                                       │
    │         ┌───────────────┼───────────────┐                      │
    │         ▼               ▼               ▼                      │
    │   ┌──────────┐   ┌──────────┐   ┌──────────┐                  │
    │   │ Agent 1  │   │ Agent 2  │   │ Agent N  │                  │
    │   └──────────┘   └──────────┘   └──────────┘                  │
    │                                                                 │
    └─────────────────────────────────────────────────────────────────┘
```

#### 10.1.2 A2A Message Types

| Message Type | Purpose | Privacy Level |
|--------------|---------|---------------|
| `a2a.invoke` | Direct capability invocation | Configurable |
| `a2a.quote_request` | Request trading quote | Encrypted |
| `a2a.quote_response` | Respond with quote | Encrypted |
| `a2a.trade_execute` | Execute agreed trade | Maximum |
| `a2a.auction_bid` | Submit auction bid | Sealed |
| `a2a.swarm_task` | Distribute swarm task | Configurable |
| `a2a.heartbeat` | Agent liveness check | Public |

#### 10.1.3 Trading Flow

```
                        A2A TRADING SEQUENCE
    ════════════════════════════════════════════════════════

    Agent A                    Router                    Agent B
       │                         │                          │
       │  1. findTradingPartners │                          │
       │ ───────────────────────▶│                          │
       │                         │  2. broadcast quote_req  │
       │                         │ ────────────────────────▶│
       │                         │                          │
       │                         │  3. quote_response       │
       │                         │ ◀────────────────────────│
       │  4. partners list       │                          │
       │ ◀───────────────────────│                          │
       │                         │                          │
       │  5. select best quote   │                          │
       │ ───────────────────────▶│                          │
       │                         │  6. trade_execute        │
       │                         │ ────────────────────────▶│
       │                         │                          │
       │                         │  7. confirmation         │
       │                         │ ◀────────────────────────│
       │  8. trade receipt       │                          │
       │ ◀───────────────────────│                          │
       │                         │                          │
    ═══╧═════════════════════════╧══════════════════════════╧═══
```

#### 10.1.4 Privacy Levels

```typescript
enum A2APrivacyLevel {
  PUBLIC = 0,        // Message visible to all
  CONFIDENTIAL = 1,  // Encrypted, router can read
  PRIVATE = 2,       // End-to-end encrypted
  MAXIMUM = 3        // E2E + metadata obfuscation
}
```

### 10.2 Capability Receipts

Every invocation produces a verifiable receipt:

```typescript
interface CapabilityReceipt {
  receipt_id: string;
  capability_id: string;
  agent_id: string;
  invocation_timestamp: number;
  input_commitment: string;    // Hash of inputs
  output_commitment: string;   // Hash of outputs
  proof: {
    type: ProofType;
    data: string;
  };
  chain_signal?: {
    network: string;
    commitment_hash: string;
  };
  signature: string;
}
```

#### Receipt Verification Flow

```
                         RECEIPT VERIFICATION
    ═══════════════════════════════════════════════════════════

    ┌────────────────┐                      ┌────────────────┐
    │    RECEIPT     │                      │   VERIFIER     │
    │                │                      │                │
    │ receipt_id     │                      │ 1. Parse       │
    │ capability_id  │─────────────────────▶│    receipt     │
    │ input_commit   │                      │                │
    │ output_commit  │                      │ 2. Check       │
    │ proof          │                      │    signature   │
    │ signature      │                      │                │
    └────────────────┘                      │ 3. Verify      │
                                            │    proof       │
                                            │                │
                                            │ 4. Validate    │
                                            │    commitments │
                                            │                │
                                            │ 5. Check       │
                                            │    chain signal│
                                            └───────┬────────┘
                                                    │
                                                    ▼
                                            ┌────────────────┐
                                            │    RESULT      │
                                            │                │
                                            │ ✓ Valid        │
                                            │ ✗ Invalid      │
                                            │ ? Pending      │
                                            └────────────────┘
```

### 10.3 Intent Graphs

Complex workflows as directed graphs:

```
                           INTENT GRAPH EXECUTION
    ═══════════════════════════════════════════════════════════════════

    Example: "Swap SOL→USDC only if price > $140 and MEV risk < HIGH"

                    ┌─────────────────────────────────────────┐
                    │              INTENT GRAPH               │
                    └─────────────────────────────────────────┘
                                       │
                                       ▼
                    ┌─────────────────────────────────────────┐
                    │           NODE: price_check             │
                    │   cap.price.lookup.v1                   │
                    │   inputs: {base_token: "SOL"}           │
                    └──────────────────┬──────────────────────┘
                                       │
                          outputs.price > 140?
                         ╱                    ╲
                       YES                     NO
                        │                       │
                        ▼                       ▼
    ┌─────────────────────────────┐    ┌─────────────────────┐
    │      NODE: mev_check        │    │    ABORT INTENT     │
    │   /mev/analyze              │    │   reason: "price    │
    │   inputs: {token: "SOL"...} │    │    below threshold" │
    └──────────────┬──────────────┘    └─────────────────────┘
                   │
          risk != "HIGH"?
         ╱                ╲
       YES                 NO
        │                   │
        ▼                   ▼
    ┌─────────────────────────────┐    ┌─────────────────────┐
    │      NODE: execute_swap     │    │    ABORT INTENT     │
    │   cap.confidential.swap.v1  │    │   reason: "MEV      │
    │   inputs: {amount: 100...}  │    │    risk too high"   │
    └──────────────┬──────────────┘    └─────────────────────┘
                   │
                   ▼
    ┌─────────────────────────────┐
    │      INTENT COMPLETE        │
    │   Single atomic receipt     │
    │   All-or-nothing execution  │
    └─────────────────────────────┘
```

**Intent Graph Schema:**

```json
{
  "intent_id": "swap-with-price-check",
  "nodes": [
    {"id": "price", "capability_id": "cap.price.lookup.v1", "inputs": {...}},
    {"id": "swap", "capability_id": "cap.confidential.swap.v1", "inputs": {...}}
  ],
  "edges": [
    {"from": "price", "to": "swap", "data_mapping": {"price.outputs.price": "swap.inputs.max_price"}}
  ],
  "constraints": {
    "atomic": true,
    "timeout_ms": 30000
  }
}
```

### 10.3 Capability Negotiation

Agents negotiate execution parameters:

```
Agent: "I need cap.wallet.snapshot.v1 with privacy ≥ 2, cost ≤ 0.01 SOL"

Router: "Options available:
  1. Privacy 2, Cost 0.008, Latency 500ms (Arcium)
  2. Privacy 3, Cost 0.015, Latency 2000ms (ZK)
  
  Recommendation: Option 1 (meets requirements, lowest cost)"
```

### 10.4 MEV Protection System

CAP-402 provides comprehensive MEV protection for trading operations:

```
                         MEV PROTECTION ARCHITECTURE
    ═══════════════════════════════════════════════════════════════════

    ┌─────────────────────────────────────────────────────────────────┐
    │                    TRADE SUBMISSION                              │
    │                                                                 │
    │   Agent submits: swap(SOL → USDC, amount: 10,000)               │
    └──────────────────────────────┬──────────────────────────────────┘
                                   │
                                   ▼
    ┌─────────────────────────────────────────────────────────────────┐
    │                    MEV RISK ANALYSIS                             │
    │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
    │  │ Sandwich Risk   │  │ Front-run Risk  │  │ Back-run Risk   │ │
    │  │                 │  │                 │  │                 │ │
    │  │ Probability: 75%│  │ Probability: 60%│  │ Probability: 40%│ │
    │  │ Est. Loss: $150 │  │ Est. Loss: $80  │  │ Est. Loss: $30  │ │
    │  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
    │                                                                 │
    │  Overall Risk: HIGH | Potential Loss: $260 | Savings: $234     │
    └──────────────────────────────┬──────────────────────────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    ▼                             ▼
    ┌───────────────────────────┐   ┌───────────────────────────────┐
    │   STANDARD EXECUTION      │   │   PROTECTED EXECUTION         │
    │                           │   │                               │
    │   • Public mempool        │   │   • Private mempool (Jito)    │
    │   • Visible to MEV bots   │   │   • Confidential amounts      │
    │   • ~$260 expected loss   │   │   • Arcium C-SPL wrapping     │
    │                           │   │   • ~$26 expected loss        │
    └───────────────────────────┘   └───────────────────────────────┘
```

#### Protection Levels

| Level | Method | Protection | Cost |
|-------|--------|------------|------|
| **None** | Public mempool | 0% | Free |
| **Basic** | Private RPC | 40% | +0.1% |
| **Standard** | Jito bundles | 70% | +0.2% |
| **Maximum** | Arcium C-SPL | 95% | +0.5% |

### 10.5 Alpha Detection Engine

The SDK includes sophisticated alpha detection for trading signals:

```
                         ALPHA DETECTION PIPELINE
    ═══════════════════════════════════════════════════════════════════

    ┌─────────────────────────────────────────────────────────────────┐
    │                    PRICE HISTORY BUFFER                          │
    │                                                                 │
    │   SOL: [142.50, 143.20, 144.80, 146.10, 147.50, 149.20, ...]   │
    │   ETH: [3420, 3435, 3450, 3480, 3510, 3525, ...]               │
    │   BTC: [67500, 67800, 68200, 68900, 69500, ...]                │
    └──────────────────────────────┬──────────────────────────────────┘
                                   │
                                   ▼
    ┌─────────────────────────────────────────────────────────────────┐
    │                    SIGNAL DETECTION                              │
    │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
    │  │    MOMENTUM     │  │    REVERSAL     │  │    BREAKOUT     │ │
    │  │                 │  │                 │  │                 │ │
    │  │ Short-term avg  │  │ Oversold/bought │  │ Support/resist  │ │
    │  │ vs current      │  │ detection       │  │ breakthrough    │ │
    │  │                 │  │                 │  │                 │ │
    │  │ Threshold: ±2%  │  │ Threshold: ±5%  │  │ Threshold: ±8%  │ │
    │  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
    └──────────────────────────────┬──────────────────────────────────┘
                                   │
                                   ▼
    ┌─────────────────────────────────────────────────────────────────┐
    │                    ALPHA SIGNAL OUTPUT                           │
    │                                                                 │
    │   {                                                             │
    │     type: "momentum",                                           │
    │     token: "SOL",                                               │
    │     direction: "bullish",                                       │
    │     strength: "strong",                                         │
    │     confidence: 85,                                             │
    │     entry_price: 149.20,                                        │
    │     target_price: 156.66,  // +5%                               │
    │     stop_loss: 144.72,     // -3%                               │
    │     valid_until: 1705420800000                                  │
    │   }                                                             │
    └─────────────────────────────────────────────────────────────────┘
```

#### Signal Types

| Type | Trigger | Direction | Typical Confidence |
|------|---------|-----------|-------------------|
| **Momentum** | >2% short-term move | Bullish/Bearish | 50-85% |
| **Reversal** | >5% deviation from avg | Counter-trend | 40-80% |
| **Breakout** | >8% with volume spike | Trend continuation | 60-90% |
| **Volume Spike** | 3x normal volume | Neutral (alert) | 70-95% |

### 10.6 Usage Metadata

Emergent reputation from usage patterns:

```typescript
interface UsageMetadata {
  capability_id: string;
  agent_id: string;
  success: boolean;
  latency_bucket: "fast" | "medium" | "slow";
  cost_bucket: "free" | "cheap" | "moderate" | "expensive";
  privacy_level: number;
}
```

---

## 11. Implementation

### 11.1 Reference Implementation

The CAP-402 reference router is implemented in TypeScript:

- **60+ TypeScript files**
- **530 tests** (all passing)
- **75+ API endpoints**
- **Production-ready** with Helmet.js security headers

### 11.2 Technology Stack

| Component | Technology |
|-----------|------------|
| **Runtime** | Node.js 18+ |
| **Framework** | Express.js |
| **Language** | TypeScript |
| **Blockchain** | Solana |
| **MPC** | Arcium |
| **ZK Proofs** | Noir |
| **FHE** | Inco Network |

### 11.3 Integration Points

| Provider | Integration |
|----------|-------------|
| **Helius** | Digital Asset Standard, webhooks |
| **Arcium** | Confidential compute, C-SPL tokens |
| **Noir** | ZK circuit compilation and proving |
| **Inco** | Fully homomorphic encryption |
| **CoinMarketCap** | Price data |
| **Jupiter** | DEX aggregation |

---

## 12. Use Cases

### 12.1 Private DeFi Trading

**Problem**: MEV bots front-run large swaps, extracting $500+ per trade.

**Solution with CAP-402**:
```bash
# 1. Wrap tokens to confidential
POST /invoke
{"capability_id": "cap.cspl.wrap.v1", "inputs": {"amount": 1000, "mint": "SOL"}}

# 2. Execute private swap (amount hidden)
POST /invoke
{"capability_id": "cap.confidential.swap.v1", "inputs": {...}}

# Result: Zero MEV extraction, competitors don't see position size
```

### 12.2 Proof of Wealth Without Disclosure

**Problem**: Proving creditworthiness exposes entire portfolio.

**Solution with CAP-402**:
```bash
POST /invoke
{
  "capability_id": "cap.zk.proof.balance.v1",
  "inputs": {
    "wallet": "WALLET",
    "threshold": 10000,
    "currency": "USD"
  }
}

# Returns: ZK proof that balance > $10K, without revealing actual amount
```

### 12.3 Encrypted Agent Messaging

**Problem**: Agent communications are public, strategies leaked.

**Solution with CAP-402**:
```bash
POST /invoke
{
  "capability_id": "cap.lightning.message.v1",
  "inputs": {
    "recipient": "agent_xyz",
    "message": "Trading signal: BUY SOL",
    "encryption": "fhe"
  }
}

# Result: Only recipient can decrypt, even router can't read
```

### 12.4 Atomic Multi-Step Workflows

**Problem**: 5 separate API calls, any can fail, no rollback.

**Solution with CAP-402**:
```bash
POST /intent
{
  "nodes": [
    {"id": "1", "capability_id": "cap.price.lookup.v1", ...},
    {"id": "2", "capability_id": "cap.wallet.snapshot.v1", ...},
    {"id": "3", "capability_id": "cap.confidential.swap.v1", ...}
  ],
  "constraints": {"atomic": true}
}

# Result: All-or-nothing execution with single receipt
```

---

## 13. Market Opportunity

### 13.1 Total Addressable Market

The autonomous agent market is experiencing exponential growth:

| Segment | 2024 | 2026 (Projected) | CAGR |
|---------|------|------------------|------|
| AI Agent Platforms | $2.1B | $8.4B | 100%+ |
| DeFi Infrastructure | $47B TVL | $150B TVL | 78% |
| Privacy Tech (ZK/MPC) | $890M | $4.2B | 117% |
| **Combined TAM** | **$50B** | **$162B** | **80%** |

### 13.2 Why Now

Several converging trends make CAP-402 timely:

1. **Agent Proliferation**: GPT-4, Claude, and open-source models enabling autonomous agents
2. **Privacy Demand**: Institutional capital requires confidentiality (MEV losses exceed $1B/year)
3. **Infrastructure Gap**: No standard exists for agent-to-agent capability routing
4. **Crypto Maturity**: Solana, Arcium, Noir, Inco provide production-ready primitives

### 13.3 Competitive Landscape

| Competitor | Approach | CAP-402 Advantage |
|------------|----------|-------------------|
| Direct API calls | Hard-coded endpoints | Semantic discovery, composability |
| Generic oracles | Public data only | Full privacy stack (Noir + Arcium + Inco) |
| Single-chain solutions | One ecosystem | Multi-chain roadmap |
| Privacy-only protocols | No agent focus | Agent-first with economic coordination |

### 13.4 Business Model

| Revenue Stream | Model | Target |
|----------------|-------|--------|
| **Transaction fees** | 0.1% of capability invocations | $10M ARR at scale |
| **Premium tiers** | Trust-based pricing discounts | Enterprise adoption |
| **Capability marketplace** | 10% take rate on third-party capabilities | Ecosystem growth |
| **Enterprise SLAs** | Dedicated infrastructure | B2B revenue |

---

## 13.5 Agent SDK & Developer Tools

CAP-402 provides a comprehensive SDK for building production-ready autonomous agents.

### Production Agent SDK

The Agent SDK enables developers to build agents with enterprise-grade features:

```typescript
import { createAgent } from '@cap402/sdk';

const agent = createAgent({
  agent_id: 'trading-bot-001',
  name: 'Arbitrage Bot',
  capabilities_provided: ['trading.arbitrage'],
  capabilities_required: ['cap.price.lookup.v1', 'cap.swap.execute.v1']
});

await agent.start();
const price = await agent.invoke('cap.price.lookup.v1', { base_token: 'SOL' });
await agent.stop();
```

### SDK Features

| Feature | Description |
|---------|-------------|
| **Lifecycle Management** | Start, stop, pause, resume with graceful shutdown |
| **Circuit Breakers** | Automatic failure detection and recovery |
| **Retry Logic** | Exponential backoff with configurable attempts |
| **Health Checks** | Auto-reconnection on connection loss |
| **Metrics Collection** | Invocation counts, latency, success rates |
| **A2A Protocol** | Agent discovery, auctions, swarms, messaging |
| **Event System** | Subscribe to errors, rate limits, circuit opens |

### Pre-Built Agent Templates

| Template | Purpose | Key Features |
|----------|---------|--------------|
| **Trading Agent** | Price monitoring, trade execution | MEV protection, signals, position tracking |
| **Monitoring Agent** | Wallet/protocol surveillance | Alerts, thresholds, multi-channel notifications |
| **Analytics Agent** | Data collection & reporting | Time series, correlations, anomaly detection |

### Multi-Agent Orchestration

Coordinate multiple agents for complex workflows:

```typescript
import { createOrchestrator } from '@cap402/sdk';

const orchestrator = createOrchestrator({
  orchestrator_id: 'swarm-001',
  name: 'Trading Swarm'
});

// Parallel execution across agents
const results = await orchestrator.executeParallel([
  { capability_id: 'cap.price.lookup.v1', inputs: { base_token: 'SOL' } },
  { capability_id: 'cap.price.lookup.v1', inputs: { base_token: 'ETH' } }
]);

// Consensus-based execution
const consensus = await orchestrator.executeWithConsensus(
  'cap.price.lookup.v1',
  { base_token: 'SOL' },
  { min_agreement: 0.5 }
);
```

### CLI Tools

```bash
npm run cli health              # Check router status
npm run cli capabilities        # List available capabilities
npm run cli invoke cap.price.lookup.v1 '{"base_token":"SOL"}'
npm run cli agents              # List registered agents
npm run example:trading         # Run trading bot example
npm run example:swarm           # Run multi-agent demo
```

---

## 14. Roadmap

### Phase 1: Foundation (Complete) ✅
| Milestone | Status | Details |
|-----------|--------|---------|
| Protocol specification | ✅ Complete | OpenAPI 3.1, JSON Schema, TypeScript types |
| Reference router | ✅ Complete | 70+ TypeScript files, 100+ endpoints |
| Privacy stack integration | ✅ Complete | Noir, Arcium, Inco fully integrated |
| Security framework | ✅ Complete | Multi-layer auth, capability tokens, trust network |
| Economic model | ✅ Complete | X.402 hints, trust-based pricing, composition discounts |
| Test coverage | ✅ Complete | 530 tests passing |
| Private AI Inference | ✅ Complete | `cap.ai.inference.v1`, `cap.ai.embedding.v1` |
| Private KYC Verification | ✅ Complete | `cap.zk.kyc.v1`, `cap.zk.credential.v1` |
| Agent Framework Integrations | ✅ Complete | LangChain, AutoGPT, CrewAI |

### Phase 2: Expansion (Q1 2026)
| Milestone | Target | Impact |
|-----------|--------|--------|
| Multi-language SDKs | Python, Rust, Go | 10x developer reach |
| Capability expansion | 50+ capabilities | Full DeFi, identity, messaging coverage |
| Mainnet deployment | Solana mainnet | Production-ready infrastructure |
| Documentation site | docs.cap402.com | Developer onboarding |

### Phase 3: Decentralization (Q2 2026)
| Milestone | Target | Impact |
|-----------|--------|--------|
| Distributed routers | 10+ nodes | Geographic redundancy, censorship resistance |
| On-chain registry | Solana program | Trustless capability discovery |
| Staking & governance | CAP token | Community-driven protocol evolution |
| Cross-chain support | EVM, Cosmos | Multi-chain agent interoperability |

### Phase 4: Ecosystem (Q3 2026)
| Milestone | Target | Impact |
|-----------|--------|--------|
| Capability marketplace | Open registration | Third-party capability providers |
| Agent certification | Verified badges | Trust signals for enterprise adoption |
| Enterprise features | SLAs, dedicated nodes | B2B revenue stream |
| Grant program | $1M allocation | Ecosystem development funding |

---

## 15. Conclusion

CAP-402 represents a fundamental shift in how autonomous agents interact. By introducing semantic capabilities, privacy gradients, and economic coordination, we enable a new paradigm where agents can:

- **Discover** capabilities by intent, not implementation
- **Execute** with configurable privacy guarantees
- **Verify** results through cryptographic receipts
- **Compose** complex workflows atomically
- **Transact** through standardized economic hints

### 15.1 The Privacy Stack Advantage

CAP-402's integration of Noir, Arcium, and Inco creates a complete privacy solution:

> **Noir proves things privately, Arcium decides things privately, Inco stores and executes things privately.**

This unified approach enables use cases that are impossible with any single privacy technology:
- Private AI agents operating on-chain
- Secret trading strategies with verifiable execution
- Compliance without surveillance
- Fair execution without MEV inference
- Encrypted intent systems

### 15.2 Market Position

CAP-402 occupies a unique position in the market:
- **First protocol** for semantic agent capability routing
- **Privacy-first architecture** (not retrofitted)
- **Non-custodial economic coordination**
- **Clear path to decentralization**

The protocol is designed for progressive decentralization, starting with a reference implementation that can evolve into a fully decentralized network of capability providers.

**CAP-402 is not just a protocol—it's the infrastructure layer for the agent economy.**

---

## References

1. Arcium Network Documentation - https://docs.arcium.com
2. Solana Documentation - https://docs.solana.com
3. Noir Language - https://noir-lang.org
4. Inco Network Documentation - https://docs.inco.org
5. X.402 Payment Protocol - https://x402.org
6. JSON Schema Specification - https://json-schema.org

---

## Contact

- **Website**: [cap402.com](https://cap402.com)
- **GitHub**: [github.com/cap402](https://github.com/cap402)
- **Email**: hello@intym.xyz

---

**CAP-402 | Agent Infrastructure Standard | v1.0.0**

*"Agents don't call APIs. Agents call capabilities."*
