/**
 * Intent Graph System
 * 
 * Advanced composition that supports:
 * - Intent graphs with dependency edges
 * - Constraint propagation
 * - Privacy boundary selection
 * - Atomic execution with single receipt
 * 
 * Example: "Get price → check wallet → execute swap → prove outcome"
 */

import { router, InvokeRequest, InvokeResponse } from './router';
import { receiptManager, CapabilityReceipt } from './capability-receipt';
import { privacyGradient, PrivacyLevel } from './privacy-gradient';

export interface IntentNode {
  id: string;
  capability_id: string;
  inputs: Record<string, any> | ((context: IntentContext) => Record<string, any>);
  
  // Privacy requirements for this node
  privacy?: {
    minimum_level?: PrivacyLevel;
    preferred_level?: PrivacyLevel;
  };
  
  // Execution constraints
  constraints?: {
    max_latency_ms?: number;
    max_cost?: number;
    required_proof?: boolean;
  };
  
  // Conditional execution
  condition?: (context: IntentContext) => boolean;
}

export interface IntentEdge {
  from: string;  // Node ID
  to: string;    // Node ID
  type: 'data' | 'sequence' | 'conditional';
  
  // For data edges: how to map outputs to inputs
  mapping?: Record<string, string>;  // { "to_input": "from_output.path" }
}

export interface IntentGraph {
  nodes: IntentNode[];
  edges: IntentEdge[];
  
  // Global constraints
  constraints?: {
    atomic: boolean;           // All or nothing
    max_total_cost?: number;
    min_privacy_level?: PrivacyLevel;
    timeout_ms?: number;
  };
  
  // Metadata
  name?: string;
  description?: string;
}

export interface IntentContext {
  // Results from previous nodes
  results: Map<string, InvokeResponse>;
  
  // Aggregated outputs for easy access
  outputs: Record<string, any>;
  
  // Execution state
  executed_nodes: string[];
  failed_nodes: string[];
  
  // Privacy decisions made
  privacy_decisions: Map<string, PrivacyLevel>;
}

export interface IntentExecutionResult {
  success: boolean;
  
  // Individual node results
  node_results: Map<string, InvokeResponse>;
  
  // Aggregated outputs
  final_outputs: Record<string, any>;
  
  // Single receipt for entire intent
  receipt: CapabilityReceipt;
  encoded_receipt: string;
  
  // Execution metadata
  metadata: {
    nodes_executed: number;
    nodes_skipped: number;
    nodes_failed: number;
    total_cost: number;
    total_time_ms: number;
    privacy_levels_used: PrivacyLevel[];
  };
  
  // Errors if any
  errors?: Array<{ node_id: string; error: string }>;
}

class IntentGraphExecutor {
  
  /**
   * Execute an intent graph
   */
  async execute(graph: IntentGraph): Promise<IntentExecutionResult> {
    const startTime = Date.now();
    const context: IntentContext = {
      results: new Map(),
      outputs: {},
      executed_nodes: [],
      failed_nodes: [],
      privacy_decisions: new Map()
    };
    
    const errors: Array<{ node_id: string; error: string }> = [];
    let totalCost = 0;
    const privacyLevelsUsed: PrivacyLevel[] = [];

    // Topological sort to determine execution order
    const executionOrder = this.topologicalSort(graph);
    
    // Execute nodes in order
    for (const nodeId of executionOrder) {
      const node = graph.nodes.find(n => n.id === nodeId);
      if (!node) continue;

      // Check condition
      if (node.condition && !node.condition(context)) {
        continue; // Skip this node
      }

      // Determine privacy level
      const privacyLevel = this.selectPrivacyLevel(node, graph.constraints?.min_privacy_level);
      context.privacy_decisions.set(nodeId, privacyLevel);
      privacyLevelsUsed.push(privacyLevel);

      // Resolve inputs
      const inputs = this.resolveInputs(node, context, graph.edges);

      // Execute capability
      try {
        const request: InvokeRequest = {
          capability_id: node.capability_id,
          inputs,
          preferences: {
            execution_mode: privacyLevel >= 2 ? 'confidential' : 'public'
          } as any
        };

        const result = await router.invoke(request);
        context.results.set(nodeId, result);
        
        if (result.success) {
          context.executed_nodes.push(nodeId);
          context.outputs[nodeId] = result.outputs;
          totalCost += result.metadata?.execution?.cost_actual || 0;
        } else {
          context.failed_nodes.push(nodeId);
          errors.push({ node_id: nodeId, error: result.error || 'Unknown error' });
          
          // If atomic, stop on first failure
          if (graph.constraints?.atomic) {
            break;
          }
        }
      } catch (error) {
        context.failed_nodes.push(nodeId);
        errors.push({ 
          node_id: nodeId, 
          error: error instanceof Error ? error.message : 'Execution failed' 
        });
        
        if (graph.constraints?.atomic) {
          break;
        }
      }
    }

    const totalTime = Date.now() - startTime;
    const success = graph.constraints?.atomic 
      ? context.failed_nodes.length === 0 
      : context.executed_nodes.length > 0;

    // Generate single receipt for entire intent
    const receipt = receiptManager.generateReceipt(
      `intent:${graph.name || 'unnamed'}`,
      { nodes: graph.nodes.map(n => n.capability_id), edges: graph.edges.length },
      context.outputs,
      {
        executor: 'intent-graph-executor',
        privacy_level: Math.max(...privacyLevelsUsed, 0) as PrivacyLevel,
        duration_ms: totalTime,
        success,
        cost_actual: totalCost
      }
    );

    return {
      success,
      node_results: context.results,
      final_outputs: context.outputs,
      receipt,
      encoded_receipt: receiptManager.serializeReceipt(receipt),
      metadata: {
        nodes_executed: context.executed_nodes.length,
        nodes_skipped: graph.nodes.length - context.executed_nodes.length - context.failed_nodes.length,
        nodes_failed: context.failed_nodes.length,
        total_cost: totalCost,
        total_time_ms: totalTime,
        privacy_levels_used: [...new Set(privacyLevelsUsed)]
      },
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Validate an intent graph before execution
   */
  validate(graph: IntentGraph): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check for empty graph
    if (!graph.nodes || graph.nodes.length === 0) {
      errors.push('Intent graph must have at least one node');
    }

    // Check for duplicate node IDs
    const nodeIds = new Set<string>();
    for (const node of graph.nodes) {
      if (nodeIds.has(node.id)) {
        errors.push(`Duplicate node ID: ${node.id}`);
      }
      nodeIds.add(node.id);
    }

    // Check edges reference valid nodes
    for (const edge of graph.edges || []) {
      if (!nodeIds.has(edge.from)) {
        errors.push(`Edge references non-existent node: ${edge.from}`);
      }
      if (!nodeIds.has(edge.to)) {
        errors.push(`Edge references non-existent node: ${edge.to}`);
      }
    }

    // Check for cycles (would cause infinite loop)
    if (this.hasCycle(graph)) {
      errors.push('Intent graph contains a cycle');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Plan execution without executing (dry run)
   */
  plan(graph: IntentGraph): {
    execution_order: string[];
    estimated_cost: number;
    estimated_time_ms: number;
    privacy_levels: Map<string, PrivacyLevel>;
  } {
    const executionOrder = this.topologicalSort(graph);
    const privacyLevels = new Map<string, PrivacyLevel>();
    let estimatedCost = 0;
    let estimatedTime = 0;

    for (const nodeId of executionOrder) {
      const node = graph.nodes.find(n => n.id === nodeId);
      if (!node) continue;

      const privacyLevel = this.selectPrivacyLevel(node, graph.constraints?.min_privacy_level);
      privacyLevels.set(nodeId, privacyLevel);

      // Estimate cost based on privacy level
      const baseCost = 0.01;
      const multiplier = privacyLevel === 0 ? 1 : privacyLevel === 1 ? 1.1 : privacyLevel === 2 ? 1.5 : 2.0;
      estimatedCost += baseCost * multiplier;

      // Estimate time
      estimatedTime += 200 * (1 + privacyLevel * 0.5);
    }

    return {
      execution_order: executionOrder,
      estimated_cost: estimatedCost,
      estimated_time_ms: estimatedTime,
      privacy_levels: privacyLevels
    };
  }

  private topologicalSort(graph: IntentGraph): string[] {
    const visited = new Set<string>();
    const result: string[] = [];
    const edges = graph.edges || [];

    const visit = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      // Visit dependencies first
      const dependencies = edges
        .filter(e => e.to === nodeId)
        .map(e => e.from);
      
      for (const dep of dependencies) {
        visit(dep);
      }

      result.push(nodeId);
    };

    for (const node of graph.nodes) {
      visit(node.id);
    }

    return result;
  }

  private hasCycle(graph: IntentGraph): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const edges = graph.edges || [];

    const hasCycleUtil = (nodeId: string): boolean => {
      visited.add(nodeId);
      recursionStack.add(nodeId);

      const neighbors = edges
        .filter(e => e.from === nodeId)
        .map(e => e.to);

      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          if (hasCycleUtil(neighbor)) return true;
        } else if (recursionStack.has(neighbor)) {
          return true;
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const node of graph.nodes) {
      if (!visited.has(node.id)) {
        if (hasCycleUtil(node.id)) return true;
      }
    }

    return false;
  }

  private selectPrivacyLevel(node: IntentNode, globalMinimum?: PrivacyLevel): PrivacyLevel {
    const nodeMin = node.privacy?.minimum_level || 0;
    const nodePreferred = node.privacy?.preferred_level;
    const globalMin = globalMinimum || 0;

    const minimum = Math.max(nodeMin, globalMin) as PrivacyLevel;
    
    if (nodePreferred !== undefined && nodePreferred >= minimum) {
      return nodePreferred;
    }
    
    return minimum;
  }

  private resolveInputs(
    node: IntentNode,
    context: IntentContext,
    edges: IntentEdge[]
  ): Record<string, any> {
    // If inputs is a function, call it with context
    if (typeof node.inputs === 'function') {
      return node.inputs(context);
    }

    // Start with static inputs
    const inputs = { ...node.inputs };

    // Apply data mappings from edges
    const dataEdges = edges.filter(e => e.to === node.id && e.type === 'data' && e.mapping);
    
    for (const edge of dataEdges) {
      const sourceResult = context.results.get(edge.from);
      if (!sourceResult?.outputs || !edge.mapping) continue;

      for (const [toInput, fromPath] of Object.entries(edge.mapping)) {
        const value = this.getNestedValue(sourceResult.outputs, fromPath);
        if (value !== undefined) {
          inputs[toInput] = value;
        }
      }
    }

    return inputs;
  }

  private getNestedValue(obj: any, path: string): any {
    const parts = path.split('.');
    let current = obj;
    
    for (const part of parts) {
      if (current === undefined || current === null) return undefined;
      current = current[part];
    }
    
    return current;
  }
}

export const intentGraphExecutor = new IntentGraphExecutor();

/**
 * Example intent graphs for common workflows
 */
export const EXAMPLE_INTENT_GRAPHS: Record<string, IntentGraph> = {
  // Price → Wallet → Swap → Prove
  confidential_swap_with_proof: {
    name: 'confidential_swap_with_proof',
    description: 'Get price, check wallet, execute confidential swap, prove outcome',
    nodes: [
      {
        id: 'get_price',
        capability_id: 'cap.price.lookup.v1',
        inputs: { base_token: 'SOL', quote_token: 'USD' }
      },
      {
        id: 'check_wallet',
        capability_id: 'cap.wallet.snapshot.v1',
        inputs: (ctx) => ({ address: ctx.outputs.wallet_address || 'default' })
      },
      {
        id: 'execute_swap',
        capability_id: 'cap.confidential.swap.v1',
        inputs: (ctx) => ({
          input_token: 'SOL',
          output_token: 'USDC',
          amount: 100,
          expected_price: ctx.outputs.get_price?.price
        }),
        privacy: { minimum_level: 2 },
        condition: (ctx) => (ctx.outputs.check_wallet?.balance || 0) > 100
      },
      {
        id: 'prove_outcome',
        capability_id: 'cap.zk.proof.v1',
        inputs: (ctx) => ({
          circuit: 'balance_threshold',
          threshold: 100,
          private_inputs: { actual_balance: ctx.outputs.check_wallet?.balance }
        }),
        privacy: { minimum_level: 3 }
      }
    ],
    edges: [
      { from: 'get_price', to: 'execute_swap', type: 'data', mapping: { expected_price: 'price' } },
      { from: 'check_wallet', to: 'execute_swap', type: 'sequence' },
      { from: 'execute_swap', to: 'prove_outcome', type: 'sequence' }
    ],
    constraints: {
      atomic: true,
      min_privacy_level: 2
    }
  },

  // Multi-agent negotiation
  agent_negotiation: {
    name: 'agent_negotiation',
    description: 'Prove credentials, send encrypted offer, await response',
    nodes: [
      {
        id: 'prove_credentials',
        capability_id: 'cap.zk.proof.v1',
        inputs: {
          circuit: 'credential_ownership',
          credential_type: 'verified_agent'
        },
        privacy: { minimum_level: 3 }
      },
      {
        id: 'send_offer',
        capability_id: 'cap.lightning.message.v1',
        inputs: (ctx) => ({
          recipient: 'counterparty_agent',
          message: 'Offer: 50K USDC',
          credential_proof: ctx.outputs.prove_credentials?.proof
        }),
        privacy: { minimum_level: 2 }
      }
    ],
    edges: [
      { from: 'prove_credentials', to: 'send_offer', type: 'data', mapping: { credential_proof: 'proof' } }
    ],
    constraints: {
      atomic: true,
      min_privacy_level: 2
    }
  }
};
