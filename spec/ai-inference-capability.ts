import { Capability } from './capabilities';

export const AI_INFERENCE_CAPABILITY: Capability = {
  id: "cap.ai.inference.v1",
  name: "Private AI Inference",
  description: "Execute AI model inference with encrypted inputs and outputs. Supports sentiment analysis, classification, embeddings, and custom models. Your prompts and data remain confidential.",
  inputs: {
    schema: {
      type: "object",
      properties: {
        model: { 
          type: "string", 
          description: "Model identifier (e.g., 'sentiment-analysis', 'classification', 'embeddings', 'custom')",
          enum: ["sentiment-analysis", "classification", "embeddings", "summarization", "custom"]
        },
        input: { 
          type: "string", 
          description: "Input text or data to process" 
        },
        privacy_level: { 
          type: "number", 
          description: "Privacy level: 0=public, 1=pseudonymous, 2=confidential (MPC), 3=maximum (FHE)",
          minimum: 0,
          maximum: 3,
          default: 2
        },
        model_config: {
          type: "object",
          description: "Optional model-specific configuration",
          properties: {
            temperature: { type: "number", minimum: 0, maximum: 2 },
            max_tokens: { type: "number", minimum: 1, maximum: 4096 },
            custom_model_id: { type: "string" }
          }
        },
        encrypt_output: {
          type: "boolean",
          description: "Whether to encrypt the output (default: false)",
          default: false
        }
      },
      required: ["model", "input"]
    },
    required: ["model", "input"]
  },
  outputs: {
    schema: {
      type: "object",
      properties: {
        result: { 
          type: "object",
          description: "Model output (structure depends on model type)"
        },
        model_used: { type: "string" },
        privacy_level: { type: "number" },
        encrypted: { type: "boolean" },
        proof: { 
          type: "string",
          description: "Cryptographic proof of correct execution"
        },
        execution_time_ms: { type: "number" }
      }
    }
  },
  execution: {
    mode: "confidential",
    proof_type: "arcium-attestation",
    executor_hint: "confidential-executor"
  },
  economics: {
    cost_hint: 0.01,
    currency: "SOL",
    x402_payment_signal: {
      enabled: true,
      settlement_optional: false,
      payment_methods: ["SOL", "USDC"]
    },
    privacy_cash_compatible: true
  },
  performance: {
    latency_hint: "medium",
    reliability_hint: 0.95,
    throughput_limit: 50
  },
  version: "1.0.0",
  deprecated: false,
  composable: true,
  metadata: {
    tags: ["ai", "inference", "privacy", "confidential-compute", "machine-learning"],
    provider_hints: ["arcium", "openai", "anthropic"],
    use_cases: [
      "Private sentiment analysis on confidential documents",
      "Secure classification without exposing training data",
      "Confidential embeddings for private search",
      "AI-powered analysis with data privacy"
    ],
    privacy_guarantees: [
      "Input data encrypted before processing",
      "Model weights remain confidential",
      "Output optionally encrypted",
      "Execution proof without data exposure"
    ]
  }
};

export const AI_EMBEDDING_CAPABILITY: Capability = {
  id: "cap.ai.embedding.v1",
  name: "Private Embeddings",
  description: "Generate vector embeddings for text with privacy guarantees. Useful for semantic search, similarity matching, and RAG applications without exposing your data.",
  inputs: {
    schema: {
      type: "object",
      properties: {
        texts: { 
          type: "array",
          items: { type: "string" },
          description: "Array of texts to embed (max 100)",
          maxItems: 100
        },
        model: {
          type: "string",
          description: "Embedding model to use",
          enum: ["text-embedding-3-small", "text-embedding-3-large", "custom"],
          default: "text-embedding-3-small"
        },
        privacy_level: { 
          type: "number",
          default: 2
        }
      },
      required: ["texts"]
    },
    required: ["texts"]
  },
  outputs: {
    schema: {
      type: "object",
      properties: {
        embeddings: {
          type: "array",
          items: {
            type: "array",
            items: { type: "number" }
          },
          description: "Vector embeddings for each input text"
        },
        dimensions: { type: "number" },
        model_used: { type: "string" },
        proof: { type: "string" }
      }
    }
  },
  execution: {
    mode: "confidential",
    proof_type: "arcium-attestation",
    executor_hint: "confidential-executor"
  },
  economics: {
    cost_hint: 0.005,
    currency: "SOL",
    x402_payment_signal: {
      enabled: true,
      settlement_optional: false,
      payment_methods: ["SOL", "USDC"]
    },
    privacy_cash_compatible: true
  },
  performance: {
    latency_hint: "low",
    reliability_hint: 0.98,
    throughput_limit: 100
  },
  version: "1.0.0",
  deprecated: false,
  composable: true,
  metadata: {
    tags: ["ai", "embeddings", "privacy", "semantic-search", "rag"],
    provider_hints: ["arcium", "openai"],
    use_cases: [
      "Private semantic search",
      "Confidential document similarity",
      "Secure RAG pipelines"
    ]
  }
};
