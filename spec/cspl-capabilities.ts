import { Capability } from './capabilities';

/**
 * C-SPL Token Capabilities
 * 
 * Confidential SPL Token operations using Arcium:
 * - Wrap public tokens to confidential
 * - Unwrap confidential tokens to public
 * - Confidential transfers (hidden amounts)
 * - Confidential balance queries
 */

export const CSPL_WRAP_CAPABILITY: Capability = {
  id: "cap.cspl.wrap.v1",
  name: "Wrap Token to Confidential",
  description: "Convert public SPL tokens to confidential C-SPL tokens. Balance becomes encrypted on-chain.",
  inputs: {
    schema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "Wallet address" },
        mint: { type: "string", description: "Token mint address" },
        amount: { type: "number", description: "Amount to wrap" }
      },
      required: ["owner", "mint", "amount"]
    },
    required: ["owner", "mint", "amount"]
  },
  outputs: {
    schema: {
      type: "object",
      properties: {
        wrapped_mint: { type: "string" },
        amount_wrapped: { type: "number" },
        confidential_account: { type: "string" },
        transaction_signature: { type: "string" }
      }
    }
  },
  execution: {
    mode: "confidential",
    executor_hint: "arcium-cspl",
    proof_type: "arcium-attestation"
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
    tags: ["privacy", "cspl", "arcium", "tokens", "wrap"],
    provider_hints: ["arcium-cspl"]
  }
};

export const CSPL_TRANSFER_CAPABILITY: Capability = {
  id: "cap.cspl.transfer.v1",
  name: "Confidential Token Transfer",
  description: "Transfer tokens with hidden amounts. Only sender and receiver know the amount.",
  inputs: {
    schema: {
      type: "object",
      properties: {
        sender: { type: "string", description: "Sender wallet address" },
        recipient: { type: "string", description: "Recipient wallet address" },
        mint: { type: "string", description: "Token mint address" },
        amount: { type: "number", description: "Amount to transfer (encrypted)" }
      },
      required: ["sender", "recipient", "mint", "amount"]
    },
    required: ["sender", "recipient", "mint", "amount"]
  },
  outputs: {
    schema: {
      type: "object",
      properties: {
        transaction_signature: { type: "string" },
        encrypted_amount: { type: "string" },
        proof: { type: "string" },
        commitment: { type: "string" }
      }
    }
  },
  execution: {
    mode: "confidential",
    executor_hint: "arcium-cspl",
    proof_type: "arcium-attestation"
  },
  economics: {
    cost_hint: 0.02,
    currency: "SOL",
    x402_payment_signal: {
      enabled: true,
      settlement_optional: true,
      payment_methods: ["sol", "usdc"]
    }
  },
  performance: {
    latency_hint: "medium",
    reliability_hint: 0.97,
    throughput_limit: 30
  },
  version: "1.0.0",
  composable: true,
  metadata: {
    tags: ["privacy", "cspl", "arcium", "tokens", "transfer"],
    provider_hints: ["arcium-cspl"]
  }
};

export const FHE_COMPUTE_CAPABILITY: Capability = {
  id: "cap.fhe.compute.v1",
  name: "FHE Encrypted Computation",
  description: "Perform computation on encrypted data without decryption using Inco FHE.",
  inputs: {
    schema: {
      type: "object",
      properties: {
        operation: { 
          type: "string", 
          enum: ["add", "mul", "lt", "select"],
          description: "FHE operation to perform" 
        },
        operands: { 
          type: "array", 
          description: "Encrypted operands" 
        },
        encryption_type: {
          type: "string",
          enum: ["euint8", "euint16", "euint32", "euint64", "ebool"],
          description: "FHE encryption type"
        }
      },
      required: ["operation", "operands"]
    },
    required: ["operation", "operands"]
  },
  outputs: {
    schema: {
      type: "object",
      properties: {
        encrypted_result: { type: "string" },
        computation_proof: { type: "string" },
        gas_used: { type: "number" }
      }
    }
  },
  execution: {
    mode: "confidential",
    executor_hint: "inco-fhe"
  },
  economics: {
    cost_hint: 0.005,
    currency: "SOL",
    x402_payment_signal: {
      enabled: true,
      settlement_optional: true,
      payment_methods: ["sol", "usdc"]
    }
  },
  performance: {
    latency_hint: "low",
    reliability_hint: 0.99,
    throughput_limit: 200
  },
  version: "1.0.0",
  composable: true,
  metadata: {
    tags: ["privacy", "fhe", "inco", "computation", "encrypted"],
    provider_hints: ["inco-fhe"]
  }
};
