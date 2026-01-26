import { Capability } from './capabilities';

export const KYC_PROOF_CAPABILITY: Capability = {
  id: "cap.zk.kyc.v1",
  name: "Private KYC Verification",
  description: "Prove KYC compliance without revealing personal data. Verifiers learn only that requirements are met, not the underlying information. Supports age verification, accreditation status, jurisdiction checks, and custom compliance rules.",
  inputs: {
    schema: {
      type: "object",
      properties: {
        verification_type: {
          type: "string",
          description: "Type of KYC verification to perform",
          enum: ["age", "accreditation", "jurisdiction", "aml", "full_kyc", "custom"]
        },
        private_inputs: {
          type: "object",
          description: "Private data that will NOT be revealed (only used to generate proof)",
          properties: {
            date_of_birth: { type: "string", format: "date" },
            country_code: { type: "string", minLength: 2, maxLength: 3 },
            accredited_investor: { type: "boolean" },
            net_worth_usd: { type: "number" },
            annual_income_usd: { type: "number" },
            pep_status: { type: "boolean" },
            sanctions_clear: { type: "boolean" },
            identity_hash: { type: "string" }
          }
        },
        public_inputs: {
          type: "object",
          description: "Public parameters that define the requirements",
          properties: {
            min_age: { type: "number", default: 18 },
            allowed_jurisdictions: { 
              type: "array", 
              items: { type: "string" },
              description: "List of allowed country codes"
            },
            blocked_jurisdictions: {
              type: "array",
              items: { type: "string" },
              description: "List of blocked country codes"
            },
            require_accreditation: { type: "boolean" },
            min_net_worth: { type: "number" },
            require_aml_clear: { type: "boolean" }
          }
        },
        verifier_id: {
          type: "string",
          description: "Optional identifier of the verifying party"
        }
      },
      required: ["verification_type", "private_inputs", "public_inputs"]
    },
    required: ["verification_type", "private_inputs", "public_inputs"]
  },
  outputs: {
    schema: {
      type: "object",
      properties: {
        compliant: { 
          type: "boolean",
          description: "Whether the user meets all requirements"
        },
        proof: { 
          type: "string",
          description: "ZK proof that can be verified without revealing private data"
        },
        public_outputs: {
          type: "object",
          description: "Public signals from the proof (no private data)",
          properties: {
            verification_type: { type: "string" },
            timestamp: { type: "number" },
            verifier_id: { type: "string" },
            requirements_hash: { type: "string" }
          }
        },
        verification_id: {
          type: "string",
          description: "Unique ID for this verification (can be used for audit)"
        },
        expires_at: {
          type: "number",
          description: "Unix timestamp when this proof expires"
        }
      }
    }
  },
  execution: {
    mode: "confidential",
    proof_type: "zk-snark",
    executor_hint: "confidential-executor"
  },
  economics: {
    cost_hint: 0.02,
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
    reliability_hint: 0.99,
    throughput_limit: 100
  },
  version: "1.0.0",
  deprecated: false,
  composable: true,
  metadata: {
    tags: ["kyc", "compliance", "zk-proof", "privacy", "identity", "verification"],
    provider_hints: ["noir", "arcium"],
    use_cases: [
      "Prove you are 18+ without revealing birthdate",
      "Prove accredited investor status without revealing net worth",
      "Prove jurisdiction compliance without revealing location",
      "Prove AML clearance without revealing identity",
      "Onboard to DeFi protocols with privacy"
    ],
    privacy_guarantees: [
      "Personal data never leaves user device",
      "Only compliance status revealed to verifier",
      "Proof is cryptographically unforgeable",
      "No correlation between verifications possible"
    ]
  }
};

export const CREDENTIAL_PROOF_CAPABILITY: Capability = {
  id: "cap.zk.credential.v1",
  name: "Private Credential Verification",
  description: "Prove ownership of credentials (degrees, certifications, memberships) without revealing the credential itself. Useful for job applications, access control, and reputation systems.",
  inputs: {
    schema: {
      type: "object",
      properties: {
        credential_type: {
          type: "string",
          enum: ["degree", "certification", "membership", "license", "badge", "custom"]
        },
        private_inputs: {
          type: "object",
          properties: {
            credential_hash: { type: "string" },
            issuer_signature: { type: "string" },
            issue_date: { type: "string" },
            expiry_date: { type: "string" },
            holder_id: { type: "string" }
          }
        },
        public_inputs: {
          type: "object",
          properties: {
            accepted_issuers: { type: "array", items: { type: "string" } },
            credential_types: { type: "array", items: { type: "string" } },
            not_expired: { type: "boolean", default: true }
          }
        }
      },
      required: ["credential_type", "private_inputs", "public_inputs"]
    },
    required: ["credential_type", "private_inputs", "public_inputs"]
  },
  outputs: {
    schema: {
      type: "object",
      properties: {
        valid: { type: "boolean" },
        proof: { type: "string" },
        credential_type: { type: "string" },
        issuer_verified: { type: "boolean" },
        not_expired: { type: "boolean" }
      }
    }
  },
  execution: {
    mode: "confidential",
    proof_type: "zk-snark",
    executor_hint: "confidential-executor"
  },
  economics: {
    cost_hint: 0.015,
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
    reliability_hint: 0.99,
    throughput_limit: 100
  },
  version: "1.0.0",
  deprecated: false,
  composable: true,
  metadata: {
    tags: ["credential", "verification", "zk-proof", "privacy", "identity"],
    provider_hints: ["noir"],
    use_cases: [
      "Prove degree without revealing institution",
      "Prove professional license without revealing ID",
      "Prove membership without revealing member details"
    ]
  }
};
