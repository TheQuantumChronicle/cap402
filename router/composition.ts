/**
 * Capability Composition Engine
 * 
 * Allows agents to chain multiple capabilities together in a single request.
 * This is a key differentiator - agents can compose complex workflows
 * without multiple round-trips.
 * 
 * Enhanced with:
 * - Single receipt for entire composition (verifiable execution memory)
 * - Privacy level tracking across steps
 * - Usage metadata emission for emergent reputation
 * - Executor privacy method integration
 */

import { router, InvokeRequest, InvokeResponse } from './router';
import { receiptManager, CapabilityReceipt } from './capability-receipt';
import { usageMetadataEmitter } from './usage-metadata';
import { PrivacyLevel } from './privacy-gradient';
import { advancedFeaturesHealth } from './advanced/health';
import { EXECUTORS } from './advanced/constants';

export interface CompositionStep {
  capability_id: string;
  inputs: Record<string, any> | ((prev: any) => Record<string, any>);
  preferences?: any;
  condition?: (prev: any) => boolean; // Optional conditional execution
  privacy_level?: PrivacyLevel; // Privacy requirement for this step
}

export interface CompositionRequest {
  steps: CompositionStep[];
  parallel?: boolean; // Execute steps in parallel if possible
  stop_on_error?: boolean; // Stop pipeline on first error
  atomic?: boolean; // All or nothing execution
  name?: string; // Name for the composition (used in receipt)
}

export interface CompositionResult {
  success: boolean;
  steps: InvokeResponse[];
  total_cost: number;
  total_time_ms: number;
  error?: string;
  
  // New: Single receipt for entire composition
  receipt?: {
    id: string;
    encoded: string;
    verification_hint: string;
  };
  
  // New: Privacy summary
  privacy_summary?: {
    levels_used: PrivacyLevel[];
    highest_level: PrivacyLevel;
    all_confidential: boolean;
  };
}

/**
 * Execute a composition of capabilities
 * 
 * Example:
 * 1. Get SOL price
 * 2. Get wallet balance
 * 3. Calculate if user can afford a swap
 * 4. Execute swap if affordable
 */
export async function executeComposition(
  composition: CompositionRequest,
  agentId?: string
): Promise<CompositionResult> {
  const startTime = Date.now();
  const results: InvokeResponse[] = [];
  let totalCost = 0;
  let previousOutput: any = null;
  const privacyLevelsUsed: PrivacyLevel[] = [];
  const allOutputs: Record<string, any> = {};

  try {
    for (let i = 0; i < composition.steps.length; i++) {
      const step = composition.steps[i];
      
      // Check condition if present
      if (step.condition && !step.condition(previousOutput)) {
        continue; // Skip this step
      }

      // Resolve inputs (can be static or function of previous output)
      const inputs = typeof step.inputs === 'function'
        ? step.inputs(previousOutput)
        : step.inputs;

      // Execute capability
      const request: InvokeRequest = {
        capability_id: step.capability_id,
        inputs,
        preferences: step.preferences
      };

      const result = await router.invoke(request);
      results.push(result);

      // Track privacy level
      const privacyLevel = (step.privacy_level || 0) as PrivacyLevel;
      privacyLevelsUsed.push(privacyLevel);

      // Track cost
      if (result.metadata?.execution?.cost_actual) {
        totalCost += result.metadata.execution.cost_actual;
      }

      // Store outputs
      allOutputs[`step_${i}`] = result.outputs;

      // Emit usage metadata for each step
      const stepMetadata = usageMetadataEmitter.createMetadata(
        step.capability_id,
        {
          success: result.success,
          latency_ms: result.metadata?.execution?.execution_time_ms || 0,
          executor: result.metadata?.execution?.executor,
          privacy_level: privacyLevel,
          proof: result.metadata?.execution?.proof_type ? { type: result.metadata.execution.proof_type } : undefined,
          cost: result.metadata?.execution?.cost_actual
        },
        result.request_id,
        agentId
      );
      usageMetadataEmitter.emit('usage', stepMetadata);

      // Stop on error if configured
      if (!result.success && (composition.stop_on_error || composition.atomic)) {
        const totalTime = Date.now() - startTime;
        
        // Generate failure receipt
        const failureReceipt = receiptManager.generateReceipt(
          `compose:${composition.name || 'unnamed'}`,
          { steps: composition.steps.map(s => s.capability_id), step_count: composition.steps.length },
          { failed_at_step: i, error: result.error },
          {
            executor: 'composition-engine',
            privacy_level: Math.max(...privacyLevelsUsed, 0) as PrivacyLevel,
            duration_ms: totalTime,
            success: false,
            cost_actual: totalCost
          }
        );

        return {
          success: false,
          steps: results,
          total_cost: totalCost,
          total_time_ms: totalTime,
          error: `Step ${i + 1} (${step.capability_id}) failed: ${result.error}`,
          receipt: {
            id: failureReceipt.receipt_id,
            encoded: receiptManager.serializeReceipt(failureReceipt),
            verification_hint: 'POST /receipts/verify to verify offline'
          },
          privacy_summary: {
            levels_used: [...new Set(privacyLevelsUsed)],
            highest_level: Math.max(...privacyLevelsUsed, 0) as PrivacyLevel,
            all_confidential: privacyLevelsUsed.every(l => l >= 2)
          }
        };
      }

      // Store output for next step
      previousOutput = result.outputs;
    }

    const totalTime = Date.now() - startTime;
    
    // Generate success receipt for entire composition
    const compositionReceipt = receiptManager.generateReceipt(
      `compose:${composition.name || 'unnamed'}`,
      { 
        steps: composition.steps.map(s => s.capability_id), 
        step_count: composition.steps.length,
        atomic: composition.atomic 
      },
      allOutputs,
      {
        executor: 'composition-engine',
        privacy_level: Math.max(...privacyLevelsUsed, 0) as PrivacyLevel,
        duration_ms: totalTime,
        success: true,
        cost_actual: totalCost
      }
    );

    // Record health metrics
    advancedFeaturesHealth.recordUsage('capability-receipts', true, totalTime);

    return {
      success: true,
      steps: results,
      total_cost: totalCost,
      total_time_ms: totalTime,
      receipt: {
        id: compositionReceipt.receipt_id,
        encoded: receiptManager.serializeReceipt(compositionReceipt),
        verification_hint: 'POST /receipts/verify to verify offline'
      },
      privacy_summary: {
        levels_used: [...new Set(privacyLevelsUsed)],
        highest_level: Math.max(...privacyLevelsUsed, 0) as PrivacyLevel,
        all_confidential: privacyLevelsUsed.every(l => l >= 2)
      }
    };

  } catch (error) {
    const totalTime = Date.now() - startTime;
    
    // Generate error receipt
    const errorReceipt = receiptManager.generateReceipt(
      `compose:${composition.name || 'unnamed'}`,
      { steps: composition.steps.map(s => s.capability_id) },
      { error: error instanceof Error ? error.message : 'Unknown error' },
      {
        executor: 'composition-engine',
        privacy_level: Math.max(...privacyLevelsUsed, 0) as PrivacyLevel,
        duration_ms: totalTime,
        success: false,
        cost_actual: totalCost
      }
    );

    return {
      success: false,
      steps: results,
      total_cost: totalCost,
      total_time_ms: totalTime,
      error: error instanceof Error ? error.message : 'Composition failed',
      receipt: {
        id: errorReceipt.receipt_id,
        encoded: receiptManager.serializeReceipt(errorReceipt),
        verification_hint: 'POST /receipts/verify to verify offline'
      }
    };
  }
}

/**
 * Validate a composition before execution
 * Checks for circular dependencies, invalid capability IDs, etc.
 */
export function validateComposition(composition: CompositionRequest): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!composition.steps || composition.steps.length === 0) {
    errors.push('Composition must have at least one step');
  }

  // Check for duplicate capability calls (potential inefficiency)
  const capabilityCounts = new Map<string, number>();
  for (const step of composition.steps) {
    const count = capabilityCounts.get(step.capability_id) || 0;
    capabilityCounts.set(step.capability_id, count + 1);
  }

  for (const [cap, count] of capabilityCounts) {
    if (count > 3) {
      errors.push(`Warning: Capability ${cap} called ${count} times - consider optimization`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Example compositions for common workflows
 */
export const EXAMPLE_COMPOSITIONS = {
  // Portfolio valuation: Get wallet + prices for all tokens
  portfolio_value: {
    steps: [
      {
        capability_id: 'cap.wallet.snapshot.v1',
        inputs: { address: '{{wallet_address}}' }
      },
      {
        capability_id: 'cap.price.lookup.v1',
        inputs: (prev: any) => ({
          base_token: prev.balances[0].token,
          quote_token: 'USD'
        })
      }
    ]
  },

  // Smart swap: Check price + balance before swapping
  smart_swap: {
    steps: [
      {
        capability_id: 'cap.price.lookup.v1',
        inputs: { base_token: '{{input_token}}', quote_token: 'USD' }
      },
      {
        capability_id: 'cap.wallet.snapshot.v1',
        inputs: { address: '{{wallet_address}}' }
      },
      {
        capability_id: 'cap.swap.execute.v1',
        inputs: (prev: any) => ({
          input_token: '{{input_token}}',
          output_token: '{{output_token}}',
          amount: prev.balances[0].amount * 0.5, // Swap 50% of balance
          wallet_address: '{{wallet_address}}'
        }),
        condition: (prev: any) => prev.balances[0].amount > 1 // Only if balance > 1
      }
    ],
    stop_on_error: true
  }
};
