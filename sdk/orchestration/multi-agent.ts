/**
 * Multi-Agent Orchestration
 * 
 * Coordinates multiple agents working together on complex tasks.
 * Real coordination with actual agent communication.
 */

import { CAP402Agent, createAgent, AgentConfig, InvokeResult } from '../agent';
import { EventEmitter } from 'events';

// ============================================
// TYPES
// ============================================

export interface OrchestratorConfig {
  orchestrator_id: string;
  name: string;
  router_url?: string;
  max_agents?: number;
  task_timeout_ms?: number;
  retry_failed_tasks?: boolean;
}

export interface AgentRole {
  role_id: string;
  agent_id: string;
  capabilities: string[];
  priority?: number;
}

export interface Task {
  task_id: string;
  name: string;
  capability_id: string;
  inputs: Record<string, any>;
  assigned_to?: string;
  depends_on?: string[];
  priority?: number;
  status: 'pending' | 'assigned' | 'running' | 'completed' | 'failed';
  result?: InvokeResult;
  error?: string;
  started_at?: number;
  completed_at?: number;
}

export interface Workflow {
  workflow_id: string;
  name: string;
  description?: string;
  tasks: Task[];
  status: 'pending' | 'running' | 'completed' | 'failed' | 'partial';
  created_at: number;
  started_at?: number;
  completed_at?: number;
}

export interface WorkflowResult {
  workflow_id: string;
  success: boolean;
  tasks_completed: number;
  tasks_failed: number;
  results: Record<string, any>;
  duration_ms: number;
}

// ============================================
// MULTI-AGENT ORCHESTRATOR
// ============================================

export class MultiAgentOrchestrator extends EventEmitter {
  private config: Required<OrchestratorConfig>;
  private coordinator: CAP402Agent;
  private agents: Map<string, CAP402Agent> = new Map();
  private roles: Map<string, AgentRole> = new Map();
  private workflows: Map<string, Workflow> = new Map();
  private taskQueue: Task[] = [];
  private isRunning = false;

  constructor(config: OrchestratorConfig) {
    super();

    this.config = {
      router_url: 'https://cap402.com',
      max_agents: 10,
      task_timeout_ms: 60000,
      retry_failed_tasks: true,
      ...config
    };

    this.coordinator = createAgent({
      agent_id: this.config.orchestrator_id,
      name: this.config.name,
      router_url: this.config.router_url,
      description: 'Multi-agent orchestrator',
      capabilities_provided: ['orchestration.coordinate', 'orchestration.dispatch'],
      tags: ['orchestrator', 'coordinator']
    });
  }

  // ============================================
  // LIFECYCLE
  // ============================================

  async start(): Promise<void> {
    console.log(`\n🎭 Starting Orchestrator: ${this.config.name}`);
    await this.coordinator.start();
    this.isRunning = true;
    this.emit('started');
  }

  async stop(): Promise<void> {
    console.log('\n🛑 Stopping Orchestrator...');
    this.isRunning = false;

    // Stop all managed agents
    const stopPromises: Promise<void>[] = [];
    this.agents.forEach((agent, id) => {
      stopPromises.push(
        agent.stop()
          .then(() => console.log(`   Stopped agent: ${id}`))
          .catch((e) => console.error(`   Failed to stop agent ${id}:`, e))
      );
    });
    await Promise.all(stopPromises);

    await this.coordinator.stop();
    this.emit('stopped');
  }

  // ============================================
  // AGENT MANAGEMENT
  // ============================================

  async addAgent(config: AgentConfig, role?: Partial<AgentRole>): Promise<CAP402Agent> {
    if (this.agents.size >= this.config.max_agents) {
      throw new Error(`Maximum agents (${this.config.max_agents}) reached`);
    }

    const agent = createAgent({
      router_url: this.config.router_url,
      ...config
    });

    await agent.start();
    this.agents.set(config.agent_id, agent);

    if (role) {
      this.roles.set(config.agent_id, {
        role_id: role.role_id || config.agent_id,
        agent_id: config.agent_id,
        capabilities: role.capabilities || config.capabilities_provided || [],
        priority: role.priority || 1
      });
    }

    console.log(`   Added agent: ${config.agent_id}`);
    this.emit('agent_added', { agent_id: config.agent_id });

    return agent;
  }

  async removeAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (agent) {
      await agent.stop();
      this.agents.delete(agentId);
      this.roles.delete(agentId);
      this.emit('agent_removed', { agent_id: agentId });
    }
  }

  getAgent(agentId: string): CAP402Agent | undefined {
    return this.agents.get(agentId);
  }

  listAgents(): string[] {
    return Array.from(this.agents.keys());
  }

  // ============================================
  // TASK ASSIGNMENT
  // ============================================

  private findBestAgent(capabilityId: string): string | null {
    let bestAgent: string | null = null;
    let bestPriority = -1;

    this.roles.forEach((role, agentId) => {
      if (role.capabilities.includes(capabilityId) || role.capabilities.includes('*')) {
        if (role.priority !== undefined && role.priority > bestPriority) {
          bestPriority = role.priority;
          bestAgent = agentId;
        }
      }
    });

    // Fallback: use any available agent
    if (!bestAgent && this.agents.size > 0) {
      bestAgent = Array.from(this.agents.keys())[0];
    }

    return bestAgent;
  }

  async dispatchTask(task: Task): Promise<InvokeResult> {
    const agentId = task.assigned_to || this.findBestAgent(task.capability_id);
    
    if (!agentId) {
      throw new Error(`No agent available for capability: ${task.capability_id}`);
    }

    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    task.assigned_to = agentId;
    task.status = 'running';
    task.started_at = Date.now();

    this.emit('task_started', { task_id: task.task_id, agent_id: agentId });

    try {
      const result = await agent.invoke(task.capability_id, task.inputs, {
        timeout_ms: this.config.task_timeout_ms
      });

      task.status = result.success ? 'completed' : 'failed';
      task.result = result;
      task.completed_at = Date.now();

      this.emit('task_completed', {
        task_id: task.task_id,
        success: result.success,
        duration_ms: task.completed_at - task.started_at!
      });

      return result;

    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : String(error);
      task.completed_at = Date.now();

      this.emit('task_failed', { task_id: task.task_id, error: task.error });

      throw error;
    }
  }

  // ============================================
  // WORKFLOW EXECUTION
  // ============================================

  createWorkflow(name: string, tasks: Omit<Task, 'task_id' | 'status'>[]): Workflow {
    const workflow: Workflow = {
      workflow_id: `wf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      tasks: tasks.map((t, i) => ({
        ...t,
        task_id: `task_${i}_${Date.now()}`,
        status: 'pending' as const
      })),
      status: 'pending',
      created_at: Date.now()
    };

    this.workflows.set(workflow.workflow_id, workflow);
    return workflow;
  }

  async executeWorkflow(workflowId: string): Promise<WorkflowResult> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    workflow.status = 'running';
    workflow.started_at = Date.now();

    const results: Record<string, any> = {};
    let tasksCompleted = 0;
    let tasksFailed = 0;

    // Build dependency graph
    const taskMap = new Map<string, Task>();
    for (const task of workflow.tasks) {
      taskMap.set(task.task_id, task);
    }

    // Execute tasks respecting dependencies
    const completed = new Set<string>();
    const pending = [...workflow.tasks];

    while (pending.length > 0) {
      // Find tasks ready to run (dependencies satisfied)
      const ready = pending.filter(task => {
        if (!task.depends_on || task.depends_on.length === 0) return true;
        return task.depends_on.every(dep => completed.has(dep));
      });

      if (ready.length === 0 && pending.length > 0) {
        // Deadlock - circular dependency
        console.error('Workflow deadlock detected');
        break;
      }

      // Execute ready tasks in parallel
      const executions = ready.map(async (task) => {
        try {
          const result = await this.dispatchTask(task);
          results[task.task_id] = result.outputs;
          tasksCompleted++;
          return { task, success: true };
        } catch (error) {
          tasksFailed++;
          
          if (this.config.retry_failed_tasks) {
            // One retry
            try {
              const result = await this.dispatchTask(task);
              results[task.task_id] = result.outputs;
              tasksCompleted++;
              tasksFailed--;
              return { task, success: true };
            } catch {
              return { task, success: false };
            }
          }
          
          return { task, success: false };
        }
      });

      const outcomes = await Promise.all(executions);

      for (const { task } of outcomes) {
        completed.add(task.task_id);
        const idx = pending.findIndex(t => t.task_id === task.task_id);
        if (idx > -1) pending.splice(idx, 1);
      }
    }

    workflow.completed_at = Date.now();
    workflow.status = tasksFailed === 0 ? 'completed' : 
                      tasksCompleted > 0 ? 'partial' : 'failed';

    const workflowResult: WorkflowResult = {
      workflow_id: workflowId,
      success: tasksFailed === 0,
      tasks_completed: tasksCompleted,
      tasks_failed: tasksFailed,
      results,
      duration_ms: workflow.completed_at - workflow.started_at!
    };

    this.emit('workflow_completed', workflowResult);

    return workflowResult;
  }

  // ============================================
  // PARALLEL EXECUTION
  // ============================================

  async executeParallel(
    tasks: Array<{ capability_id: string; inputs: Record<string, any> }>
  ): Promise<{
    success: boolean;
    results: InvokeResult[];
    duration_ms: number;
  }> {
    const startTime = Date.now();

    // Distribute tasks across agents
    const agentIds = Array.from(this.agents.keys());
    if (agentIds.length === 0) {
      throw new Error('No agents available');
    }

    const executions = tasks.map(async (task, i) => {
      const agentId = agentIds[i % agentIds.length];
      const agent = this.agents.get(agentId)!;
      
      return agent.invoke(task.capability_id, task.inputs);
    });

    const results = await Promise.all(executions);

    return {
      success: results.every(r => r.success),
      results,
      duration_ms: Date.now() - startTime
    };
  }

  // ============================================
  // CONSENSUS EXECUTION
  // ============================================

  async executeWithConsensus(
    capabilityId: string,
    inputs: Record<string, any>,
    options?: {
      min_agreement?: number;
      timeout_ms?: number;
    }
  ): Promise<{
    consensus: boolean;
    agreed_value: any;
    responses: Array<{ agent_id: string; value: any }>;
    agreement_rate: number;
  }> {
    const minAgreement = options?.min_agreement ?? 0.5;
    const responses: Array<{ agent_id: string; value: any }> = [];

    // Get responses from all agents
    const executions = Array.from(this.agents.entries()).map(async ([agentId, agent]) => {
      try {
        const result = await agent.invoke(capabilityId, inputs, {
          timeout_ms: options?.timeout_ms
        });
        
        if (result.success && result.outputs) {
          return { agent_id: agentId, value: result.outputs };
        }
      } catch {
        // Agent failed to respond
      }
      return null;
    });

    const results = await Promise.all(executions);
    
    for (const result of results) {
      if (result) responses.push(result);
    }

    if (responses.length === 0) {
      return {
        consensus: false,
        agreed_value: null,
        responses: [],
        agreement_rate: 0
      };
    }

    // Find consensus (simple majority on stringified values)
    const valueCounts = new Map<string, { count: number; value: any }>();
    
    for (const response of responses) {
      const key = JSON.stringify(response.value);
      const existing = valueCounts.get(key);
      if (existing) {
        existing.count++;
      } else {
        valueCounts.set(key, { count: 1, value: response.value });
      }
    }

    let maxCount = 0;
    let agreedValue: any = null;

    valueCounts.forEach(({ count, value }) => {
      if (count > maxCount) {
        maxCount = count;
        agreedValue = value;
      }
    });

    const agreementRate = maxCount / responses.length;

    return {
      consensus: agreementRate >= minAgreement,
      agreed_value: agreedValue,
      responses,
      agreement_rate: agreementRate
    };
  }

  // ============================================
  // STATS
  // ============================================

  getStats(): {
    agents: number;
    workflows: number;
    workflows_completed: number;
    workflows_failed: number;
  } {
    let completed = 0;
    let failed = 0;

    this.workflows.forEach(wf => {
      if (wf.status === 'completed') completed++;
      if (wf.status === 'failed') failed++;
    });

    return {
      agents: this.agents.size,
      workflows: this.workflows.size,
      workflows_completed: completed,
      workflows_failed: failed
    };
  }
}

// ============================================
// FACTORY
// ============================================

export function createOrchestrator(config: OrchestratorConfig): MultiAgentOrchestrator {
  return new MultiAgentOrchestrator(config);
}
