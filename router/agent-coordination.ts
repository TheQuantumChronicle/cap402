/**
 * Agent Coordination Protocol
 * 
 * Enables complex multi-agent workflows:
 * - Agent-to-agent capability requests
 * - Coordinated task execution
 * - Result aggregation and consensus
 * - Secure context passing between agents
 */

import * as crypto from 'crypto';
import { agentRegistry, RegisteredAgent, AgentDelegation } from './agent-registry';

export interface AgentTask {
  task_id: string;
  initiator_agent: string;
  target_agents: string[];
  capability_id: string;
  inputs: Record<string, any>;
  context: TaskContext;
  status: TaskStatus;
  results: TaskResult[];
  created_at: number;
  completed_at?: number;
  timeout_ms: number;
}

export interface TaskContext {
  parent_task_id?: string;
  chain_depth: number;
  max_chain_depth: number;
  shared_state: Record<string, any>;
  privacy_level: 'public' | 'obscured' | 'encrypted' | 'zk';
  delegation_id?: string;
}

export type TaskStatus = 
  | 'pending'
  | 'dispatched'
  | 'in_progress'
  | 'awaiting_consensus'
  | 'completed'
  | 'failed'
  | 'timeout';

export interface TaskResult {
  agent_id: string;
  success: boolean;
  outputs?: Record<string, any>;
  error?: string;
  execution_time_ms: number;
  signature: string;
  timestamp: number;
}

export interface CoordinationRequest {
  from_agent: string;
  to_agent: string;
  capability_id: string;
  inputs: Record<string, any>;
  context: Partial<TaskContext>;
  require_consensus?: boolean;
  consensus_threshold?: number;
}

export interface CoordinationResponse {
  task_id: string;
  status: TaskStatus;
  results?: TaskResult[];
  consensus_reached?: boolean;
  aggregated_result?: Record<string, any>;
  error?: string;
}

class AgentCoordinator {
  private tasks: Map<string, AgentTask> = new Map();
  private pendingRequests: Map<string, CoordinationRequest[]> = new Map();
  private taskCache: Map<string, CoordinationResponse> = new Map(); // Cache recent results
  
  private readonly MAX_CHAIN_DEPTH = 5;
  private readonly DEFAULT_TIMEOUT_MS = 30000;
  private readonly MAX_TASKS = 10000; // Prevent memory leaks
  private readonly CACHE_TTL_MS = 60000; // 1 minute cache

  /**
   * Request a capability from another agent
   */
  async requestCapability(request: CoordinationRequest): Promise<CoordinationResponse> {
    // Input validation
    if (!request.from_agent || !request.to_agent || !request.capability_id) {
      return { task_id: '', status: 'failed', error: 'Missing required fields: from_agent, to_agent, capability_id' };
    }

    // Cleanup old tasks if needed
    this.cleanupOldTasks();

    const fromAgent = agentRegistry.getAgent(request.from_agent);
    const toAgent = agentRegistry.getAgent(request.to_agent);

    if (!fromAgent) {
      return { task_id: '', status: 'failed', error: `Requesting agent '${request.from_agent}' not registered` };
    }

    if (!toAgent) {
      return { task_id: '', status: 'failed', error: `Target agent '${request.to_agent}' not registered` };
    }

    // Check if target agent provides the capability
    if (!toAgent.capabilities_provided.includes(request.capability_id)) {
      // Check for delegation
      const delegation = agentRegistry.hasDelegatedAccess(request.to_agent, request.capability_id);
      if (!delegation) {
        return { task_id: '', status: 'failed', error: 'Target agent does not provide this capability' };
      }
    }

    // Check chain depth
    const chainDepth = request.context.chain_depth || 0;
    if (chainDepth >= this.MAX_CHAIN_DEPTH) {
      return { task_id: '', status: 'failed', error: 'Maximum chain depth exceeded' };
    }

    // Create task
    const task = this.createTask(request, [request.to_agent]);

    // Dispatch to target agent
    const result = await this.dispatchToAgent(task, toAgent);

    task.results.push(result);
    task.status = result.success ? 'completed' : 'failed';
    task.completed_at = Date.now();

    // Record invocation for reputation
    agentRegistry.recordInvocation(
      request.to_agent,
      result.success,
      result.execution_time_ms
    );

    return {
      task_id: task.task_id,
      status: task.status,
      results: task.results,
      aggregated_result: result.outputs
    };
  }

  /**
   * Request capability from multiple agents with consensus
   */
  async requestWithConsensus(
    request: CoordinationRequest,
    targetAgents: string[],
    consensusThreshold: number = 0.66
  ): Promise<CoordinationResponse> {
    const fromAgent = agentRegistry.getAgent(request.from_agent);
    if (!fromAgent) {
      return { task_id: '', status: 'failed', error: 'Requesting agent not registered' };
    }

    // Validate all target agents
    const validAgents: RegisteredAgent[] = [];
    for (const agentId of targetAgents) {
      const agent = agentRegistry.getAgent(agentId);
      if (agent && agent.capabilities_provided.includes(request.capability_id)) {
        validAgents.push(agent);
      }
    }

    if (validAgents.length === 0) {
      return { task_id: '', status: 'failed', error: 'No valid target agents found' };
    }

    // Create task
    const task = this.createTask(request, validAgents.map(a => a.agent_id));
    task.status = 'dispatched';

    // Dispatch to all agents in parallel
    const resultPromises = validAgents.map(agent => this.dispatchToAgent(task, agent));
    const results = await Promise.all(resultPromises);

    task.results = results;

    // Check consensus
    const successfulResults = results.filter(r => r.success);
    const consensusReached = successfulResults.length / validAgents.length >= consensusThreshold;

    if (consensusReached) {
      task.status = 'completed';
      
      // Aggregate results (simple majority for now)
      const aggregated = this.aggregateResults(successfulResults);

      return {
        task_id: task.task_id,
        status: 'completed',
        results: task.results,
        consensus_reached: true,
        aggregated_result: aggregated
      };
    } else {
      task.status = 'failed';
      return {
        task_id: task.task_id,
        status: 'failed',
        results: task.results,
        consensus_reached: false,
        error: `Consensus not reached: ${successfulResults.length}/${validAgents.length} succeeded`
      };
    }
  }

  /**
   * Chain capabilities across multiple agents
   */
  async chainCapabilities(
    initiatorAgent: string,
    chain: Array<{ agent_id: string; capability_id: string; input_mapping?: Record<string, string> }>,
    initialInputs: Record<string, any>,
    privacyLevel: 'public' | 'obscured' | 'encrypted' | 'zk' = 'public'
  ): Promise<CoordinationResponse> {
    const initiator = agentRegistry.getAgent(initiatorAgent);
    if (!initiator) {
      return { task_id: '', status: 'failed', error: 'Initiator agent not registered' };
    }

    let currentInputs = { ...initialInputs };
    const results: TaskResult[] = [];
    const chainTaskId = `chain_${crypto.randomBytes(12).toString('hex')}`;

    for (let i = 0; i < chain.length; i++) {
      const step = chain[i];
      
      // Map outputs from previous step to inputs for this step
      if (step.input_mapping && i > 0) {
        const prevResult = results[i - 1];
        if (prevResult.outputs) {
          for (const [inputKey, outputKey] of Object.entries(step.input_mapping)) {
            currentInputs[inputKey] = prevResult.outputs[outputKey];
          }
        }
      }

      const response = await this.requestCapability({
        from_agent: initiatorAgent,
        to_agent: step.agent_id,
        capability_id: step.capability_id,
        inputs: currentInputs,
        context: {
          parent_task_id: chainTaskId,
          chain_depth: i,
          max_chain_depth: chain.length,
          shared_state: {},
          privacy_level: privacyLevel
        }
      });

      if (response.status === 'failed') {
        return {
          task_id: chainTaskId,
          status: 'failed',
          results,
          error: `Chain failed at step ${i + 1}: ${response.error}`
        };
      }

      if (response.results && response.results.length > 0) {
        results.push(response.results[0]);
        if (response.results[0].outputs) {
          currentInputs = { ...currentInputs, ...response.results[0].outputs };
        }
      }
    }

    return {
      task_id: chainTaskId,
      status: 'completed',
      results,
      aggregated_result: currentInputs
    };
  }

  /**
   * Create a new task
   */
  private createTask(request: CoordinationRequest, targetAgents: string[]): AgentTask {
    const taskId = `task_${crypto.randomBytes(12).toString('hex')}`;

    const task: AgentTask = {
      task_id: taskId,
      initiator_agent: request.from_agent,
      target_agents: targetAgents,
      capability_id: request.capability_id,
      inputs: request.inputs,
      context: {
        parent_task_id: request.context.parent_task_id,
        chain_depth: request.context.chain_depth || 0,
        max_chain_depth: request.context.max_chain_depth || this.MAX_CHAIN_DEPTH,
        shared_state: request.context.shared_state || {},
        privacy_level: request.context.privacy_level || 'public',
        delegation_id: request.context.delegation_id
      },
      status: 'pending',
      results: [],
      created_at: Date.now(),
      timeout_ms: this.DEFAULT_TIMEOUT_MS
    };

    this.tasks.set(taskId, task);
    return task;
  }

  /**
   * Dispatch task to an agent (simulated - in production would call agent endpoint)
   */
  private async dispatchToAgent(task: AgentTask, agent: RegisteredAgent): Promise<TaskResult> {
    const startTime = Date.now();

    try {
      // Wrap execution with timeout
      const result = await this.executeWithTimeout(
        async () => {
          // In production, this would make an HTTP call to agent.endpoint
          if (agent.endpoint) {
            // Real HTTP call would go here
            // const response = await fetch(agent.endpoint, { ... });
          }
          
          // Simulate execution (faster in tests)
          await new Promise(resolve => setTimeout(resolve, 20 + Math.random() * 50));

          return {
            agent_id: agent.agent_id,
            success: true,
            outputs: {
              ...task.inputs,
              processed_by: agent.agent_id,
              processed_at: Date.now()
            },
            execution_time_ms: Date.now() - startTime,
            signature: crypto.createHash('sha256')
              .update(`${agent.agent_id}:${task.task_id}:${Date.now()}`)
              .digest('hex'),
            timestamp: Date.now()
          } as TaskResult;
        },
        task.timeout_ms
      );

      return result;
    } catch (error) {
      const isTimeout = error instanceof Error && error.message === 'TIMEOUT';
      return {
        agent_id: agent.agent_id,
        success: false,
        error: isTimeout ? 'Request timed out' : (error instanceof Error ? error.message : 'Unknown error'),
        execution_time_ms: Date.now() - startTime,
        signature: '',
        timestamp: Date.now()
      };
    }
  }

  /**
   * Execute with timeout
   */
  private async executeWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) => 
        setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs)
      )
    ]);
  }

  /**
   * Cleanup old tasks to prevent memory leaks
   */
  private cleanupOldTasks(): void {
    if (this.tasks.size > this.MAX_TASKS) {
      const sortedTasks = Array.from(this.tasks.entries())
        .sort((a, b) => a[1].created_at - b[1].created_at);
      
      // Remove oldest 20%
      const toRemove = Math.floor(this.MAX_TASKS * 0.2);
      for (let i = 0; i < toRemove; i++) {
        this.tasks.delete(sortedTasks[i][0]);
      }
    }
  }

  /**
   * Aggregate results from multiple agents
   */
  private aggregateResults(results: TaskResult[]): Record<string, any> {
    if (results.length === 0) return {};
    if (results.length === 1) return results[0].outputs || {};

    // Simple aggregation: merge all outputs, last value wins for conflicts
    const aggregated: Record<string, any> = {};
    for (const result of results) {
      if (result.outputs) {
        Object.assign(aggregated, result.outputs);
      }
    }

    aggregated._consensus = {
      total_agents: results.length,
      successful_agents: results.filter(r => r.success).length,
      aggregation_method: 'merge'
    };

    return aggregated;
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): AgentTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get all tasks for an agent
   */
  getAgentTasks(agentId: string): AgentTask[] {
    return Array.from(this.tasks.values()).filter(
      t => t.initiator_agent === agentId || t.target_agents.includes(agentId)
    );
  }

  /**
   * Get coordination statistics
   */
  getStats(): {
    total_tasks: number;
    completed_tasks: number;
    failed_tasks: number;
    average_execution_time_ms: number;
  } {
    const tasks = Array.from(this.tasks.values());
    const completed = tasks.filter(t => t.status === 'completed');
    const failed = tasks.filter(t => t.status === 'failed');

    const totalTime = completed.reduce((sum, t) => {
      const avgTime = t.results.reduce((s, r) => s + r.execution_time_ms, 0) / (t.results.length || 1);
      return sum + avgTime;
    }, 0);

    return {
      total_tasks: tasks.length,
      completed_tasks: completed.length,
      failed_tasks: failed.length,
      average_execution_time_ms: completed.length > 0 ? totalTime / completed.length : 0
    };
  }
}

export const agentCoordinator = new AgentCoordinator();
