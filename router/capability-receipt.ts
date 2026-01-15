/**
 * Capability Receipt System
 * 
 * Every invocation returns a verifiable receipt that:
 * - Is serializable and portable
 * - Can be re-verified without re-execution
 * - Enables agents to reason over past executions
 * - Can be shared between agents as proof of work
 * 
 * Security Integration:
 * - Receipts are signed with the same key as capability tokens
 * - Agent ID is included for audit trail
 * - Chain signals provide on-chain verification
 * 
 * "CAP-402 is where agent intent becomes verifiable execution."
 */

import * as crypto from 'crypto';

export interface CapabilityReceipt {
  receipt_id: string;
  version: '1.0.0';
  
  // Execution identity
  capability_id: string;
  invocation_timestamp: number;
  agent_id?: string; // For audit trail
  
  // Input commitment (hash of inputs - proves what was requested)
  input_commitment: string;
  
  // Output commitment (hash of outputs - proves what was returned)
  output_commitment: string;
  
  // Execution metadata
  execution: {
    executor: string;
    privacy_level: 0 | 1 | 2 | 3;
    duration_ms: number;
    success: boolean;
  };
  
  // Optional cryptographic proof
  proof?: {
    type: 'arcium-attestation' | 'zk-snark' | 'delivery-receipt' | 'none';
    data: string;
    verification_key?: string;
  };
  
  // Optional economic signal
  economics?: {
    cost_actual: number;
    cost_estimated: number;
    currency: string;
  };
  
  // Optional chain signal (for on-chain verification)
  chain_signal?: {
    network: 'solana-mainnet' | 'solana-devnet' | 'ethereum' | 'inco';
    commitment_hash: string;
    slot?: number;
    block_height?: number;
    signature?: string;
    finality: 'processed' | 'confirmed' | 'finalized';
  };
  
  // Receipt signature (proves receipt authenticity)
  signature: string;
}

export interface ReceiptVerificationResult {
  valid: boolean;
  checks: {
    signature_valid: boolean;
    input_commitment_valid: boolean;
    output_commitment_valid: boolean;
    proof_valid: boolean;
    timestamp_valid: boolean;
  };
  error?: string;
}

class CapabilityReceiptManager {
  private signingKey: string;

  constructor() {
    this.signingKey = process.env.CAP402_TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
  }

  /**
   * Generate a capability receipt for an invocation
   */
  generateReceipt(
    capabilityId: string,
    inputs: Record<string, any>,
    outputs: Record<string, any>,
    metadata: {
      executor: string;
      privacy_level: 0 | 1 | 2 | 3;
      duration_ms: number;
      success: boolean;
      proof?: { type: string; data: string; verification_key?: string };
      cost_actual?: number;
      cost_estimated?: number;
      chain_signal?: { network: string; commitment_hash: string; slot?: number };
      agent_id?: string;
    }
  ): CapabilityReceipt {
    const receiptId = `rcpt_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    const timestamp = Date.now();

    // Create commitments (hashes that prove content without revealing it)
    const inputCommitment = this.createCommitment(inputs);
    const outputCommitment = this.createCommitment(outputs);

    // Build receipt
    const receipt: Omit<CapabilityReceipt, 'signature'> = {
      receipt_id: receiptId,
      version: '1.0.0',
      capability_id: capabilityId,
      invocation_timestamp: timestamp,
      agent_id: metadata.agent_id,
      input_commitment: inputCommitment,
      output_commitment: outputCommitment,
      execution: {
        executor: metadata.executor,
        privacy_level: metadata.privacy_level,
        duration_ms: metadata.duration_ms,
        success: metadata.success
      }
    };

    // Add optional proof
    if (metadata.proof) {
      receipt.proof = {
        type: metadata.proof.type as any,
        data: metadata.proof.data,
        verification_key: metadata.proof.verification_key
      };
    }

    // Add optional economics
    if (metadata.cost_actual !== undefined) {
      receipt.economics = {
        cost_actual: metadata.cost_actual,
        cost_estimated: metadata.cost_estimated || metadata.cost_actual,
        currency: 'USD'
      };
    }

    // Add optional chain signal
    if (metadata.chain_signal) {
      receipt.chain_signal = {
        network: metadata.chain_signal.network as any,
        commitment_hash: metadata.chain_signal.commitment_hash,
        slot: metadata.chain_signal.slot,
        finality: (metadata.chain_signal as any).finality || 'confirmed'
      };
    }

    // Sign the receipt
    const signature = this.signReceipt(receipt);

    return {
      ...receipt,
      signature
    };
  }

  /**
   * Verify a capability receipt
   * Can be done offline without re-executing the capability
   */
  verifyReceipt(
    receipt: CapabilityReceipt,
    originalInputs?: Record<string, any>,
    originalOutputs?: Record<string, any>
  ): ReceiptVerificationResult {
    const checks = {
      signature_valid: false,
      input_commitment_valid: true,
      output_commitment_valid: true,
      proof_valid: true,
      timestamp_valid: false
    };

    // 1. Verify signature (timing-safe comparison to prevent timing attacks)
    const { signature, ...receiptWithoutSig } = receipt;
    const expectedSignature = this.signReceipt(receiptWithoutSig);
    try {
      checks.signature_valid = crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex')
      );
    } catch {
      checks.signature_valid = false;
    }

    // 2. Verify input commitment if original inputs provided (timing-safe)
    if (originalInputs) {
      const expectedInputCommitment = this.createCommitment(originalInputs);
      try {
        checks.input_commitment_valid = crypto.timingSafeEqual(
          Buffer.from(receipt.input_commitment),
          Buffer.from(expectedInputCommitment)
        );
      } catch {
        checks.input_commitment_valid = false;
      }
    }

    // 3. Verify output commitment if original outputs provided (timing-safe)
    if (originalOutputs) {
      const expectedOutputCommitment = this.createCommitment(originalOutputs);
      try {
        checks.output_commitment_valid = crypto.timingSafeEqual(
          Buffer.from(receipt.output_commitment),
          Buffer.from(expectedOutputCommitment)
        );
      } catch {
        checks.output_commitment_valid = false;
      }
    }

    // 4. Verify timestamp is reasonable (not in future, not too old)
    const now = Date.now();
    const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    checks.timestamp_valid = 
      receipt.invocation_timestamp <= now && 
      receipt.invocation_timestamp > (now - maxAge);

    // 5. Verify proof if present
    if (receipt.proof && receipt.proof.type !== 'none') {
      // In production, this would call the appropriate verifier
      checks.proof_valid = receipt.proof.data.length > 0;
    }

    const valid = Object.values(checks).every(c => c);

    return {
      valid,
      checks,
      error: valid ? undefined : 'One or more verification checks failed'
    };
  }

  /**
   * Create a commitment (hash) of data
   * This proves what data was used without revealing it
   */
  private createCommitment(data: Record<string, any>): string {
    const serialized = JSON.stringify(data, Object.keys(data).sort());
    return '0x' + crypto.createHash('sha256').update(serialized).digest('hex');
  }

  /**
   * Sign a receipt for authenticity
   */
  private signReceipt(receipt: Omit<CapabilityReceipt, 'signature'>): string {
    const serialized = JSON.stringify(receipt, Object.keys(receipt).sort());
    return crypto.createHmac('sha256', this.signingKey).update(serialized).digest('hex');
  }

  /**
   * Serialize receipt for storage/transmission
   */
  serializeReceipt(receipt: CapabilityReceipt): string {
    return Buffer.from(JSON.stringify(receipt)).toString('base64');
  }

  /**
   * Deserialize receipt from storage/transmission
   */
  deserializeReceipt(serialized: string): CapabilityReceipt {
    try {
      return JSON.parse(Buffer.from(serialized, 'base64').toString('utf-8'));
    } catch (error) {
      throw new Error('Invalid receipt format: unable to decode');
    }
  }

  /**
   * Create a receipt summary for logging/display
   */
  summarizeReceipt(receipt: CapabilityReceipt): string {
    return [
      `Receipt: ${receipt.receipt_id}`,
      `Capability: ${receipt.capability_id}`,
      `Privacy: L${receipt.execution.privacy_level}`,
      `Success: ${receipt.execution.success}`,
      `Duration: ${receipt.execution.duration_ms}ms`,
      receipt.proof ? `Proof: ${receipt.proof.type}` : null,
      receipt.economics ? `Cost: $${receipt.economics.cost_actual}` : null
    ].filter(Boolean).join(' | ');
  }
}

export const receiptManager = new CapabilityReceiptManager();
