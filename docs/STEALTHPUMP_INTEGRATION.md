# StealthPump Integration Architecture

## Overview

StealthPump is a privacy-first token launch platform built on top of CAP-402's privacy infrastructure and pump.fun's bonding curve mechanism. This document outlines the complete integration architecture.

## System Components

```
┌─────────────────────────────────────────────────────────────┐
│                    UNIFIED PRIVACY LAYER                     │
│                  (providers/unified-privacy.ts)              │
├─────────────────────────────────────────────────────────────┤
│  • Privacy orchestration across all systems                  │
│  • Cross-system event synchronization                        │
│  • Unified configuration management                          │
│  • Real-time privacy scoring                                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────────┐
        │                                         │
        ▼                                         ▼
┌──────────────────┐                    ┌──────────────────┐
│    CAP-402       │                    │   PUMP.FUN       │
│  Privacy Layer   │                    │   Integration    │
├──────────────────┤                    ├──────────────────┤
│ • Arcium MPC     │                    │ • Bonding Curve  │
│ • Inco FHE       │                    │ • Token Launch   │
│ • Noir ZK        │                    │ • Buy/Sell       │
│ • Private Txs    │                    │ • Graduation     │
└──────────────────┘                    └──────────────────┘
        │                                         │
        └─────────────────┬───────────────────────┘
                          ▼
                ┌──────────────────┐
                │   STEALTHPUMP    │
                │   Application    │
                ├──────────────────┤
                │ • Launch UI      │
                │ • Dashboard      │
                │ • Token Monitor  │
                │ • Privacy Score  │
                └──────────────────┘
```

## Privacy Levels

### Basic Privacy
- **Creator Hiding**: Stealth wallet generation
- **Timing Obfuscation**: Random delays (100-500ms)
- **MEV Protection**: Optional Jito bundles
- **Privacy Score**: 40-60

### Enhanced Privacy (Default)
- **All Basic features** +
- **Funding Obfuscation**: Multi-hop transfers
- **Holder Anonymity Tracking**: Monitor deanonymization
- **Auto-reveal on Graduation**: Creator revealed at 85 SOL
- **Privacy Score**: 60-80

### Maximum Privacy
- **All Enhanced features** +
- **CAP-402 Integration**: Arcium MPC (✅ Verified Working) or Inco FHE
- **Zero-Knowledge Proofs**: Noir circuits for verification
- **Advanced Timing**: Randomized delays (1-5 seconds)
- **Permanent Anonymity**: Never reveal creator
- **Privacy Score**: 80-100

> **Arcium MPC Status (Jan 2026)**: ✅ Devnet fully operational post-migration. Program `Aaco6pyL...` verified on-chain and executable.

## Key Features

### 1. Stealth Launch Registry
**File**: `providers/pumpfun.ts`

```typescript
interface StealthLaunchRecord {
  mintAddress: string;
  stealthWalletHash: string;  // SHA-256 hash
  createdAt: number;
  revealAt?: number;
  graduated: boolean;
  revealed: boolean;
  publicData: {
    name: string;
    symbol: string;
    description: string;
    image?: string;
    launchTimestamp: number;
  };
  hiddenData: {
    creatorWallet: string;      // Only revealed after graduation
    initialBuyAmount: number;   // Hidden until reveal
    fundingSource?: string;
  };
}
```

**Purpose**: Track stealth launches and manage creator reveal timing.

### 2. Graduation Monitoring
**File**: `providers/pumpfun.ts`

Monitors bonding curve progress and auto-reveals creator at 85 SOL threshold.

```typescript
startGraduationMonitor(
  mintAddress: string,
  callback: (event: GraduationEvent) => void
): void
```

**Cleanup**: `stopAllMonitors()` called on graceful shutdown to prevent memory leaks.

### 3. Privacy Scoring
**File**: `providers/pumpfun.ts`

Calculates privacy score based on:
- Creator hidden status (30 points)
- Holder anonymity (30 points)
- Funding obfuscation (20 points)
- MEV protection (10 points)
- Timing obfuscation (10 points)

**Grades**:
- A (90-100): 🔒 Maximum Privacy
- B (80-89): 🛡️ Strong Privacy
- C (70-79): ✅ Good Privacy
- D (60-69): ⚠️ Moderate Privacy
- F (<60): ❌ Minimal Privacy

### 4. Cross-System Event Bus
**File**: `providers/unified-privacy.ts`

Real-time event synchronization across CAP-402, StealthPump, and pump.fun.

**Event Types**:
- `launch_started`
- `token_created`
- `graduation_detected`
- `creator_revealed`
- `privacy_score_updated`
- `anonymity_alert`

**WebSocket Support**: Events broadcast to connected clients via `/unified/events/stream`.

### 5. Anonymity Set Tracking
**File**: `providers/pumpfun.ts`

Monitors holder distribution to detect deanonymization risks.

```typescript
interface HolderAnonymityInfo {
  mintAddress: string;
  totalHolders: number;
  anonymousHolders: number;
  revealedHolders: number;
  anonymityScore: number;  // 0-100
  largestHolderPercent: number;
  top10HoldersPercent: number;
  lastUpdated: number;
}
```

**Alerts**: Triggered when anonymity score drops below threshold.

## API Endpoints

### Unified Privacy Orchestrator

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/unified/status` | GET | System status across all integrations |
| `/unified/privacy-presets` | GET | Available privacy configurations |
| `/unified/launch` | POST | Execute privacy-first token launch |
| `/unified/dashboard/:mint` | GET | Aggregated dashboard data |
| `/unified/launches/active` | GET | All active stealth launches |
| `/unified/events` | GET | Query cross-system events |
| `/unified/events/emit` | POST | Emit custom events |
| `/unified/events/stream` | WS | Real-time event stream |

### StealthPump Core

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/stealthpump/launch` | POST | Launch token with privacy |
| `/stealthpump/buy` | POST | Buy tokens from bonding curve |
| `/stealthpump/sell` | POST | Sell tokens to bonding curve |
| `/stealthpump/quote` | GET | Get buy/sell quote |
| `/stealthpump/curve/:mint` | GET | Bonding curve information |
| `/stealthpump/status` | GET | Provider status |
| `/stealthpump/wallet/generate` | POST | Generate stealth wallet |

### Stealth Registry

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/stealthpump/stealth/register` | POST | Register stealth launch |
| `/stealthpump/stealth/view/:mint` | GET | Privacy-preserving view |
| `/stealthpump/stealth/check-graduation/:mint` | GET | Check graduation status |
| `/stealthpump/stealth/launches` | GET | List stealth launches |
| `/stealthpump/stealth/reveal` | POST | Manually reveal creator |
| `/stealthpump/stealth/stats` | GET | Stealth launch statistics |

### MEV Protection

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/stealthpump/launch-protected` | POST | Launch with Jito MEV protection |

### Anonymity Tracking

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/stealthpump/anonymity/init` | POST | Initialize anonymity tracking |
| `/stealthpump/anonymity/update` | POST | Update holder data |
| `/stealthpump/anonymity/:mint` | GET | Get anonymity metrics |

### Privacy Scoring

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/stealthpump/privacy-score/:mint` | GET | Calculate privacy score |

## Security Features

### Input Validation
- Mint address format validation (32-44 chars)
- Amount limits (0.01-1000 SOL for buys, 0.01-100 SOL for launches)
- Token amount positivity checks
- Type validation for all inputs

### Memory Leak Prevention
- `stopAllMonitors()`: Cleanup all graduation monitors
- `cleanupStealthRegistry()`: Remove old entries (7 day default)
- `cleanupAnonymitySets()`: Remove stale anonymity data
- Graceful shutdown handler with resource cleanup

### Sensitive Data Protection
- Private keys never returned in API responses
- Creator wallet hidden until reveal conditions met
- Security warnings logged when `payer_secret` used
- Base64 decoding wrapped in try/catch

### Error Handling
- Consistent error format: `{ success: false, error: string }`
- 400 for validation errors
- 404 for not found
- 500 for server errors

## Integration Flow

### 1. Privacy-First Token Launch

```typescript
// Client calls unified launch endpoint
POST /unified/launch
{
  "metadata": {
    "name": "My Token",
    "symbol": "MTK",
    "description": "Privacy-first token",
    "image": "https://..."
  },
  "initialBuySol": 1.0,
  "privacyConfig": {
    "level": "enhanced",
    "hideCreator": true,
    "revealOnGraduation": true,
    "useStealthWallet": true,
    "mevProtection": true,
    "trackAnonymitySet": true
  }
}

// Unified orchestrator executes:
// 1. Generate stealth wallet
// 2. Fund wallet (obfuscated if enhanced/maximum)
// 3. Create token on pump.fun
// 4. Register in stealth registry
// 5. Start graduation monitor
// 6. Initialize anonymity tracking
// 7. Emit events to event bus
```

### 2. Real-Time Dashboard Updates

```typescript
// Client subscribes to WebSocket
WS /unified/events/stream

// Receives events:
{
  "type": "graduation_detected",
  "mintAddress": "...",
  "solRaised": 85.0,
  "timestamp": 1768915689715
}

// Client queries dashboard
GET /unified/dashboard/:mint

// Returns aggregated data from:
// - Pump.fun bonding curve
// - Stealth registry
// - Anonymity tracking
// - Privacy scoring
```

### 3. Graduation & Reveal

```typescript
// Monitor detects 85 SOL threshold
// Auto-reveal triggered if configured
{
  "graduated": true,
  "revealed": true,
  "creatorWallet": "...",
  "marketCapSol": 85.0
}

// Event emitted to all subscribers
// Dashboard updated with creator info
```

## Performance Characteristics

| Operation | Latency | Throughput |
|-----------|---------|------------|
| Stealth Launch | 2-5s | 10/min |
| Buy/Sell | 1-3s | 50/min |
| Quote | <100ms | 1000/min |
| Privacy Score | <50ms | 500/min |
| Event Emission | <10ms | 10000/min |

## Deployment

### CAP-402 (Railway)
- **URL**: https://cap402.com
- **Status**: ✅ Operational
- **Environment**: Production

### StealthPump
- **Website**: https://stealthpump.fun
- **Status**: ✅ Operational
- **Integration**: Live with CAP-402

### Pump.fun
- **Program ID**: `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`
- **Network**: Solana Mainnet
- **Status**: ✅ Connected

## Testing

### Integration Check Script
**File**: `stealthpump/src/tests/integration-check.ts`

```bash
cd /Users/zion/Desktop/stealthpump
npx tsx src/tests/integration-check.ts
```

**Tests**:
1. ✅ Unified Status
2. ✅ Privacy Presets
3. ✅ Active Launches
4. ✅ Pump.fun Constants
5. ✅ Bonding Curve Calculation
6. ✅ Stealth Stats

**Result**: 6/6 passing

## Arcium MPC Integration

**Status**: ✅ Verified Working (January 2026)

| Component | Status | Details |
|-----------|--------|---------|
| **Devnet Connection** | ✅ Live | Slot 394808159+ |
| **Program On-Chain** | ✅ Verified | `Aaco6pyLJ6wAod2ivxS264xRcFyFZWdamy5VaqHQVC2d` |
| **MPC Computations** | ✅ Working | ~236ms execution |
| **C-SPL Transfers** | ✅ Working | Confidential token transfers |
| **Wrap/Unwrap** | ✅ Working | SPL ↔ C-SPL conversion |
| **Mainnet** | ⏳ Pending | Awaiting Arcium mainnet launch |

**Configuration**:
```bash
ARCIUM_PROGRAM_ID=Aaco6pyLJ6wAod2ivxS264xRcFyFZWdamy5VaqHQVC2d
ARCIUM_MXE_ID=456
ARCIUM_NETWORK=devnet
```

## Future Enhancements

1. **Advanced Privacy** (Partially Complete)
   - ✅ Arcium MPC confidential transfers
   - ✅ Privacy alerts and monitoring
   - ✅ Privacy trend analytics
   - ⏳ Tornado Cash-style mixing for funding
   - ⏳ Ring signatures for creator anonymity

2. **Cross-Chain Support**
   - Ethereum L2s (Base, Arbitrum)
   - Other Solana DEXs (Raydium, Orca)

3. **Analytics** (Complete)
   - ✅ Privacy trend analysis
   - ✅ Deanonymization risk scoring
   - ✅ Automated privacy alerts
   - ⏳ Market impact correlation

4. **Governance**
   - DAO for privacy parameter tuning
   - Community-driven reveal policies

## Resources

- **CAP-402 Docs**: `/docs/INDEX.md`
- **API Documentation**: `/docs/api-docs.html`
- **OpenAPI Spec**: `/docs/openapi.yaml`
- **Architecture**: `/docs/ARCHITECTURE.md`
- **Privacy Integrations**: `/docs/privacy-integrations.md`

## Support

For issues or questions:
- GitHub: https://github.com/TheQuantumChronicle/cap402
- Website: https://stealthpump.fun
