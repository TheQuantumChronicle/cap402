# CAP-402 Economic Choke Points

## The Core Truth

**Agents don't pay for privacy. They pay for edge, profit, and survivability.**

Privacy is the *means*, not the product. CAP-402 is **profit-enabling**, not privacy-enabling.

## Why Agents Must Pay

Every profitable agent has the same pain:

> "If my strategy becomes visible, I lose money."

CAP-402 sits on that pain by force, not choice. Once an agent:
- Handles size (>$100K)
- Handles other people's capital
- Runs continuously

**Public execution = death.**

## The Three Economic Rails

| Technology | Mandatory For | Threshold | Revenue Model |
|------------|--------------|-----------|---------------|
| **Arcium** | Large-size execution, sealed auctions, OTC matching | >$100K trades | % of saved slippage |
| **Inco** | Encrypted PnL computation, strategy scoring, agent ranking | Any competitive strategy | Subscription + compute fees |
| **Noir** | Onboarding proofs, capital delegation, compliance | Institutional capital | Per-proof + verification fees |

---

## 1. Arcium Integration

### What is Arcium?

Arcium is a **Decentralized Confidential Computing (DeCC)** network on Solana that uses Multi-Party Computation (MPC) to enable secure computation on encrypted data. No single party ever sees the plaintext data.

### CAP-402 Arcium Capabilities

```typescript
// Provider: /providers/arcium-client.ts

// 1. Confidential Token Wrapping (C-SPL)
await arciumProvider.wrapToCSPL(owner, mint, amount);

// 2. Private Token Transfers
await arciumProvider.transferCSPL(from, to, mint, encryptedAmount);

// 3. Confidential Swaps (hidden amounts)
await arciumProvider.confidentialSwap(inputToken, outputToken, encryptedAmount, wallet);

// 4. Private Auction Bids
await arciumProvider.submitPrivateBid(auctionId, bidder, encryptedBidAmount);

// 5. Confidential Voting
await arciumProvider.castConfidentialVote(proposalId, voter, encryptedVote, votingPower);

// 6. Private Order Book
await arciumProvider.placePrivateOrder(market, trader, side, encryptedPrice, encryptedSize);

// 7. Confidential Credit Scoring
await arciumProvider.computeConfidentialCreditScore(applicant, encryptedFinancialData, lenderId);
```

### Use Cases in CAP-402

| Use Case | Description | Endpoint |
|----------|-------------|----------|
| **Dark Pool Trading** | Execute large trades without market impact | `/alpha/private-trade` |
| **MEV Protection** | Hide trade details from MEV bots | `/mev/protected-swap` |
| **Private Auctions** | Sealed-bid auctions for agent services | `/trading/auction/create` |
| **Confidential DeFi** | Lending/borrowing without exposing positions | `/arcium/confidential-swap` |

### Router Endpoints

```
POST /arcium/encrypt          - Encrypt data for MPC
POST /arcium/compute          - Submit confidential computation
POST /arcium/cspl/wrap        - Wrap tokens to C-SPL
POST /arcium/cspl/transfer    - Transfer confidential tokens
GET  /arcium/status           - Check Arcium connection status
```

---

## 2. Inco Network Integration

### What is Inco?

Inco Network provides **Fully Homomorphic Encryption (FHE)** - the ability to perform computations on encrypted data without ever decrypting it. This enables:
- Encrypted arithmetic (add, subtract, multiply)
- Encrypted comparisons (less than, equal)
- Encrypted conditional logic (if/else on encrypted booleans)

### CAP-402 Inco Capabilities

```typescript
// Provider: /providers/inco-fhe.ts

// Supported encrypted types
type FHEType = 'euint8' | 'euint16' | 'euint32' | 'euint64' | 'ebool' | 'eaddress';

// 1. Encrypt values
const encrypted = await incoFHEProvider.encrypt(1000, 'euint64');

// 2. Homomorphic Operations
await incoFHEProvider.fheAdd(a, b);      // Add encrypted values
await incoFHEProvider.fheSub(a, b);      // Subtract encrypted values
await incoFHEProvider.fheMul(a, b);      // Multiply encrypted values
await incoFHEProvider.fheLt(a, b);       // Compare (a < b) on encrypted
await incoFHEProvider.fheSelect(cond, ifTrue, ifFalse);  // Conditional

// 3. Confidential Messaging
await incoFHEProvider.sendConfidentialMessage(sender, recipient, message, ttl);

// 4. Encrypted State Management
await incoFHEProvider.createEncryptedState(owner, stateData);
await incoFHEProvider.computeOnState(stateId, computation, inputs);

// 5. Private Auctions & Voting
await incoFHEProvider.submitPrivateBid(auctionId, bidder, amount);
await incoFHEProvider.submitPrivateVote(proposalId, voter, vote, votingPower);

// 6. Private Random Numbers
await incoFHEProvider.generatePrivateRandom(requester, minValue, maxValue);

// 7. Time-Locked Encryption
await incoFHEProvider.createTimeLock(value, unlockTimestamp);
```

### FHE Operations Reference

| Operation | Function | Gas Cost | Description |
|-----------|----------|----------|-------------|
| `fheAdd` | `e.add(a, b)` | ~50k | Add two encrypted values |
| `fheSub` | `e.sub(a, b)` | ~50k | Subtract encrypted values |
| `fheMul` | `e.mul(a, b)` | ~100k | Multiply encrypted values |
| `fheLt` | `e.lt(a, b)` | ~75k | Less than comparison |
| `fheEq` | `e.eq(a, b)` | ~75k | Equality comparison |
| `fheSelect` | `e.select(c, t, f)` | ~80k | Conditional selection |
| `rand` | `e.rand()` | ~60k | Generate encrypted random |

### Router Endpoints

```
POST /inco/encrypt            - Encrypt a value
POST /inco/compute            - Perform FHE computation
POST /inco/message            - Send confidential message
POST /inco/state/create       - Create encrypted state
POST /inco/state/compute      - Compute on encrypted state
GET  /inco/status             - Check Inco connection status
```

---

## 3. Noir Integration

### What is Noir?

Noir is Aztec's **zero-knowledge proof language** that compiles to ACIR (Abstract Circuit Intermediate Representation). It enables proving statements about private data without revealing the data itself.

### CAP-402 Noir Circuits

```typescript
// Provider: /providers/noir-circuits.ts

// Available circuits
const circuits = [
  'balance_threshold',      // Prove balance > X without revealing amount
  'credential_ownership',   // Prove credential without revealing details
  'set_membership',         // Prove membership without revealing which member
  'age_verification',       // Prove age > X without revealing birthdate
  'transaction_limit',      // Prove tx within limits without revealing amount
  'kyc_compliance',         // Prove KYC without revealing personal data
  'voting_eligibility',     // Prove voting rights without revealing identity
  'credit_score_range',     // Prove score in range without revealing exact score
  'nft_ownership',          // Prove NFT ownership without revealing which NFT
  'income_verification'     // Prove income > X without revealing exact amount
];

// Generate proofs
await noirCircuitsProvider.proveBalanceThreshold(actualBalance, threshold, tokenMint, signature);
await noirCircuitsProvider.proveCredentialOwnership(credentialData, type, issuerPubkey, signature);
await noirCircuitsProvider.proveKYCCompliance(kycData, attestation, level, jurisdiction);
await noirCircuitsProvider.proveCreditScoreRange(actualScore, minScore, maxScore, lenderId);
await noirCircuitsProvider.proveNFTOwnership(nftMint, collection, merkleRoot, merkleProof);
await noirCircuitsProvider.proveIncomeVerification(actualIncome, threshold, currency);

// Verify proofs
await noirCircuitsProvider.verifyProof(proof, verificationKey, publicInputs);
```

### Circuit Specifications

| Circuit | Public Inputs | Private Inputs | Constraints |
|---------|---------------|----------------|-------------|
| `balance_threshold` | threshold, token_mint | actual_balance, signature | 1,024 |
| `credential_ownership` | credential_type, issuer_pubkey | credential_data, signature | 2,048 |
| `set_membership` | merkle_root, set_id | member_data, merkle_path | 4,096 |
| `kyc_compliance` | compliance_level, jurisdiction | kyc_data, attestation | 3,072 |
| `credit_score_range` | min_score, max_score, lender_id | actual_score, report_hash | 1,536 |
| `nft_ownership` | collection_address, merkle_root | nft_mint, merkle_proof | 2,048 |
| `income_verification` | income_threshold, currency | actual_income, pay_stub_hash | 1,792 |

### Router Endpoints

```
GET  /noir/circuits           - List available circuits
GET  /noir/circuits/:name     - Get circuit details
POST /noir/prove              - Generate ZK proof
POST /noir/verify             - Verify ZK proof
GET  /noir/stats              - Get proving statistics
```

---

## Combined Use Cases

### 1. Private DeFi Trading

```
Agent wants to execute a large swap without revealing size:

1. [Noir] Prove balance > minimum threshold (no exact amount revealed)
2. [Arcium] Encrypt trade amount using MPC
3. [Inco] Execute swap on encrypted amounts
4. [Noir] Generate proof of successful execution
```

### 2. Confidential Credit Assessment

```
Agent needs to prove creditworthiness without revealing financial data:

1. [Inco] Encrypt financial data (income, debts, assets)
2. [Inco] Compute credit score on encrypted data (FHE)
3. [Noir] Generate proof that score > threshold
4. [Arcium] Submit encrypted proof to lender via MPC
```

### 3. Private Auction for Agent Services

```
Multiple agents bid on a capability without revealing bids:

1. [Arcium] Each agent encrypts their bid
2. [Inco] Bids stored as encrypted state
3. [Inco] Compare bids using FHE (no decryption)
4. [Noir] Winner proves they had highest bid
5. [Arcium] Execute winning bid confidentially
```

### 4. Anonymous Governance Voting

```
DAO members vote without revealing identity or vote:

1. [Noir] Prove voting eligibility (token holder)
2. [Inco] Encrypt vote and voting power
3. [Inco] Tally votes using FHE
4. [Noir] Generate proof of correct tally
```

### 5. MEV-Protected Trading

```
Execute trade without MEV bots seeing details:

1. [Arcium] Encrypt trade parameters
2. [Inco] Route through private mempool
3. [Arcium] Execute via MPC (no single party sees full trade)
4. [Noir] Prove execution was fair
```

---

## API Reference

### Unified Privacy Endpoint

```
POST /privacy/execute
{
  "operation": "confidential_swap" | "private_bid" | "zk_proof" | "fhe_compute",
  "technology": "arcium" | "inco" | "noir",
  "inputs": { ... },
  "options": {
    "privacy_level": "standard" | "enhanced" | "maximum"
  }
}
```

### Health & Status

```
GET /health/providers
{
  "arcium": { "status": "live", "mode": "devnet", "program_id": "..." },
  "inco": { "status": "live", "chain_id": "...", "operations": 1234 },
  "noir": { "status": "ready", "circuits": 10, "proofs_generated": 567 }
}
```

---

## Security Considerations

1. **Key Management**: All encryption keys are derived from chain entropy (block hashes) for verifiability
2. **Proof Verification**: All ZK proofs are verified on-chain before execution
3. **MPC Threshold**: Arcium uses 2-of-3 MPC for computation security
4. **FHE Parameters**: Inco uses 128-bit security level for all FHE operations
5. **Circuit Auditing**: All Noir circuits are audited for constraint completeness

---

## Performance Benchmarks

| Operation | Technology | Latency | Gas/Cost |
|-----------|------------|---------|----------|
| Encrypt 64-bit value | Inco FHE | ~50ms | ~30k gas |
| FHE Addition | Inco FHE | ~100ms | ~50k gas |
| FHE Multiplication | Inco FHE | ~200ms | ~100k gas |
| Generate ZK Proof | Noir | ~500ms | Off-chain |
| Verify ZK Proof | Noir | ~50ms | ~200k gas |
| MPC Computation | Arcium | ~1s | ~100k gas |
| Confidential Swap | Arcium | ~2s | ~500k gas |

---

## Getting Started

### 1. Check Provider Status

```bash
curl https://cap402.com/health/providers
```

### 2. Generate a ZK Proof

```bash
curl -X POST https://cap402.com/noir/prove \
  -H "Content-Type: application/json" \
  -d '{
    "circuit": "balance_threshold",
    "public_inputs": { "threshold": 1000, "token_mint": "SOL" },
    "private_inputs": { "actual_balance": 5000, "wallet_signature": "..." }
  }'
```

### 3. Execute Confidential Swap

```bash
curl -X POST https://cap402.com/arcium/confidential-swap \
  -H "Content-Type: application/json" \
  -d '{
    "input_token": "SOL",
    "output_token": "USDC",
    "encrypted_amount": "0x...",
    "wallet": "..."
  }'
```

### 4. Perform FHE Computation

```bash
curl -X POST https://cap402.com/inco/compute \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "fhe_add",
    "operands": ["0x...", "0x..."]
  }'
```

---

## The Investment Story

**Not**: "We integrated Arcium, Inco, Noir"

**But**: "CAP-402 takes a cut of agent execution once they make money."

We are not selling privacy. We are **taxing successful autonomy**.

### Revenue Model

| Layer | Trigger | Pricing |
|-------|---------|---------|
| **Execution-as-a-Service** | Agent crosses $100K trade size | 0.1% of saved slippage |
| **Dark Coordination** | Agent-to-agent matching | 0.05% of matched volume |
| **Reputation Proofs** | Capital delegation, compliance | $10-100 per proof |
| **Subscriptions** | Continuous attestation, priority execution | $500-5000/month |

### Why This Works

1. **Agents have no choice** — public execution above thresholds = death
2. **Value is obvious** — save $5K in MEV, pay $500 to CAP-402
3. **Sponsors are structural** — not optional features, mandatory rails
4. **Network effects** — more agents = better coordination = more value

---

## 4. AI Inference Integration (NEW)

### What is Private AI?

CAP-402 now supports **private AI inference** using Arcium MPC. Your prompts and data are encrypted before processing - the model never sees plaintext.

### CAP-402 AI Capabilities

```typescript
// Provider: /providers/ai-inference.ts

// 1. Private Sentiment Analysis
await client.invokeCapability('cap.ai.inference.v1', {
  model: 'sentiment-analysis',
  input: 'Confidential document text...',
  privacy_level: 2
});

// 2. Private Embeddings for RAG
await client.invokeCapability('cap.ai.embedding.v1', {
  texts: ['Private document 1', 'Private document 2'],
  privacy_level: 2
});
```

### Supported Models

| Model | Use Case | Privacy |
|-------|----------|---------|
| `sentiment-analysis` | Analyze sentiment without exposing text | L2 (MPC) |
| `classification` | Classify documents privately | L2 (MPC) |
| `summarization` | Summarize without revealing content | L2 (MPC) |
| `embeddings` | Generate vectors for private search | L2 (MPC) |

---

## 5. KYC Verification Integration (NEW)

### What is Private KYC?

Zero-knowledge proofs for identity verification. Prove you meet requirements (age, jurisdiction, accreditation) **without revealing the underlying data**.

### CAP-402 KYC Capabilities

```typescript
// Provider: Uses Noir ZK circuits

// Prove you're 18+ without revealing birthdate
await client.invokeCapability('cap.zk.kyc.v1', {
  verification_type: 'age',
  private_inputs: { date_of_birth: '1990-05-15' }, // NEVER revealed
  public_inputs: { min_age: 18 }
});
// Returns: { compliant: true, proof: '0x...' }
// Verifier learns ONLY: "User is 18+" - nothing else
```

### Verification Types

| Type | Proves | Without Revealing |
|------|--------|-------------------|
| `age` | User is above minimum age | Birthdate |
| `jurisdiction` | User is in allowed country | Exact location |
| `accreditation` | User is accredited investor | Net worth/income |
| `aml` | User passes AML checks | Identity details |

---

## The One Sentence

> **"Confidential execution infrastructure that agents must use once they scale."**

That's CAP-402.
