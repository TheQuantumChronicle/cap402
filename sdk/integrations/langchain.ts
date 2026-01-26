/**
 * CAP-402 LangChain Integration
 * 
 * Provides LangChain-compatible tools for using CAP-402 capabilities
 * in LangChain agents and chains.
 * 
 * Usage:
 * ```typescript
 * import { CAP402Toolkit } from '@cap402/sdk/integrations/langchain';
 * 
 * const toolkit = new CAP402Toolkit({ routerUrl: 'https://api.cap402.com' });
 * const tools = toolkit.getTools();
 * 
 * // Use with LangChain agent
 * const agent = new AgentExecutor({ tools, ... });
 * ```
 */

import { CAP402Client, createClient } from '../client';

interface ToolInput {
  name: string;
  description: string;
  schema: Record<string, any>;
}

interface ToolResult {
  output: string;
  success: boolean;
}

export interface LangChainTool {
  name: string;
  description: string;
  schema: Record<string, any>;
  call: (input: Record<string, any>) => Promise<string>;
}

export interface CAP402ToolkitConfig {
  routerUrl?: string;
  apiKey?: string;
  timeout?: number;
  includedCapabilities?: string[];
  excludedCapabilities?: string[];
}

export class CAP402Toolkit {
  private client: CAP402Client;
  private config: CAP402ToolkitConfig;

  constructor(config: CAP402ToolkitConfig = {}) {
    this.config = config;
    this.client = createClient(
      config.routerUrl || 'https://api.cap402.com',
      { timeout: config.timeout || 30000 }
    );
  }

  async getTools(): Promise<LangChainTool[]> {
    const capabilities = await this.client.discoverCapabilities();
    const tools: LangChainTool[] = [];

    for (const cap of capabilities) {
      // Filter based on config
      if (this.config.includedCapabilities && 
          !this.config.includedCapabilities.includes(cap.id)) {
        continue;
      }
      if (this.config.excludedCapabilities?.includes(cap.id)) {
        continue;
      }

      tools.push(this.capabilityToTool(cap));
    }

    // Add convenience tools
    tools.push(this.createPriceTool());
    tools.push(this.createKYCTool());
    tools.push(this.createAIInferenceTool());

    return tools;
  }

  private capabilityToTool(capability: any): LangChainTool {
    return {
      name: this.capabilityIdToToolName(capability.id),
      description: capability.description,
      schema: capability.inputs.schema,
      call: async (input: Record<string, any>) => {
        const result = await this.client.invokeCapability(capability.id, input);
        if (result.success) {
          return JSON.stringify(result.outputs);
        }
        return `Error: ${result.error}`;
      }
    };
  }

  private capabilityIdToToolName(id: string): string {
    // cap.price.lookup.v1 -> cap402_price_lookup
    return id.replace(/\./g, '_').replace(/_v\d+$/, '');
  }

  private createPriceTool(): LangChainTool {
    return {
      name: 'cap402_get_price',
      description: 'Get the current market price of a cryptocurrency token. Input should be the token symbol (e.g., "SOL", "BTC", "ETH").',
      schema: {
        type: 'object',
        properties: {
          token: { type: 'string', description: 'Token symbol' },
          quote: { type: 'string', description: 'Quote currency (default: USD)' }
        },
        required: ['token']
      },
      call: async (input: Record<string, any>) => {
        const result = await this.client.invokeCapability('cap.price.lookup.v1', {
          base_token: input.token,
          quote_token: input.quote || 'USD'
        });
        if (result.success && result.outputs) {
          return `${input.token} price: $${result.outputs.price} (source: ${result.outputs.source})`;
        }
        return `Error getting price: ${result.error}`;
      }
    };
  }

  private createKYCTool(): LangChainTool {
    return {
      name: 'cap402_verify_kyc',
      description: 'Verify KYC compliance using zero-knowledge proofs. Proves compliance without revealing personal data. Use this when you need to verify age, jurisdiction, or accreditation status privately.',
      schema: {
        type: 'object',
        properties: {
          verification_type: { 
            type: 'string', 
            enum: ['age', 'accreditation', 'jurisdiction'],
            description: 'Type of verification'
          },
          min_age: { type: 'number', description: 'Minimum age requirement (for age verification)' },
          allowed_jurisdictions: { 
            type: 'array', 
            items: { type: 'string' },
            description: 'Allowed country codes (for jurisdiction verification)'
          }
        },
        required: ['verification_type']
      },
      call: async (input: Record<string, any>) => {
        const result = await this.client.invokeCapability('cap.zk.kyc.v1', {
          verification_type: input.verification_type,
          private_inputs: {}, // User provides these securely
          public_inputs: {
            min_age: input.min_age || 18,
            allowed_jurisdictions: input.allowed_jurisdictions
          }
        });
        if (result.success && result.outputs) {
          return result.outputs.compliant 
            ? `KYC verification passed. Proof ID: ${result.outputs.verification_id}`
            : 'KYC verification failed - requirements not met';
        }
        return `Error: ${result.error}`;
      }
    };
  }

  private createAIInferenceTool(): LangChainTool {
    return {
      name: 'cap402_private_ai',
      description: 'Run AI inference with privacy guarantees. Your input data is encrypted and never exposed. Supports sentiment analysis, classification, and summarization.',
      schema: {
        type: 'object',
        properties: {
          model: { 
            type: 'string',
            enum: ['sentiment-analysis', 'classification', 'summarization'],
            description: 'AI model to use'
          },
          input: { type: 'string', description: 'Text to analyze' }
        },
        required: ['model', 'input']
      },
      call: async (input: Record<string, any>) => {
        const result = await this.client.invokeCapability('cap.ai.inference.v1', {
          model: input.model,
          input: input.input,
          privacy_level: 2
        });
        if (result.success && result.outputs) {
          return JSON.stringify(result.outputs.result);
        }
        return `Error: ${result.error}`;
      }
    };
  }
}

// Export factory function
export function createLangChainTools(config?: CAP402ToolkitConfig): Promise<LangChainTool[]> {
  const toolkit = new CAP402Toolkit(config);
  return toolkit.getTools();
}
