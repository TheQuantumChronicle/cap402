import { Capability } from './capabilities';

/**
 * Zero-Knowledge Balance Proof Capability
 * 
 * Proves that a wallet balance exceeds a threshold WITHOUT revealing the actual balance.
 * Uses Noir circuits to generate cryptographic proofs that can be verified by anyone.
 * 
 * Use cases:
 * - Prove creditworthiness without exposing portfolio
 * - Verify collateral requirements for lending
 * - Gate access to services based on holdings
 * - Compliance verification without surveillance
 */
export const ZK_BALANCE_PROOF_CAPABILITY: Capability = {
  id: "cap.zk.proof.balance.v1",
  name: "ZK Balance Proof",
  description: "Generate a zero-knowledge proof that wallet balance exceeds a threshold without revealing the actual balance. Enables privacy-preserving creditworthiness verification.",
  inputs: {
    schema: {
      type: "object",
      properties: {
        wallet: {
          type: "string",
          description: "Wallet address to prove balance for"
        },
        threshold: {
          type: "number",
          description: "Minimum balance threshold to prove (e.g., 10000 for $10K)"
        },
        currency: {
          type: "string",
          description: "Currency/token to check (e.g., 'SOL', 'USDC', 'USD')"
        }
      },
      required: ["wallet", "threshold", "currency"]
    },
    required: ["wallet", "threshold", "currency"]
  },
  outputs: {
    schema: {
      type: "object",
      properties: {
        proof_valid: { type: "boolean", description: "Whether the balance exceeds threshold" },
        proof: { type: "string", description: "ZK proof (hex encoded)" },
        verification_key: { type: "string", description: "Public verification key" },
        public_statement: { type: "string", description: "Human-readable statement proved" },
        threshold_met: { type: "boolean", description: "Whether threshold was met" },
        circuit_used: { type: "string", description: "Noir circuit identifier" },
        privacy_guarantees: { type: "array", items: { type: "string" } }
      }
    }
  },
  execution: {
    mode: "confidential",
    executor_hint: "noir-prover",
    proof_type: "zk-snark"
  },
  economics: {
    cost_hint: 0.015,
    currency: "SOL",
    x402_payment_signal: {
      enabled: true,
      settlement_optional: true,
      payment_methods: ["SOL", "USDC", "privacy-cash"]
    },
    privacy_cash_compatible: true
  },
  performance: {
    latency_hint: "medium",
    reliability_hint: 0.97,
    throughput_limit: 30
  },
  version: "1.0.0",
  composable: true,
  metadata: {
    tags: ["privacy", "zk", "noir", "balance", "proof", "verification", "lending", "compliance"],
    provider_hints: ["noir-prover"],
    use_cases: [
      "Prove wallet balance threshold without revealing exact balance",
      "Verify collateral for lending protocols",
      "Gate access to premium services based on holdings",
      "Compliance verification without exposing full portfolio"
    ],
    privacy_guarantees: [
      "Actual balance never revealed",
      "Only threshold comparison result is public",
      "Wallet address can be verified",
      "Proof is cryptographically verifiable by anyone"
    ]
  }
};
