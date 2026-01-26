/**
 * CAP-402 AutoGPT Integration
 * 
 * Provides AutoGPT-compatible tools for using CAP-402 capabilities.
 * 
 * Usage:
 * ```typescript
 * import { CAP402AutoGPTPlugin } from '@cap402/sdk/integrations/autogpt';
 * 
 * const plugin = new CAP402AutoGPTPlugin({
 *   routerUrl: 'https://api.cap402.com'
 * });
 * 
 * // Get commands for AutoGPT
 * const commands = plugin.getCommands();
 * ```
 */

import { CAP402Client, createClient } from '../client';

export interface AutoGPTCommand {
  name: string;
  description: string;
  method: string;
  signature: string;
  enabled: boolean;
  disabled_reason?: string;
}

export interface AutoGPTPluginConfig {
  routerUrl?: string;
  apiKey?: string;
  enabledCapabilities?: string[];
}

export class CAP402AutoGPTPlugin {
  private client: CAP402Client;
  private config: AutoGPTPluginConfig;

  constructor(config: AutoGPTPluginConfig = {}) {
    this.config = config;
    this.client = createClient(
      config.routerUrl || 'https://api.cap402.com'
    );
  }

  getCommands(): AutoGPTCommand[] {
    return [
      {
        name: 'cap402_get_price',
        description: 'Get the current market price of a cryptocurrency. Returns price in USD.',
        method: 'get_price',
        signature: '(token: str, quote: str = "USD") -> str',
        enabled: true
      },
      {
        name: 'cap402_private_kyc',
        description: 'Verify KYC compliance using zero-knowledge proofs. Proves you meet requirements without revealing personal data.',
        method: 'verify_kyc',
        signature: '(verification_type: str, requirements: dict) -> dict',
        enabled: true
      },
      {
        name: 'cap402_private_ai',
        description: 'Run AI inference with privacy guarantees. Your input is encrypted and never exposed.',
        method: 'private_ai_inference',
        signature: '(model: str, input: str) -> dict',
        enabled: true
      },
      {
        name: 'cap402_confidential_swap',
        description: 'Execute a token swap with hidden amounts. Protects against MEV and front-running.',
        method: 'confidential_swap',
        signature: '(input_token: str, output_token: str, amount: float, wallet: str) -> dict',
        enabled: true
      },
      {
        name: 'cap402_wallet_snapshot',
        description: 'Get a snapshot of wallet holdings including tokens and NFTs.',
        method: 'wallet_snapshot',
        signature: '(address: str, include_nfts: bool = False) -> dict',
        enabled: true
      },
      {
        name: 'cap402_zk_proof',
        description: 'Generate a zero-knowledge proof for various assertions (balance threshold, age, etc.)',
        method: 'generate_zk_proof',
        signature: '(circuit: str, private_inputs: dict, public_inputs: dict) -> dict',
        enabled: true
      }
    ];
  }

  async get_price(token: string, quote: string = 'USD'): Promise<string> {
    const result = await this.client.invokeCapability('cap.price.lookup.v1', {
      base_token: token,
      quote_token: quote
    });
    
    if (result.success && result.outputs) {
      return `${token} price: $${result.outputs.price} USD (source: ${result.outputs.source})`;
    }
    return `Error: ${result.error}`;
  }

  async verify_kyc(
    verification_type: string,
    requirements: Record<string, any>
  ): Promise<Record<string, any>> {
    const result = await this.client.invokeCapability('cap.zk.kyc.v1', {
      verification_type,
      private_inputs: requirements.private_inputs || {},
      public_inputs: requirements.public_inputs || {}
    });
    
    if (result.success && result.outputs) {
      return {
        compliant: result.outputs.compliant,
        proof: result.outputs.proof,
        verification_id: result.outputs.verification_id
      };
    }
    return { error: result.error };
  }

  async private_ai_inference(
    model: string,
    input: string
  ): Promise<Record<string, any>> {
    const result = await this.client.invokeCapability('cap.ai.inference.v1', {
      model,
      input,
      privacy_level: 2
    });
    
    if (result.success && result.outputs) {
      return result.outputs.result;
    }
    return { error: result.error };
  }

  async confidential_swap(
    input_token: string,
    output_token: string,
    amount: number,
    wallet: string
  ): Promise<Record<string, any>> {
    const result = await this.client.invokeCapability('cap.confidential.swap.v1', {
      input_token,
      output_token,
      amount,
      wallet_address: wallet
    });
    
    if (result.success && result.outputs) {
      return {
        success: true,
        encrypted_input: result.outputs.encrypted_input,
        encrypted_output: result.outputs.encrypted_output,
        proof: result.outputs.proof
      };
    }
    return { error: result.error };
  }

  async wallet_snapshot(
    address: string,
    include_nfts: boolean = false
  ): Promise<Record<string, any>> {
    const result = await this.client.invokeCapability('cap.wallet.snapshot.v1', {
      address,
      include_nfts
    });
    
    if (result.success && result.outputs) {
      return result.outputs;
    }
    return { error: result.error };
  }

  async generate_zk_proof(
    circuit: string,
    private_inputs: Record<string, any>,
    public_inputs: Record<string, any>
  ): Promise<Record<string, any>> {
    const result = await this.client.invokeCapability('cap.zk.proof.v1', {
      circuit,
      private_inputs,
      public_inputs
    });
    
    if (result.success && result.outputs) {
      return {
        valid: result.outputs.valid,
        proof: result.outputs.proof,
        public_outputs: result.outputs.public_outputs
      };
    }
    return { error: result.error };
  }
}

// Export factory
export function createAutoGPTPlugin(config?: AutoGPTPluginConfig): CAP402AutoGPTPlugin {
  return new CAP402AutoGPTPlugin(config);
}
