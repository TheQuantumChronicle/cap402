import { Capability } from './capabilities';

/**
 * Confidential Swap Capability
 * 
 * Uses Arcium MPC + C-SPL (Confidential Token Standard) for fully private swaps.
 * Unlike public swaps (Jupiter), this hides:
 * - Trade amounts
 * - Token types
 * - Wallet addresses
 * - Price impact
 * 
 * Only the final settlement is visible on-chain, encrypted.
 */
export const CONFIDENTIAL_SWAP_CAPABILITY: Capability = {
  id: "cap.confidential.swap.v1",
  name: "Confidential Token Swap",
  description: "Execute fully private token swaps using Arcium MPC and C-SPL confidential tokens. Trade amounts, tokens, and addresses remain encrypted throughout execution.",
  inputs: {
    schema: {
      type: "object",
      properties: {
        input_token: { 
          type: "string", 
          description: "Input token mint address (encrypted in MPC)" 
        },
        output_token: { 
          type: "string", 
          description: "Output token mint address (encrypted in MPC)" 
        },
        amount: { 
          type: "number", 
          description: "Amount to swap (encrypted in MPC)" 
        },
        wallet_address: {
          type: "string",
          description: "Wallet address (encrypted in MPC)"
        },
        max_slippage_bps: {
          type: "number",
          description: "Maximum slippage in basis points (default: 50)"
        }
      },
      required: ["input_token", "output_token", "amount", "wallet_address"]
    },
    required: ["input_token", "output_token", "amount", "wallet_address"]
  },
  outputs: {
    schema: {
      type: "object",
      properties: {
        encrypted_transaction: { type: "string", description: "Encrypted transaction data" },
        proof: { type: "string", description: "ZK proof of valid swap" },
        attestation: { type: "string", description: "Arcium attestation" },
        commitment: { type: "string", description: "On-chain commitment hash" }
      }
    }
  },
  execution: {
    mode: "confidential",
    executor_hint: "arcium-mpc",
    proof_type: "arcium-attestation"
  },
  economics: {
    cost_hint: 0.05, // Higher cost for confidential compute
    currency: "SOL",
    x402_payment_signal: {
      enabled: true,
      settlement_optional: true,
      payment_methods: ["sol", "usdc"]
    }
  },
  performance: {
    latency_hint: "high", // MPC is slower than public
    reliability_hint: 0.95,
    throughput_limit: 10
  },
  version: "1.0.0",
  composable: true,
  metadata: {
    tags: ["privacy", "confidential", "defi", "swap", "arcium", "c-spl"],
    provider_hints: ["arcium-mpc"],
    privacy_guarantees: [
      "Trade amounts encrypted",
      "Token types hidden",
      "Wallet addresses confidential",
      "Only settlement visible on-chain"
    ]
  }
};
