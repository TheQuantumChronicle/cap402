/**
 * Composition Templates
 * 
 * Pre-built capability workflows that agents can use out of the box.
 * This is a major differentiator - agents don't need to figure out
 * how to chain capabilities, we provide battle-tested templates.
 * 
 * Templates are versioned and can be customized.
 */

export interface CompositionTemplate {
  id: string;
  name: string;
  description: string;
  use_case: string;
  capabilities: Array<{
    capability_id: string;
    input_mapping: Record<string, any>;
    output_alias: string;
    privacy_level?: 0 | 1 | 2 | 3; // Privacy requirement for this step
  }>;
  required_inputs: string[];
  final_output: string;
  estimated_cost: number;
  estimated_time_ms: number;
  tags: string[];
  // New: Advanced features
  atomic?: boolean; // All or nothing execution
  min_privacy_level?: 0 | 1 | 2 | 3; // Minimum privacy for entire workflow
  generates_receipt?: boolean; // Whether to generate a receipt
}

export const COMPOSITION_TEMPLATES: CompositionTemplate[] = [
  {
    id: 'template.private-swap.v1',
    name: 'Private Token Swap',
    description: 'Wrap tokens to confidential, execute private swap, return result',
    use_case: 'trading',
    capabilities: [
      {
        capability_id: 'cap.cspl.wrap.v1',
        input_mapping: {
          owner: '{{wallet_address}}',
          mint: '{{input_token}}',
          amount: '{{amount}}'
        },
        output_alias: 'wrap_result',
        privacy_level: 2
      },
      {
        capability_id: 'cap.confidential.swap.v1',
        input_mapping: {
          wallet_address: '{{wallet_address}}',
          input_token: '{{wrap_result.wrapped_mint}}',
          output_token: '{{output_token}}',
          amount: '{{amount}}'
        },
        output_alias: 'swap_result',
        privacy_level: 2
      }
    ],
    required_inputs: ['wallet_address', 'input_token', 'output_token', 'amount'],
    final_output: 'swap_result',
    estimated_cost: 0.06,
    estimated_time_ms: 3000,
    tags: ['privacy', 'trading', 'defi', 'arcium'],
    atomic: true,
    min_privacy_level: 2,
    generates_receipt: true
  },
  {
    id: 'template.verified-trade.v1',
    name: 'KYC-Verified Trade',
    description: 'Prove KYC compliance with ZK proof, then execute trade',
    use_case: 'compliance',
    capabilities: [
      {
        capability_id: 'cap.zk.proof.v1',
        input_mapping: {
          proof_type: 'kyc_compliance',
          circuit: 'kyc_compliance',
          public_inputs: {
            compliance_level: '{{compliance_level}}',
            jurisdiction: '{{jurisdiction}}'
          },
          private_inputs: {
            kyc_data: '{{kyc_data}}',
            verifier_attestation: '{{attestation}}'
          }
        },
        output_alias: 'kyc_proof',
        privacy_level: 3
      },
      {
        capability_id: 'cap.swap.execute.v1',
        input_mapping: {
          input_token: '{{input_token}}',
          output_token: '{{output_token}}',
          amount: '{{amount}}',
          wallet_address: '{{wallet_address}}',
          compliance_proof: '{{kyc_proof.proof}}'
        },
        output_alias: 'trade_result',
        privacy_level: 0
      }
    ],
    required_inputs: ['wallet_address', 'input_token', 'output_token', 'amount', 'compliance_level', 'jurisdiction', 'kyc_data', 'attestation'],
    final_output: 'trade_result',
    estimated_cost: 0.02,
    estimated_time_ms: 2000,
    tags: ['compliance', 'kyc', 'trading', 'zk'],
    atomic: true,
    generates_receipt: true
  },
  {
    id: 'template.portfolio-check.v1',
    name: 'Portfolio Health Check',
    description: 'Get wallet snapshot, check prices, calculate total value',
    use_case: 'portfolio',
    capabilities: [
      {
        capability_id: 'cap.wallet.snapshot.v1',
        input_mapping: {
          address: '{{wallet_address}}',
          include_das_data: true
        },
        output_alias: 'wallet'
      },
      {
        capability_id: 'cap.price.lookup.v1',
        input_mapping: {
          base_token: 'SOL',
          quote_token: 'USD'
        },
        output_alias: 'sol_price'
      }
    ],
    required_inputs: ['wallet_address'],
    final_output: 'wallet',
    estimated_cost: 0.002,
    estimated_time_ms: 1000,
    tags: ['portfolio', 'analytics', 'wallet']
  },
  {
    id: 'template.private-message-with-proof.v1',
    name: 'Verified Private Message',
    description: 'Generate credential proof, then send encrypted message',
    use_case: 'messaging',
    capabilities: [
      {
        capability_id: 'cap.zk.proof.v1',
        input_mapping: {
          proof_type: 'credential_ownership',
          circuit: 'credential_ownership',
          public_inputs: {
            credential_type: '{{credential_type}}',
            issuer_pubkey: '{{issuer}}'
          },
          private_inputs: {
            credential_data: '{{credential}}',
            owner_signature: '{{signature}}'
          }
        },
        output_alias: 'credential_proof'
      },
      {
        capability_id: 'cap.lightning.message.v1',
        input_mapping: {
          sender: '{{sender}}',
          recipient: '{{recipient}}',
          message: '{{message}}',
          credential_proof: '{{credential_proof.proof}}'
        },
        output_alias: 'message_result'
      }
    ],
    required_inputs: ['sender', 'recipient', 'message', 'credential_type', 'issuer', 'credential', 'signature'],
    final_output: 'message_result',
    estimated_cost: 0.011,
    estimated_time_ms: 1500,
    tags: ['messaging', 'privacy', 'credentials', 'zk']
  },
  {
    id: 'template.balance-threshold-swap.v1',
    name: 'Balance-Gated Swap',
    description: 'Prove balance threshold, then execute swap if qualified',
    use_case: 'defi',
    capabilities: [
      {
        capability_id: 'cap.zk.proof.v1',
        input_mapping: {
          proof_type: 'balance_threshold',
          circuit: 'balance_threshold',
          public_inputs: {
            threshold: '{{min_balance}}',
            token_mint: '{{token}}'
          },
          private_inputs: {
            actual_balance: '{{actual_balance}}',
            wallet_signature: '{{signature}}'
          }
        },
        output_alias: 'balance_proof'
      },
      {
        capability_id: 'cap.swap.execute.v1',
        input_mapping: {
          input_token: '{{input_token}}',
          output_token: '{{output_token}}',
          amount: '{{amount}}',
          wallet_address: '{{wallet_address}}'
        },
        output_alias: 'swap_result'
      }
    ],
    required_inputs: ['wallet_address', 'input_token', 'output_token', 'amount', 'min_balance', 'token', 'actual_balance', 'signature'],
    final_output: 'swap_result',
    estimated_cost: 0.02,
    estimated_time_ms: 2000,
    tags: ['defi', 'zk', 'trading', 'gated']
  },
  {
    id: 'template.private-governance-vote.v1',
    name: 'Private DAO Vote',
    description: 'Prove voting eligibility with ZK, submit encrypted vote',
    use_case: 'governance',
    capabilities: [
      {
        capability_id: 'cap.zk.proof.v1',
        input_mapping: {
          proof_type: 'voting_eligibility',
          circuit: 'voting_eligibility',
          public_inputs: {
            proposal_id: '{{proposal_id}}',
            dao_address: '{{dao_address}}'
          },
          private_inputs: {
            token_balance: '{{token_balance}}',
            delegation_proof: '{{delegation}}',
            voter_signature: '{{signature}}'
          }
        },
        output_alias: 'eligibility_proof'
      },
      {
        capability_id: 'cap.private.governance.v1',
        input_mapping: {
          proposal_id: '{{proposal_id}}',
          vote: '{{vote}}',
          voting_power: '{{voting_power}}',
          eligibility_proof: '{{eligibility_proof.proof}}'
        },
        output_alias: 'vote_result'
      }
    ],
    required_inputs: ['proposal_id', 'dao_address', 'vote', 'voting_power', 'token_balance', 'delegation', 'signature'],
    final_output: 'vote_result',
    estimated_cost: 0.02,
    estimated_time_ms: 2500,
    tags: ['governance', 'dao', 'voting', 'privacy', 'zk']
  }
];

class CompositionTemplateEngine {
  private templates: Map<string, CompositionTemplate> = new Map();

  constructor() {
    for (const template of COMPOSITION_TEMPLATES) {
      this.templates.set(template.id, template);
    }
  }

  /**
   * Get all available templates
   */
  getTemplates(): CompositionTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * Get template by ID
   */
  getTemplate(id: string): CompositionTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * Search templates by use case or tags
   */
  searchTemplates(query: {
    use_case?: string;
    tags?: string[];
    max_cost?: number;
  }): CompositionTemplate[] {
    let results = Array.from(this.templates.values());

    if (query.use_case) {
      results = results.filter(t => t.use_case === query.use_case);
    }

    if (query.tags && query.tags.length > 0) {
      results = results.filter(t => 
        query.tags!.some(tag => t.tags.includes(tag))
      );
    }

    if (query.max_cost !== undefined) {
      results = results.filter(t => t.estimated_cost <= query.max_cost!);
    }

    return results;
  }

  /**
   * Validate inputs for a template
   */
  validateInputs(templateId: string, inputs: Record<string, any>): {
    valid: boolean;
    missing: string[];
  } {
    const template = this.templates.get(templateId);
    if (!template) {
      return { valid: false, missing: ['Template not found'] };
    }

    const missing = template.required_inputs.filter(input => 
      inputs[input] === undefined
    );

    return {
      valid: missing.length === 0,
      missing
    };
  }

  /**
   * Get template recommendations based on context
   */
  recommend(context: {
    recent_capabilities?: string[];
    agent_type?: string;
    use_case?: string;
  }): CompositionTemplate[] {
    if (context.use_case) {
      return this.searchTemplates({ use_case: context.use_case });
    }

    // Recommend based on recent capabilities
    if (context.recent_capabilities && context.recent_capabilities.length > 0) {
      return Array.from(this.templates.values()).filter(t =>
        t.capabilities.some(c => 
          context.recent_capabilities!.includes(c.capability_id)
        )
      );
    }

    // Return most popular templates
    return Array.from(this.templates.values()).slice(0, 3);
  }
}

export const compositionTemplateEngine = new CompositionTemplateEngine();
