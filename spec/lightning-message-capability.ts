import { Capability } from './capabilities';

/**
 * Lightning Private Message Capability
 * 
 * Uses Inco for lightning-fast confidential messaging between agents.
 * Unlike traditional encrypted messaging, this provides:
 * - Native-speed confidentiality (no MPC overhead)
 * - End-to-end encryption
 * - Ephemeral keys
 * - No message content stored on-chain
 * 
 * Perfect for agent-to-agent coordination, private negotiations,
 * and confidential data exchange.
 */
export const LIGHTNING_MESSAGE_CAPABILITY: Capability = {
  id: "cap.lightning.message.v1",
  name: "Lightning Private Message",
  description: "Send lightning-fast confidential messages between agents using Inco. Messages are encrypted end-to-end with no on-chain storage of content.",
  inputs: {
    schema: {
      type: "object",
      properties: {
        recipient: {
          type: "string",
          description: "Recipient agent address or public key"
        },
        message: {
          type: "string",
          description: "Message content (encrypted before transmission)"
        },
        ttl_seconds: {
          type: "number",
          description: "Time-to-live in seconds (default: 3600)"
        },
        ephemeral: {
          type: "boolean",
          description: "Use ephemeral keys (default: true)"
        },
        priority: {
          type: "string",
          enum: ["low", "normal", "high"],
          description: "Message priority (default: normal)"
        }
      },
      required: ["recipient", "message"]
    },
    required: ["recipient", "message"]
  },
  outputs: {
    schema: {
      type: "object",
      properties: {
        message_id: { type: "string", description: "Unique message identifier" },
        encrypted_payload: { type: "string", description: "Encrypted message payload" },
        delivery_proof: { type: "string", description: "Proof of delivery" },
        timestamp: { type: "number", description: "Unix timestamp" },
        expires_at: { type: "number", description: "Expiration timestamp" }
      }
    }
  },
  execution: {
    mode: "confidential",
    executor_hint: "inco-lightning",
    proof_type: "delivery-receipt"
  },
  economics: {
    cost_hint: 0.0001, // Very cheap for messaging
    currency: "SOL",
    x402_payment_signal: {
      enabled: true,
      settlement_optional: true,
      payment_methods: ["sol", "usdc"]
    }
  },
  performance: {
    latency_hint: "low", // Lightning fast!
    reliability_hint: 0.99,
    throughput_limit: 1000
  },
  version: "1.0.0",
  composable: true,
  metadata: {
    tags: ["privacy", "messaging", "inco", "lightning", "confidential"],
    provider_hints: ["inco-lightning"],
    use_cases: [
      "Agent-to-agent private coordination",
      "Confidential trade negotiations",
      "Private data exchange",
      "Encrypted notifications"
    ]
  }
};
