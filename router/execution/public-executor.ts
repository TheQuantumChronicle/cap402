import { Executor, ExecutionContext, ExecutionResult } from './types';
import { integrationManager } from '../../providers/integration-manager';
import { swapProvider } from '../../providers/swap';
import { heliusDASProvider } from '../../providers/helius-das';

export class PublicExecutor implements Executor {
  name = "public-executor";

  getPrivacyLevel(): 0 | 1 | 2 | 3 {
    return 0; // Public executor operates at L0
  }

  supportsProofType(proofType: string): boolean {
    return proofType === 'none'; // Public executor doesn't generate proofs
  }

  canExecute(capability_id: string): boolean {
    return capability_id.includes('price.lookup') || 
           capability_id.includes('wallet.snapshot') ||
           capability_id.includes('swap.execute');
  }

  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    try {
      let outputs: Record<string, any>;
      let provider_used: string;

      if (context.capability_id.includes('price.lookup')) {
        const price = await integrationManager.getPrice(
          context.inputs.base_token,
          context.inputs.quote_token || 'USD'
        );
        outputs = price;
        provider_used = price.source;
      } else if (context.capability_id.includes('swap.execute')) {
        const swapResult = await swapProvider.executeSwap(
          context.inputs.input_token,
          context.inputs.output_token,
          context.inputs.amount,
          context.inputs.wallet_address,
          context.inputs.slippage_bps || 50
        );

        if (!swapResult.success) {
          throw new Error(swapResult.error || 'Swap failed');
        }

        outputs = {
          transaction_signature: swapResult.transaction_signature,
          input_amount: swapResult.input_amount,
          output_amount: swapResult.output_amount,
          price_impact: swapResult.price_impact,
          route: swapResult.route,
          fees: swapResult.fees
        };
        provider_used = 'jupiter-aggregator';
      } else if (context.capability_id.includes('wallet.snapshot')) {
        const wallet = await integrationManager.getWalletSnapshot(
          context.inputs.address,
          context.inputs.network || 'solana-mainnet',
          {
            include_nfts: context.inputs.include_nfts || false,
            include_history: context.inputs.include_history || false
          }
        );

        // Enhance with Helius DAS for richer data if requested
        if (context.inputs.include_das_data) {
          try {
            const [fungibleTokens, nfts] = await Promise.all([
              heliusDASProvider.getFungibleTokens(context.inputs.address),
              context.inputs.include_nfts 
                ? heliusDASProvider.getNFTs(context.inputs.address)
                : Promise.resolve([])
            ]);

            outputs = {
              ...wallet,
              das_enhanced: true,
              fungible_tokens: fungibleTokens,
              nfts: nfts,
              total_token_value_usd: fungibleTokens.reduce(
                (sum, t) => sum + (t.total_value_usd || 0), 0
              )
            };
          } catch (dasError) {
            // Fallback to basic wallet data if DAS fails
            outputs = { ...wallet, das_enhanced: false };
          }
        } else {
          outputs = wallet;
        }
        provider_used = 'helius-das';
      } else {
        return {
          success: false,
          outputs: {},
          error: `Capability ${context.capability_id} not supported by public executor`,
          metadata: {
            executor: this.name,
            execution_time_ms: Date.now() - startTime,
            cost_actual: 0
          }
        };
      }

      return {
        success: true,
        outputs,
        metadata: {
          executor: this.name,
          execution_time_ms: Date.now() - startTime,
          cost_actual: 0.0001,
          provider_used
        }
      };
    } catch (error) {
      return {
        success: false,
        outputs: {},
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          executor: this.name,
          execution_time_ms: Date.now() - startTime,
          cost_actual: 0
        }
      };
    }
  }
}
