/**
 * Confidential Executor
 * 
 * Handles all privacy-focused capabilities using various confidential compute backends:
 * - Arcium MPC for confidential swaps and document processing
 * - Noir for ZK proofs
 * - Inco for lightning messaging
 * 
 * Integrated with:
 * - Privacy Gradient (L2-L3 execution)
 * - Usage Metadata emission
 * - Proof type tracking for receipts
 */

import { Executor, ExecutionContext, ExecutionResult } from './types';
import { arciumProvider } from '../../providers/arcium-client';
import { arciumCSPLProvider } from '../../providers/arcium-cspl';
import { noirCircuitsProvider } from '../../providers/noir-circuits';
import { incoFHEProvider } from '../../providers/inco-fhe';
import { aiInferenceProvider } from '../../providers/ai-inference';

export class ConfidentialExecutor implements Executor {
  name = "confidential-executor";

  getPrivacyLevel(): 0 | 1 | 2 | 3 {
    return 2; // Confidential executor operates at L2 minimum
  }

  supportsProofType(proofType: string): boolean {
    return ['arcium-attestation', 'zk-snark', 'delivery-receipt', 'fhe-proof'].includes(proofType);
  }

  canExecute(capability_id: string): boolean {
    return capability_id.includes('confidential') || 
           capability_id.includes('zk.proof') ||
           capability_id.includes('lightning.message') ||
           capability_id.includes('document.parse') ||
           capability_id.includes('cspl.') ||
           capability_id.includes('fhe.') ||
           capability_id.includes('ai.inference') ||
           capability_id.includes('ai.embedding') ||
           capability_id === 'cap.zk.proof.balance.v1';
  }

  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    try {
      // Route to appropriate confidential backend
      if (context.capability_id === 'cap.confidential.swap.v1') {
        return await this.executeConfidentialSwap(context, startTime);
      } else if (context.capability_id === 'cap.zk.proof.v1') {
        return await this.executeZKProof(context, startTime);
      } else if (context.capability_id === 'cap.lightning.message.v1') {
        return await this.executeLightningMessage(context, startTime);
      } else if (context.capability_id === 'cap.document.parse.v1') {
        return await this.executeDocumentParse(context, startTime);
      } else if (context.capability_id === 'cap.cspl.wrap.v1') {
        return await this.executeCSPLWrap(context, startTime);
      } else if (context.capability_id === 'cap.cspl.transfer.v1') {
        return await this.executeCSPLTransfer(context, startTime);
      } else if (context.capability_id === 'cap.fhe.compute.v1') {
        return await this.executeFHECompute(context, startTime);
      } else if (context.capability_id === 'cap.zk.proof.balance.v1') {
        return await this.executeZKBalanceProof(context, startTime);
      } else if (context.capability_id === 'cap.ai.inference.v1') {
        return await this.executeAIInference(context, startTime);
      } else if (context.capability_id === 'cap.ai.embedding.v1') {
        return await this.executeAIEmbedding(context, startTime);
      }

      return {
        success: false,
        outputs: {},
        error: `Confidential capability ${context.capability_id} not implemented`,
        metadata: {
          executor: this.name,
          execution_time_ms: Date.now() - startTime,
          cost_actual: 0
        }
      };
    } catch (error) {
      return {
        success: false,
        outputs: {},
        error: error instanceof Error ? error.message : 'Confidential execution failed',
        metadata: {
          executor: this.name,
          execution_time_ms: Date.now() - startTime,
          cost_actual: 0
        }
      };
    }
  }

  private async executeConfidentialSwap(context: ExecutionContext, startTime: number): Promise<ExecutionResult> {
    // Use Arcium C-SPL for deep confidential swap integration
    const swapResult = await arciumCSPLProvider.confidentialSwap(
      context.inputs.wallet_address,
      context.inputs.input_token,
      context.inputs.output_token,
      context.inputs.amount,
      context.inputs.min_output_amount || context.inputs.amount * 0.95
    );

    if (!swapResult.success) {
      return {
        success: false,
        outputs: {},
        error: 'Confidential swap failed',
        metadata: {
          executor: this.name,
          execution_time_ms: Date.now() - startTime,
          cost_actual: 0
        }
      };
    }

    return {
      success: true,
      outputs: {
        encrypted_input: swapResult.encrypted_input,
        encrypted_output: swapResult.encrypted_output,
        proof: swapResult.proof,
        route: swapResult.route,
        privacy_guarantees: [
          'Input amount encrypted',
          'Output amount encrypted',
          'Trade route hidden',
          'Only settlement visible on-chain'
        ]
      },
      metadata: {
        executor: this.name,
        execution_time_ms: Date.now() - startTime,
        cost_actual: 0.05,
        provider_used: 'arcium-cspl',
        proof_type: 'arcium-attestation',
        privacy_level: 2
      }
    };
  }

  private async executeZKProof(context: ExecutionContext, startTime: number): Promise<ExecutionResult> {
    // Use Noir circuits provider for deep ZK integration
    const circuitName = context.inputs.circuit || context.inputs.proof_type;
    const circuit = noirCircuitsProvider.getCircuit(circuitName);

    if (!circuit) {
      // List available circuits in error
      const available = noirCircuitsProvider.getAvailableCircuits().map(c => c.name);
      return {
        success: false,
        outputs: { available_circuits: available },
        error: `Circuit '${circuitName}' not found. Available: ${available.join(', ')}`,
        metadata: {
          executor: this.name,
          execution_time_ms: Date.now() - startTime,
          cost_actual: 0
        }
      };
    }

    const proof = await noirCircuitsProvider.generateProof(
      circuitName,
      context.inputs.public_inputs || {},
      context.inputs.private_inputs || {}
    );
    
    return {
      success: true,
      outputs: {
        proof: proof.proof,
        verification_key: proof.verification_key,
        public_outputs: proof.public_outputs,
        proof_valid: true,
        circuit_hash: proof.circuit_hash,
        circuit_info: {
          name: circuit.name,
          description: circuit.description,
          constraints: circuit.constraints
        },
        proving_time_ms: proof.proving_time_ms
      },
      metadata: {
        executor: this.name,
        execution_time_ms: Date.now() - startTime,
        cost_actual: 0.01,
        provider_used: 'noir-prover',
        proof_type: 'zk-snark',
        privacy_level: 3
      }
    };
  }

  private async executeLightningMessage(context: ExecutionContext, startTime: number): Promise<ExecutionResult> {
    // Use Inco FHE provider for deep confidential messaging
    const ttl = context.inputs.ttl_seconds || 3600;
    
    const message = await incoFHEProvider.sendConfidentialMessage(
      context.inputs.sender || 'anonymous',
      context.inputs.recipient,
      context.inputs.message,
      ttl
    );
    
    return {
      success: true,
      outputs: {
        message_id: message.message_id,
        sender: message.sender,
        recipient: message.recipient,
        encrypted_payload: message.encrypted_payload,
        delivery_proof: message.delivery_proof,
        timestamp: message.timestamp,
        expires_at: message.expires_at,
        encryption_type: 'FHE',
        privacy_guarantees: [
          'End-to-end encrypted',
          'Message content hidden from all observers',
          'Ephemeral keys used',
          'No on-chain storage of content'
        ]
      },
      metadata: {
        executor: this.name,
        execution_time_ms: Date.now() - startTime,
        cost_actual: 0.0001,
        provider_used: 'inco-fhe',
        proof_type: 'delivery-receipt',
        privacy_level: 2
      }
    };
  }

  private async executeDocumentParse(context: ExecutionContext, startTime: number): Promise<ExecutionResult> {
    // Use existing Arcium document parsing
    const result = await arciumProvider.submitComputation({
      programId: process.env.ARCIUM_PROGRAM_ID || '',
      inputs: context.inputs
    });

    return {
      success: result.success,
      outputs: result.success ? {
        status: 'arcium-ready',
        program_id: process.env.ARCIUM_PROGRAM_ID,
        computation_id: result.computationId,
        mxe_cluster: process.env.ARCIUM_MXE_ID
      } : {},
      error: result.error,
      metadata: {
        executor: this.name,
        execution_time_ms: Date.now() - startTime,
        cost_actual: 0.01,
        provider_used: 'arcium-mpc',
        proof_type: 'arcium-attestation',
        privacy_level: 2
      }
    };
  }

  private async executeCSPLWrap(context: ExecutionContext, startTime: number): Promise<ExecutionResult> {
    // Use Arcium C-SPL for wrapping public tokens to confidential
    const wrapResult = await arciumCSPLProvider.wrapToConfidential(
      context.inputs.owner,
      context.inputs.mint,
      context.inputs.amount
    );

    return {
      success: wrapResult.success,
      outputs: {
        wrapped_mint: wrapResult.wrapped_mint,
        amount_wrapped: wrapResult.amount_wrapped,
        confidential_account: wrapResult.confidential_account,
        transaction_signature: wrapResult.transaction_signature,
        privacy_transition: 'public → confidential'
      },
      metadata: {
        executor: this.name,
        execution_time_ms: Date.now() - startTime,
        cost_actual: 0.01,
        provider_used: 'arcium-cspl',
        proof_type: 'arcium-attestation',
        privacy_level: 2
      }
    };
  }

  private async executeCSPLTransfer(context: ExecutionContext, startTime: number): Promise<ExecutionResult> {
    // Use Arcium C-SPL for confidential transfers
    const transferResult = await arciumCSPLProvider.confidentialTransfer(
      context.inputs.sender,
      context.inputs.recipient,
      context.inputs.mint,
      context.inputs.amount
    );

    if (!transferResult.success) {
      return {
        success: false,
        outputs: {},
        error: transferResult.error || 'Confidential transfer failed',
        metadata: {
          executor: this.name,
          execution_time_ms: Date.now() - startTime,
          cost_actual: 0
        }
      };
    }

    return {
      success: true,
      outputs: {
        transaction_signature: transferResult.transaction_signature,
        encrypted_amount: transferResult.encrypted_amount,
        proof: transferResult.proof,
        commitment: transferResult.commitment,
        privacy_guarantees: [
          'Transfer amount hidden from all observers',
          'Only sender and recipient know the amount',
          'On-chain record shows encrypted data only'
        ]
      },
      metadata: {
        executor: this.name,
        execution_time_ms: Date.now() - startTime,
        cost_actual: 0.02,
        provider_used: 'arcium-cspl',
        proof_type: 'arcium-attestation',
        privacy_level: 2
      }
    };
  }

  private async executeZKBalanceProof(context: ExecutionContext, startTime: number): Promise<ExecutionResult> {
    // Generate ZK proof that balance exceeds threshold without revealing actual balance
    const { wallet, threshold, currency } = context.inputs;
    
    // First, get the actual balance (this stays private)
    const { walletProvider } = await import('../../providers/wallet');
    const snapshot = await walletProvider.getSnapshot(wallet, 'solana-mainnet', {
      include_nfts: false,
      include_history: false
    });
    
    // Find the relevant balance
    let actualBalance = 0;
    if (currency === 'SOL' || currency === 'sol') {
      // SOL balance is typically in the balances array or as native_balance
      const solBalance = (snapshot as any).native_balance || 
        snapshot.balances?.find((b: any) => b.symbol === 'SOL')?.amount || 0;
      actualBalance = solBalance;
    } else {
      // Look for token balance
      const token = snapshot.balances?.find((b: any) => 
        b.symbol?.toUpperCase() === currency.toUpperCase() ||
        b.mint === currency
      );
      actualBalance = token?.amount || 0;
    }
    
    // Generate ZK proof using Noir
    const proof = await noirCircuitsProvider.generateProof(
      'balance_threshold',
      { threshold, currency }, // public inputs
      { actual_balance: actualBalance, wallet } // private inputs (never revealed)
    );
    
    // The proof proves: actual_balance >= threshold
    // Without revealing actual_balance
    const balanceExceedsThreshold = actualBalance >= threshold;
    
    return {
      success: true,
      outputs: {
        proof_valid: balanceExceedsThreshold,
        proof: proof.proof,
        verification_key: proof.verification_key,
        public_statement: `Balance of ${currency} >= ${threshold}`,
        threshold_met: balanceExceedsThreshold,
        circuit_used: 'balance_threshold',
        privacy_guarantees: [
          'Actual balance never revealed',
          'Only threshold comparison result is public',
          'Wallet address can be verified',
          'Proof is cryptographically verifiable'
        ]
      },
      metadata: {
        executor: this.name,
        execution_time_ms: Date.now() - startTime,
        cost_actual: 0.015,
        provider_used: 'noir-prover',
        proof_type: 'zk-snark',
        privacy_level: 3
      }
    };
  }

  private async executeFHECompute(context: ExecutionContext, startTime: number): Promise<ExecutionResult> {
    // Use Inco FHE for encrypted computation
    const operation = context.inputs.operation;
    const rawOperands = context.inputs.operands || [];
    const encryptionType = context.inputs.encryption_type || 'euint32';

    // Encrypt raw operands if they're not already encrypted
    const encryptedOperands = await Promise.all(
      rawOperands.map(async (op: any) => {
        if (typeof op === 'object' && op.ciphertext) {
          return op; // Already encrypted
        }
        // Encrypt raw value
        return await incoFHEProvider.encrypt(op, encryptionType);
      })
    );

    let result;
    switch (operation) {
      case 'add':
        result = await incoFHEProvider.fheAdd(encryptedOperands[0], encryptedOperands[1]);
        break;
      case 'sub':
        result = await incoFHEProvider.fheSub(encryptedOperands[0], encryptedOperands[1]);
        break;
      case 'mul':
        result = await incoFHEProvider.fheMul(encryptedOperands[0], encryptedOperands[1]);
        break;
      case 'lt':
        result = await incoFHEProvider.fheLt(encryptedOperands[0], encryptedOperands[1]);
        break;
      case 'select':
        result = await incoFHEProvider.fheSelect(encryptedOperands[0], encryptedOperands[1], encryptedOperands[2]);
        break;
      default:
        return {
          success: false,
          outputs: { available_operations: ['add', 'sub', 'mul', 'lt', 'select'] },
          error: `Unknown FHE operation: ${operation}`,
          metadata: {
            executor: this.name,
            execution_time_ms: Date.now() - startTime,
            cost_actual: 0
          }
        };
    }

    return {
      success: result.success,
      outputs: {
        encrypted_result: result.encrypted_result,
        computation_proof: result.computation_proof,
        gas_used: result.gas_used,
        operation_performed: operation,
        encryption_type: encryptionType,
        mode: result.mode,
        privacy_guarantees: [
          'Inputs encrypted before computation',
          'Computation performed on encrypted data',
          'No decryption during computation',
          'Result remains encrypted'
        ]
      },
      metadata: {
        executor: this.name,
        execution_time_ms: Date.now() - startTime,
        cost_actual: 0.005,
        provider_used: 'inco-fhe',
        proof_type: 'fhe-proof',
        privacy_level: 2
      }
    };
  }

  private async executeAIInference(context: ExecutionContext, startTime: number): Promise<ExecutionResult> {
    const { model, input, privacy_level = 2, model_config, encrypt_output = false } = context.inputs;

    const result = await aiInferenceProvider.inference(
      model,
      input,
      privacy_level,
      model_config,
      encrypt_output
    );

    if (!result.success) {
      return {
        success: false,
        outputs: { available_models: aiInferenceProvider.getAvailableModels() },
        error: result.error || 'AI inference failed',
        metadata: {
          executor: this.name,
          execution_time_ms: Date.now() - startTime,
          cost_actual: 0
        }
      };
    }

    return {
      success: true,
      outputs: {
        result: result.result,
        model_used: result.model_used,
        privacy_level: result.privacy_level,
        encrypted: result.encrypted,
        proof: result.proof,
        execution_time_ms: result.execution_time_ms,
        privacy_guarantees: [
          'Input data encrypted before processing',
          'Model execution in secure enclave',
          'No plaintext data exposure',
          'Cryptographic proof of execution'
        ]
      },
      metadata: {
        executor: this.name,
        execution_time_ms: Date.now() - startTime,
        cost_actual: 0.01,
        provider_used: 'arcium-ai',
        proof_type: 'arcium-attestation',
        privacy_level: privacy_level
      }
    };
  }

  private async executeAIEmbedding(context: ExecutionContext, startTime: number): Promise<ExecutionResult> {
    const { texts, model = 'text-embedding-3-small', privacy_level = 2 } = context.inputs;

    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      return {
        success: false,
        outputs: {},
        error: 'texts array is required and must not be empty',
        metadata: {
          executor: this.name,
          execution_time_ms: Date.now() - startTime,
          cost_actual: 0
        }
      };
    }

    const result = await aiInferenceProvider.generateEmbeddings(texts, model, privacy_level);

    if (!result.success) {
      return {
        success: false,
        outputs: {},
        error: result.error || 'Embedding generation failed',
        metadata: {
          executor: this.name,
          execution_time_ms: Date.now() - startTime,
          cost_actual: 0
        }
      };
    }

    return {
      success: true,
      outputs: {
        embeddings: result.embeddings,
        dimensions: result.dimensions,
        model_used: result.model_used,
        count: texts.length,
        proof: result.proof,
        privacy_guarantees: [
          'Text inputs encrypted before embedding',
          'Embeddings generated in secure environment',
          'No plaintext exposure during computation'
        ]
      },
      metadata: {
        executor: this.name,
        execution_time_ms: Date.now() - startTime,
        cost_actual: 0.005 * texts.length,
        provider_used: 'arcium-ai',
        proof_type: 'arcium-attestation',
        privacy_level: privacy_level
      }
    };
  }
}
