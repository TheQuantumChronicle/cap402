/**
 * Cross-System Validation
 * 
 * Ensures consistency and interoperability between advanced features:
 * - Receipt validation
 * - Privacy level validation
 * - Intent graph validation
 * - Negotiation request validation
 */

import { PrivacyLevel } from '../privacy-gradient';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate privacy level is within bounds
 */
export function validatePrivacyLevel(level: number): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (level < 0 || level > 3) {
    errors.push(`Privacy level must be 0-3, got ${level}`);
  }

  if (!Number.isInteger(level)) {
    errors.push(`Privacy level must be an integer, got ${level}`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate capability ID format
 */
export function validateCapabilityId(capabilityId: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!capabilityId) {
    errors.push('Capability ID is required');
    return { valid: false, errors, warnings };
  }

  if (!capabilityId.startsWith('cap.')) {
    warnings.push(`Capability ID should start with 'cap.', got '${capabilityId}'`);
  }

  if (!capabilityId.includes('.v')) {
    warnings.push(`Capability ID should include version (e.g., .v1), got '${capabilityId}'`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate receipt structure
 */
export function validateReceipt(receipt: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!receipt) {
    errors.push('Receipt is required');
    return { valid: false, errors, warnings };
  }

  const requiredFields = ['receipt_id', 'version', 'capability_id', 'invocation_timestamp', 
                          'input_commitment', 'output_commitment', 'execution', 'signature'];
  
  for (const field of requiredFields) {
    if (!(field in receipt)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (receipt.version && receipt.version !== '1.0.0') {
    warnings.push(`Unknown receipt version: ${receipt.version}`);
  }

  if (receipt.execution) {
    if (typeof receipt.execution.privacy_level !== 'number') {
      warnings.push('Receipt execution missing privacy_level');
    }
    if (typeof receipt.execution.success !== 'boolean') {
      errors.push('Receipt execution.success must be boolean');
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate negotiation request
 */
export function validateNegotiationRequest(request: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!request) {
    errors.push('Negotiation request is required');
    return { valid: false, errors, warnings };
  }

  if (!request.capability_id) {
    errors.push('capability_id is required');
  }

  if (request.constraints) {
    if (request.constraints.min_privacy_level !== undefined) {
      const privacyValidation = validatePrivacyLevel(request.constraints.min_privacy_level);
      errors.push(...privacyValidation.errors);
    }

    if (request.constraints.max_cost !== undefined && request.constraints.max_cost < 0) {
      errors.push('max_cost cannot be negative');
    }

    if (request.constraints.max_latency_ms !== undefined && request.constraints.max_latency_ms < 0) {
      errors.push('max_latency_ms cannot be negative');
    }
  }

  if (!request.negotiate || Object.keys(request.negotiate).length === 0) {
    warnings.push('No negotiation options specified (privacy, latency, batching)');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate intent graph structure
 */
export function validateIntentGraph(graph: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!graph) {
    errors.push('Intent graph is required');
    return { valid: false, errors, warnings };
  }

  if (!graph.nodes || !Array.isArray(graph.nodes)) {
    errors.push('Intent graph must have nodes array');
    return { valid: false, errors, warnings };
  }

  if (graph.nodes.length === 0) {
    errors.push('Intent graph must have at least one node');
  }

  // Check for duplicate node IDs
  const nodeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (!node.id) {
      errors.push('Each node must have an id');
      continue;
    }
    if (nodeIds.has(node.id)) {
      errors.push(`Duplicate node ID: ${node.id}`);
    }
    nodeIds.add(node.id);

    if (!node.capability_id) {
      errors.push(`Node ${node.id} missing capability_id`);
    }

    if (node.privacy?.minimum_level !== undefined) {
      const privacyValidation = validatePrivacyLevel(node.privacy.minimum_level);
      errors.push(...privacyValidation.errors.map(e => `Node ${node.id}: ${e}`));
    }
  }

  // Check edges reference valid nodes
  if (graph.edges && Array.isArray(graph.edges)) {
    for (const edge of graph.edges) {
      if (!nodeIds.has(edge.from)) {
        errors.push(`Edge references non-existent node: ${edge.from}`);
      }
      if (!nodeIds.has(edge.to)) {
        errors.push(`Edge references non-existent node: ${edge.to}`);
      }
      if (edge.from === edge.to) {
        errors.push(`Self-referencing edge: ${edge.from}`);
      }
    }
  }

  // Check for cycles (simple detection)
  if (graph.edges && graph.edges.length > 0) {
    const hasCycle = detectCycle(graph.nodes, graph.edges);
    if (hasCycle) {
      errors.push('Intent graph contains a cycle');
    }
  }

  // Warnings for best practices
  if (graph.nodes.length > 10) {
    warnings.push('Large intent graph (>10 nodes) may have performance implications');
  }

  if (!graph.constraints?.atomic && graph.nodes.length > 1) {
    warnings.push('Consider setting atomic: true for multi-node graphs');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Simple cycle detection using DFS
 */
function detectCycle(nodes: any[], edges: any[]): boolean {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

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

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      if (hasCycleUtil(node.id)) return true;
    }
  }

  return false;
}

/**
 * Validate usage metadata
 */
export function validateUsageMetadata(metadata: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!metadata) {
    errors.push('Usage metadata is required');
    return { valid: false, errors, warnings };
  }

  if (!metadata.capability_id) {
    errors.push('capability_id is required');
  }

  if (!metadata.request_id) {
    errors.push('request_id is required');
  }

  if (typeof metadata.success !== 'boolean') {
    errors.push('success must be boolean');
  }

  const validLatencyBuckets = ['fast', 'medium', 'slow', 'timeout'];
  if (metadata.latency_bucket && !validLatencyBuckets.includes(metadata.latency_bucket)) {
    errors.push(`Invalid latency_bucket: ${metadata.latency_bucket}`);
  }

  const validCostBuckets = ['free', 'cheap', 'moderate', 'expensive'];
  if (metadata.cost_bucket && !validCostBuckets.includes(metadata.cost_bucket)) {
    errors.push(`Invalid cost_bucket: ${metadata.cost_bucket}`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate all cross-system consistency
 */
export function validateCrossSystemConsistency(data: {
  receipt?: any;
  privacyLevel?: number;
  negotiationRequest?: any;
  intentGraph?: any;
  usageMetadata?: any;
}): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Cross-validate privacy levels match
  const privacyLevels: number[] = [];

  if (data.receipt?.execution?.privacy_level !== undefined) {
    privacyLevels.push(data.receipt.execution.privacy_level);
  }

  if (data.privacyLevel !== undefined) {
    privacyLevels.push(data.privacyLevel);
  }

  if (data.usageMetadata?.privacy_level !== undefined) {
    privacyLevels.push(data.usageMetadata.privacy_level);
  }

  if (privacyLevels.length > 1) {
    const allSame = privacyLevels.every(l => l === privacyLevels[0]);
    if (!allSame) {
      warnings.push(`Inconsistent privacy levels across systems: ${privacyLevels.join(', ')}`);
    }
  }

  // Cross-validate capability IDs match
  const capabilityIds: string[] = [];

  if (data.receipt?.capability_id) {
    capabilityIds.push(data.receipt.capability_id);
  }

  if (data.negotiationRequest?.capability_id) {
    capabilityIds.push(data.negotiationRequest.capability_id);
  }

  if (data.usageMetadata?.capability_id) {
    capabilityIds.push(data.usageMetadata.capability_id);
  }

  if (capabilityIds.length > 1) {
    const allSame = capabilityIds.every(id => id === capabilityIds[0]);
    if (!allSame) {
      errors.push(`Inconsistent capability IDs: ${capabilityIds.join(', ')}`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
