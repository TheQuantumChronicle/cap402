import { Capability } from './capabilities';

/**
 * Zero-Knowledge Proof Capability
 * 
 * Uses Aztec's Noir to generate ZK proofs for various use cases:
 * - Prove wallet balance > X without revealing exact amount
 * - Prove credential ownership without revealing credential
 * - Prove membership in set without revealing which member
 * - Prove computation result without revealing inputs
 * 
 * This enables privacy-preserving agent interactions where agents can
 * verify claims without exposing sensitive data.
 */
export const ZK_PROOF_CAPABILITY: Capability = {
  id: "cap.zk.proof.v1",
  name: "Zero-Knowledge Proof Generation",
  description: "Generate ZK proofs using Aztec Noir for privacy-preserving verification. Prove statements about data without revealing the data itself.",
  inputs: {
    schema: {
      type: "object",
      properties: {
        proof_type: {
          type: "string",
          enum: ["balance_threshold", "credential_ownership", "set_membership", "computation_result"],
          description: "Type of proof to generate"
        },
        circuit: {
          type: "string",
          description: "Noir circuit identifier or code"
        },
        private_inputs: {
          type: "object",
          description: "Private inputs (never revealed)"
        },
        public_inputs: {
          type: "object",
          description: "Public inputs (verifiable by anyone)"
        },
        statement: {
          type: "string",
          description: "Statement to prove (e.g., 'balance > 100 SOL')"
        }
      },
      required: ["proof_type", "circuit", "private_inputs", "public_inputs"]
    },
    required: ["proof_type", "circuit", "private_inputs", "public_inputs"]
  },
  outputs: {
    schema: {
      type: "object",
      properties: {
        proof: { type: "string", description: "ZK proof (hex encoded)" },
        verification_key: { type: "string", description: "Public verification key" },
        public_outputs: { type: "object", description: "Public outputs from circuit" },
        proof_valid: { type: "boolean", description: "Self-verification result" },
        circuit_hash: { type: "string", description: "Hash of circuit used" }
      }
    }
  },
  execution: {
    mode: "confidential",
    executor_hint: "noir-prover",
    proof_type: "zk-snark"
  },
  economics: {
    cost_hint: 0.01,
    currency: "SOL",
    x402_payment_signal: {
      enabled: true,
      settlement_optional: true,
      payment_methods: ["sol", "usdc"]
    }
  },
  performance: {
    latency_hint: "medium",
    reliability_hint: 0.98,
    throughput_limit: 50
  },
  version: "1.0.0",
  composable: true,
  metadata: {
    tags: ["privacy", "zk", "noir", "aztec", "proof", "verification"],
    provider_hints: ["noir-prover", "aztec"],
    use_cases: [
      "Prove wallet balance threshold without revealing exact balance",
      "Prove credential ownership without revealing credential details",
      "Prove set membership without revealing which member",
      "Prove computation correctness without revealing inputs"
    ]
  }
};
