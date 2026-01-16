#!/usr/bin/env npx ts-node
/**
 * CAP-402 CLI Tool
 * 
 * Command-line interface for agent management, debugging, and operations.
 * 
 * Usage:
 *   npx ts-node sdk/cli.ts <command> [options]
 * 
 * Commands:
 *   health              - Check router health
 *   capabilities        - List all capabilities
 *   invoke <cap> <json> - Invoke a capability
 *   agents              - List registered agents
 *   agent <id>          - Get agent details
 *   register            - Register a new agent
 *   trust <id>          - Get trust score
 *   metrics             - Get system metrics
 *   discover <query>    - Semantic capability search
 *   batch <file>        - Execute batch invocations from file
 */

import axios, { AxiosInstance } from 'axios';

// ============================================
// CONFIGURATION
// ============================================

const ROUTER_URL = process.env.CAP402_ROUTER || 'https://cap402.com';
const API_KEY = process.env.CAP402_API_KEY;

const client: AxiosInstance = axios.create({
  baseURL: ROUTER_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    ...(API_KEY ? { 'X-API-Key': API_KEY } : {})
  }
});

// ============================================
// FORMATTING HELPERS
// ============================================

function printHeader(title: string): void {
  console.log('\n' + '═'.repeat(60));
  console.log(`  ${title}`);
  console.log('═'.repeat(60) + '\n');
}

function printSection(title: string): void {
  console.log(`\n${title}`);
  console.log('─'.repeat(40));
}

function printKeyValue(key: string, value: any, indent: number = 0): void {
  const prefix = '  '.repeat(indent);
  const formattedValue = typeof value === 'object' ? JSON.stringify(value) : value;
  console.log(`${prefix}${key}: ${formattedValue}`);
}

function printJson(data: any): void {
  console.log(JSON.stringify(data, null, 2));
}

function printError(message: string): void {
  console.error(`\n❌ Error: ${message}\n`);
}

function printSuccess(message: string): void {
  console.log(`\n✅ ${message}\n`);
}

// ============================================
// COMMANDS
// ============================================

async function cmdHealth(): Promise<void> {
  printHeader('Router Health Check');
  
  try {
    const response = await client.get('/health');
    const health = response.data;

    printKeyValue('Status', health.status || 'unknown');
    printKeyValue('Router URL', ROUTER_URL);
    printKeyValue('Timestamp', new Date().toISOString());

    if (health.capabilities_count !== undefined) {
      printKeyValue('Capabilities', health.capabilities_count);
    }
    if (health.uptime_seconds !== undefined) {
      printKeyValue('Uptime', `${Math.round(health.uptime_seconds / 60)} minutes`);
    }

    printSuccess('Router is healthy');
  } catch (error) {
    printError(`Cannot connect to router at ${ROUTER_URL}`);
    process.exit(1);
  }
}

async function cmdCapabilities(filter?: string): Promise<void> {
  printHeader('Available Capabilities');

  try {
    const response = await client.get('/capabilities');
    let capabilities = response.data.capabilities || [];

    if (filter) {
      capabilities = capabilities.filter((c: any) => 
        c.id.includes(filter) || c.name?.toLowerCase().includes(filter.toLowerCase())
      );
    }

    console.log(`Found ${capabilities.length} capabilities:\n`);

    for (const cap of capabilities) {
      console.log(`  📦 ${cap.name || cap.id}`);
      console.log(`     ID: ${cap.id}`);
      if (cap.execution?.mode) {
        console.log(`     Mode: ${cap.execution.mode}`);
      }
      if (cap.economics?.cost_hint !== undefined) {
        console.log(`     Cost: ${cap.economics.cost_hint} ${cap.economics.currency || 'USD'}`);
      }
      if (cap.description) {
        console.log(`     ${cap.description.substring(0, 60)}...`);
      }
      console.log('');
    }
  } catch (error) {
    printError('Failed to fetch capabilities');
    process.exit(1);
  }
}

async function cmdInvoke(capabilityId: string, inputsJson: string): Promise<void> {
  printHeader(`Invoke: ${capabilityId}`);

  let inputs: Record<string, any>;
  try {
    inputs = JSON.parse(inputsJson);
  } catch {
    printError('Invalid JSON inputs');
    process.exit(1);
  }

  console.log('Inputs:');
  printJson(inputs);

  try {
    const startTime = Date.now();
    const response = await client.post('/invoke', {
      capability_id: capabilityId,
      inputs
    });
    const latency = Date.now() - startTime;

    const result = response.data;

    printSection('Result');
    printKeyValue('Success', result.success);
    printKeyValue('Request ID', result.request_id);
    printKeyValue('Latency', `${latency}ms`);

    if (result.outputs) {
      printSection('Outputs');
      printJson(result.outputs);
    }

    if (result.error) {
      printSection('Error');
      console.log(result.error);
    }

    if (result.metadata?.execution) {
      printSection('Execution Metadata');
      printKeyValue('Time', `${result.metadata.execution.execution_time_ms}ms`);
      if (result.metadata.execution.cost_actual !== undefined) {
        printKeyValue('Cost', `${result.metadata.execution.cost_actual} ${result.metadata.execution.currency || 'USD'}`);
      }
      if (result.metadata.execution.provider) {
        printKeyValue('Provider', result.metadata.execution.provider);
      }
    }

    if (result.success) {
      printSuccess('Invocation completed');
    } else {
      printError('Invocation failed');
      process.exit(1);
    }
  } catch (error: any) {
    printError(error.response?.data?.error?.message || error.message);
    process.exit(1);
  }
}

async function cmdAgents(): Promise<void> {
  printHeader('Registered Agents');

  try {
    const response = await client.get('/agents');
    const agents = response.data.agents || [];

    console.log(`Found ${agents.length} agents:\n`);

    for (const agent of agents) {
      console.log(`  🤖 ${agent.name || agent.agent_id}`);
      console.log(`     ID: ${agent.agent_id}`);
      if (agent.capabilities_provided?.length) {
        console.log(`     Provides: ${agent.capabilities_provided.join(', ')}`);
      }
      if (agent.trust_score !== undefined) {
        console.log(`     Trust: ${agent.trust_score}`);
      }
      console.log('');
    }
  } catch (error) {
    printError('Failed to fetch agents');
    process.exit(1);
  }
}

async function cmdAgent(agentId: string): Promise<void> {
  printHeader(`Agent: ${agentId}`);

  try {
    const response = await client.get(`/unified/agent/${agentId}`);
    const agent = response.data;

    printKeyValue('ID', agent.agent_id || agentId);
    printKeyValue('Name', agent.name || 'N/A');
    printKeyValue('Description', agent.description || 'N/A');
    printKeyValue('Status', agent.status || 'unknown');

    if (agent.capabilities_provided?.length) {
      printSection('Capabilities Provided');
      for (const cap of agent.capabilities_provided) {
        console.log(`  • ${cap}`);
      }
    }

    if (agent.capabilities_required?.length) {
      printSection('Capabilities Required');
      for (const cap of agent.capabilities_required) {
        console.log(`  • ${cap}`);
      }
    }

    if (agent.reputation) {
      printSection('Reputation');
      printKeyValue('Score', agent.reputation.score);
      printKeyValue('Level', agent.reputation.level);
      printKeyValue('Success Rate', `${(agent.reputation.success_rate * 100).toFixed(1)}%`);
    }

    if (agent.metrics) {
      printSection('Metrics');
      printKeyValue('Total Invocations', agent.metrics.total_invocations);
      printKeyValue('Avg Latency', `${agent.metrics.avg_latency_ms}ms`);
    }

    printSuccess('Agent details retrieved');
  } catch (error: any) {
    if (error.response?.status === 404) {
      printError(`Agent '${agentId}' not found`);
    } else {
      printError('Failed to fetch agent details');
    }
    process.exit(1);
  }
}

async function cmdRegister(
  agentId: string,
  name: string,
  capabilities?: string
): Promise<void> {
  printHeader('Register Agent');

  const config = {
    agent_id: agentId,
    name: name,
    capabilities_provided: capabilities ? capabilities.split(',') : []
  };

  console.log('Configuration:');
  printJson(config);

  try {
    const response = await client.post('/agents/register', config);
    
    if (response.data.success || response.data.agent_id) {
      printSuccess(`Agent '${agentId}' registered successfully`);
      
      if (response.data.token) {
        printSection('Authentication Token');
        console.log(response.data.token);
        console.log('\n⚠️  Save this token securely. It will not be shown again.');
      }
    } else {
      printError('Registration failed');
      process.exit(1);
    }
  } catch (error: any) {
    printError(error.response?.data?.error?.message || error.message);
    process.exit(1);
  }
}

async function cmdTrust(agentId: string): Promise<void> {
  printHeader(`Trust Score: ${agentId}`);

  try {
    const response = await client.get(`/security/trust/${agentId}`);
    const trust = response.data;

    printKeyValue('Agent ID', agentId);
    printKeyValue('Score', trust.score || trust.trust_score || 0);
    printKeyValue('Level', trust.level || 'unknown');
    
    if (trust.endorsements !== undefined) {
      printKeyValue('Endorsements', trust.endorsements);
    }
    
    if (trust.history) {
      printSection('History');
      printKeyValue('Total Interactions', trust.history.total);
      printKeyValue('Successful', trust.history.successful);
      printKeyValue('Success Rate', `${((trust.history.successful / trust.history.total) * 100).toFixed(1)}%`);
    }

    printSuccess('Trust score retrieved');
  } catch (error: any) {
    if (error.response?.status === 404) {
      printError(`Agent '${agentId}' not found in trust network`);
    } else {
      printError('Failed to fetch trust score');
    }
    process.exit(1);
  }
}

async function cmdMetrics(): Promise<void> {
  printHeader('System Metrics');

  try {
    const response = await client.get('/metrics');
    const metrics = response.data;

    if (metrics.total_invocations !== undefined) {
      printKeyValue('Total Invocations', metrics.total_invocations);
    }
    if (metrics.success_rate !== undefined) {
      printKeyValue('Success Rate', `${(metrics.success_rate * 100).toFixed(1)}%`);
    }
    if (metrics.avg_latency_ms !== undefined) {
      printKeyValue('Avg Latency', `${metrics.avg_latency_ms}ms`);
    }
    if (metrics.active_agents !== undefined) {
      printKeyValue('Active Agents', metrics.active_agents);
    }
    if (metrics.capabilities_count !== undefined) {
      printKeyValue('Capabilities', metrics.capabilities_count);
    }

    if (metrics.by_capability) {
      printSection('By Capability');
      for (const [cap, data] of Object.entries(metrics.by_capability as Record<string, any>)) {
        console.log(`  ${cap}: ${data.count} calls, ${data.avg_latency_ms}ms avg`);
      }
    }

    printSuccess('Metrics retrieved');
  } catch (error) {
    printError('Failed to fetch metrics');
    process.exit(1);
  }
}

async function cmdDiscover(query: string): Promise<void> {
  printHeader(`Discover: "${query}"`);

  try {
    const response = await client.post('/discover', { query });
    const results = response.data.capabilities || response.data.results || [];

    console.log(`Found ${results.length} matching capabilities:\n`);

    for (const result of results) {
      const cap = result.capability || result;
      console.log(`  📦 ${cap.name || cap.id}`);
      console.log(`     ID: ${cap.id}`);
      if (result.score !== undefined) {
        console.log(`     Relevance: ${(result.score * 100).toFixed(0)}%`);
      }
      if (cap.description) {
        console.log(`     ${cap.description.substring(0, 60)}...`);
      }
      console.log('');
    }

    printSuccess('Discovery completed');
  } catch (error) {
    printError('Discovery failed');
    process.exit(1);
  }
}

async function cmdBatch(filePath: string): Promise<void> {
  printHeader('Batch Execution');

  const fs = await import('fs');
  
  if (!fs.existsSync(filePath)) {
    printError(`File not found: ${filePath}`);
    process.exit(1);
  }

  let requests: Array<{ capability_id: string; inputs: Record<string, any> }>;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    requests = JSON.parse(content);
  } catch {
    printError('Invalid JSON file');
    process.exit(1);
  }

  console.log(`Executing ${requests.length} requests...\n`);

  try {
    const startTime = Date.now();
    const response = await client.post('/batch/invoke', { requests });
    const totalTime = Date.now() - startTime;

    const results = response.data.results || [];
    let successes = 0;
    let failures = 0;

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const status = result.success ? '✓' : '✗';
      console.log(`  ${status} ${requests[i].capability_id}`);
      
      if (result.success) {
        successes++;
      } else {
        failures++;
        console.log(`    Error: ${result.error}`);
      }
    }

    printSection('Summary');
    printKeyValue('Total', requests.length);
    printKeyValue('Successes', successes);
    printKeyValue('Failures', failures);
    printKeyValue('Total Time', `${totalTime}ms`);
    printKeyValue('Avg Time', `${Math.round(totalTime / requests.length)}ms`);

    if (failures > 0) {
      printError(`${failures} requests failed`);
      process.exit(1);
    } else {
      printSuccess('Batch completed successfully');
    }
  } catch (error: any) {
    printError(error.response?.data?.error?.message || error.message);
    process.exit(1);
  }
}

async function cmdLeaderboard(category?: string): Promise<void> {
  printHeader('Agent Leaderboard');

  try {
    const response = await client.get('/a2a/leaderboard', {
      params: category ? { category } : {}
    });
    const leaderboard = response.data.leaderboard || [];

    if (category) {
      console.log(`Category: ${category}\n`);
    }

    console.log('Rank  Agent                          Score');
    console.log('─'.repeat(50));

    for (const entry of leaderboard) {
      const rank = String(entry.rank).padStart(3);
      const agent = (entry.agent_id || entry.name || 'Unknown').substring(0, 30).padEnd(30);
      const score = entry.score?.toFixed(2) || '0.00';
      console.log(`${rank}   ${agent} ${score}`);
    }

    printSuccess('Leaderboard retrieved');
  } catch (error) {
    printError('Failed to fetch leaderboard');
    process.exit(1);
  }
}

async function cmdExample(capabilityId: string): Promise<void> {
  printHeader(`Example: ${capabilityId}`);

  try {
    const response = await client.get(`/capabilities/${capabilityId}/example`);
    const example = response.data;

    if (example.curl) {
      printSection('cURL');
      console.log(example.curl);
    }

    if (example.inputs) {
      printSection('Example Inputs');
      printJson(example.inputs);
    }

    if (example.expected_outputs) {
      printSection('Expected Outputs');
      printJson(example.expected_outputs);
    }

    printSuccess('Example retrieved');
  } catch (error: any) {
    if (error.response?.status === 404) {
      printError(`Capability '${capabilityId}' not found`);
    } else {
      printError('Failed to fetch example');
    }
    process.exit(1);
  }
}

// ============================================
// MAIN
// ============================================

function printUsage(): void {
  console.log(`
CAP-402 CLI Tool

Usage: npx ts-node sdk/cli.ts <command> [options]

Commands:
  health                          Check router health
  capabilities [filter]           List capabilities (optionally filter by name/id)
  invoke <cap_id> <inputs_json>   Invoke a capability
  agents                          List registered agents
  agent <agent_id>                Get agent details
  register <id> <name> [caps]     Register a new agent
  trust <agent_id>                Get trust score
  metrics                         Get system metrics
  discover <query>                Semantic capability search
  batch <file.json>               Execute batch from JSON file
  leaderboard [category]          View agent leaderboard
  example <cap_id>                Get capability usage example

Environment Variables:
  CAP402_ROUTER    Router URL (default: https://cap402.com)
  CAP402_API_KEY   API key for authentication

Examples:
  npx ts-node sdk/cli.ts health
  npx ts-node sdk/cli.ts invoke cap.price.lookup.v1 '{"base_token":"SOL"}'
  npx ts-node sdk/cli.ts discover "get token price"
  npx ts-node sdk/cli.ts register my-agent "My Agent" "cap.price,cap.wallet"
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0]?.toLowerCase();

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printUsage();
    process.exit(0);
  }

  console.log(`\n🔗 Router: ${ROUTER_URL}`);

  try {
    switch (command) {
      case 'health':
        await cmdHealth();
        break;
      case 'capabilities':
      case 'caps':
        await cmdCapabilities(args[1]);
        break;
      case 'invoke':
        if (!args[1] || !args[2]) {
          printError('Usage: invoke <capability_id> <inputs_json>');
          process.exit(1);
        }
        await cmdInvoke(args[1], args[2]);
        break;
      case 'agents':
        await cmdAgents();
        break;
      case 'agent':
        if (!args[1]) {
          printError('Usage: agent <agent_id>');
          process.exit(1);
        }
        await cmdAgent(args[1]);
        break;
      case 'register':
        if (!args[1] || !args[2]) {
          printError('Usage: register <agent_id> <name> [capabilities]');
          process.exit(1);
        }
        await cmdRegister(args[1], args[2], args[3]);
        break;
      case 'trust':
        if (!args[1]) {
          printError('Usage: trust <agent_id>');
          process.exit(1);
        }
        await cmdTrust(args[1]);
        break;
      case 'metrics':
        await cmdMetrics();
        break;
      case 'discover':
        if (!args[1]) {
          printError('Usage: discover <query>');
          process.exit(1);
        }
        await cmdDiscover(args.slice(1).join(' '));
        break;
      case 'batch':
        if (!args[1]) {
          printError('Usage: batch <file.json>');
          process.exit(1);
        }
        await cmdBatch(args[1]);
        break;
      case 'leaderboard':
        await cmdLeaderboard(args[1]);
        break;
      case 'example':
        if (!args[1]) {
          printError('Usage: example <capability_id>');
          process.exit(1);
        }
        await cmdExample(args[1]);
        break;
      default:
        printError(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } catch (error: any) {
    printError(error.message);
    process.exit(1);
  }
}

main();
