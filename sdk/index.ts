/**
 * CAP-402 SDK
 * 
 * Production-ready SDK for building agents on the CAP-402 protocol.
 * 
 * @example Basic Client Usage
 * ```typescript
 * import { createClient } from '@cap402/sdk';
 * 
 * const client = createClient('https://cap402.com');
 * const price = await client.getPrice('SOL');
 * ```
 * 
 * @example Production Agent
 * ```typescript
 * import { createAgent } from '@cap402/sdk';
 * 
 * const agent = createAgent({
 *   agent_id: 'my-agent',
 *   name: 'My Trading Agent',
 *   capabilities_provided: ['analysis.portfolio']
 * });
 * 
 * await agent.start();
 * const result = await agent.invoke('cap.price.lookup.v1', { base_token: 'SOL' });
 * await agent.stop();
 * ```
 */

// Core client
export { CAP402Client, createClient, useCAP402 } from './client';

// Production agent
export { 
  CAP402Agent, 
  Agent,
  createAgent,
  type AgentConfig,
  type AgentState,
  type InvokeResult,
  type A2AMessage,
  type A2AInvokeRequest,
  type SwarmTask,
  type AuctionRequest
} from './agent';

// Types
export {
  SDKConfig,
  DiscoverOptions,
  InvokeOptions,
  CapabilityResponse,
  InvocationResponse
} from './types';

// Agent Templates
export { 
  TradingAgent, 
  createTradingAgent,
  MonitoringAgent,
  createMonitoringAgent,
  AnalyticsAgent,
  createAnalyticsAgent
} from './agents';

// Orchestration
export {
  MultiAgentOrchestrator,
  createOrchestrator
} from './orchestration';

// Testing
export {
  AgentTester,
  CapabilityValidator,
  runQuickTest
} from './testing';

// Webhooks
export {
  WebhookManager,
  createWebhookManager
} from './webhooks';

// Safety Guardrails
export {
  SafetyGuardrails,
  createSafetyGuardrails,
  SAFETY_PRESETS,
  DEFAULT_SAFETY_CONFIG
} from './safety';

// Re-export capability types from spec
export type { Capability } from '../spec/capabilities';
