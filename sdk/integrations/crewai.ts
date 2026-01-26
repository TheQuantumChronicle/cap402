/**
 * CAP-402 CrewAI Integration
 * 
 * Provides CrewAI-compatible agents and tools for using CAP-402 capabilities.
 * 
 * Usage:
 * ```typescript
 * import { CAP402CrewAgent, CAP402CrewTools } from '@cap402/sdk/integrations/crewai';
 * 
 * const tools = new CAP402CrewTools({ routerUrl: 'https://api.cap402.com' });
 * 
 * // Create a CrewAI agent with CAP-402 capabilities
 * const analyst = new CAP402CrewAgent({
 *   role: 'Market Analyst',
 *   goal: 'Analyze crypto markets with privacy',
 *   capabilities: ['cap.price.lookup.v1', 'cap.ai.inference.v1']
 * });
 * ```
 */

import { CAP402Client, createClient } from '../client';

export interface CrewToolConfig {
  routerUrl?: string;
  apiKey?: string;
}

export interface CrewAgentConfig {
  role: string;
  goal: string;
  backstory?: string;
  capabilities: string[];
  routerUrl?: string;
  verbose?: boolean;
}

export interface CrewTool {
  name: string;
  description: string;
  func: (...args: any[]) => Promise<string>;
}

export class CAP402CrewTools {
  private client: CAP402Client;

  constructor(config: CrewToolConfig = {}) {
    this.client = createClient(
      config.routerUrl || 'https://api.cap402.com'
    );
  }

  getTools(): CrewTool[] {
    return [
      this.createPriceTool(),
      this.createWalletTool(),
      this.createKYCTool(),
      this.createAITool(),
      this.createSwapTool(),
      this.createZKProofTool()
    ];
  }

  private createPriceTool(): CrewTool {
    return {
      name: 'get_crypto_price',
      description: 'Get the current market price of a cryptocurrency token. Input: token symbol (e.g., SOL, BTC, ETH)',
      func: async (token: string) => {
        const result = await this.client.invokeCapability('cap.price.lookup.v1', {
          base_token: token,
          quote_token: 'USD'
        });
        if (result.success && result.outputs) {
          return `${token}: $${result.outputs.price} USD`;
        }
        return `Error: ${result.error}`;
      }
    };
  }

  private createWalletTool(): CrewTool {
    return {
      name: 'analyze_wallet',
      description: 'Get wallet holdings and balances. Input: wallet address',
      func: async (address: string) => {
        const result = await this.client.invokeCapability('cap.wallet.snapshot.v1', {
          address,
          include_nfts: true
        });
        if (result.success && result.outputs) {
          const tokens = result.outputs.tokens || [];
          const summary = tokens.map((t: any) => `${t.symbol}: ${t.balance}`).join(', ');
          return `Wallet ${address.slice(0, 8)}... holdings: ${summary || 'No tokens found'}`;
        }
        return `Error: ${result.error}`;
      }
    };
  }

  private createKYCTool(): CrewTool {
    return {
      name: 'verify_kyc_privately',
      description: 'Verify KYC compliance using zero-knowledge proofs. Proves compliance without revealing personal data. Input: JSON with verification_type and requirements',
      func: async (inputJson: string) => {
        try {
          const input = JSON.parse(inputJson);
          const result = await this.client.invokeCapability('cap.zk.kyc.v1', {
            verification_type: input.verification_type || 'age',
            private_inputs: input.private_inputs || {},
            public_inputs: input.public_inputs || { min_age: 18 }
          });
          if (result.success && result.outputs) {
            return result.outputs.compliant 
              ? `KYC PASSED - Verification ID: ${result.outputs.verification_id}`
              : 'KYC FAILED - Requirements not met';
          }
          return `Error: ${result.error}`;
        } catch (e) {
          return 'Error: Invalid JSON input';
        }
      }
    };
  }

  private createAITool(): CrewTool {
    return {
      name: 'private_ai_analysis',
      description: 'Run AI analysis with privacy guarantees. Your data is encrypted. Input: JSON with model (sentiment-analysis, classification, summarization) and input text',
      func: async (inputJson: string) => {
        try {
          const input = JSON.parse(inputJson);
          const result = await this.client.invokeCapability('cap.ai.inference.v1', {
            model: input.model || 'sentiment-analysis',
            input: input.input || input.text,
            privacy_level: 2
          });
          if (result.success && result.outputs) {
            return JSON.stringify(result.outputs.result);
          }
          return `Error: ${result.error}`;
        } catch (e) {
          return 'Error: Invalid JSON input';
        }
      }
    };
  }

  private createSwapTool(): CrewTool {
    return {
      name: 'confidential_swap',
      description: 'Execute a private token swap with hidden amounts. Input: JSON with input_token, output_token, amount, wallet_address',
      func: async (inputJson: string) => {
        try {
          const input = JSON.parse(inputJson);
          const result = await this.client.invokeCapability('cap.confidential.swap.v1', {
            input_token: input.input_token,
            output_token: input.output_token,
            amount: input.amount,
            wallet_address: input.wallet_address
          });
          if (result.success && result.outputs) {
            return `Swap executed privately. Proof: ${result.outputs.proof?.slice(0, 20)}...`;
          }
          return `Error: ${result.error}`;
        } catch (e) {
          return 'Error: Invalid JSON input';
        }
      }
    };
  }

  private createZKProofTool(): CrewTool {
    return {
      name: 'generate_zk_proof',
      description: 'Generate a zero-knowledge proof. Input: JSON with circuit name and inputs',
      func: async (inputJson: string) => {
        try {
          const input = JSON.parse(inputJson);
          const result = await this.client.invokeCapability('cap.zk.proof.v1', {
            circuit: input.circuit,
            private_inputs: input.private_inputs || {},
            public_inputs: input.public_inputs || {}
          });
          if (result.success && result.outputs) {
            return `ZK Proof generated: ${result.outputs.valid ? 'VALID' : 'INVALID'}`;
          }
          return `Error: ${result.error}`;
        } catch (e) {
          return 'Error: Invalid JSON input';
        }
      }
    };
  }
}

export class CAP402CrewAgent {
  private client: CAP402Client;
  private config: CrewAgentConfig;

  constructor(config: CrewAgentConfig) {
    this.config = config;
    this.client = createClient(
      config.routerUrl || 'https://api.cap402.com'
    );
  }

  getAgentDefinition() {
    return {
      role: this.config.role,
      goal: this.config.goal,
      backstory: this.config.backstory || `An AI agent powered by CAP-402 with access to ${this.config.capabilities.length} privacy-preserving capabilities.`,
      verbose: this.config.verbose ?? true,
      tools: this.getTools()
    };
  }

  getTools(): CrewTool[] {
    const allTools = new CAP402CrewTools({ 
      routerUrl: this.config.routerUrl 
    }).getTools();
    
    // Filter to only enabled capabilities
    return allTools.filter(tool => {
      // Map tool names to capability IDs
      const toolToCapability: Record<string, string> = {
        'get_crypto_price': 'cap.price.lookup.v1',
        'analyze_wallet': 'cap.wallet.snapshot.v1',
        'verify_kyc_privately': 'cap.zk.kyc.v1',
        'private_ai_analysis': 'cap.ai.inference.v1',
        'confidential_swap': 'cap.confidential.swap.v1',
        'generate_zk_proof': 'cap.zk.proof.v1'
      };
      
      const capId = toolToCapability[tool.name];
      return !capId || this.config.capabilities.includes(capId);
    });
  }

  async invoke(capability: string, inputs: Record<string, any>): Promise<any> {
    if (!this.config.capabilities.includes(capability)) {
      throw new Error(`Capability ${capability} not enabled for this agent`);
    }
    
    const result = await this.client.invokeCapability(capability, inputs);
    return result;
  }
}

// Export factories
export function createCrewTools(config?: CrewToolConfig): CAP402CrewTools {
  return new CAP402CrewTools(config);
}

export function createCrewAgent(config: CrewAgentConfig): CAP402CrewAgent {
  return new CAP402CrewAgent(config);
}
