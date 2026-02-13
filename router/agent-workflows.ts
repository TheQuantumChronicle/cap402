/**
 * Agent Workflow Templates
 * 
 * Pre-built multi-agent workflow patterns that agents can use:
 * - Trading workflows (price check → analysis → swap)
 * - Research workflows (data gather → analyze → report)
 * - Privacy workflows (wrap → compute → unwrap)
 * - Governance workflows (propose → vote → execute)
 */

import { agentCoordinator } from './agent-coordination';
import { agentRegistry } from './agent-registry';

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: 'trading' | 'research' | 'privacy' | 'governance' | 'custom';
  steps: WorkflowStep[];
  required_capabilities: string[];
  estimated_time_ms: number;
  privacy_level: 'public' | 'obscured' | 'encrypted' | 'zk';
  min_agents: number;
}

export interface WorkflowStep {
  step_id: string;
  name: string;
  capability_id: string;
  agent_role: string; // e.g., "price_provider", "analyzer", "executor"
  input_mapping: Record<string, string>; // maps from previous outputs
  required: boolean;
  timeout_ms: number;
}

export interface WorkflowExecution {
  execution_id: string;
  template_id: string;
  initiator_agent: string;
  assigned_agents: Record<string, string>; // role -> agent_id
  status: 'pending' | 'running' | 'completed' | 'failed';
  current_step: number;
  results: Record<string, any>;
  started_at: number;
  completed_at?: number;
  error?: string;
}

class AgentWorkflowEngine {
  private templates: Map<string, WorkflowTemplate> = new Map();
  private executions: Map<string, WorkflowExecution> = new Map();
  private readonly MAX_EXECUTIONS = 5000;

  constructor() {
    this.registerBuiltInTemplates();
    
    // Periodic cleanup of old completed/failed executions
    setInterval(() => {
      if (this.executions.size > this.MAX_EXECUTIONS) {
        let removed = 0;
        const toRemove = Math.floor(this.MAX_EXECUTIONS * 0.3);
        for (const [key, exec] of this.executions) {
          if (removed >= toRemove) break;
          if (exec.status === 'completed' || exec.status === 'failed') {
            this.executions.delete(key);
            removed++;
          }
        }
      }
    }, 5 * 60 * 1000).unref();
  }

  private registerBuiltInTemplates(): void {
    // Trading workflow: Price → Analysis → Swap
    this.templates.set('trading_basic', {
      id: 'trading_basic',
      name: 'Basic Trading Workflow',
      description: 'Get price, analyze opportunity, execute swap',
      category: 'trading',
      steps: [
        {
          step_id: 'get_price',
          name: 'Get Current Price',
          capability_id: 'cap.price.lookup.v1',
          agent_role: 'price_provider',
          input_mapping: {},
          required: true,
          timeout_ms: 5000
        },
        {
          step_id: 'check_balance',
          name: 'Check Wallet Balance',
          capability_id: 'cap.wallet.snapshot.v1',
          agent_role: 'wallet_provider',
          input_mapping: {},
          required: true,
          timeout_ms: 5000
        },
        {
          step_id: 'execute_swap',
          name: 'Execute Swap',
          capability_id: 'cap.swap.execute.v1',
          agent_role: 'executor',
          input_mapping: { price: 'get_price.price' },
          required: true,
          timeout_ms: 30000
        }
      ],
      required_capabilities: ['cap.price.lookup.v1', 'cap.wallet.snapshot.v1', 'cap.swap.execute.v1'],
      estimated_time_ms: 40000,
      privacy_level: 'public',
      min_agents: 1
    });

    // Private trading workflow
    this.templates.set('trading_private', {
      id: 'trading_private',
      name: 'Private Trading Workflow',
      description: 'Confidential swap with ZK balance proof',
      category: 'trading',
      steps: [
        {
          step_id: 'prove_balance',
          name: 'Generate Balance Proof',
          capability_id: 'cap.zk.proof.balance.v1',
          agent_role: 'prover',
          input_mapping: {},
          required: true,
          timeout_ms: 10000
        },
        {
          step_id: 'wrap_tokens',
          name: 'Wrap to Confidential',
          capability_id: 'cap.cspl.wrap.v1',
          agent_role: 'wrapper',
          input_mapping: {},
          required: true,
          timeout_ms: 15000
        },
        {
          step_id: 'confidential_swap',
          name: 'Execute Confidential Swap',
          capability_id: 'cap.confidential.swap.v1',
          agent_role: 'executor',
          input_mapping: { proof: 'prove_balance.proof' },
          required: true,
          timeout_ms: 30000
        }
      ],
      required_capabilities: ['cap.zk.proof.balance.v1', 'cap.cspl.wrap.v1', 'cap.confidential.swap.v1'],
      estimated_time_ms: 55000,
      privacy_level: 'zk',
      min_agents: 1
    });

    // Research workflow
    this.templates.set('research_market', {
      id: 'research_market',
      name: 'Market Research Workflow',
      description: 'Gather prices, analyze trends, generate report',
      category: 'research',
      steps: [
        {
          step_id: 'gather_sol',
          name: 'Get SOL Price',
          capability_id: 'cap.price.lookup.v1',
          agent_role: 'data_gatherer',
          input_mapping: {},
          required: true,
          timeout_ms: 5000
        },
        {
          step_id: 'gather_btc',
          name: 'Get BTC Price',
          capability_id: 'cap.price.lookup.v1',
          agent_role: 'data_gatherer',
          input_mapping: {},
          required: true,
          timeout_ms: 5000
        },
        {
          step_id: 'gather_eth',
          name: 'Get ETH Price',
          capability_id: 'cap.price.lookup.v1',
          agent_role: 'data_gatherer',
          input_mapping: {},
          required: true,
          timeout_ms: 5000
        }
      ],
      required_capabilities: ['cap.price.lookup.v1'],
      estimated_time_ms: 15000,
      privacy_level: 'public',
      min_agents: 1
    });

    // Multi-agent consensus workflow
    this.templates.set('consensus_price', {
      id: 'consensus_price',
      name: 'Multi-Agent Price Consensus',
      description: 'Get price from multiple agents, reach consensus',
      category: 'research',
      steps: [
        {
          step_id: 'price_agent_1',
          name: 'Price from Agent 1',
          capability_id: 'cap.price.lookup.v1',
          agent_role: 'oracle_1',
          input_mapping: {},
          required: true,
          timeout_ms: 5000
        },
        {
          step_id: 'price_agent_2',
          name: 'Price from Agent 2',
          capability_id: 'cap.price.lookup.v1',
          agent_role: 'oracle_2',
          input_mapping: {},
          required: true,
          timeout_ms: 5000
        },
        {
          step_id: 'price_agent_3',
          name: 'Price from Agent 3',
          capability_id: 'cap.price.lookup.v1',
          agent_role: 'oracle_3',
          input_mapping: {},
          required: false,
          timeout_ms: 5000
        }
      ],
      required_capabilities: ['cap.price.lookup.v1'],
      estimated_time_ms: 15000,
      privacy_level: 'public',
      min_agents: 2
    });

    // Private messaging workflow
    this.templates.set('secure_messaging', {
      id: 'secure_messaging',
      name: 'Secure Agent Messaging',
      description: 'End-to-end encrypted messaging between agents',
      category: 'privacy',
      steps: [
        {
          step_id: 'encrypt_message',
          name: 'Encrypt Message (FHE)',
          capability_id: 'cap.fhe.compute.v1',
          agent_role: 'sender',
          input_mapping: {},
          required: true,
          timeout_ms: 5000
        },
        {
          step_id: 'send_message',
          name: 'Send Lightning Message',
          capability_id: 'cap.lightning.message.v1',
          agent_role: 'sender',
          input_mapping: { encrypted: 'encrypt_message.result' },
          required: true,
          timeout_ms: 5000
        }
      ],
      required_capabilities: ['cap.fhe.compute.v1', 'cap.lightning.message.v1'],
      estimated_time_ms: 10000,
      privacy_level: 'encrypted',
      min_agents: 2
    });
  }

  /**
   * Get all available workflow templates
   */
  getTemplates(category?: string): WorkflowTemplate[] {
    const templates = Array.from(this.templates.values());
    if (category) {
      return templates.filter(t => t.category === category);
    }
    return templates;
  }

  /**
   * Get a specific template
   */
  getTemplate(templateId: string): WorkflowTemplate | undefined {
    return this.templates.get(templateId);
  }

  /**
   * Start a workflow execution
   */
  async startWorkflow(
    templateId: string,
    initiatorAgent: string,
    agentAssignments: Record<string, string>,
    initialInputs: Record<string, any>
  ): Promise<WorkflowExecution> {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }

    const executionId = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    const execution: WorkflowExecution = {
      execution_id: executionId,
      template_id: templateId,
      initiator_agent: initiatorAgent,
      assigned_agents: agentAssignments,
      status: 'running',
      current_step: 0,
      results: { ...initialInputs },
      started_at: Date.now()
    };

    this.executions.set(executionId, execution);

    // Execute steps sequentially
    try {
      for (let i = 0; i < template.steps.length; i++) {
        const step = template.steps[i];
        execution.current_step = i;

        const agentId = agentAssignments[step.agent_role] || initiatorAgent;
        
        // Map inputs from previous results
        const stepInputs: Record<string, any> = {};
        for (const [inputKey, outputPath] of Object.entries(step.input_mapping)) {
          const [stepId, outputKey] = outputPath.split('.');
          if (execution.results[stepId]) {
            stepInputs[inputKey] = execution.results[stepId][outputKey];
          }
        }

        // Execute via coordinator
        const result = await agentCoordinator.requestCapability({
          from_agent: initiatorAgent,
          to_agent: agentId,
          capability_id: step.capability_id,
          inputs: { ...initialInputs, ...stepInputs },
          context: {
            chain_depth: i,
            max_chain_depth: template.steps.length,
            shared_state: execution.results,
            privacy_level: template.privacy_level
          }
        });

        if (result.status === 'failed' && step.required) {
          execution.status = 'failed';
          execution.error = `Step ${step.name} failed: ${result.error}`;
          break;
        }

        execution.results[step.step_id] = result.aggregated_result || result.results?.[0]?.outputs;
      }

      if (execution.status !== 'failed') {
        execution.status = 'completed';
      }
    } catch (error) {
      execution.status = 'failed';
      execution.error = error instanceof Error ? error.message : 'Unknown error';
    }

    execution.completed_at = Date.now();
    return execution;
  }

  /**
   * Get workflow execution status
   */
  getExecution(executionId: string): WorkflowExecution | undefined {
    return this.executions.get(executionId);
  }

  /**
   * Get all executions for an agent
   */
  getAgentExecutions(agentId: string): WorkflowExecution[] {
    return Array.from(this.executions.values()).filter(
      e => e.initiator_agent === agentId || Object.values(e.assigned_agents).includes(agentId)
    );
  }

  /**
   * Register a custom workflow template
   */
  registerTemplate(template: WorkflowTemplate): void {
    this.templates.set(template.id, template);
  }

  /**
   * Get workflow statistics
   */
  getStats(): {
    total_templates: number;
    total_executions: number;
    completed_executions: number;
    failed_executions: number;
    by_category: Record<string, number>;
  } {
    const executions = Array.from(this.executions.values());
    const templates = Array.from(this.templates.values());

    const byCategory: Record<string, number> = {};
    templates.forEach(t => {
      byCategory[t.category] = (byCategory[t.category] || 0) + 1;
    });

    return {
      total_templates: templates.length,
      total_executions: executions.length,
      completed_executions: executions.filter(e => e.status === 'completed').length,
      failed_executions: executions.filter(e => e.status === 'failed').length,
      by_category: byCategory
    };
  }
}

export const agentWorkflowEngine = new AgentWorkflowEngine();
