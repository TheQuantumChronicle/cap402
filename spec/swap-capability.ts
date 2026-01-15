import { Capability } from './capabilities';

export const SWAP_CAPABILITY: Capability = {
  id: "cap.swap.execute.v1",
  name: "Token Swap",
  description: "Execute token swaps with best price routing across DEXs",
  inputs: {
    schema: {
      type: "object",
      properties: {
        input_token: { 
          type: "string", 
          description: "Input token mint address or symbol" 
        },
        output_token: { 
          type: "string", 
          description: "Output token mint address or symbol" 
        },
        amount: { 
          type: "number", 
          description: "Amount of input token to swap" 
        },
        slippage_bps: { 
          type: "number", 
          description: "Maximum slippage in basis points (default: 50 = 0.5%)" 
        },
        wallet_address: {
          type: "string",
          description: "Wallet address to execute swap from"
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
        transaction_signature: { type: "string" },
        input_amount: { type: "number" },
        output_amount: { type: "number" },
        price_impact: { type: "number" },
        route: { type: "array" },
        fees: { type: "object" }
      }
    }
  },
  execution: {
    mode: "public",
    executor_hint: "jupiter-aggregator"
  },
  economics: {
    cost_hint: 0.001,
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
    throughput_limit: 100
  },
  version: "1.0.0",
  composable: true,
  metadata: {
    tags: ["defi", "swap", "trading"],
    provider_hints: ["jupiter", "raydium", "orca"]
  }
};
