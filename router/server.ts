import express, { Request, Response, NextFunction } from 'express';
import compression from 'compression';
import path from 'path';
import helmet from 'helmet';
import { registry } from './registry';
import { router, InvokeRequest } from './router';
import { observability } from './observability';
import { integrationManager } from '../providers/integration-manager';
import { rateLimiter } from './rate-limiter';
import { requestContext, errorHandler } from './middleware/request-context';
import { capabilityTokenManager } from './security/capability-tokens';
import { trustNetwork } from './security/trust-network';
import { agentHandshake } from './security/agent-handshake';
import { semanticEncryption } from './security/semantic-encryption';
import { securityAuditLog } from './security/audit-log';
import { responseCache } from './cache';
import { unifiedAgentService } from './agent-unified';
import * as dotenv from 'dotenv';

dotenv.config();

// ============================================
// UNIFIED ERROR CODES
// ============================================
const ErrorCodes = {
  VALIDATION_ERROR: { code: 'E001', status: 400 },
  UNAUTHORIZED: { code: 'E002', status: 401 },
  FORBIDDEN: { code: 'E003', status: 403 },
  NOT_FOUND: { code: 'E004', status: 404 },
  RATE_LIMITED: { code: 'E005', status: 429 },
  INTERNAL_ERROR: { code: 'E006', status: 500 },
  SERVICE_UNAVAILABLE: { code: 'E007', status: 503 },
  CIRCUIT_OPEN: { code: 'E008', status: 503 },
} as const;

type ErrorCode = keyof typeof ErrorCodes;

function apiError(code: ErrorCode, message: string, details?: any) {
  const { code: errorCode, status } = ErrorCodes[code];
  return { status, body: { success: false, error: { code: errorCode, message, details } } };
}

function apiSuccess<T>(data: T, meta?: any) {
  return { success: true, data, meta, timestamp: Date.now() };
}

// Request validation helper
function validate<T extends Record<string, any>>(body: any, required: (keyof T)[]): { valid: true; data: T } | { valid: false; missing: string[] } {
  const missing = required.filter(k => body[k] === undefined || body[k] === null);
  return missing.length ? { valid: false, missing: missing as string[] } : { valid: true, data: body as T };
}

// Graceful degradation - return cached/fallback data on errors
async function withFallback<T>(fn: () => Promise<T>, fallback: T, cacheKey?: string): Promise<T> {
  try {
    const result = await fn();
    if (cacheKey) responseCache.set(cacheKey, result, 300000); // Cache success for 5min
    return result;
  } catch {
    if (cacheKey) {
      const cached = responseCache.get(cacheKey);
      if (cached) return cached as T;
    }
    return fallback;
  }
}

const app = express();

// Security headers via Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.helius.xyz", "https://mainnet.helius-rpc.com", "https://pro-api.coinmarketcap.com"]
    }
  },
  crossOriginEmbedderPolicy: false, // Allow embedding for dashboard
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true
  }
}));

app.use(express.json({ limit: '1mb' })); // Limit request body size
app.use(compression({ threshold: 1024 })); // Compress responses > 1KB

// Serve frontend static files - use process.cwd() for correct path in Railway
app.use(express.static(path.join(process.cwd(), 'frontend')));
app.use('/public', express.static(path.join(process.cwd(), 'public')));
// Also serve public files at root for favicon.ico etc
app.use(express.static(path.join(process.cwd(), 'public')));

// CORS middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-Request-ID');
  res.setHeader('Access-Control-Expose-Headers', 'X-Request-ID, X-RateLimit-Remaining, X-RateLimit-Limit, X-Agent-Trust-Level');
  
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

// API versioning headers
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-API-Version', '0.1.0');
  res.setHeader('X-Protocol', 'CAP-402');
  next();
});

// Request context middleware (adds request ID and timing)
app.use(requestContext);

// Security middleware - sanitize request bodies
import { sanitizeRequestBody, verifyRequestSignature } from './middleware/security';
app.use(sanitizeRequestBody);

// Rate limiting middleware with adaptive load factor
app.use((req: Request, res: Response, next: NextFunction) => {
  const identifier = req.ip || req.socket?.remoteAddress || 'unknown';
  
  if (!rateLimiter.checkLimit(identifier, 100, 60000)) {
    const resetTime = rateLimiter.getResetTime(identifier);
    const err = apiError('RATE_LIMITED', 'Rate limit exceeded', { retry_after: resetTime ? Math.ceil((resetTime - Date.now()) / 1000) : 60 });
    return res.status(err.status).json(err.body);
  }
  
  res.setHeader('X-RateLimit-Remaining', rateLimiter.getRemainingRequests(identifier).toString());
  res.setHeader('X-RateLimit-Limit', Math.floor(100 * rateLimiter.getLoadFactor()).toString());
  next();
});

// Serve frontend at root
app.get('/', (req: Request, res: Response) => {
  // Use process.cwd() which is always the project root in both local and Railway
  const frontendPath = path.join(process.cwd(), 'frontend', 'index.html');
  res.sendFile(frontendPath);
});

// API info endpoint (moved from root)
app.get('/api', async (req: Request, res: Response) => {
  const allCaps = registry.getAllCapabilities();
  const publicCaps = allCaps.filter(c => c.execution.mode === 'public');
  const confidentialCaps = allCaps.filter(c => c.execution.mode === 'confidential');
  
  res.json({
    name: 'CAP-402',
    tagline: 'Privacy-First Agent Infrastructure',
    description: 'Semantic capability routing for autonomous agents with native privacy support',
    version: '0.1.0',
    protocol: 'CAP-402',
    status: 'operational',
    mission: 'Enable agents to access capabilities with privacy as a first-class routing decision',
    endpoints: {
      capabilities: '/capabilities',
      invoke: '/invoke',
      discover: '/discover',
      agents: '/agents/register',
      sponsors: '/sponsors',
      analytics: '/analytics/dashboard',
      health: '/health'
    },
    capabilities: {
      total: allCaps.length,
      public: publicCaps.length,
      confidential: confidentialCaps.length,
      privacy_ratio: `${Math.round((confidentialCaps.length / allCaps.length) * 100)}%`
    },
    sponsors: {
      arcium: { capabilities: 3, focus: 'C-SPL Confidential Tokens' },
      noir: { capabilities: 1, focus: 'Zero-Knowledge Proofs (10 circuits)' },
      helius: { capabilities: 1, focus: 'DAS API & Webhooks' },
      inco: { capabilities: 2, focus: 'Fully Homomorphic Encryption' }
    },
    templates: 6,
    agent_features: ['identity', 'reputation', 'delegation', 'messaging', 'recommendations'],
    links: {
      sponsor_status: '/sponsors',
      capabilities: '/capabilities',
      health: '/health',
      community: '/community/stats',
      openapi: '/openapi.json'
    }
  });
});

// OpenAPI schema for interoperability
app.get('/openapi.json', (req: Request, res: Response) => {
  res.json({
    openapi: '3.0.3',
    info: { title: 'CAP-402 API', version: '0.1.0', description: 'Privacy-First Agent Infrastructure' },
    servers: [{ url: 'https://cap402.com' }, { url: 'http://localhost:3001', description: 'Local development' }],
    paths: {
      '/invoke': {
        post: {
          summary: 'Invoke a capability',
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/InvokeRequest' } } } },
          responses: { '200': { description: 'Success' }, '400': { description: 'Validation error' }, '429': { description: 'Rate limited' } }
        }
      },
      '/capabilities': { get: { summary: 'List all capabilities', responses: { '200': { description: 'Capability list' } } } },
      '/capabilities/{id}': { get: { summary: 'Get capability by ID', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }] } },
      '/queue/invoke': { post: { summary: 'Priority queue invoke', requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/QueueInvokeRequest' } } } } } },
      '/system/health': { get: { summary: 'System health status' } },
      '/system/metrics': { get: { summary: 'Performance metrics' } }
    },
    components: {
      schemas: {
        InvokeRequest: { type: 'object', required: ['capability_id'], properties: { capability_id: { type: 'string' }, inputs: { type: 'object' }, preferences: { type: 'object' } } },
        QueueInvokeRequest: { type: 'object', required: ['capability_id'], properties: { capability_id: { type: 'string' }, inputs: { type: 'object' }, priority: { type: 'string', enum: ['critical', 'high', 'normal', 'low'] } } },
        Error: { type: 'object', properties: { success: { type: 'boolean' }, error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: { type: 'object' } } } } }
      }
    }
  });
});

app.get('/capabilities', (req: Request, res: Response) => {
  observability.info('server', 'Capability discovery request');
  
  const { tag, mode } = req.query;
  
  // Check cache
  const cacheKey = `caps:${tag || 'all'}:${mode || 'all'}`;
  const cached = responseCache.get(cacheKey);
  if (cached) {
    res.setHeader('X-Cache', 'HIT');
    return res.json(cached);
  }
  
  let capabilities;
  if (tag) {
    capabilities = registry.getCapabilitiesByTag(tag as string);
  } else if (mode) {
    capabilities = registry.getCapabilitiesByMode(mode as 'public' | 'confidential');
  } else {
    capabilities = registry.getAllCapabilities();
  }

  const response = {
    success: true,
    count: capabilities.length,
    capabilities
  };
  
  // Cache for 30 seconds
  responseCache.set(cacheKey, response, 30000);
  res.setHeader('X-Cache', 'MISS');
  res.json(response);
});

// Capability examples - quick reference for all capabilities
app.get('/capabilities/examples', (req: Request, res: Response) => {
  const examples = {
    'cap.price.lookup.v1': {
      description: 'Get real-time token prices',
      curl: `curl -X POST https://cap402.com/invoke -H "Content-Type: application/json" -d '{"capability_id":"cap.price.lookup.v1","inputs":{"base_token":"SOL"}}'`,
      inputs: { base_token: 'SOL' },
      sponsor: 'Helius'
    },
    'cap.wallet.snapshot.v1': {
      description: 'Get wallet balances and NFTs',
      curl: `curl -X POST https://cap402.com/invoke -H "Content-Type: application/json" -d '{"capability_id":"cap.wallet.snapshot.v1","inputs":{"address":"YOUR_WALLET"}}'`,
      inputs: { address: 'YOUR_WALLET_ADDRESS' },
      sponsor: 'Helius'
    },
    'cap.swap.execute.v1': {
      description: 'Execute token swap via Jupiter',
      curl: `curl -X POST https://cap402.com/invoke -H "Content-Type: application/json" -d '{"capability_id":"cap.swap.execute.v1","inputs":{"input_token":"SOL","output_token":"USDC","amount":0.001,"wallet_address":"YOUR_WALLET"}}'`,
      inputs: { input_token: 'SOL', output_token: 'USDC', amount: 0.001, wallet_address: 'YOUR_WALLET' },
      sponsor: 'Jupiter'
    },
    'cap.zk.proof.v1': {
      description: 'Generate zero-knowledge proof',
      curl: `curl -X POST https://cap402.com/invoke -H "Content-Type: application/json" -d '{"capability_id":"cap.zk.proof.v1","inputs":{"proof_type":"balance_threshold","circuit":"balance_threshold","public_inputs":{"threshold":100},"private_inputs":{"actual_balance":500}}}'`,
      inputs: { proof_type: 'balance_threshold', circuit: 'balance_threshold', public_inputs: { threshold: 100 }, private_inputs: { actual_balance: 500 } },
      sponsor: 'Noir/Aztec'
    },
    'cap.fhe.compute.v1': {
      description: 'Compute on encrypted data',
      curl: `curl -X POST https://cap402.com/invoke -H "Content-Type: application/json" -d '{"capability_id":"cap.fhe.compute.v1","inputs":{"operation":"add","operands":[100,50]}}'`,
      inputs: { operation: 'add', operands: [100, 50] },
      sponsor: 'Inco'
    },
    'cap.confidential.swap.v1': {
      description: 'Private token swap via MPC',
      curl: `curl -X POST https://cap402.com/invoke -H "Content-Type: application/json" -d '{"capability_id":"cap.confidential.swap.v1","inputs":{"input_token":"SOL","output_token":"USDC","amount":0.001,"wallet_address":"YOUR_WALLET"}}'`,
      inputs: { input_token: 'SOL', output_token: 'USDC', amount: 0.001, wallet_address: 'YOUR_WALLET' },
      sponsor: 'Arcium'
    },
    'cap.cspl.wrap.v1': {
      description: 'Wrap tokens into confidential C-SPL',
      curl: `curl -X POST https://cap402.com/invoke -H "Content-Type: application/json" -d '{"capability_id":"cap.cspl.wrap.v1","inputs":{"owner":"YOUR_WALLET","mint":"TOKEN_MINT","amount":100}}'`,
      inputs: { owner: 'YOUR_WALLET', mint: 'TOKEN_MINT', amount: 100 },
      sponsor: 'Arcium'
    }
  };

  res.json({
    success: true,
    count: Object.keys(examples).length,
    examples,
    note: 'Replace YOUR_WALLET with your actual wallet address'
  });
});

// Capability summary with sponsor breakdown (must be before :id route)
app.get('/capabilities/summary', (req: Request, res: Response) => {
  // Check cache
  const cached = responseCache.get('caps:summary');
  if (cached) {
    res.setHeader('X-Cache', 'HIT');
    return res.json(cached);
  }
  
  const summary = registry.getCapabilitySummary();
  const response = { success: true, ...summary };
  
  responseCache.set('caps:summary', response, 60000); // 60s cache
  res.setHeader('X-Cache', 'MISS');
  res.json(response);
});

app.get('/capabilities/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  observability.info('server', `Capability lookup: ${id}`);
  
  // Check cache first
  const cacheKey = `cap:${id}`;
  const cached = responseCache.get(cacheKey);
  if (cached) {
    res.setHeader('X-Cache', 'HIT');
    return res.json(cached);
  }
  
  const capability = registry.getCapability(id);
  
  if (!capability) {
    const err = apiError('NOT_FOUND', `Capability ${id} not found`);
    return res.status(err.status).json(err.body);
  }

  // Add sponsor info
  const sponsor = registry.getSponsor(id);

  const response = {
    success: true,
    capability,
    sponsor
  };
  
  // Cache for 60 seconds
  responseCache.set(cacheKey, response, 60000);
  res.setHeader('X-Cache', 'MISS');
  res.json(response);
});

// Batch capability lookup - get multiple capabilities at once
app.post('/capabilities/batch', (req: Request, res: Response) => {
  const { capability_ids } = req.body;
  
  if (!capability_ids || !Array.isArray(capability_ids)) {
    return res.status(400).json({
      success: false,
      error: 'capability_ids array required'
    });
  }
  
  const results = capability_ids.map(id => {
    const capability = registry.getCapability(id);
    const sponsor = capability ? registry.getSponsor(id) : null;
    return {
      id,
      found: !!capability,
      capability,
      sponsor
    };
  });
  
  res.json({
    success: true,
    count: results.length,
    found: results.filter(r => r.found).length,
    capabilities: results
  });
});

// Capability examples - show how to invoke each capability
app.get('/capabilities/:id/example', (req: Request, res: Response) => {
  const { id } = req.params;
  const capability = registry.getCapability(id);
  
  if (!capability) {
    return res.status(404).json({
      success: false,
      error: `Capability ${id} not found`
    });
  }

  // Generate example based on capability
  const examples: Record<string, any> = {
    'cap.price.lookup.v1': {
      curl: `curl -X POST https://cap402.com/invoke -H "Content-Type: application/json" -d '{"capability_id":"cap.price.lookup.v1","inputs":{"base_token":"SOL","quote_token":"USD"}}'`,
      inputs: { base_token: 'SOL', quote_token: 'USD' }
    },
    'cap.wallet.snapshot.v1': {
      curl: `curl -X POST https://cap402.com/invoke -H "Content-Type: application/json" -d '{"capability_id":"cap.wallet.snapshot.v1","inputs":{"address":"YOUR_WALLET_ADDRESS"}}'`,
      inputs: { address: 'YOUR_WALLET_ADDRESS', include_das_data: true }
    },
    'cap.swap.execute.v1': {
      curl: `curl -X POST https://cap402.com/invoke -H "Content-Type: application/json" -d '{"capability_id":"cap.swap.execute.v1","inputs":{"input_token":"SOL","output_token":"USDC","amount":1.0,"wallet_address":"YOUR_WALLET"}}'`,
      inputs: { input_token: 'SOL', output_token: 'USDC', amount: 1.0, wallet_address: 'YOUR_WALLET', slippage_bps: 50 }
    },
    'cap.zk.proof.v1': {
      curl: `curl -X POST https://cap402.com/invoke -H "Content-Type: application/json" -d '{"capability_id":"cap.zk.proof.v1","inputs":{"proof_type":"balance_threshold","public_inputs":{"threshold":100},"private_inputs":{"actual_balance":500}}}'`,
      inputs: { proof_type: 'balance_threshold', public_inputs: { threshold: 100, token_mint: 'SOL' }, private_inputs: { actual_balance: 500 } }
    },
    'cap.cspl.wrap.v1': {
      curl: `curl -X POST https://cap402.com/invoke -H "Content-Type: application/json" -d '{"capability_id":"cap.cspl.wrap.v1","inputs":{"owner":"YOUR_WALLET","mint":"TOKEN_MINT","amount":100}}'`,
      inputs: { owner: 'YOUR_WALLET', mint: 'TOKEN_MINT', amount: 100 }
    },
    'cap.fhe.compute.v1': {
      curl: `curl -X POST https://cap402.com/invoke -H "Content-Type: application/json" -d '{"capability_id":"cap.fhe.compute.v1","inputs":{"operation":"add","encrypted_inputs":["enc_a","enc_b"]}}'`,
      inputs: { operation: 'add', encrypted_inputs: ['encrypted_value_a', 'encrypted_value_b'] }
    }
  };

  const example = examples[id] || {
    curl: `curl -X POST https://cap402.com/invoke -H "Content-Type: application/json" -d '{"capability_id":"${id}","inputs":{}}'`,
    inputs: {},
    note: 'See capability schema for required inputs'
  };

  res.json({
    success: true,
    capability_id: id,
    example,
    schema: capability.inputs,
    execution_mode: capability.execution.mode
  });
});

app.post('/invoke', async (req: Request, res: Response) => {
  const invokeRequest: InvokeRequest = req.body;
  const startTime = Date.now();
  
  // FAST PATH: Check cache before any middleware processing
  const cacheKey = `${invokeRequest.capability_id}:${JSON.stringify(invokeRequest.inputs)}`;
  const cached = responseCache.get(cacheKey);
  if (cached && !req.headers['x-no-cache']) {
    return res.json({ ...cached, request_id: `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, _cached: true });
  }

  const apiKey = req.headers['x-api-key'] as string;
  const capabilityToken = req.headers['x-capability-token'] as string;
  const semanticKey = req.headers['x-semantic-key'] as string;
  
  // Get agent identity if API key or X-Agent-ID provided
  let agent = null;
  let agentId = 'anonymous';
  let trustLevel: 'anonymous' | 'verified' | 'trusted' | 'premium' = 'anonymous';
  
  const agentIdHeader = req.headers['x-agent-id'] as string;
  
  if (apiKey) {
    const { agentIdentityManager } = await import('./agent-identity');
    agent = agentIdentityManager.getAgentByApiKey(apiKey);
    if (agent) {
      agentId = agent.agent_id;
      trustLevel = agent.trust_level;
    }
  } else if (agentIdHeader) {
    // Support X-Agent-ID header for agent identification
    const { agentRegistry } = await import('./agent-registry');
    agent = agentRegistry.getAgent(agentIdHeader);
    if (agent) {
      agentId = agent.agent_id;
      trustLevel = 'verified'; // Agents identified by ID get verified level
    }
  }

  // Get capability to check execution mode
  const capability = registry.getCapability(invokeRequest.capability_id);
  const isConfidential = capability?.execution.mode === 'confidential';

  // ============================================
  // SECRET SAUCE: Capability Token Validation
  // ============================================
  if (capabilityToken) {
    const tokenValidation = capabilityTokenManager.validateToken(
      capabilityToken,
      invokeRequest.capability_id,
      isConfidential ? 'confidential' : 'public'
    );

    if (!tokenValidation.valid) {
      const err = apiError('FORBIDDEN', 'Capability token validation failed', { reason: tokenValidation.reason, hint: 'Issue a new token via POST /security/tokens/issue' });
      return res.status(err.status).json(err.body);
    }

    // Record token usage
    capabilityTokenManager.recordUsage(capabilityToken);
    
    // Add token context to response headers
    res.setHeader('X-Token-Remaining', tokenValidation.remaining_invocations?.toString() || '0');
    res.setHeader('X-Semantic-Access', tokenValidation.permissions?.semantic_access_level || 'basic');
  }

  // ============================================
  // SECRET SAUCE: Handshake Required for Confidential
  // ============================================
  if (isConfidential && agentId !== 'anonymous') {
    const hasAccess = agentHandshake.hasAccess(agentId, 'confidential');
    
    if (!hasAccess && !capabilityToken) {
      return res.status(403).json({
        success: false,
        error: 'Confidential capability requires completed handshake or valid token',
        hint: 'Complete handshake via POST /security/handshake/initiate or provide X-Capability-Token header'
      });
    }
  }

  // ============================================
  // SECRET SAUCE: Trust Network Activity Recording
  // ============================================
  if (agentId !== 'anonymous') {
    const node = trustNetwork.getNode(agentId);
    
    if (!node) {
      // Auto-register in trust network
      trustNetwork.registerAgent(agentId);
    }
  }

  // Check agent-aware rate limits
  const { agentRateLimiter } = await import('./agent-rate-limiter');
  const rateCheck = agentRateLimiter.checkAndRecord(agentId, trustLevel);
  
  if (!rateCheck.allowed) {
    return res.status(429).json({
      success: false,
      error: rateCheck.reason,
      rate_limit: {
        remaining: rateCheck.remaining,
        reset_at: new Date(rateCheck.reset_at).toISOString(),
        upgrade_hint: trustLevel === 'anonymous' 
          ? 'Register an agent to get higher rate limits'
          : 'Upgrade trust level for higher limits'
      }
    });
  }

  // Check capability prerequisites (only for identity-based agents)
  const { prerequisiteChecker } = await import('./capability-prerequisites');
  const prereqCheck = prerequisiteChecker.check(invokeRequest.capability_id, null);
  
  if (!prereqCheck.allowed) {
    return res.status(403).json({
      success: false,
      error: 'Prerequisites not met',
      missing: prereqCheck.missing,
      recommendations: prereqCheck.recommendations
    });
  }
  
  observability.info('server', 'Capability invocation', {
    capability_id: invokeRequest.capability_id,
    agent_id: agentId,
    trust_level: trustLevel,
    has_token: !!capabilityToken,
    is_confidential: isConfidential
  });

  try {
    const result = await router.invoke(invokeRequest);
    const executionTime = Date.now() - startTime;
    
    // Record analytics
    const { capabilityAnalytics } = await import('./capability-analytics');
    capabilityAnalytics.recordEvent({
      capability_id: invokeRequest.capability_id,
      agent_id: agentId !== 'anonymous' ? agentId : undefined,
      timestamp: Date.now(),
      success: result.success,
      latency_ms: executionTime,
      cost: result.metadata?.execution?.cost_actual || 0,
      inputs_hash: require('crypto').createHash('md5')
        .update(JSON.stringify(invokeRequest.inputs || {}))
        .digest('hex').slice(0, 8)
    });

    // Update agent reputation if registered
    if (agent && agentId !== 'anonymous') {
      const { agentIdentityManager } = await import('./agent-identity');
      const { agentRegistry } = await import('./agent-registry');
      agentIdentityManager.recordInvocation(agentId, invokeRequest.capability_id, result.success);
      agentRegistry.recordInvocation(agentId, result.success, executionTime);
    }

    // ============================================
    // SECRET SAUCE: Trust Network Activity Recording
    // ============================================
    if (agentId !== 'anonymous') {
      trustNetwork.recordActivity(
        agentId,
        'invocation',
        result.success,
        invokeRequest.capability_id
      );
    }

    // ============================================
    // ACTIVITY FEED: Record invocation event
    // ============================================
    const { activityFeed } = await import('./activity-feed');
    activityFeed.record('capability_invoked', agentId, {
      capability_id: invokeRequest.capability_id,
      success: result.success,
      execution_time_ms: executionTime,
      mode: isConfidential ? 'confidential' : 'public'
    });

    // Add rate limit headers
    res.setHeader('X-Agent-RateLimit-Remaining', rateCheck.remaining.toString());
    res.setHeader('X-Agent-Trust-Level', trustLevel);
    res.setHeader('X-Cost-Multiplier', rateCheck.cost_multiplier.toString());
    
    // ============================================
    // CAPABILITY RECEIPT: Verifiable Execution Memory
    // ============================================
    const { receiptManager } = await import('./capability-receipt');
    const receipt = receiptManager.generateReceipt(
      invokeRequest.capability_id,
      invokeRequest.inputs || {},
      result.outputs || {},
      {
        executor: result.metadata?.execution?.executor || 'public-executor',
        privacy_level: isConfidential ? 2 : 0,
        duration_ms: executionTime,
        success: result.success,
        proof: result.metadata?.execution?.proof_type ? {
          type: result.metadata.execution.proof_type,
          data: result.outputs?.proof || ''
        } : undefined,
        cost_actual: result.metadata?.execution?.cost_actual,
        cost_estimated: result.metadata?.execution?.cost_estimate,
        agent_id: agentId !== 'anonymous' ? agentId : undefined
      }
    );
    const serializedReceipt = receiptManager.serializeReceipt(receipt);
    
    // ============================================
    // SECRET SAUCE: Semantic Encryption for Premium
    // ============================================
    let encryptedSemantics = undefined;
    if (semanticKey && result.success) {
      const nonce = semanticEncryption.generateSemanticNonce();
      
      // Create encrypted semantic payload with execution hints
      encryptedSemantics = semanticEncryption.encryptSemantics(
        {
          action_type: isConfidential ? 'confidential_execution' : 'public_execution',
          parameters: {
            capability_id: invokeRequest.capability_id,
            execution_time_ms: executionTime,
            cost: result.metadata?.execution?.cost_actual || 0
          },
          execution_hints: [
            isConfidential ? 'mpc_computation' : 'direct_execution',
            result.metadata?.execution?.provider_used || 'default'
          ],
          routing_rules: {
            preferred_executor: result.metadata?.execution?.executor || 'public-executor',
            fallback_allowed: true,
            cache_ttl_seconds: isConfidential ? 0 : 60
          }
        },
        semanticKey
      );

      // Create obfuscated action for audit trail
      const obfuscatedAction = semanticEncryption.obfuscateAction(
        isConfidential ? 'encrypt' : 'transfer',
        invokeRequest.inputs || {},
        nonce
      );

      res.setHeader('X-Semantic-Nonce', nonce);
      res.setHeader('X-Obfuscated-Action', obfuscatedAction);
    }

    const statusCode = result.success ? 200 : 400;
    res.status(statusCode).json({
      ...result,
      agent_context: agentId !== 'anonymous' ? {
        agent_id: agentId,
        trust_level: trustLevel,
        rate_limit_remaining: rateCheck.remaining,
        cost_multiplier: rateCheck.cost_multiplier
      } : undefined,
      encrypted_semantics: encryptedSemantics,
      // Capability Receipt - verifiable execution memory
      receipt: {
        id: receipt.receipt_id,
        encoded: serializedReceipt,
        verification_hint: 'POST /receipts/verify to verify offline'
      }
    });
    
    // ============================================
    // USAGE METADATA: Emergent Reputation
    // ============================================
    const { usageMetadataEmitter } = await import('./usage-metadata');
    const usageMetadata = usageMetadataEmitter.createMetadata(
      invokeRequest.capability_id,
      {
        success: result.success,
        latency_ms: executionTime,
        executor: result.metadata?.execution?.executor,
        privacy_level: isConfidential ? 2 : 0,
        proof: result.metadata?.execution?.proof_type ? { type: result.metadata.execution.proof_type } : undefined,
        cost: result.metadata?.execution?.cost_actual
      },
      result.request_id,
      agentId !== 'anonymous' ? agentId : undefined
    );
    usageMetadataEmitter.emit('usage', usageMetadata);
    
    observability.info('server', 'Invocation completed', {
      request_id: result.request_id,
      success: result.success,
      agent_id: agentId,
      execution_time_ms: executionTime
    });
  } catch (error) {
    // Record failed analytics
    const { capabilityAnalytics } = await import('./capability-analytics');
    capabilityAnalytics.recordEvent({
      capability_id: invokeRequest.capability_id,
      agent_id: agentId !== 'anonymous' ? agentId : undefined,
      timestamp: Date.now(),
      success: false,
      latency_ms: Date.now() - startTime,
      cost: 0,
      inputs_hash: 'error'
    });

    // ============================================
    // SECRET SAUCE: Record violation for repeated failures
    // ============================================
    if (agentId !== 'anonymous') {
      trustNetwork.recordActivity(agentId, 'invocation', false, invokeRequest.capability_id);
      
      // Check for pattern of failures - record violation if too many
      const node = trustNetwork.getNode(agentId);
      if (node) {
        const recentFailures = node.activity_history
          .filter(a => !a.success && Date.now() - a.timestamp < 60 * 60 * 1000)
          .length;
        
        if (recentFailures >= 5) {
          trustNetwork.recordViolation(agentId, 'rate_abuse', 
            `${recentFailures} failed invocations in the last hour`);
        }
      }
    }

    observability.error('server', 'Invocation failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Simple health check that responds immediately (for Railway/load balancers)
app.get('/health', (req: Request, res: Response) => {
  // Fast response for healthchecks - don't wait for integration status
  res.status(200).json({
    status: 'healthy',
    timestamp: Date.now(),
    version: '1.0.0'
  });
});

// Detailed health check with integration status
app.get('/health/detailed', (req: Request, res: Response) => {
  const integrations = integrationManager.getHealthStatus();
  const allHealthy = integrations.every(i => i.status === 'healthy');
  
  res.json({
    status: allHealthy ? 'healthy' : 'degraded',
    timestamp: Date.now(),
    version: '1.0.0',
    integrations: integrations
  });
});

app.get('/integrations/status', (req: Request, res: Response) => {
  const status = integrationManager.getHealthStatus();
  res.json({
    success: true,
    timestamp: Date.now(),
    integrations: status
  });
});

app.get('/integrations/:service', (req: Request, res: Response) => {
  const { service } = req.params;
  const health = integrationManager.getServiceHealth(service);
  
  if (!health) {
    return res.status(404).json({
      success: false,
      error: `Service ${service} not found`
    });
  }
  
  res.json({
    success: true,
    health
  });
});

app.get('/wallet/status', async (req: Request, res: Response) => {
  try {
    const { solanaWallet } = await import('../chain/solana-wallet');
    const walletInfo = await solanaWallet.getWalletInfo();
    
    res.json({
      success: true,
      wallet: {
        address: walletInfo.publicKey,
        balance: walletInfo.balance,
        can_sign: solanaWallet.canSign(),
        network: 'solana-mainnet'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get wallet status'
    });
  }
});

// Router status endpoint with circuit breaker info
app.get('/router/status', (req: Request, res: Response) => {
  const { router } = require('./router');
  const status = router.getStatus();
  
  res.json({
    success: true,
    status: 'operational',
    router: {
      executors: status.executors,
      capabilities_registered: status.capabilities_registered,
      circuit_breakers: status.circuit_breakers
    },
    features: {
      retry_enabled: true,
      max_retries: 3,
      circuit_breaker_enabled: true,
      circuit_breaker_threshold: 5,
      health_monitoring: true
    }
  });
});

// Reset circuit breaker for a capability (admin)
app.post('/router/circuit-breaker/:capability_id/reset', (req: Request, res: Response) => {
  const { router } = require('./router');
  const { capability_id } = req.params;
  
  const reset = router.resetCircuitBreaker(capability_id);
  
  res.json({
    success: reset,
    capability_id,
    message: reset 
      ? `Circuit breaker reset for ${capability_id}` 
      : `No circuit breaker found for ${capability_id}`
  });
});

// Router stats - internal router statistics
app.get('/router/stats', (req: Request, res: Response) => {
  res.json({
    success: true,
    router: router.getStats(),
    timestamp: Date.now()
  });
});

// Activity feed stats
app.get('/activity/stats', (req: Request, res: Response) => {
  const { activityFeed } = require('./activity-feed');
  res.json({
    success: true,
    activity: activityFeed.getStats(),
    timestamp: Date.now()
  });
});

// Usage signal stats
app.get('/chain/usage-stats', (req: Request, res: Response) => {
  const { getUsageSignalStats } = require('../chain/usage-signal');
  res.json({
    success: true,
    usage: getUsageSignalStats(),
    timestamp: Date.now()
  });
});

// Comprehensive diagnostics endpoint
app.get('/diagnostics', async (req: Request, res: Response) => {
  try {
    const { metricsCollector } = require('./metrics');
    const { memoryManager } = require('./memory-manager');
    const { agentRegistry } = require('./agent-registry');
    const { activityFeed } = require('./activity-feed');
    const { getUsageSignalStats } = require('../chain/usage-signal');
    
    const systemMetrics = metricsCollector.getSystemMetrics();
    
    res.json({
      success: true,
      timestamp: Date.now(),
      uptime_seconds: Math.floor(process.uptime()),
      node_version: process.version,
      diagnostics: {
        router: router.getStats(),
        memory: memoryManager.getStats(),
        cache: responseCache.getStats(),
        rate_limiter: rateLimiter.getStats(),
        agents: agentRegistry.getStats(),
        activity: activityFeed.getStats(),
        usage_signals: getUsageSignalStats(),
        observability: observability.getStats(),
        capabilities: {
          total: registry.getAllCapabilities().length,
          by_mode: {
            public: registry.getAllCapabilities().filter((c: any) => c.execution.mode === 'public').length,
            confidential: registry.getAllCapabilities().filter((c: any) => c.execution.mode === 'confidential').length
          }
        },
        requests: {
          total: systemMetrics.total_requests,
          per_minute: systemMetrics.requests_per_minute
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Diagnostics failed'
    });
  }
});

// Real-time system dashboard - everything at a glance
app.get('/system/dashboard', async (req: Request, res: Response) => {
  try {
    const { metricsCollector } = require('./metrics');
    const { agentRegistry } = require('./agent-registry');
    const { sponsorStatusManager } = await import('./sponsor-status');
    const { getRequestMetrics } = require('./middleware/request-context');
    
    const systemMetrics = metricsCollector.getSystemMetrics();
    const agentStats = agentRegistry.getStats();
    const requestMetrics = getRequestMetrics();
    const sponsorReport = await sponsorStatusManager.getFullReport();
    
    // Calculate uptime
    const uptimeSeconds = Math.floor(systemMetrics.uptime_ms / 1000);
    const uptimeFormatted = uptimeSeconds > 3600 
      ? `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m`
      : uptimeSeconds > 60 
        ? `${Math.floor(uptimeSeconds / 60)}m ${uptimeSeconds % 60}s`
        : `${uptimeSeconds}s`;
    
    res.json({
      success: true,
      dashboard: {
        status: sponsorReport.overall_status === 'healthy' ? '🟢 All Systems Operational' : '🟡 Degraded',
        uptime: uptimeFormatted,
        version: '1.0.0'
      },
      capabilities: {
        total: registry.getAllCapabilities().length,
        public: registry.getAllCapabilities().filter((c: any) => c.execution.mode === 'public').length,
        confidential: registry.getAllCapabilities().filter((c: any) => c.execution.mode === 'confidential').length,
        privacy_ratio: Math.round((registry.getAllCapabilities().filter((c: any) => c.execution.mode === 'confidential').length / registry.getAllCapabilities().length) * 100) + '%'
      },
      sponsors: {
        status: sponsorReport.overall_status,
        arcium: sponsorReport.sponsors.find(s => s.sponsor === 'Arcium')?.status || 'unknown',
        noir: sponsorReport.sponsors.find(s => s.sponsor === 'Aztec/Noir')?.status || 'unknown',
        helius: sponsorReport.sponsors.find(s => s.sponsor === 'Helius')?.status || 'unknown',
        inco: sponsorReport.sponsors.find(s => s.sponsor === 'Inco')?.status || 'unknown'
      },
      agents: {
        registered: agentStats.total || 0,
        active_24h: agentStats.active_24h || 0
      },
      traffic: {
        total_requests: requestMetrics.total || 0,
        success_rate: requestMetrics.total > 0 
          ? Math.round((requestMetrics.success / requestMetrics.total) * 100) + '%'
          : '100%',
        avg_latency_ms: Math.round(requestMetrics.avgLatencyMs || 0)
      },
      timestamp: Date.now()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Dashboard failed'
    });
  }
});

// System overview - comprehensive status of all components
app.get('/system/overview', async (req: Request, res: Response) => {
  try {
    const { metricsCollector } = require('./metrics');
    const { memoryManager } = require('./memory-manager');
    const { agentRegistry } = require('./agent-registry');
    
    const systemMetrics = metricsCollector.getSystemMetrics();
    const memoryStats = memoryManager.getStats();
    const agentStats = agentRegistry.getStats();
    
    res.json({
      success: true,
      timestamp: Date.now(),
      uptime_seconds: Math.floor(systemMetrics.uptime_ms / 1000),
      capabilities: {
        total: registry.getAllCapabilities().length,
        public: registry.getAllCapabilities().filter((c: any) => c.execution.mode === 'public').length,
        confidential: registry.getAllCapabilities().filter((c: any) => c.execution.mode === 'confidential').length
      },
      agents: agentStats,
      memory: memoryStats,
      requests: {
        total: systemMetrics.total_requests,
        per_minute: systemMetrics.requests_per_minute
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get system overview'
    });
  }
});

app.get('/metrics', (req: Request, res: Response) => {
  const { metricsCollector } = require('./metrics');
  const { getRequestMetrics } = require('./middleware/request-context');
  const systemMetrics = metricsCollector.getSystemMetrics();
  const capabilityMetrics = metricsCollector.getAllMetrics();
  const requestMetrics = getRequestMetrics();
  
  res.json({
    success: true,
    system: {
      uptime_seconds: Math.floor(systemMetrics.uptime_ms / 1000),
      total_requests: systemMetrics.total_requests,
      requests_per_minute: systemMetrics.requests_per_minute
    },
    http: {
      total_requests: requestMetrics.total,
      success_count: requestMetrics.success,
      client_error_count: requestMetrics.clientError,
      server_error_count: requestMetrics.serverError,
      avg_latency_ms: requestMetrics.avgLatencyMs,
      success_rate: requestMetrics.total > 0 
        ? ((requestMetrics.success / requestMetrics.total) * 100).toFixed(2) + '%'
        : '0%'
    },
    capabilities: capabilityMetrics.map((m: any) => ({
      id: m.capability_id,
      invocations: m.total_invocations,
      success_rate: ((m.successful_invocations / m.total_invocations) * 100).toFixed(2) + '%',
      avg_latency_ms: Math.round(m.avg_latency_ms),
      min_latency_ms: m.min_latency_ms === Infinity ? 0 : m.min_latency_ms,
      max_latency_ms: m.max_latency_ms,
      total_cost_sol: m.total_cost
    }))
  });
});

app.get('/metrics/:capability_id', (req: Request, res: Response) => {
  const { metricsCollector } = require('./metrics');
  const { capability_id } = req.params;
  const metrics = metricsCollector.getCapabilityMetrics(capability_id);
  
  if (!metrics) {
    return res.status(404).json({
      success: false,
      error: 'No metrics found for this capability'
    });
  }
  
  res.json({
    success: true,
    metrics: {
      capability_id: metrics.capability_id,
      total_invocations: metrics.total_invocations,
      successful: metrics.successful_invocations,
      failed: metrics.failed_invocations,
      success_rate: ((metrics.successful_invocations / metrics.total_invocations) * 100).toFixed(2) + '%',
      latency: {
        avg_ms: Math.round(metrics.avg_latency_ms),
        min_ms: metrics.min_latency_ms === Infinity ? 0 : metrics.min_latency_ms,
        max_ms: metrics.max_latency_ms
      },
      total_cost_sol: metrics.total_cost,
      last_invocation: new Date(metrics.last_invocation).toISOString()
    }
  });
});

// Capability Composition endpoint
app.post('/compose', async (req: Request, res: Response) => {
  try {
    const { executeComposition, validateComposition } = await import('./composition');
    const { compositionTemplateEngine } = await import('./composition-templates');
    let composition = req.body;
    
    // If template_id is provided, convert template to steps
    if (composition.template_id) {
      const template = compositionTemplateEngine.getTemplate(composition.template_id);
      if (!template) {
        return res.status(404).json({
          success: false,
          error: `Template ${composition.template_id} not found`
        });
      }
      
      // Convert template capabilities to composition steps
      const steps = template.capabilities.map((cap: any) => {
        // Replace {{variable}} placeholders with actual input values
        const resolvedInputs: Record<string, any> = {};
        for (const [key, value] of Object.entries(cap.input_mapping)) {
          if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
            const varName = value.slice(2, -2);
            resolvedInputs[key] = composition.inputs?.[varName] ?? value;
          } else {
            resolvedInputs[key] = value;
          }
        }
        return {
          capability_id: cap.capability_id,
          inputs: resolvedInputs
        };
      });
      
      composition = { steps, stop_on_error: true };
    }
    
    // Validate composition
    const validation = validateComposition(composition);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        errors: validation.errors
      });
    }
    
    // Execute composition
    const result = await executeComposition(composition);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Composition failed'
    });
  }
});

// Proof Verification endpoint
app.post('/verify-proof', async (req: Request, res: Response) => {
  try {
    const { proofVerifier } = await import('./proof-verification');
    const result = await proofVerifier.verify(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      valid: false,
      error: error instanceof Error ? error.message : 'Verification failed'
    });
  }
});

// Semantic Discovery endpoint - "Google for capabilities"
app.post('/discover', async (req: Request, res: Response) => {
  try {
    const { query } = req.body;
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ success: false, error: 'query is required and must be a string' });
    }
    
    const { semanticDiscovery } = await import('./semantic-discovery');
    const results = await semanticDiscovery.discover(req.body);
    res.json({
      success: true,
      query,
      results: results.map(r => ({
        capability_id: r.capability.id,
        name: r.capability.name,
        description: r.capability.description,
        relevance_score: r.relevance_score,
        match_reasons: r.match_reasons,
        mode: r.capability.execution.mode,
        cost_hint: r.capability.economics.cost_hint
      }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Discovery failed'
    });
  }
});

// Agent Registration endpoint - supports both identity and registry
app.post('/agents/register', async (req: Request, res: Response) => {
  try {
    const { agent_id, name, description, capabilities_provided, capabilities_required, endpoint, metadata, public_key } = req.body;
    
    // If public_key provided, use identity manager (legacy)
    if (public_key) {
      const { agentIdentityManager } = await import('./agent-identity');
      const result = await agentIdentityManager.register({ public_key, metadata });
      return res.json({
        success: true,
        ...result,
        message: 'Agent registered successfully. Store your API key securely.'
      });
    }
    
    // Otherwise use new agent registry
    if (!agent_id || !name) {
      return res.status(400).json({ success: false, error: 'agent_id and name required' });
    }
    
    const { agentRegistry } = await import('./agent-registry');
    const agent = agentRegistry.registerAgent(
      agent_id,
      name,
      description || '',
      capabilities_provided || [],
      capabilities_required || [],
      endpoint,
      metadata || {}
    );

    // Record registration in activity feed
    const { activityFeed } = await import('./activity-feed');
    activityFeed.record('agent_registered', agent_id, {
      name,
      capabilities_count: (capabilities_provided || []).length
    });

    res.json({
      success: true,
      agent: {
        agent_id: agent.agent_id,
        name: agent.name,
        trust_score: agent.trust_score,
        capabilities_provided: agent.capabilities_provided,
        registered_at: new Date(agent.registered_at).toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Registration failed'
    });
  }
});

// Discover agents by capability (must be before :agent_id route)
app.get('/agents/discover', async (req: Request, res: Response) => {
  try {
    const { agentRegistry } = await import('./agent-registry');
    const { capability, min_trust_score, min_success_rate, limit } = req.query;

    const agents = agentRegistry.discoverAgents({
      capability: capability as string,
      min_trust_score: min_trust_score ? parseInt(min_trust_score as string) : undefined,
      min_success_rate: min_success_rate ? parseFloat(min_success_rate as string) : undefined,
      limit: limit ? parseInt(limit as string) : 10
    });

    res.json({
      success: true,
      count: agents.length,
      agents: agents.map(a => ({
        agent_id: a.agent_id,
        name: a.name,
        description: a.description,
        capabilities_provided: a.capabilities_provided,
        trust_score: a.trust_score,
        reputation: {
          success_rate: a.reputation.total_invocations > 0 
            ? (a.reputation.successful_invocations / a.reputation.total_invocations * 100).toFixed(1) + '%'
            : 'N/A',
          avg_response_time_ms: Math.round(a.reputation.average_response_time_ms)
        },
        status: a.status
      }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Discovery failed'
    });
  }
});

// Agent registry stats (must be before :agent_id route)
app.get('/agents/stats/overview', async (req: Request, res: Response) => {
  try {
    const { agentRegistry } = await import('./agent-registry');
    const { agentCoordinator } = await import('./agent-coordination');
    
    const registryStats = agentRegistry.getStats();
    const coordStats = agentCoordinator.getStats();

    res.json({
      success: true,
      registry: registryStats,
      coordination: coordStats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Stats failed'
    });
  }
});

// Agent Profile endpoint
app.get('/agents/:agent_id', async (req: Request, res: Response) => {
  try {
    const { agentIdentityManager } = await import('./agent-identity');
    const { agentRegistry } = await import('./agent-registry');
    
    // Try identity manager first
    const identityAgent = agentIdentityManager.getAgent(req.params.agent_id);
    if (identityAgent) {
      return res.json({
        success: true,
        agent: {
          agent_id: identityAgent.agent_id,
          trust_level: identityAgent.trust_level,
          reputation: identityAgent.reputation,
          credentials: identityAgent.credentials.length,
          created_at: identityAgent.created_at
        }
      });
    }
    
    // Try agent registry
    const registeredAgent = agentRegistry.getAgent(req.params.agent_id);
    if (!registeredAgent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }
    
    const delegations = agentRegistry.getAgentDelegations(req.params.agent_id);
    res.json({
      success: true,
      agent: {
        agent_id: registeredAgent.agent_id,
        name: registeredAgent.name,
        trust_score: registeredAgent.trust_score,
        capabilities_provided: registeredAgent.capabilities_provided,
        reputation: registeredAgent.reputation,
        delegations: { granted: delegations.granted.length, received: delegations.received.length },
        registered_at: new Date(registeredAgent.registered_at).toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get agent'
    });
  }
});

// Leaderboard endpoint
app.get('/leaderboard/:category?', async (req: Request, res: Response) => {
  try {
    const { agentSocialManager } = await import('./agent-social');
    const category = (req.params.category || 'reputation') as 'reputation' | 'invocations' | 'badges' | 'capabilities';
    const parsedLimit = parseInt(req.query.limit as string);
    const limit = isNaN(parsedLimit) || parsedLimit < 1 ? 10 : Math.min(parsedLimit, 100);
    
    const leaderboard = agentSocialManager.getLeaderboard(category, limit);
    res.json({
      success: true,
      category,
      leaderboard
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Leaderboard failed'
    });
  }
});

// Community stats
app.get('/community/stats', async (req: Request, res: Response) => {
  try {
    const { agentSocialManager } = await import('./agent-social');
    const stats = agentSocialManager.getCommunityStats();
    res.json({ success: true, ...stats });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Stats failed'
    });
  }
});

// Agent public profile
app.get('/agents/:agent_id/profile', async (req: Request, res: Response) => {
  try {
    const { agentSocialManager } = await import('./agent-social');
    const profile = agentSocialManager.getPublicProfile(req.params.agent_id);
    
    if (!profile) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }
    
    res.json({ success: true, profile });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Profile failed'
    });
  }
});

// Delegate capability to another agent
app.post('/agents/:agent_id/delegate', async (req: Request, res: Response) => {
  try {
    const { agentSocialManager } = await import('./agent-social');
    const { to_agent, capability_id, permissions, expires_in_hours, max_uses } = req.body;
    
    const delegation = agentSocialManager.delegateCapability(
      req.params.agent_id,
      to_agent,
      capability_id,
      { permissions, expires_in_hours, max_uses }
    );
    
    res.json({
      success: true,
      message: 'Capability delegated successfully',
      delegation
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Delegation failed'
    });
  }
});

// Get agent's delegations
app.get('/agents/:agent_id/delegations', async (req: Request, res: Response) => {
  try {
    const { agentSocialManager } = await import('./agent-social');
    const delegations = agentSocialManager.getDelegations(req.params.agent_id);
    res.json({ success: true, ...delegations });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Delegations failed'
    });
  }
});

// Get agent's messages
app.get('/agents/:agent_id/messages', async (req: Request, res: Response) => {
  try {
    const { agentSocialManager } = await import('./agent-social');
    const unread_only = req.query.unread === 'true';
    const messages = agentSocialManager.getMessages(req.params.agent_id, unread_only);
    res.json({
      success: true,
      count: messages.length,
      messages
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Messages failed'
    });
  }
});

// Send message to another agent
app.post('/agents/:agent_id/messages', async (req: Request, res: Response) => {
  try {
    const { agentSocialManager } = await import('./agent-social');
    const { to_agent, subject, content, type } = req.body;
    
    const message = agentSocialManager.sendMessage(
      req.params.agent_id,
      to_agent,
      { subject, content, type }
    );
    
    res.json({ success: true, message });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Send failed'
    });
  }
});

// Recommendations endpoint - personalized for agent
app.get('/recommendations/:agent_id', async (req: Request, res: Response) => {
  try {
    const { recommendationEngine } = await import('./recommendation-engine');
    const { agentIdentityManager } = await import('./agent-identity');
    
    const agent = agentIdentityManager.getAgent(req.params.agent_id);
    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    const profile = {
      agent_id: agent.agent_id,
      capabilities_used: agent.reputation.capabilities_used,
      total_invocations: agent.reputation.total_invocations,
      favorite_mode: 'mixed' as const,
      avg_cost_per_invocation: 0.01,
      trust_level: agent.trust_level,
      badges: agent.reputation.badges
    };

    const recommendations = recommendationEngine.getRecommendations(profile);
    const archetype = recommendationEngine.detectArchetype(profile);
    const agentsLikeYou = recommendationEngine.getAgentsLikeYou(profile);

    res.json({
      success: true,
      agent_id: req.params.agent_id,
      archetype,
      recommendations,
      agents_like_you: agentsLikeYou
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Recommendations failed'
    });
  }
});

// Workflow suggestions based on goal
app.post('/suggest-workflow', async (req: Request, res: Response) => {
  try {
    const { recommendationEngine } = await import('./recommendation-engine');
    const { goal } = req.body;
    
    if (!goal) {
      return res.status(400).json({ success: false, error: 'Provide a goal description' });
    }

    const suggestions = recommendationEngine.suggestWorkflows(goal);
    res.json({
      success: true,
      goal,
      suggestions
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Suggestion failed'
    });
  }
});

// Capability health endpoint
app.get('/health/capabilities', async (req: Request, res: Response) => {
  try {
    const { capabilityHealthMonitor } = await import('./capability-health');
    const systemHealth = capabilityHealthMonitor.getSystemHealth();
    const allHealth = capabilityHealthMonitor.getAllHealth();
    
    res.json({
      success: true,
      system: systemHealth,
      capabilities: allHealth
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Health check failed'
    });
  }
});

// Individual capability health
app.get('/health/capabilities/:capability_id', async (req: Request, res: Response) => {
  try {
    const { capabilityHealthMonitor } = await import('./capability-health');
    const health = capabilityHealthMonitor.getHealth(req.params.capability_id);
    const safetyCheck = capabilityHealthMonitor.isSafeToUse(req.params.capability_id);
    
    res.json({
      success: true,
      health,
      safety: safetyCheck
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Health check failed'
    });
  }
});

// Cost Estimation endpoint
app.post('/estimate', async (req: Request, res: Response) => {
  try {
    const { costEstimator } = await import('./cost-estimator');
    const { capability_id, capability_ids, trust_level = 'anonymous' } = req.body;

    if (capability_ids && Array.isArray(capability_ids)) {
      // Composition estimate
      const estimate = costEstimator.estimateComposition(capability_ids, trust_level);
      res.json({ success: true, type: 'composition', estimate });
    } else if (capability_id) {
      // Single capability estimate
      const estimate = costEstimator.estimate(capability_id, trust_level);
      res.json({ success: true, type: 'single', estimate });
    } else {
      res.status(400).json({
        success: false,
        error: 'Provide capability_id or capability_ids array'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Estimation failed'
    });
  }
});

// Cost comparison across trust levels
app.get('/estimate/:capability_id/compare', async (req: Request, res: Response) => {
  try {
    const { costEstimator } = await import('./cost-estimator');
    const comparison = costEstimator.compareTrustLevels(req.params.capability_id);
    res.json({
      success: true,
      capability_id: req.params.capability_id,
      comparison,
      recommendation: 'Upgrade to verified for 33% cost reduction'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Comparison failed'
    });
  }
});

// Composition Templates endpoint
app.get('/templates', async (req: Request, res: Response) => {
  try {
    const { compositionTemplateEngine } = await import('./composition-templates');
    const templates = compositionTemplateEngine.getTemplates();
    res.json({
      success: true,
      count: templates.length,
      templates: templates.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        use_case: t.use_case,
        capabilities: t.capabilities.map(c => c.capability_id),
        required_inputs: t.required_inputs,
        estimated_cost: t.estimated_cost,
        tags: t.tags
      }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get templates'
    });
  }
});

// Get specific template
app.get('/templates/:template_id', async (req: Request, res: Response) => {
  try {
    const { compositionTemplateEngine } = await import('./composition-templates');
    const template = compositionTemplateEngine.getTemplate(req.params.template_id);
    if (!template) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }
    res.json({ success: true, template });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get template'
    });
  }
});

// ============================================
// AGENT REGISTRY & COORDINATION ENDPOINTS
// ============================================

// Discover agents by capability
app.get('/agents/discover', async (req: Request, res: Response) => {
  try {
    const { agentRegistry } = await import('./agent-registry');
    const { capability, min_trust_score, min_success_rate, limit } = req.query;

    const agents = agentRegistry.discoverAgents({
      capability: capability as string,
      min_trust_score: min_trust_score ? parseInt(min_trust_score as string) : undefined,
      min_success_rate: min_success_rate ? parseFloat(min_success_rate as string) : undefined,
      limit: limit ? parseInt(limit as string) : 10
    });

    res.json({
      success: true,
      count: agents.length,
      agents: agents.map(a => ({
        agent_id: a.agent_id,
        name: a.name,
        description: a.description,
        capabilities_provided: a.capabilities_provided,
        trust_score: a.trust_score,
        reputation: {
          success_rate: a.reputation.total_invocations > 0 
            ? (a.reputation.successful_invocations / a.reputation.total_invocations * 100).toFixed(1) + '%'
            : 'N/A',
          avg_response_time_ms: Math.round(a.reputation.average_response_time_ms)
        },
        status: a.status
      }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Discovery failed'
    });
  }
});

// Get agent details
app.get('/agents/:agent_id', async (req: Request, res: Response) => {
  try {
    const { agentRegistry } = await import('./agent-registry');
    const agent = agentRegistry.getAgent(req.params.agent_id);

    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    const delegations = agentRegistry.getAgentDelegations(req.params.agent_id);

    res.json({
      success: true,
      agent: {
        ...agent,
        registered_at: new Date(agent.registered_at).toISOString(),
        last_active: new Date(agent.last_active).toISOString()
      },
      delegations: {
        granted: delegations.granted.length,
        received: delegations.received.length
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get agent'
    });
  }
});

// Create capability delegation
app.post('/agents/delegate', async (req: Request, res: Response) => {
  try {
    const { agentRegistry } = await import('./agent-registry');
    const { from_agent, to_agent, capability_id, constraints, expires_in_hours } = req.body;

    if (!from_agent || !to_agent || !capability_id) {
      return res.status(400).json({ 
        success: false, 
        error: 'from_agent, to_agent, and capability_id required' 
      });
    }

    const delegation = agentRegistry.createDelegation(
      from_agent,
      to_agent,
      capability_id,
      constraints || {},
      expires_in_hours || 24
    );

    if (!delegation) {
      return res.status(400).json({ 
        success: false, 
        error: 'Delegation failed - check agent IDs and capability ownership' 
      });
    }

    res.json({
      success: true,
      delegation: {
        delegation_id: delegation.delegation_id,
        from_agent: delegation.from_agent,
        to_agent: delegation.to_agent,
        capability_id: delegation.capability_id,
        expires_at: new Date(delegation.expires_at).toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Delegation failed'
    });
  }
});

// Workflow templates
app.get('/workflows/templates', async (req: Request, res: Response) => {
  try {
    const { agentWorkflowEngine } = await import('./agent-workflows');
    const { category } = req.query;
    const templates = agentWorkflowEngine.getTemplates(category as string);
    
    res.json({
      success: true,
      count: templates.length,
      templates: templates.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        category: t.category,
        steps: t.steps.length,
        required_capabilities: t.required_capabilities,
        estimated_time_ms: t.estimated_time_ms,
        privacy_level: t.privacy_level,
        min_agents: t.min_agents
      }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get templates'
    });
  }
});

// Get specific workflow template
app.get('/workflows/templates/:template_id', async (req: Request, res: Response) => {
  try {
    const { agentWorkflowEngine } = await import('./agent-workflows');
    const template = agentWorkflowEngine.getTemplate(req.params.template_id);
    
    if (!template) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }
    
    res.json({ success: true, template });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get template'
    });
  }
});

// Execute a workflow
app.post('/workflows/execute', async (req: Request, res: Response) => {
  try {
    const { agentWorkflowEngine } = await import('./agent-workflows');
    const { template_id, initiator_agent, agent_assignments, inputs } = req.body;
    
    if (!template_id || !initiator_agent) {
      return res.status(400).json({ 
        success: false, 
        error: 'template_id and initiator_agent required' 
      });
    }
    
    const execution = await agentWorkflowEngine.startWorkflow(
      template_id,
      initiator_agent,
      agent_assignments || {},
      inputs || {}
    );
    
    res.json({
      success: execution.status === 'completed',
      execution: {
        execution_id: execution.execution_id,
        template_id: execution.template_id,
        status: execution.status,
        current_step: execution.current_step,
        results: execution.results,
        duration_ms: execution.completed_at ? execution.completed_at - execution.started_at : null,
        error: execution.error
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Workflow execution failed'
    });
  }
});

// Get workflow execution status
app.get('/workflows/executions/:execution_id', async (req: Request, res: Response) => {
  try {
    const { agentWorkflowEngine } = await import('./agent-workflows');
    const execution = agentWorkflowEngine.getExecution(req.params.execution_id);
    
    if (!execution) {
      return res.status(404).json({ success: false, error: 'Execution not found' });
    }
    
    res.json({ success: true, execution });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get execution'
    });
  }
});

// Workflow stats
app.get('/workflows/stats', async (req: Request, res: Response) => {
  try {
    const { agentWorkflowEngine } = await import('./agent-workflows');
    const stats = agentWorkflowEngine.getStats();
    res.json({ success: true, ...stats });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get stats'
    });
  }
});

// ============================================
// CAPABILITY MARKETPLACE ENDPOINTS
// ============================================

// Create a marketplace listing
app.post('/marketplace/listings', async (req: Request, res: Response) => {
  try {
    const { capabilityMarketplace } = await import('./capability-marketplace');
    const { provider_agent, capability_id, name, description, pricing, terms } = req.body;

    if (!provider_agent || !capability_id || !name) {
      return res.status(400).json({ 
        success: false, 
        error: 'provider_agent, capability_id, and name required' 
      });
    }

    const listing = capabilityMarketplace.createListing(
      provider_agent,
      capability_id,
      name,
      description || '',
      pricing || { type: 'free', currency: 'SOL' },
      terms || {}
    );

    res.json({ success: true, listing });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create listing'
    });
  }
});

// Browse marketplace
app.get('/marketplace/listings', async (req: Request, res: Response) => {
  try {
    const { capabilityMarketplace } = await import('./capability-marketplace');
    const { capability_id, provider_agent, pricing_type, max_price, min_rating } = req.query;

    const listings = capabilityMarketplace.browseListings({
      capability_id: capability_id as string,
      provider_agent: provider_agent as string,
      pricing_type: pricing_type as string,
      max_price_sol: max_price ? parseFloat(max_price as string) : undefined,
      min_rating: min_rating ? parseFloat(min_rating as string) : undefined,
      status: 'active'
    });

    res.json({
      success: true,
      count: listings.length,
      listings: listings.map(l => ({
        listing_id: l.listing_id,
        provider_agent: l.provider_agent,
        capability_id: l.capability_id,
        name: l.name,
        description: l.description,
        pricing: l.pricing,
        stats: l.stats,
        status: l.status
      }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to browse listings'
    });
  }
});

// Purchase capability access
app.post('/marketplace/purchase', async (req: Request, res: Response) => {
  try {
    const { capabilityMarketplace } = await import('./capability-marketplace');
    const { buyer_agent, listing_id, tier } = req.body;

    if (!buyer_agent || !listing_id) {
      return res.status(400).json({ 
        success: false, 
        error: 'buyer_agent and listing_id required' 
      });
    }

    const purchase = capabilityMarketplace.purchaseCapability(buyer_agent, listing_id, tier);

    if (!purchase) {
      return res.status(400).json({ 
        success: false, 
        error: 'Purchase failed - listing may be inactive or self-purchase attempted' 
      });
    }

    res.json({ success: true, purchase });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Purchase failed'
    });
  }
});

// Check access to capability
app.get('/marketplace/access/:agent_id/:capability_id', async (req: Request, res: Response) => {
  try {
    const { capabilityMarketplace } = await import('./capability-marketplace');
    const purchase = capabilityMarketplace.hasAccess(
      req.params.agent_id,
      req.params.capability_id
    );

    res.json({
      success: true,
      has_access: !!purchase,
      purchase: purchase || undefined
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Access check failed'
    });
  }
});

// Add review
app.post('/marketplace/listings/:listing_id/review', async (req: Request, res: Response) => {
  try {
    const { capabilityMarketplace } = await import('./capability-marketplace');
    const { reviewer_agent, rating, comment } = req.body;

    if (!reviewer_agent || rating === undefined) {
      return res.status(400).json({ 
        success: false, 
        error: 'reviewer_agent and rating required' 
      });
    }

    const review = capabilityMarketplace.addReview(
      req.params.listing_id,
      reviewer_agent,
      rating,
      comment
    );

    if (!review) {
      return res.status(400).json({ 
        success: false, 
        error: 'Review failed - must purchase before reviewing' 
      });
    }

    res.json({ success: true, review });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Review failed'
    });
  }
});

// Get agent's purchases
app.get('/marketplace/purchases/:agent_id', async (req: Request, res: Response) => {
  try {
    const { capabilityMarketplace } = await import('./capability-marketplace');
    const purchases = capabilityMarketplace.getAgentPurchases(req.params.agent_id);
    res.json({ success: true, count: purchases.length, purchases });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get purchases'
    });
  }
});

// Get agent's earnings (as provider)
app.get('/marketplace/earnings/:agent_id', async (req: Request, res: Response) => {
  try {
    const { capabilityMarketplace } = await import('./capability-marketplace');
    const earnings = capabilityMarketplace.getAgentEarnings(req.params.agent_id);
    res.json({ success: true, ...earnings });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get earnings'
    });
  }
});

// Marketplace stats
app.get('/marketplace/stats', async (req: Request, res: Response) => {
  try {
    const { capabilityMarketplace } = await import('./capability-marketplace');
    const stats = capabilityMarketplace.getStats();
    res.json({ success: true, ...stats });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get stats'
    });
  }
});

// ============================================
// AGENT-AWARE SEMANTIC DISCOVERY
// ============================================

// Discover capabilities with agent context
app.post('/discover/agent', async (req: Request, res: Response) => {
  try {
    const { semanticDiscovery } = await import('./semantic-discovery');
    const { query, agent_id, capabilities_used, trust_level, specialization } = req.body;

    if (!query) {
      return res.status(400).json({ success: false, error: 'query required' });
    }

    const results = await semanticDiscovery.discoverForAgent(query, {
      agent_id: agent_id || 'anonymous',
      capabilities_used: capabilities_used || [],
      trust_level: trust_level || 'anonymous',
      specialization
    });

    res.json({
      success: true,
      query,
      agent_context: { agent_id, trust_level, specialization },
      count: results.length,
      results: results.map(r => ({
        capability_id: r.capability.id,
        name: r.capability.name,
        description: r.capability.description,
        relevance_score: r.relevance_score,
        match_reasons: r.match_reasons,
        mode: r.capability.execution.mode
      }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Discovery failed'
    });
  }
});

// Get personalized recommendations for an agent
app.get('/discover/recommendations/:agent_id', async (req: Request, res: Response) => {
  try {
    const { semanticDiscovery } = await import('./semantic-discovery');
    const { agentRegistry } = await import('./agent-registry');
    
    const agent = agentRegistry.getAgent(req.params.agent_id);
    const capabilities_used = agent?.capabilities_provided || [];
    const trust_level = 'anonymous'; // Would come from identity manager in production

    const recommendations = await semanticDiscovery.getAgentRecommendations({
      agent_id: req.params.agent_id,
      capabilities_used,
      trust_level
    });

    res.json({
      success: true,
      agent_id: req.params.agent_id,
      recommendations: {
        next_capabilities: recommendations.next_capabilities.map(r => ({
          capability_id: r.capability.id,
          name: r.capability.name,
          reason: r.match_reasons[0]
        })),
        upgrade_path: recommendations.upgrade_path,
        similar_agents_use: recommendations.similar_agents_use
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Recommendations failed'
    });
  }
});

// ============================================
// SIMPLIFIED AGENT API (Agent-Friendly)
// ============================================

// Rate limit middleware for API endpoints
const apiRateLimitMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const { agentRateLimiter } = require('./agent-rate-limiter');
  const agentId = req.body?.agent_id || req.params?.agent_id || 'anonymous';
  const trustLevel = 'anonymous'; // Would get from identity in production
  
  const check = agentRateLimiter.checkAndRecord(agentId, trustLevel);
  
  if (!check.allowed) {
    return res.status(429).json({
      success: false,
      error: 'Rate limit exceeded',
      reason: check.reason,
      retry_after_ms: check.reset_at - Date.now()
    });
  }
  
  res.setHeader('X-RateLimit-Remaining', check.remaining.toString());
  res.setHeader('X-RateLimit-Reset', check.reset_at.toString());
  next();
};

// Quick start - register and get session in one call
app.post('/api/quickstart', 
  require('./middleware/validation').unifiedRegisterValidation,
  apiRateLimitMiddleware,
  async (req: Request, res: Response) => {
  try {
    const { agentAPI } = await import('./agent-api');
    const result = await agentAPI.quickStart(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Quick start failed'
    });
  }
});

// Quick invoke - find best agent and invoke in one call
app.post('/api/invoke',
  require('./middleware/validation').quickInvokeValidation,
  apiRateLimitMiddleware,
  async (req: Request, res: Response) => {
  try {
    const { agentAPI } = await import('./agent-api');
    const { agent_id, capability, inputs, prefer_agent, min_trust, retry_count } = req.body;

    const result = await agentAPI.quickInvoke(agent_id, {
      capability,
      inputs,
      prefer_agent,
      min_trust,
      retry_count
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Quick invoke failed'
    });
  }
});

// Batch operations - multiple operations in parallel
app.post('/api/batch',
  require('./middleware/validation').batchValidation,
  apiRateLimitMiddleware,
  async (req: Request, res: Response) => {
  try {
    const { agentAPI } = await import('./agent-api');
    const { agent_id, operations } = req.body;

    const result = await agentAPI.batch(agent_id, operations);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Batch failed'
    });
  }
});

// Smart discover - natural language search
app.post('/api/discover',
  require('./middleware/validation').discoverValidation,
  apiRateLimitMiddleware,
  async (req: Request, res: Response) => {
  try {
    const { agentAPI } = await import('./agent-api');
    const { agent_id, query } = req.body;

    const result = await agentAPI.smartDiscover(agent_id || 'anonymous', query);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Smart discover failed'
    });
  }
});

// Agent dashboard - all info in one call
app.get('/api/dashboard/:agent_id',
  require('./middleware/validation').agentIdParamValidation,
  async (req: Request, res: Response) => {
  try {
    const { agentAPI } = await import('./agent-api');
    const result = await agentAPI.getDashboard(req.params.agent_id);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Dashboard failed'
    });
  }
});

// ============================================
// SMART FEATURES - AI-Powered Enhancements
// ============================================

// Smart invoke with recommendations and prefetching
app.post('/smart/invoke', async (req: Request, res: Response) => {
  try {
    const { capability_id, inputs, preferences, options } = req.body;
    
    if (!capability_id) {
      return res.status(400).json({ success: false, error: 'capability_id required' });
    }

    const result = await router.smartInvoke(
      { capability_id, inputs: inputs || {}, preferences },
      {
        prefetch: options?.prefetch ?? true,
        include_recommendations: options?.include_recommendations ?? true
      }
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Smart invoke failed'
    });
  }
});

// Batch invoke - parallel execution of multiple capabilities
app.post('/smart/batch', async (req: Request, res: Response) => {
  try {
    const { requests } = req.body;
    
    if (!requests || !Array.isArray(requests) || requests.length === 0) {
      return res.status(400).json({ success: false, error: 'requests array required' });
    }

    if (requests.length > 10) {
      return res.status(400).json({ success: false, error: 'Maximum 10 requests per batch' });
    }

    const result = await router.batchInvoke(requests);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Batch invoke failed'
    });
  }
});

// Get recommendations for a capability
app.get('/smart/recommendations/:capability_id', async (req: Request, res: Response) => {
  try {
    const recommendations = router.getRecommendations(req.params.capability_id);
    res.json({ success: true, ...recommendations });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Recommendations failed'
    });
  }
});

// Workflow templates - pre-built compositions for common tasks
app.get('/smart/workflows', async (req: Request, res: Response) => {
  try {
    const workflows = [
      {
        id: 'portfolio-check',
        name: 'Portfolio Check',
        description: 'Get wallet balance and current prices for all tokens',
        steps: ['cap.wallet.snapshot.v1', 'cap.price.lookup.v1'],
        estimated_time_ms: 500
      },
      {
        id: 'smart-swap',
        name: 'Smart Swap',
        description: 'Check price, verify balance, then execute swap',
        steps: ['cap.price.lookup.v1', 'cap.wallet.snapshot.v1', 'cap.swap.execute.v1'],
        estimated_time_ms: 1500
      },
      {
        id: 'confidential-transfer',
        name: 'Confidential Transfer',
        description: 'Wrap tokens and transfer privately',
        steps: ['cap.cspl.wrap.v1', 'cap.cspl.transfer.v1'],
        estimated_time_ms: 2000
      },
      {
        id: 'zk-balance-proof',
        name: 'ZK Balance Proof',
        description: 'Generate zero-knowledge proof of sufficient balance',
        steps: ['cap.wallet.snapshot.v1', 'cap.zk.proof.balance.v1'],
        estimated_time_ms: 3000
      }
    ];

    res.json({ success: true, workflows });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Workflows failed'
    });
  }
});

// Execute a workflow template
app.post('/smart/workflows/:workflow_id', async (req: Request, res: Response) => {
  try {
    const { executeComposition } = await import('./composition');
    const { workflow_id } = req.params;
    const { inputs, agent_id } = req.body;

    const workflowTemplates: Record<string, any> = {
      'portfolio-check': {
        name: 'Portfolio Check',
        steps: [
          { capability_id: 'cap.wallet.snapshot.v1', inputs: { address: inputs?.wallet_address } },
          { 
            capability_id: 'cap.price.lookup.v1', 
            inputs: { base_token: inputs?.token || 'SOL', quote_token: 'USD' }
          }
        ]
      },
      'smart-swap': {
        name: 'Smart Swap',
        steps: [
          { capability_id: 'cap.price.lookup.v1', inputs: { base_token: inputs?.input_token, quote_token: inputs?.output_token } },
          { capability_id: 'cap.wallet.snapshot.v1', inputs: { address: inputs?.wallet_address } },
          { 
            capability_id: 'cap.swap.execute.v1', 
            inputs: { 
              input_token: inputs?.input_token,
              output_token: inputs?.output_token,
              amount: inputs?.amount,
              wallet_address: inputs?.wallet_address
            }
          }
        ],
        stop_on_error: true
      }
    };

    const template = workflowTemplates[workflow_id];
    if (!template) {
      return res.status(404).json({ success: false, error: `Workflow ${workflow_id} not found` });
    }

    const result = await executeComposition(template, agent_id);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Workflow execution failed'
    });
  }
});

// ============================================
// UNIFIED AGENT SERVICE (Cross-System View)
// ============================================

// Get unified agent view (combines identity, registry, trust)
app.get('/unified/agent/:agent_id', async (req: Request, res: Response) => {
  try {
    const agentId = req.params.agent_id;
    // Use require() for consistent module instances
    const { agentRegistry } = require('./agent-registry');
    const { agentIdentityManager } = require('./agent-identity');
    const { activityFeed } = require('./activity-feed');
    
    // Get from each system directly
    const registered = agentRegistry.getAgent(agentId);
    const identityAgent = agentIdentityManager.getAgent(agentId);
    const trustNode = trustNetwork.getNode(agentId);
    
    if (!registered && !identityAgent && !trustNode) {
      return res.status(404).json({ success: false, error: 'Agent not found in any system' });
    }
    
    const delegations = registered ? agentRegistry.getAgentDelegations(agentId) : { granted: [], received: [] };
    const trustCalc = trustNode ? trustNetwork.calculateTrust(agentId) : null;
    const activitySummary = activityFeed.getAgentSummary(agentId, 24);
    
    const identityScore = identityAgent?.reputation?.score || 50;
    const registryScore = registered?.trust_score || 50;
    const networkScore = trustCalc?.final_score || trustNode?.trust_score || 50;
    const overallScore = Math.round((identityScore * 0.3 + registryScore * 0.3 + networkScore * 0.4));
    
    res.json({
      success: true,
      agent: {
        agent_id: agentId,
        name: registered?.name || identityAgent?.metadata?.name,
        trust_level: identityAgent?.trust_level || 'anonymous',
        badges: identityAgent?.reputation?.badges || [],
        credentials_count: identityAgent?.credentials?.length || 0,
        capabilities_provided: registered?.capabilities_provided || [],
        capabilities_required: registered?.capabilities_required || [],
        delegations_granted: delegations.granted.length,
        delegations_received: delegations.received.length,
        trust_score: trustCalc?.final_score || trustNode?.trust_score || 50,
        reputation_level: trustNode?.reputation_level || 'newcomer',
        endorsements_count: trustNode?.endorsements?.length || 0,
        violations_count: trustNode?.violations?.length || 0,
        network_connections: trustNode?.network_connections?.length || 0,
        overall_score: overallScore,
        activity_24h: activitySummary.total_events,
        registered_at: identityAgent?.created_at || registered?.registered_at || trustNode?.joined_at || Date.now(),
        last_active: Math.max(
          identityAgent?.reputation?.last_active || 0,
          registered?.last_active || 0,
          trustNode?.last_activity || 0
        )
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unified lookup failed'
    });
  }
});

// Register agent across all systems
app.post('/unified/register', async (req: Request, res: Response) => {
  try {
    const agent = await unifiedAgentService.registerAgent(req.body);
    res.json({ success: true, agent });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unified registration failed'
    });
  }
});

// Get all agents with unified view
app.get('/unified/agents', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const agents = unifiedAgentService.getAllAgents(limit);
    res.json({ success: true, count: agents.length, agents });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unified list failed'
    });
  }
});

// Get unified stats across all systems
app.get('/unified/stats', async (req: Request, res: Response) => {
  try {
    const stats = unifiedAgentService.getUnifiedStats();
    res.json({ success: true, ...stats });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unified stats failed'
    });
  }
});

// Revoke delegation
app.post('/agents/delegate/revoke', async (req: Request, res: Response) => {
  try {
    const { agentRegistry } = await import('./agent-registry');
    const { delegation_id, by_agent } = req.body;

    const revoked = agentRegistry.revokeDelegation(delegation_id, by_agent);

    res.json({
      success: revoked,
      message: revoked ? 'Delegation revoked' : 'Revocation failed - check delegation ID and ownership'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Revocation failed'
    });
  }
});

// Rate an agent (peer rating)
app.post('/agents/:agent_id/rate', async (req: Request, res: Response) => {
  try {
    const { agentRegistry } = await import('./agent-registry');
    const { from_agent, rating, comment } = req.body;

    if (!from_agent || rating === undefined) {
      return res.status(400).json({ success: false, error: 'from_agent and rating required' });
    }

    const success = agentRegistry.addPeerRating(
      req.params.agent_id,
      from_agent,
      rating,
      comment
    );

    res.json({
      success,
      message: success ? 'Rating recorded' : 'Rating failed - check agent IDs'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Rating failed'
    });
  }
});

// Agent-to-agent capability request
app.post('/agents/coordinate', async (req: Request, res: Response) => {
  try {
    const { agentCoordinator } = await import('./agent-coordination');
    const { from_agent, to_agent, capability_id, inputs, context } = req.body;

    if (!from_agent || !to_agent || !capability_id) {
      return res.status(400).json({ 
        success: false, 
        error: 'from_agent, to_agent, and capability_id required' 
      });
    }

    const response = await agentCoordinator.requestCapability({
      from_agent,
      to_agent,
      capability_id,
      inputs: inputs || {},
      context: context || {}
    });

    res.json({
      success: response.status === 'completed',
      ...response
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Coordination failed'
    });
  }
});

// ============================================
// AGENT ACHIEVEMENTS (Gamification)
// ============================================

// Get agent achievement profile
app.get('/achievements/:agent_id', async (req: Request, res: Response) => {
  try {
    const { agentAchievements } = require('./agent-achievements');
    const profile = agentAchievements.getProfile(req.params.agent_id);
    res.json({ success: true, ...profile });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Achievement lookup failed'
    });
  }
});

// Get all available achievements
app.get('/achievements', async (req: Request, res: Response) => {
  try {
    const { agentAchievements } = require('./agent-achievements');
    const achievements = agentAchievements.getAllAchievements();
    
    // Group by category
    const byCategory: Record<string, any[]> = {};
    for (const a of achievements) {
      if (!byCategory[a.category]) byCategory[a.category] = [];
      byCategory[a.category].push(a);
    }
    
    res.json({
      success: true,
      total: achievements.length,
      by_category: byCategory
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Achievement list failed'
    });
  }
});

// Get XP leaderboard
app.get('/achievements/leaderboard/xp', async (req: Request, res: Response) => {
  try {
    const { agentAchievements } = require('./agent-achievements');
    const limit = parseInt(req.query.limit as string) || 10;
    const leaderboard = agentAchievements.getLeaderboard(limit);
    res.json({ success: true, leaderboard });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Leaderboard failed'
    });
  }
});

// Multi-agent consensus request
app.post('/agents/consensus', async (req: Request, res: Response) => {
  try {
    const { agentCoordinator } = await import('./agent-coordination');
    const { from_agent, target_agents, capability_id, inputs, consensus_threshold } = req.body;

    if (!from_agent || !target_agents || !capability_id) {
      return res.status(400).json({ 
        success: false, 
        error: 'from_agent, target_agents array, and capability_id required' 
      });
    }

    const response = await agentCoordinator.requestWithConsensus(
      { from_agent, to_agent: '', capability_id, inputs: inputs || {}, context: {} },
      target_agents,
      consensus_threshold || 0.66
    );

    res.json({
      success: response.status === 'completed',
      ...response
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Consensus request failed'
    });
  }
});

// Chain capabilities across agents
app.post('/agents/chain', async (req: Request, res: Response) => {
  try {
    const { agentCoordinator } = await import('./agent-coordination');
    const { initiator_agent, chain, initial_inputs, privacy_level } = req.body;

    if (!initiator_agent || !chain || !Array.isArray(chain)) {
      return res.status(400).json({ 
        success: false, 
        error: 'initiator_agent and chain array required' 
      });
    }

    const response = await agentCoordinator.chainCapabilities(
      initiator_agent,
      chain,
      initial_inputs || {},
      privacy_level || 'public'
    );

    res.json({
      success: response.status === 'completed',
      ...response
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Chain execution failed'
    });
  }
});

// Agent registry stats
app.get('/agents/stats/overview', async (req: Request, res: Response) => {
  try {
    const { agentRegistry } = await import('./agent-registry');
    const { agentCoordinator } = await import('./agent-coordination');
    
    const registryStats = agentRegistry.getStats();
    const coordStats = agentCoordinator.getStats();

    res.json({
      success: true,
      registry: registryStats,
      coordination: coordStats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Stats failed'
    });
  }
});

// Analytics Dashboard endpoint
app.get('/analytics/dashboard', async (req: Request, res: Response) => {
  try {
    const { capabilityAnalytics } = await import('./capability-analytics');
    const dashboard = capabilityAnalytics.getDashboard();
    res.json({ success: true, ...dashboard });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Analytics failed'
    });
  }
});

// Capability Insights endpoint
app.get('/analytics/capability/:capability_id', async (req: Request, res: Response) => {
  try {
    const { capabilityAnalytics } = await import('./capability-analytics');
    const insight = capabilityAnalytics.getCapabilityInsight(req.params.capability_id);
    res.json({ success: true, insight });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Insight failed'
    });
  }
});

// ============================================
// SECURITY ENDPOINTS - Secret Sauce
// ============================================

// Issue capability token to an agent
app.post('/security/tokens/issue', async (req: Request, res: Response) => {
  try {
    const { agent_id, capabilities, permissions, expires_in_hours } = req.body;
    
    // SECURITY: Input validation
    if (!agent_id || typeof agent_id !== 'string') {
      return res.status(400).json({ success: false, error: 'agent_id required and must be a string' });
    }
    
    // SECURITY: Sanitize agent_id - alphanumeric, hyphens, underscores only
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(agent_id)) {
      return res.status(400).json({ 
        success: false, 
        error: 'agent_id must be 1-64 alphanumeric characters, hyphens, or underscores' 
      });
    }
    
    // SECURITY: Validate capabilities array
    if (capabilities && !Array.isArray(capabilities)) {
      return res.status(400).json({ success: false, error: 'capabilities must be an array' });
    }
    
    // SECURITY: Validate expires_in_hours
    if (expires_in_hours !== undefined && (typeof expires_in_hours !== 'number' || expires_in_hours < 1 || expires_in_hours > 720)) {
      return res.status(400).json({ success: false, error: 'expires_in_hours must be between 1 and 720' });
    }

    const expiresInMs = (expires_in_hours || 24) * 60 * 60 * 1000;
    
    const token = capabilityTokenManager.issueToken(
      agent_id,
      capabilities || ['*'],
      permissions || {},
      expiresInMs
    );

    res.json({
      success: true,
      token: {
        token_id: token.token_id,
        expires_at: new Date(token.expires_at).toISOString(),
        permissions: token.permissions
      },
      semantic_key: capabilityTokenManager.generateSemanticKey(token)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Token issuance failed'
    });
  }
});

// Validate a capability token
app.post('/security/tokens/validate', async (req: Request, res: Response) => {
  try {
    const { token_id, capability_id, mode } = req.body;
    
    const result = capabilityTokenManager.validateToken(
      token_id,
      capability_id || 'cap.price.lookup.v1',
      mode || 'public'
    );

    res.json({ success: true, validation: result });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Validation failed'
    });
  }
});

// Trust network - register agent
app.post('/security/trust/register', async (req: Request, res: Response) => {
  try {
    const { agent_id } = req.body;
    
    // SECURITY: Input validation
    if (!agent_id || typeof agent_id !== 'string') {
      return res.status(400).json({ success: false, error: 'agent_id required and must be a string' });
    }
    
    // SECURITY: Sanitize agent_id
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(agent_id)) {
      return res.status(400).json({ 
        success: false, 
        error: 'agent_id must be 1-64 alphanumeric characters, hyphens, or underscores' 
      });
    }

    const node = trustNetwork.registerAgent(agent_id);

    res.json({
      success: true,
      trust_node: {
        agent_id: node.agent_id,
        trust_score: node.trust_score,
        reputation_level: node.reputation_level,
        joined_at: new Date(node.joined_at).toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Registration failed'
    });
  }
});

// Trust network - get agent trust info
app.get('/security/trust/:agent_id', async (req: Request, res: Response) => {
  try {
    const node = trustNetwork.getNode(req.params.agent_id);
    
    if (!node) {
      return res.status(404).json({ success: false, error: 'Agent not in trust network' });
    }

    const calculation = trustNetwork.calculateTrust(req.params.agent_id);

    res.json({
      success: true,
      agent_id: node.agent_id,
      trust_score: calculation?.final_score || node.trust_score,
      reputation_level: node.reputation_level,
      endorsements: node.endorsements.length,
      violations: node.violations.length,
      network_connections: node.network_connections.length,
      calculation
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Trust lookup failed'
    });
  }
});

// Trust network - endorse another agent
app.post('/security/trust/endorse', async (req: Request, res: Response) => {
  try {
    const { from_agent, to_agent, reason } = req.body;
    
    if (!from_agent || !to_agent) {
      return res.status(400).json({ success: false, error: 'from_agent and to_agent required' });
    }

    const success = trustNetwork.addEndorsement(from_agent, to_agent, reason || 'Peer endorsement');

    if (!success) {
      return res.status(400).json({ 
        success: false, 
        error: 'Endorsement failed - check trust levels and existing endorsements' 
      });
    }

    res.json({ success: true, message: `${from_agent} endorsed ${to_agent}` });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Endorsement failed'
    });
  }
});

// Trust network stats
app.get('/security/trust', async (req: Request, res: Response) => {
  try {
    const stats = trustNetwork.getNetworkStats();
    res.json({ success: true, ...stats });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Stats failed'
    });
  }
});

// ============================================
// AGENT SOCIAL FEATURES
// ============================================

// Get leaderboard
app.get('/social/leaderboard/:category', async (req: Request, res: Response) => {
  try {
    const { agentSocialManager } = await import('./agent-social');
    const category = req.params.category as 'reputation' | 'invocations' | 'badges' | 'capabilities';
    const limit = parseInt(req.query.limit as string) || 10;
    
    const leaderboard = agentSocialManager.getLeaderboard(category, limit);
    res.json({ success: true, category, leaderboard });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Leaderboard failed'
    });
  }
});

// Get agent public profile
app.get('/social/profile/:agent_id', async (req: Request, res: Response) => {
  try {
    const { agentSocialManager } = await import('./agent-social');
    const profile = agentSocialManager.getPublicProfile(req.params.agent_id);
    
    if (!profile) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }
    
    res.json({ success: true, profile });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Profile failed'
    });
  }
});

// Send message between agents
app.post('/social/messages', async (req: Request, res: Response) => {
  try {
    const { agentSocialManager } = await import('./agent-social');
    const { from_agent, to_agent, subject, content, type } = req.body;
    
    if (!from_agent || !to_agent || !subject || !content) {
      return res.status(400).json({ 
        success: false, 
        error: 'from_agent, to_agent, subject, and content required' 
      });
    }
    
    const message = agentSocialManager.sendMessage(from_agent, to_agent, { subject, content, type });
    res.json({ success: true, message });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Message failed'
    });
  }
});

// Get agent messages
app.get('/social/messages/:agent_id', async (req: Request, res: Response) => {
  try {
    const { agentSocialManager } = await import('./agent-social');
    const unreadOnly = req.query.unread === 'true';
    const messages = agentSocialManager.getMessages(req.params.agent_id, unreadOnly);
    
    res.json({ 
      success: true, 
      count: messages.length,
      unread: messages.filter(m => !m.read).length,
      messages 
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Messages failed'
    });
  }
});

// Mark message as read
app.post('/social/messages/:agent_id/:message_id/read', async (req: Request, res: Response) => {
  try {
    const { agentSocialManager } = await import('./agent-social');
    const success = agentSocialManager.markAsRead(req.params.agent_id, req.params.message_id);
    res.json({ success });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Mark read failed'
    });
  }
});

// Share workflow publicly
app.post('/social/workflows/share', async (req: Request, res: Response) => {
  try {
    const { agentSocialManager } = await import('./agent-social');
    const { agent_id, name, description, capabilities, template } = req.body;
    
    if (!agent_id || !name || !capabilities) {
      return res.status(400).json({ 
        success: false, 
        error: 'agent_id, name, and capabilities required' 
      });
    }
    
    const workflowId = agentSocialManager.shareWorkflow(agent_id, { 
      name, description, capabilities, template 
    });
    
    res.json({ success: true, workflow_id: workflowId });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Share failed'
    });
  }
});

// Community stats
app.get('/social/stats', async (req: Request, res: Response) => {
  try {
    const { agentSocialManager } = await import('./agent-social');
    const stats = agentSocialManager.getCommunityStats();
    res.json({ success: true, ...stats });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Stats failed'
    });
  }
});

// ============================================
// REAL-TIME ACTIVITY FEED
// ============================================

// Get recent activity
app.get('/activity/feed', async (req: Request, res: Response) => {
  try {
    const { activityFeed } = await import('./activity-feed');
    const { limit, types, agent_id, since } = req.query;
    
    const events = activityFeed.getRecent({
      limit: limit ? parseInt(limit as string) : 50,
      types: types ? (types as string).split(',') as any : undefined,
      agent_id: agent_id as string,
      since: since ? parseInt(since as string) : undefined
    });
    
    res.json({ success: true, count: events.length, events });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Feed failed'
    });
  }
});

// Get agent activity summary
app.get('/activity/agent/:agent_id', async (req: Request, res: Response) => {
  try {
    const { activityFeed } = await import('./activity-feed');
    const hours = parseInt(req.query.hours as string) || 24;
    const summary = activityFeed.getAgentSummary(req.params.agent_id, hours);
    res.json({ success: true, agent_id: req.params.agent_id, ...summary });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Summary failed'
    });
  }
});

// Get network activity stats
app.get('/activity/stats', async (req: Request, res: Response) => {
  try {
    const { activityFeed } = await import('./activity-feed');
    const hours = parseInt(req.query.hours as string) || 24;
    const stats = activityFeed.getNetworkStats(hours);
    res.json({ success: true, ...stats });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Stats failed'
    });
  }
});

// Get trending agents
app.get('/activity/trending', async (req: Request, res: Response) => {
  try {
    const { activityFeed } = await import('./activity-feed');
    const limit = parseInt(req.query.limit as string) || 10;
    const trending = activityFeed.getTrendingAgents(limit);
    res.json({ success: true, trending });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Trending failed'
    });
  }
});

// SSE endpoint for real-time activity stream
app.get('/activity/stream', async (req: Request, res: Response) => {
  try {
    const { activityFeed } = await import('./activity-feed');
    
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Send initial connection event
    res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);

    // Subscribe to activity feed
    const subId = activityFeed.subscribe({
      agent_id: req.query.agent_id as string,
      types: req.query.types ? (req.query.types as string).split(',') as any : undefined,
      callback: (event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    });

    // Cleanup on disconnect
    req.on('close', () => {
      activityFeed.unsubscribe(subId);
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Stream failed'
    });
  }
});

// Initiate agent handshake
app.post('/security/handshake/initiate', async (req: Request, res: Response) => {
  try {
    const { agent_id, requested_access } = req.body;
    
    // SECURITY: Input validation
    if (!agent_id || typeof agent_id !== 'string') {
      return res.status(400).json({ success: false, error: 'agent_id required and must be a string' });
    }
    
    // SECURITY: Sanitize agent_id
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(agent_id)) {
      return res.status(400).json({ 
        success: false, 
        error: 'agent_id must be 1-64 alphanumeric characters, hyphens, or underscores' 
      });
    }
    
    // SECURITY: Validate requested_access
    if (requested_access && !Array.isArray(requested_access)) {
      return res.status(400).json({ success: false, error: 'requested_access must be an array' });
    }

    // Get agent context from trust network
    const node = trustNetwork.getNode(agent_id);
    const context = {
      prior_invocations: node?.activity_history.length || 0,
      trust_score: node?.trust_score || 0,
      reputation_level: node?.reputation_level || 'newcomer',
      network_membership: node?.network_connections || [],
      last_activity: node?.last_activity || Date.now()
    };

    const { session, challenge } = agentHandshake.initiateHandshake(
      agent_id,
      context,
      requested_access || ['public']
    );

    res.json({
      success: true,
      session_id: session.session_id,
      status: session.status,
      challenge: {
        challenge_id: challenge.challenge_id,
        step: challenge.step,
        total_steps: challenge.total_steps,
        challenge_data: challenge.challenge_data,
        required_proof: challenge.required_proof,
        expires_at: new Date(challenge.expires_at).toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Handshake initiation failed'
    });
  }
});

// Process handshake response
app.post('/security/handshake/respond', async (req: Request, res: Response) => {
  try {
    const { challenge_id, step, proof, agent_signature, context_hash } = req.body;
    
    const result = agentHandshake.processResponse({
      challenge_id,
      step,
      proof,
      agent_signature,
      context_hash
    });

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    res.json({
      success: true,
      completed: !result.next_challenge,
      next_challenge: result.next_challenge,
      session: result.session ? {
        session_id: result.session.session_id,
        status: result.session.status,
        granted_access: result.session.granted_access
      } : undefined
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Handshake response failed'
    });
  }
});

// Decrypt semantic payload (requires semantic key)
app.post('/security/semantics/decrypt', async (req: Request, res: Response) => {
  try {
    const { encrypted_payload, semantic_key } = req.body;
    
    if (!encrypted_payload || !semantic_key) {
      return res.status(400).json({ 
        success: false, 
        error: 'encrypted_payload and semantic_key required' 
      });
    }

    const decrypted = semanticEncryption.decryptSemantics(encrypted_payload, semantic_key);

    if (!decrypted) {
      return res.status(403).json({
        success: false,
        error: 'Decryption failed - invalid semantic key or tampered payload'
      });
    }

    res.json({
      success: true,
      decrypted_semantics: decrypted
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Decryption failed'
    });
  }
});

// Verify obfuscated action
app.post('/security/semantics/verify-action', async (req: Request, res: Response) => {
  try {
    const { obfuscated_action, original_parameters, nonce } = req.body;
    
    if (!obfuscated_action || !nonce) {
      return res.status(400).json({ 
        success: false, 
        error: 'obfuscated_action and nonce required' 
      });
    }

    const result = semanticEncryption.decodeAction(
      obfuscated_action,
      original_parameters || {},
      nonce
    );

    res.json({
      success: true,
      action: result.action,
      verified: result.verified
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Verification failed'
    });
  }
});

// Revoke a capability token
app.post('/security/tokens/revoke', async (req: Request, res: Response) => {
  try {
    const { token_id, reason } = req.body;
    
    if (!token_id || typeof token_id !== 'string') {
      return res.status(400).json({ success: false, error: 'token_id required' });
    }

    const revoked = capabilityTokenManager.revokeToken(token_id, reason || 'api_revocation');

    if (!revoked) {
      return res.status(404).json({ success: false, error: 'Token not found' });
    }

    res.json({ success: true, message: `Token ${token_id} revoked` });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Revocation failed'
    });
  }
});

// Get security audit log
app.get('/security/audit', async (req: Request, res: Response) => {
  try {
    const stats = securityAuditLog.getStats();
    const recentEvents = securityAuditLog.getRecentEvents(50);

    res.json({
      success: true,
      stats,
      recent_events: recentEvents
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Audit log failed'
    });
  }
});

// Get audit events for specific agent
app.get('/security/audit/:agent_id', async (req: Request, res: Response) => {
  try {
    const events = securityAuditLog.getAgentEvents(req.params.agent_id, 100);

    res.json({
      success: true,
      agent_id: req.params.agent_id,
      events
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Audit lookup failed'
    });
  }
});

// Get agent's security status (tokens, trust, handshake)
app.get('/security/status/:agent_id', async (req: Request, res: Response) => {
  try {
    const { agent_id } = req.params;

    const tokens = capabilityTokenManager.getAgentTokens(agent_id);
    const trustNode = trustNetwork.getNode(agent_id);
    const trustCalc = trustNode ? trustNetwork.calculateTrust(agent_id) : null;
    const hasConfidentialAccess = agentHandshake.hasAccess(agent_id, 'confidential');
    const hasPremiumAccess = agentHandshake.hasAccess(agent_id, 'premium');

    res.json({
      success: true,
      agent_id,
      tokens: {
        count: tokens.length,
        active: tokens.map(t => ({
          token_id: t.token_id,
          capabilities: t.capabilities,
          expires_at: new Date(t.expires_at).toISOString(),
          semantic_access_level: t.permissions.semantic_access_level
        }))
      },
      trust: trustNode ? {
        score: trustCalc?.final_score || trustNode.trust_score,
        level: trustNode.reputation_level,
        endorsements: trustNode.endorsements.length,
        violations: trustNode.violations.length,
        activities: trustNode.activity_history.length,
        network_connections: trustNode.network_connections.length
      } : null,
      access: {
        public: true,
        confidential: hasConfidentialAccess,
        premium: hasPremiumAccess
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Status lookup failed'
    });
  }
});

// Sponsor security context endpoint
app.get('/sponsors/:name/security', async (req: Request, res: Response) => {
  try {
    const { sponsorStatusManager } = await import('./sponsor-status');
    const context = await sponsorStatusManager.getSponsorSecurityContext(req.params.name);
    
    if (!context) {
      return res.status(404).json({ 
        success: false, 
        error: `Sponsor ${req.params.name} not found`,
        available: ['arcium', 'noir', 'helius', 'inco']
      });
    }

    res.json({ success: true, ...context });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Security context failed'
    });
  }
});

// Live sponsor health check (must be before /sponsors/:sponsor)
app.get('/sponsors/health', async (req: Request, res: Response) => {
  try {
    const { sponsorStatusManager } = await import('./sponsor-status');
    const healthChecks = await Promise.all([
      sponsorStatusManager.performLiveHealthCheck('arcium'),
      sponsorStatusManager.performLiveHealthCheck('noir'),
      sponsorStatusManager.performLiveHealthCheck('helius'),
      sponsorStatusManager.performLiveHealthCheck('inco')
    ]);
    
    const allHealthy = healthChecks.every(h => h.reachable);
    res.json({
      success: true,
      status: allHealthy ? 'all_healthy' : 'some_degraded',
      checks: healthChecks,
      timestamp: Date.now()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Health check failed'
    });
  }
});

// Sponsor Integration Status endpoint
app.get('/sponsors', async (req: Request, res: Response) => {
  try {
    const { sponsorStatusManager, sponsorMetrics } = await import('./sponsor-status');
    const report = await sponsorStatusManager.getFullReport();
    const metrics = sponsorMetrics.getAllMetrics();
    res.json({ success: true, ...report, sponsor_metrics: metrics });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Sponsor status failed'
    });
  }
});

// Individual sponsor status
app.get('/sponsors/:sponsor', async (req: Request, res: Response) => {
  try {
    const { sponsorStatusManager } = await import('./sponsor-status');
    const status = await sponsorStatusManager.getSponsorStatus(req.params.sponsor);
    
    if (!status) {
      return res.status(404).json({
        success: false,
        error: `Sponsor ${req.params.sponsor} not found. Available: arcium, noir, helius, inco`
      });
    }
    
    res.json({ success: true, ...status });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Sponsor status failed'
    });
  }
});

// Helius Webhook receiver
app.post('/webhooks/helius', async (req: Request, res: Response) => {
  try {
    const { heliusWebhookManager } = await import('../providers/helius-webhooks');
    const events = req.body;
    
    // Process each event
    for (const event of events) {
      const wallet = event.accountData?.[0]?.account;
      if (wallet) {
        heliusWebhookManager.processEvent(wallet, event);
      }
    }
    
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Webhook processing failed'
    });
  }
});

// Streaming endpoint (Server-Sent Events)
app.get('/stream/:capability_id', (req: Request, res: Response) => {
  const { capability_id } = req.params;
  const request_id = `stream_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  const { streamManager } = require('./streaming');
  
  // Listen for stream events
  const handler = (event: any) => {
    if (event.request_id === request_id) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      
      if (event.type === 'complete' || event.type === 'error') {
        res.end();
      }
    }
  };
  
  streamManager.on('stream', handler);
  
  // Start streaming based on capability
  if (capability_id === 'cap.price.lookup.v1') {
    const { streamPriceUpdates } = require('./streaming');
    const { base_token, quote_token } = req.query;
    streamPriceUpdates(request_id, base_token as string || 'SOL', quote_token as string || 'USD');
  }
  
  // Cleanup on client disconnect
  req.on('close', () => {
    streamManager.removeListener('stream', handler);
  });
});

// ============================================
// ADVANCED FEATURES: Receipts, Privacy, Negotiation
// ============================================

// Privacy Gradient endpoint - get privacy options for a capability
app.get('/privacy/:capability_id', async (req: Request, res: Response) => {
  try {
    const { privacyGradient, PRIVACY_LEVELS } = await import('./privacy-gradient');
    const { capability_id } = req.params;
    const sensitivity = req.query.sensitivity as 'low' | 'medium' | 'high' | 'critical' | undefined;
    
    const options = privacyGradient.getPrivacyOptions(capability_id);
    const recommendation = privacyGradient.recommendPrivacy(capability_id, sensitivity);
    
    res.json({
      success: true,
      capability_id,
      privacy_levels: PRIVACY_LEVELS,
      available_options: options,
      recommendation,
      hint: 'Use /negotiate to explore cost trade-offs'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Privacy lookup failed'
    });
  }
});

// Capability Negotiation endpoint - explore execution options
app.post('/negotiate', async (req: Request, res: Response) => {
  try {
    const { validateNegotiationRequest } = await import('./advanced/validation');
    const validation = validateNegotiationRequest(req.body);
    
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        errors: validation.errors,
        warnings: validation.warnings
      });
    }
    
    const { negotiator } = await import('./capability-negotiation');
    const result = await negotiator.negotiate(req.body);
    
    // Include any warnings in response
    if (validation.warnings.length > 0) {
      result.warnings = validation.warnings;
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Negotiation failed'
    });
  }
});

// Quick cost comparison across privacy levels
app.get('/negotiate/:capability_id/compare', async (req: Request, res: Response) => {
  try {
    const { negotiator } = await import('./capability-negotiation');
    const { capability_id } = req.params;
    
    const comparison = negotiator.compareCosts(capability_id);
    
    res.json({
      success: true,
      capability_id,
      comparison,
      hint: 'Higher privacy levels cost more but provide stronger guarantees'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Comparison failed'
    });
  }
});

// Verify a capability receipt (offline verification)
app.post('/receipts/verify', async (req: Request, res: Response) => {
  try {
    const { receiptManager } = await import('./capability-receipt');
    const { receipt, original_inputs, original_outputs } = req.body;
    
    const result = receiptManager.verifyReceipt(receipt, original_inputs, original_outputs);
    
    res.json({
      success: true,
      verification: result,
      receipt_summary: receiptManager.summarizeReceipt(receipt)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Receipt verification failed'
    });
  }
});

// Deserialize a receipt from base64
app.post('/receipts/decode', async (req: Request, res: Response) => {
  try {
    const { receiptManager } = await import('./capability-receipt');
    const { encoded_receipt } = req.body;
    
    const receipt = receiptManager.deserializeReceipt(encoded_receipt);
    
    res.json({
      success: true,
      receipt,
      summary: receiptManager.summarizeReceipt(receipt)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Receipt decode failed'
    });
  }
});

// Usage metadata / capability reputation
app.get('/reputation', async (req: Request, res: Response) => {
  try {
    const { usageMetadataEmitter } = await import('./usage-metadata');
    const stats = usageMetadataEmitter.getUsageStats();
    const topCapabilities = usageMetadataEmitter.getTopCapabilities(10);
    
    res.json({
      success: true,
      stats,
      top_capabilities: topCapabilities,
      hint: 'Scores are locally computed from usage patterns'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Reputation lookup failed'
    });
  }
});

app.get('/reputation/:capability_id', async (req: Request, res: Response) => {
  try {
    const { usageMetadataEmitter } = await import('./usage-metadata');
    const score = usageMetadataEmitter.getCapabilityScore(req.params.capability_id);
    
    if (!score) {
      return res.status(404).json({
        success: false,
        error: 'No usage data for this capability yet'
      });
    }
    
    res.json({
      success: true,
      score
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Score lookup failed'
    });
  }
});

// Export/import reputation scores (peer-to-peer)
app.get('/reputation/export', async (req: Request, res: Response) => {
  try {
    const { usageMetadataEmitter } = await import('./usage-metadata');
    const encoded = usageMetadataEmitter.exportScores();
    
    res.json({
      success: true,
      encoded_scores: encoded,
      hint: 'Share with other agents via POST /reputation/import'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Export failed'
    });
  }
});

app.post('/reputation/import', async (req: Request, res: Response) => {
  try {
    const { usageMetadataEmitter } = await import('./usage-metadata');
    const { encoded_scores, weight } = req.body;
    
    usageMetadataEmitter.importScores(encoded_scores, weight || 0.3);
    
    res.json({
      success: true,
      message: 'Scores imported and merged',
      new_stats: usageMetadataEmitter.getUsageStats()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Import failed'
    });
  }
});

// Intent Graph execution
app.post('/intent', async (req: Request, res: Response) => {
  try {
    const { validateIntentGraph } = await import('./advanced/validation');
    const { intentGraphExecutor } = await import('./intent-graph');
    const graph = req.body;
    
    // Pre-validate with cross-system validation
    const preValidation = validateIntentGraph(graph);
    if (!preValidation.valid) {
      return res.status(400).json({
        success: false,
        errors: preValidation.errors,
        warnings: preValidation.warnings
      });
    }
    
    // Validate with executor (checks cycles, etc.)
    const validation = intentGraphExecutor.validate(graph);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        errors: validation.errors
      });
    }
    
    // Execute
    const result = await intentGraphExecutor.execute(graph);
    
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Intent execution failed'
    });
  }
});

app.post('/intent/plan', async (req: Request, res: Response) => {
  try {
    const { intentGraphExecutor } = await import('./intent-graph');
    const graph = req.body;
    
    // Validate
    const validation = intentGraphExecutor.validate(graph);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        errors: validation.errors
      });
    }
    
    // Plan without executing
    const plan = intentGraphExecutor.plan(graph);
    
    res.json({
      success: true,
      plan: {
        execution_order: plan.execution_order,
        estimated_cost: plan.estimated_cost,
        estimated_time_ms: plan.estimated_time_ms,
        privacy_levels: Object.fromEntries(plan.privacy_levels)
      },
      hint: 'POST /intent to execute this plan'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Planning failed'
    });
  }
});

app.get('/intent/examples', async (req: Request, res: Response) => {
  try {
    const { EXAMPLE_INTENT_GRAPHS } = await import('./intent-graph');
    
    res.json({
      success: true,
      examples: Object.entries(EXAMPLE_INTENT_GRAPHS).map(([key, graph]) => ({
        id: key,
        name: graph.name,
        description: graph.description,
        nodes: graph.nodes.length,
        edges: graph.edges?.length || 0
      }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Examples lookup failed'
    });
  }
});

// Advanced Features Health Check
app.get('/advanced/health', async (req: Request, res: Response) => {
  try {
    const { advancedFeaturesHealth } = await import('./advanced/health');
    const report = advancedFeaturesHealth.getHealthReport();
    
    const statusCode = report.overall_status === 'healthy' ? 200 : 
                       report.overall_status === 'degraded' ? 200 : 503;
    
    res.status(statusCode).json({
      success: true,
      ...report
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Health check failed'
    });
  }
});

// Advanced Features Self-Test
app.post('/advanced/self-test', async (req: Request, res: Response) => {
  try {
    const { advancedFeaturesHealth } = await import('./advanced/health');
    const result = await advancedFeaturesHealth.runSelfTest();
    
    res.json({
      success: result.passed,
      ...result,
      timestamp: Date.now()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Self-test failed'
    });
  }
});

const PORT = process.env.PORT || process.env.ROUTER_PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

export function startServer(port?: number): Promise<any> {
  return new Promise((resolve) => {
    const actualPort = port || PORT;
    // Start cleanup jobs
    rateLimiter.startCleanup(60000);
    capabilityTokenManager.startCleanup(60000);
    
    server = app.listen(Number(actualPort), HOST, async () => {
      resolve(server);
    });
  });
}

export function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => resolve());
    } else {
      resolve();
    }
  });
}

export { app };

function startServerLegacy(): void {
  server = app.listen(Number(PORT), HOST, async () => {
    observability.info('server', `CAP-402 Router listening on ${HOST}:${PORT}`);
    console.log(`\n🚀 CAP-402 Reference Router v0.1.0`);
    console.log(`📡 Listening on http://localhost:${PORT}`);
    
    // Initialize BirdEye WebSocket
    try {
      const { birdEyeClient } = await import('../providers/birdeye-websocket');
      await birdEyeClient.connect();
      console.log(`✅ BirdEye WebSocket connected`);
    } catch (error) {
      console.log(`⚠️  BirdEye WebSocket connection failed: ${error}`);
    }
    console.log(`\n✅ Real API Integrations:`);
    console.log(`  • CoinMarketCap (Price Data)`);
    console.log(`  • Solana Tracker (Solana Tokens)`);
    console.log(`  • Helius (Wallet Data & NFTs)`);
    console.log(`  • Alchemy (Solana RPC)`);
    console.log(`  • BirdEye (Real-time WebSocket)`);
    console.log(`\n📋 Core Endpoints:`);
    console.log(`  GET  /capabilities            - Discover all capabilities`);
    console.log(`  GET  /capabilities/:id        - Get specific capability`);
    console.log(`  GET  /capabilities/:id/example - Usage example with curl`);
    console.log(`  POST /invoke                  - Invoke a capability`);
    console.log(`  POST /compose                 - Compose multiple capabilities`);
    console.log(`  GET  /stream/:capability_id   - Stream real-time updates (SSE)`);
    
    console.log(`\n🔍 Discovery & Templates:`);
    console.log(`  POST /discover                - Semantic capability search`);
    console.log(`  POST /suggest-workflow        - AI workflow suggestions`);
    console.log(`  GET  /templates               - Composition templates`);
    console.log(`  GET  /templates/:id           - Get specific template`);
    
    console.log(`\n🤖 Agent Identity:`);
    console.log(`  POST /agents/register         - Register new agent`);
    console.log(`  GET  /agents/:id              - Get agent info`);
    console.log(`  GET  /agents/:id/profile      - Public profile`);
    console.log(`  GET  /recommendations/:id     - Personalized recommendations`);
    
    console.log(`\n👥 Social Features:`);
    console.log(`  GET  /leaderboard/:category   - Agent leaderboards`);
    console.log(`  GET  /community/stats         - Community statistics`);
    console.log(`  POST /agents/:id/delegate     - Delegate capability access`);
    console.log(`  GET  /agents/:id/delegations  - View delegations`);
    console.log(`  GET  /agents/:id/messages     - Agent messages`);
    console.log(`  POST /agents/:id/messages     - Send message`);
    
    console.log(`\n📊 Analytics & Health:`);
    console.log(`  GET  /analytics/dashboard     - Usage analytics`);
    console.log(`  GET  /analytics/capability/:id - Capability insights`);
    console.log(`  GET  /health                  - System health`);
    console.log(`  GET  /health/capabilities     - All capability health`);
    console.log(`  GET  /metrics                 - Performance metrics`);
    
    console.log(`\n🏆 Sponsor Integrations:`);
    console.log(`  GET  /sponsors                - All sponsor status`);
    console.log(`  GET  /sponsors/:name          - Individual sponsor (arcium, noir, helius, inco)`);
    console.log(`  GET  /sponsors/:name/security - Sponsor security requirements`);
    
    console.log(`\n🔐 Security (Secret Sauce):`);
    console.log(`  POST /security/tokens/issue    - Issue capability token`);
    console.log(`  POST /security/tokens/validate - Validate token`);
    console.log(`  POST /security/tokens/revoke   - Revoke a token`);
    console.log(`  POST /security/trust/register  - Join trust network`);
    console.log(`  GET  /security/trust/:id       - Get trust score`);
    console.log(`  POST /security/trust/endorse   - Endorse another agent`);
    console.log(`  POST /security/handshake/initiate - Start multi-step handshake`);
    console.log(`  POST /security/handshake/respond  - Complete handshake step`);
    console.log(`  POST /security/semantics/decrypt  - Decrypt semantic payload`);
    console.log(`  POST /security/semantics/verify-action - Verify obfuscated action`);
    console.log(`  GET  /security/status/:id      - Full agent security status`);
    console.log(`  GET  /security/audit           - Security audit log`);
    console.log(`  GET  /security/audit/:id       - Agent audit events`);
    
    console.log(`\n💰 Economics:`);
    console.log(`  POST /estimate                - Cost estimation`);
    console.log(`  GET  /estimate/:id/compare    - Trust level comparison`);
    console.log(`  POST /verify-proof            - Verify cryptographic proofs`);
    
    console.log(`\n🔮 Advanced Features (Novel):`);
    console.log(`  GET  /privacy/:capability_id  - Privacy gradient options`);
    console.log(`  POST /negotiate               - Capability negotiation`);
    console.log(`  GET  /negotiate/:id/compare   - Cost comparison by privacy`);
    console.log(`  POST /receipts/verify         - Verify execution receipt`);
    console.log(`  POST /receipts/decode         - Decode serialized receipt`);
    console.log(`  GET  /reputation              - Emergent capability reputation`);
    console.log(`  GET  /reputation/export       - Export scores for P2P sharing`);
    console.log(`  POST /reputation/import       - Import peer scores`);
    console.log(`  POST /intent                  - Execute intent graph`);
    console.log(`  POST /intent/plan             - Plan intent (dry run)`);
    console.log(`  GET  /intent/examples         - Example intent graphs`);
    console.log(`  GET  /advanced/health         - Advanced features health`);
    console.log(`  POST /advanced/self-test      - Run self-test on all features`);
    
    console.log(`\n🔗 Webhooks:`);
    console.log(`  POST /webhooks/helius         - Helius event receiver\n`);
  });
}

// ============================================
// MEMORY & HEALTH MONITORING
// ============================================

// Memory stats endpoint
app.get('/system/memory', async (req: Request, res: Response) => {
  try {
    const { memoryManager } = require('./memory-manager');
    const stats = memoryManager.getStats();
    const cleanupStats = memoryManager.getCleanupStats();
    
    res.json({
      success: true,
      memory: stats,
      cleanup: cleanupStats,
      under_pressure: memoryManager.isUnderPressure()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Memory stats failed'
    });
  }
});

// Cache stats endpoint
app.get('/system/cache', async (req: Request, res: Response) => {
  try {
    const cacheStats = responseCache.getStats();
    res.json({ success: true, cache: cacheStats });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Cache stats failed'
    });
  }
});

// Integration stats endpoint
app.get('/system/integrations', async (req: Request, res: Response) => {
  try {
    const health = integrationManager.getHealthStatus();
    const stats = integrationManager.getStats();
    
    res.json({
      success: true,
      integrations: health,
      stats,
      summary: {
        total_services: health.length,
        healthy: health.filter(h => h.status === 'healthy').length,
        degraded: health.filter(h => h.status === 'degraded').length,
        down: health.filter(h => h.status === 'down').length
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Integration stats failed'
    });
  }
});

// Rate limiter stats endpoint
app.get('/system/rate-limits', async (req: Request, res: Response) => {
  try {
    const stats = rateLimiter.getStats();
    const { agentRateLimiter } = require('./agent-rate-limiter');
    const agentStats = agentRateLimiter.getStats();
    
    res.json({
      success: true,
      global: stats,
      agent: agentStats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Rate limit stats failed'
    });
  }
});

// Observability stats endpoint
app.get('/system/logs', async (req: Request, res: Response) => {
  try {
    const stats = observability.getStats();
    const limit = parseInt(req.query.limit as string) || 50;
    const level = req.query.level as string;
    const component = req.query.component as string;
    
    const logs = observability.getLogs({ level, component, limit });
    
    res.json({
      success: true,
      stats,
      logs
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Log stats failed'
    });
  }
});

// Comprehensive metrics endpoint
app.get('/system/metrics', async (req: Request, res: Response) => {
  try {
    const { metricsCollector } = require('./metrics');
    const { getRequestMetrics } = require('./middleware/request-context');
    
    // Use new summary() for concise output
    const summary = metricsCollector.summary();
    const requestMetrics = getRequestMetrics();
    
    res.json({
      success: true,
      system: {
        uptime_seconds: Math.floor(summary.uptime_ms / 1000),
        total_invocations: summary.total,
        rpm: summary.rpm,
        success_rate: summary.success_rate,
        avg_latency_ms: summary.avg_latency,
        total_cost: summary.total_cost
      },
      requests: requestMetrics,
      top_capabilities: summary.top_3,
      slowest_capabilities: summary.slowest_3,
      rate_limiter: rateLimiter.getStats()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Metrics failed'
    });
  }
});

// Force cleanup endpoint
app.post('/system/cleanup', async (req: Request, res: Response) => {
  try {
    const { memoryManager } = require('./memory-manager');
    const result = memoryManager.forceCleanup();
    
    // Also cleanup cache and circuit breakers
    const cacheRemoved = responseCache.cleanup();
    const circuitBreakersRemoved = router.cleanupCircuitBreakers();
    
    res.json({
      success: true,
      memory_cleanup: result,
      cache_items_removed: cacheRemoved,
      circuit_breakers_removed: circuitBreakersRemoved
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Cleanup failed'
    });
  }
});

// Router status endpoint
app.get('/system/router', async (req: Request, res: Response) => {
  try {
    const status = router.getStatus();
    const { registry } = require('./registry');
    const summary = registry.getCapabilitySummary();
    
    res.json({
      success: true,
      router: status,
      capabilities: summary,
      queue: router.getQueueStats(),
      circuit_breakers: router.getCircuitBreakerDashboard()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Router status failed'
    });
  }
});

// Priority queue endpoint
app.post('/queue/invoke', async (req: Request, res: Response) => {
  const v = validate<{ capability_id: string; inputs?: any; priority?: string }>(req.body, ['capability_id']);
  if (!v.valid) {
    const err = apiError('VALIDATION_ERROR', 'Missing required fields', { missing: v.missing });
    return res.status(err.status).json(err.body);
  }
  try {
    const result = await router.queuedInvoke({ capability_id: v.data.capability_id, inputs: v.data.inputs || {} }, (v.data.priority as any) || 'normal');
    res.json(result);
  } catch (error) {
    const err = apiError('INTERNAL_ERROR', error instanceof Error ? error.message : 'Queue invoke failed');
    res.status(err.status).json(err.body);
  }
});

// Request tracing endpoints
app.post('/trace/start', (req: Request, res: Response) => {
  const traceId = router.startTrace(req.body.trace_id);
  res.json({ success: true, trace_id: traceId });
});

app.post('/trace/:trace_id/step', (req: Request, res: Response) => {
  router.addTraceStep(req.params.trace_id, req.body.action, req.body.data);
  res.json({ success: true });
});

app.get('/trace/:trace_id', (req: Request, res: Response) => {
  const trace = router.getTrace(req.params.trace_id);
  if (!trace) {
    const err = apiError('NOT_FOUND', 'Trace not found');
    return res.status(err.status).json(err.body);
  }
  res.json({ success: true, ...trace });
});

// ============================================
// INNOVATIVE FEATURES - What makes CAP-402 essential
// ============================================

// Content-based deduplication - same request = cached response
app.post('/dedup/invoke', async (req: Request, res: Response) => {
  const v = validate<{ capability_id: string; inputs?: any; ttl_ms?: number }>(req.body, ['capability_id']);
  if (!v.valid) {
    const err = apiError('VALIDATION_ERROR', 'Missing required fields', { missing: v.missing });
    return res.status(err.status).json(err.body);
  }
  try {
    const result = await router.deduplicatedInvoke(
      { capability_id: v.data.capability_id, inputs: v.data.inputs || {} },
      v.data.ttl_ms || 5000
    );
    res.json(result);
  } catch (error) {
    const err = apiError('INTERNAL_ERROR', error instanceof Error ? error.message : 'Dedup invoke failed');
    res.status(err.status).json(err.body);
  }
});

// Predictive invoke - learns patterns and prefetches
app.post('/predictive/invoke', async (req: Request, res: Response) => {
  const v = validate<{ capability_id: string; inputs?: any }>(req.body, ['capability_id']);
  if (!v.valid) {
    const err = apiError('VALIDATION_ERROR', 'Missing required fields', { missing: v.missing });
    return res.status(err.status).json(err.body);
  }
  try {
    const result = await router.invokeWithPrefetch({ capability_id: v.data.capability_id, inputs: v.data.inputs || {} });
    const predictions = router.getPredictedNext(v.data.capability_id);
    res.json({ ...result, _predictions: predictions });
  } catch (error) {
    const err = apiError('INTERNAL_ERROR', error instanceof Error ? error.message : 'Predictive invoke failed');
    res.status(err.status).json(err.body);
  }
});

// Get predicted next capabilities
app.get('/predict/:capability_id', (req: Request, res: Response) => {
  const predictions = router.getPredictedNext(req.params.capability_id, 5);
  res.json({ success: true, capability_id: req.params.capability_id, predictions });
});

// Agent collaboration - multi-agent sessions
app.post('/collab/start', (req: Request, res: Response) => {
  const { session_id, agents, context } = req.body;
  if (!agents || !Array.isArray(agents) || agents.length === 0) {
    const err = apiError('VALIDATION_ERROR', 'agents array required');
    return res.status(err.status).json(err.body);
  }
  const id = router.startCollaboration(session_id, agents, context);
  res.json({ success: true, session_id: id, agents });
});

app.post('/collab/:session_id/join', (req: Request, res: Response) => {
  const { agent_id } = req.body;
  if (!agent_id) {
    const err = apiError('VALIDATION_ERROR', 'agent_id required');
    return res.status(err.status).json(err.body);
  }
  const joined = router.joinCollaboration(req.params.session_id, agent_id);
  if (!joined) {
    const err = apiError('NOT_FOUND', 'Collaboration session not found');
    return res.status(err.status).json(err.body);
  }
  res.json({ success: true, session_id: req.params.session_id, agent_id });
});

app.post('/collab/:session_id/invoke', async (req: Request, res: Response) => {
  const { agent_id, capability_id, inputs } = req.body;
  if (!agent_id || !capability_id) {
    const err = apiError('VALIDATION_ERROR', 'agent_id and capability_id required');
    return res.status(err.status).json(err.body);
  }
  const result = await router.collaborativeInvoke(req.params.session_id, agent_id, { capability_id, inputs: inputs || {} });
  res.json(result);
});

app.get('/collab/:session_id', (req: Request, res: Response) => {
  const session = router.getCollaboration(req.params.session_id);
  if (!session) {
    const err = apiError('NOT_FOUND', 'Collaboration session not found');
    return res.status(err.status).json(err.body);
  }
  res.json({ success: true, ...session });
});

app.put('/collab/:session_id/context', (req: Request, res: Response) => {
  const updated = router.updateCollaborationContext(req.params.session_id, req.body);
  if (!updated) {
    const err = apiError('NOT_FOUND', 'Collaboration session not found');
    return res.status(err.status).json(err.body);
  }
  res.json({ success: true });
});

// Capability versioning with auto-migration
app.get('/migrate/:capability_id', (req: Request, res: Response) => {
  const hint = router.getMigrationHint(req.params.capability_id);
  res.json({ success: true, capability_id: req.params.capability_id, migration: hint });
});

app.post('/migrate/invoke', async (req: Request, res: Response) => {
  const v = validate<{ capability_id: string; inputs?: any }>(req.body, ['capability_id']);
  if (!v.valid) {
    const err = apiError('VALIDATION_ERROR', 'Missing required fields', { missing: v.missing });
    return res.status(err.status).json(err.body);
  }
  try {
    const result = await router.invokeWithMigration({ capability_id: v.data.capability_id, inputs: v.data.inputs || {} });
    res.json(result);
  } catch (error) {
    const err = apiError('INTERNAL_ERROR', error instanceof Error ? error.message : 'Migration invoke failed');
    res.status(err.status).json(err.body);
  }
});

// Innovation stats dashboard
app.get('/system/innovations', (req: Request, res: Response) => {
  res.json({ success: true, ...router.getInnovationStats() });
});

// Capability health scores (router-level)
app.get('/health/scores', (req: Request, res: Response) => {
  res.json({ success: true, scores: router.getAllHealthScores() });
});

app.get('/health/score/:id', (req: Request, res: Response) => {
  const score = router.getHealthScore(req.params.id);
  res.json({ success: true, capability_id: req.params.id, score });
});

// Batch price lookup - efficient multi-token pricing
app.post('/batch/prices', async (req: Request, res: Response) => {
  const { tokens, quote } = req.body;
  if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
    const err = apiError('VALIDATION_ERROR', 'tokens array required');
    return res.status(err.status).json(err.body);
  }
  if (tokens.length > 20) {
    const err = apiError('VALIDATION_ERROR', 'Maximum 20 tokens per batch');
    return res.status(err.status).json(err.body);
  }
  try {
    const results = await integrationManager.getBatchPrices(tokens, quote || 'USD');
    const prices: Record<string, any> = {};
    results.forEach((v, k) => prices[k] = v);
    res.json({ success: true, prices, count: results.size });
  } catch (error) {
    const err = apiError('INTERNAL_ERROR', error instanceof Error ? error.message : 'Batch prices failed');
    res.status(err.status).json(err.body);
  }
});

// ============================================
// DEVELOPER & ORGANIZATION FEATURES
// ============================================

// Capability aliases - use short names
app.get('/aliases', (req: Request, res: Response) => {
  res.json({ success: true, aliases: router.getAliases() });
});

app.post('/aliases', (req: Request, res: Response) => {
  const { alias, capability_id } = req.body;
  if (!alias || !capability_id) {
    const err = apiError('VALIDATION_ERROR', 'alias and capability_id required');
    return res.status(err.status).json(err.body);
  }
  router.addAlias(alias, capability_id);
  res.json({ success: true, alias, capability_id });
});

// Webhooks - get notified of events
app.get('/webhooks', (req: Request, res: Response) => {
  res.json({ success: true, webhooks: router.getWebhooks() });
});

app.post('/webhooks', (req: Request, res: Response) => {
  const { id, url, events, secret } = req.body;
  if (!id || !url || !events) {
    const err = apiError('VALIDATION_ERROR', 'id, url, and events required');
    return res.status(err.status).json(err.body);
  }
  router.registerWebhook(id, url, events, secret);
  res.json({ success: true, id, url, events: events });
});

app.delete('/webhooks/:id', (req: Request, res: Response) => {
  const removed = router.removeWebhook(req.params.id);
  res.json({ success: removed });
});

// Budget tracking for organizations
app.post('/budgets', (req: Request, res: Response) => {
  const { org_id, limit, period } = req.body;
  if (!org_id || !limit) {
    const err = apiError('VALIDATION_ERROR', 'org_id and limit required');
    return res.status(err.status).json(err.body);
  }
  router.setBudget(org_id, limit, period || 'daily');
  res.json({ success: true, org_id, limit, period: period || 'daily' });
});

app.get('/budgets/:org_id', (req: Request, res: Response) => {
  const budget = router.getBudget(req.params.org_id);
  res.json({ success: true, org_id: req.params.org_id, budget });
});

app.get('/budgets/:org_id/check', (req: Request, res: Response) => {
  const cost = parseFloat(req.query.cost as string) || 0;
  const check = router.checkBudget(req.params.org_id, cost);
  res.json({ success: true, ...check });
});

// Request replay for debugging
app.get('/debug/requests', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 20;
  res.json({ success: true, requests: router.getRequestLog(limit) });
});

app.post('/debug/replay/:request_id', async (req: Request, res: Response) => {
  const result = await router.replayRequest(req.params.request_id);
  if (!result) {
    const err = apiError('NOT_FOUND', 'Request not found in log');
    return res.status(err.status).json(err.body);
  }
  res.json({ success: true, replayed: true, result });
});

// ============================================
// AGENT SESSIONS - Persistent context
// ============================================

app.post('/sessions', (req: Request, res: Response) => {
  const { agent_id, context } = req.body;
  if (!agent_id) {
    const err = apiError('VALIDATION_ERROR', 'agent_id required');
    return res.status(err.status).json(err.body);
  }
  const sessionId = router.createSession(agent_id, context);
  res.json({ success: true, session_id: sessionId, agent_id });
});

app.get('/sessions/:session_id', (req: Request, res: Response) => {
  const session = router.getSession(req.params.session_id);
  if (!session) {
    const err = apiError('NOT_FOUND', 'Session not found');
    return res.status(err.status).json(err.body);
  }
  res.json({ success: true, ...session });
});

app.put('/sessions/:session_id/context', (req: Request, res: Response) => {
  const updated = router.updateSessionContext(req.params.session_id, req.body);
  if (!updated) {
    const err = apiError('NOT_FOUND', 'Session not found');
    return res.status(err.status).json(err.body);
  }
  res.json({ success: true });
});

app.post('/sessions/:session_id/invoke', async (req: Request, res: Response) => {
  const { capability_id, inputs } = req.body;
  if (!capability_id) {
    const err = apiError('VALIDATION_ERROR', 'capability_id required');
    return res.status(err.status).json(err.body);
  }
  const result = await router.sessionInvoke(req.params.session_id, { capability_id, inputs: inputs || {} });
  res.json(result);
});

// ============================================
// MARKETPLACE - Community ratings & discovery
// ============================================

app.post('/marketplace/list', (req: Request, res: Response) => {
  const { capability_id, provider } = req.body;
  if (!capability_id || !provider) {
    const err = apiError('VALIDATION_ERROR', 'capability_id and provider required');
    return res.status(err.status).json(err.body);
  }
  router.listCapability(capability_id, provider);
  res.json({ success: true, listed: capability_id });
});

app.post('/marketplace/rate', (req: Request, res: Response) => {
  const { capability_id, agent_id, rating, comment } = req.body;
  if (!capability_id || !agent_id || !rating) {
    const err = apiError('VALIDATION_ERROR', 'capability_id, agent_id, and rating required');
    return res.status(err.status).json(err.body);
  }
  const success = router.rateCapability(capability_id, agent_id, rating, comment);
  res.json({ success });
});

app.get('/marketplace/:capability_id', (req: Request, res: Response) => {
  const listing = router.getMarketplaceListing(req.params.capability_id);
  res.json({ success: true, listing });
});

app.get('/marketplace', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 10;
  res.json({ success: true, top_rated: router.getTopRated(limit) });
});

// ============================================
// INTENT-BASED DISCOVERY - Natural language
// ============================================

app.get('/discover', (req: Request, res: Response) => {
  const query = req.query.q as string;
  if (!query) {
    const err = apiError('VALIDATION_ERROR', 'q (query) parameter required');
    return res.status(err.status).json(err.body);
  }
  const results = router.discoverByIntent(query);
  res.json({ success: true, query, matches: results });
});

app.post('/discover/intent', (req: Request, res: Response) => {
  const { intent, capabilities } = req.body;
  if (!intent || !capabilities) {
    const err = apiError('VALIDATION_ERROR', 'intent and capabilities required');
    return res.status(err.status).json(err.body);
  }
  router.addIntent(intent, capabilities);
  res.json({ success: true, intent, capabilities });
});

// ============================================
// PIPELINES - Pre-built capability chains
// ============================================

app.get('/pipelines', (req: Request, res: Response) => {
  res.json({ success: true, pipelines: router.listPipelines() });
});

app.get('/pipelines/:id', (req: Request, res: Response) => {
  const pipeline = router.getPipeline(req.params.id);
  if (!pipeline) {
    const err = apiError('NOT_FOUND', 'Pipeline not found');
    return res.status(err.status).json(err.body);
  }
  res.json({ success: true, ...pipeline });
});

app.post('/pipelines', (req: Request, res: Response) => {
  const { id, name, steps, description } = req.body;
  if (!id || !name || !steps) {
    const err = apiError('VALIDATION_ERROR', 'id, name, and steps required');
    return res.status(err.status).json(err.body);
  }
  router.addPipeline(id, name, steps, description || '');
  res.json({ success: true, id });
});

app.post('/pipelines/:id/execute', async (req: Request, res: Response) => {
  const result = await router.executePipeline(req.params.id, req.body);
  res.json(result);
});

// ============================================
// PROVIDER STATS - Load balancing insights
// ============================================

app.get('/providers/stats', (req: Request, res: Response) => {
  res.json({ success: true, providers: router.getProviderStats() });
});

// ============================================
// AGENT LEARNING & PROFILES
// ============================================

app.get('/agents/:agent_id/profile', (req: Request, res: Response) => {
  const profile = router.getAgentProfile(req.params.agent_id);
  res.json({ success: true, profile });
});

app.post('/agents/:agent_id/tags', (req: Request, res: Response) => {
  const { tags } = req.body;
  if (!tags || !Array.isArray(tags)) {
    const err = apiError('VALIDATION_ERROR', 'tags array required');
    return res.status(err.status).json(err.body);
  }
  router.tagAgent(req.params.agent_id, tags);
  res.json({ success: true });
});

app.get('/agents/:agent_id/recommendations', (req: Request, res: Response) => {
  const recommendations = router.getAgentRecommendations(req.params.agent_id);
  res.json({ success: true, recommendations });
});

// ============================================
// DRY-RUN / SIMULATION
// ============================================

app.post('/simulate', async (req: Request, res: Response) => {
  const { capability_id, inputs } = req.body;
  if (!capability_id) {
    const err = apiError('VALIDATION_ERROR', 'capability_id required');
    return res.status(err.status).json(err.body);
  }
  const result = await router.simulate({ capability_id, inputs: inputs || {} });
  res.json({ success: true, simulation: result });
});

// ============================================
// AGENT-TO-AGENT MESSAGING
// ============================================

app.post('/messages', (req: Request, res: Response) => {
  const { from, to, type, payload } = req.body;
  if (!from || !to || !type) {
    const err = apiError('VALIDATION_ERROR', 'from, to, and type required');
    return res.status(err.status).json(err.body);
  }
  const msgId = router.sendMessage(from, to, type, payload || {});
  res.json({ success: true, message_id: msgId });
});

app.get('/messages/:agent_id', (req: Request, res: Response) => {
  const unreadOnly = req.query.unread === 'true';
  const messages = router.getMessages(req.params.agent_id, unreadOnly);
  res.json({ success: true, messages, count: messages.length });
});

// ============================================
// COST PREDICTION
// ============================================

app.get('/predict/cost/:capability_id', (req: Request, res: Response) => {
  const prediction = router.predictCost(req.params.capability_id);
  res.json({ success: true, capability_id: req.params.capability_id, prediction });
});

// ============================================
// SDK CODE GENERATION
// ============================================

app.get('/sdk/:capability_id', (req: Request, res: Response) => {
  const language = (req.query.lang as 'typescript' | 'python' | 'curl') || 'typescript';
  const snippet = router.generateSDKSnippet(req.params.capability_id, language);
  res.json({ success: true, language, snippet });
});

app.get('/sdk/:capability_id/raw', (req: Request, res: Response) => {
  const language = (req.query.lang as 'typescript' | 'python' | 'curl') || 'curl';
  const snippet = router.generateSDKSnippet(req.params.capability_id, language);
  res.type('text/plain').send(snippet);
});

// ============================================
// POLICY ENGINE - Intent Safety & Compliance
// ============================================

app.post('/policies', (req: Request, res: Response) => {
  const { agent_id, policy } = req.body;
  if (!agent_id || !policy) {
    const err = apiError('VALIDATION_ERROR', 'agent_id and policy required');
    return res.status(err.status).json(err.body);
  }
  router.registerPolicy(agent_id, policy);
  res.json({ success: true, agent_id, policy });
});

app.get('/policies/:agent_id', (req: Request, res: Response) => {
  const policy = router.getPolicy(req.params.agent_id);
  res.json({ success: true, agent_id: req.params.agent_id, policy });
});

app.post('/policies/validate', (req: Request, res: Response) => {
  const { agent_id, request } = req.body;
  if (!agent_id) {
    const err = apiError('VALIDATION_ERROR', 'agent_id required');
    return res.status(err.status).json(err.body);
  }
  const validation = router.validateAgainstPolicy(agent_id, request || {});
  res.json({ success: true, validation });
});

// ============================================
// AGENT-TO-AGENT NEGOTIATION
// ============================================

app.post('/negotiations', (req: Request, res: Response) => {
  const { initiator, counterparty, proposal } = req.body;
  if (!initiator || !counterparty || !proposal) {
    const err = apiError('VALIDATION_ERROR', 'initiator, counterparty, and proposal required');
    return res.status(err.status).json(err.body);
  }
  const negId = router.initiateNegotiation(initiator, counterparty, proposal);
  res.json({ success: true, negotiation_id: negId });
});

app.get('/negotiations/:neg_id', (req: Request, res: Response) => {
  const negotiation = router.getNegotiation(req.params.neg_id);
  if (!negotiation) {
    const err = apiError('NOT_FOUND', 'Negotiation not found');
    return res.status(err.status).json(err.body);
  }
  res.json({ success: true, negotiation });
});

app.post('/negotiations/:neg_id/respond', (req: Request, res: Response) => {
  const { agent_id, response, counter_proposal } = req.body;
  if (!agent_id || !response) {
    const err = apiError('VALIDATION_ERROR', 'agent_id and response required');
    return res.status(err.status).json(err.body);
  }
  const result = router.respondToNegotiation(req.params.neg_id, agent_id, response, counter_proposal);
  res.json(result);
});

app.get('/negotiations/agent/:agent_id', (req: Request, res: Response) => {
  const negotiations = router.getAgentNegotiations(req.params.agent_id);
  res.json({ success: true, negotiations, count: negotiations.length });
});

// ============================================
// POLICY-COMPLIANT EXECUTION
// ============================================

app.post('/execute', async (req: Request, res: Response) => {
  const { agent_id, capability_type, inputs, policy, counterparty, fallbacks } = req.body;
  if (!agent_id || !capability_type) {
    const err = apiError('VALIDATION_ERROR', 'agent_id and capability_type required');
    return res.status(err.status).json(err.body);
  }
  const result = await router.executeWithPolicy({
    agent_id,
    capability_type,
    inputs: inputs || {},
    policy,
    counterparty,
    fallbacks
  });
  res.json(result);
});

// ============================================
// PLUGIN ARCHITECTURE
// ============================================

app.get('/plugins', (req: Request, res: Response) => {
  res.json({ success: true, plugins: router.listPlugins() });
});

app.get('/plugins/:id', (req: Request, res: Response) => {
  const plugin = router.getPlugin(req.params.id);
  if (!plugin) {
    const err = apiError('NOT_FOUND', 'Plugin not found');
    return res.status(err.status).json(err.body);
  }
  res.json({ success: true, plugin });
});

app.post('/plugins', (req: Request, res: Response) => {
  const { id, name, type, config } = req.body;
  if (!id || !name || !type) {
    const err = apiError('VALIDATION_ERROR', 'id, name, and type required');
    return res.status(err.status).json(err.body);
  }
  router.registerPlugin({ id, name, type, enabled: true, config: config || {} });
  res.json({ success: true, id });
});

app.put('/plugins/:id/enable', (req: Request, res: Response) => {
  const { enabled } = req.body;
  const success = router.enablePlugin(req.params.id, enabled !== false);
  res.json({ success });
});

// ============================================
// CONSTRAINT ENFORCEMENT
// ============================================

app.post('/constraints', (req: Request, res: Response) => {
  const { agent_id, constraints } = req.body;
  if (!agent_id || !constraints) {
    const err = apiError('VALIDATION_ERROR', 'agent_id and constraints required');
    return res.status(err.status).json(err.body);
  }
  router.setConstraints(agent_id, constraints);
  res.json({ success: true, agent_id, constraints_count: constraints.length });
});

app.get('/constraints/:agent_id', (req: Request, res: Response) => {
  const constraints = router.getConstraints(req.params.agent_id);
  res.json({ success: true, agent_id: req.params.agent_id, constraints });
});

app.post('/constraints/enforce', (req: Request, res: Response) => {
  const { agent_id, action } = req.body;
  if (!agent_id || !action) {
    const err = apiError('VALIDATION_ERROR', 'agent_id and action required');
    return res.status(err.status).json(err.body);
  }
  const result = router.enforceConstraints(agent_id, action);
  res.json({ success: true, result });
});

// ============================================
// PERFORMANCE OPTIMIZATION ENDPOINTS
// ============================================

app.get('/performance', (req: Request, res: Response) => {
  res.json({ success: true, stats: router.getPerformanceStats() });
});

app.get('/performance/memory', (req: Request, res: Response) => {
  const pressure = router.checkMemoryPressure();
  const mem = process.memoryUsage();
  res.json({
    success: true,
    pressure,
    heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
    heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
    external_mb: Math.round(mem.external / 1024 / 1024),
    rss_mb: Math.round(mem.rss / 1024 / 1024)
  });
});

app.get('/performance/affinity/:agent_id', (req: Request, res: Response) => {
  const affinity = router.getAgentAffinity(req.params.agent_id);
  res.json({ success: true, agent_id: req.params.agent_id, affinity });
});

app.get('/performance/ttl/:capability_id', (req: Request, res: Response) => {
  const ttl = router.getOptimalTTL(req.params.capability_id);
  res.json({ success: true, capability_id: req.params.capability_id, optimal_ttl_ms: ttl });
});

// ============================================
// CIRCUIT BREAKER STATUS
// ============================================

app.get('/circuit-breakers', (req: Request, res: Response) => {
  res.json({ success: true, circuit_breakers: router.getAllCircuitBreakers() });
});

app.get('/circuit-breakers/:capability_id', (req: Request, res: Response) => {
  const status = router.getCircuitBreakerStatus(req.params.capability_id);
  res.json({ success: true, capability_id: req.params.capability_id, ...status });
});

// ============================================
// COMPOSITION OPTIMIZER
// ============================================

app.post('/optimize/composition', (req: Request, res: Response) => {
  const { steps } = req.body;
  if (!steps || !Array.isArray(steps)) {
    const err = apiError('VALIDATION_ERROR', 'steps array required');
    return res.status(err.status).json(err.body);
  }
  const result = router.optimizeComposition(steps);
  res.json({ success: true, ...result });
});

// ============================================
// AGENT REPUTATION
// ============================================

app.get('/reputation/:agent_id', (req: Request, res: Response) => {
  const rep = router.getReputation(req.params.agent_id);
  res.json({ success: true, agent_id: req.params.agent_id, reputation: rep });
});

app.post('/reputation/:agent_id', (req: Request, res: Response) => {
  const { success, weight } = req.body;
  router.updateReputation(req.params.agent_id, success !== false, weight || 1);
  const rep = router.getReputation(req.params.agent_id);
  res.json({ success: true, agent_id: req.params.agent_id, reputation: rep });
});

app.get('/reputation', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 10;
  res.json({ success: true, top_agents: router.getTopAgents(limit) });
});

// ============================================
// AGENT RATE LIMITS
// ============================================

app.get('/rate-limit/:agent_id', (req: Request, res: Response) => {
  const status = router.checkAgentRateLimit(req.params.agent_id);
  res.json({ success: true, agent_id: req.params.agent_id, ...status });
});

// ============================================
// HEALTH TRENDS
// ============================================

app.get('/health-trend/:capability_id', (req: Request, res: Response) => {
  const trend = router.getHealthTrend(req.params.capability_id);
  res.json({ success: true, capability_id: req.params.capability_id, trend });
});

// ============================================
// PROVIDER HEALTH - Status of all providers
// ============================================

app.get('/health/providers', async (req: Request, res: Response) => {
  try {
    const { swapProvider } = await import('../providers/swap');
    const { incoFHEProvider } = await import('../providers/inco-fhe');
    const { arciumCSPLProvider } = await import('../providers/arcium-cspl');
    const { priceProvider } = await import('../providers/price');
    const { heliusDASProvider } = await import('../providers/helius-das');
    const { noirCircuitsProvider } = await import('../providers/noir-circuits');
    
    const providers = {
      swap: swapProvider.getStatus(),
      inco_fhe: incoFHEProvider.getStatus(),
      arcium_cspl: arciumCSPLProvider.getStatus(),
      price: priceProvider.getStats(),
      helius_das: heliusDASProvider.getStats(),
      noir_circuits: noirCircuitsProvider.getStats()
    };
    
    res.json({
      success: true,
      providers,
      timestamp: Date.now()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get provider status'
    });
  }
});

// ============================================
// COLLABORATION SCORING
// ============================================

app.post('/collaboration', (req: Request, res: Response) => {
  const { agent1, agent2, success } = req.body;
  if (!agent1 || !agent2) {
    const err = apiError('VALIDATION_ERROR', 'agent1 and agent2 required');
    return res.status(err.status).json(err.body);
  }
  router.recordCollaboration(agent1, agent2, success !== false);
  res.json({ success: true });
});

app.get('/collaboration/:agent_id/best', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 5;
  const collaborators = router.getBestCollaborators(req.params.agent_id, limit);
  res.json({ success: true, agent_id: req.params.agent_id, best_collaborators: collaborators });
});

// ============================================
// INTENT BROADCASTING - Agents announce needs
// ============================================

app.post('/intents', (req: Request, res: Response) => {
  const { agent_id, type, description, requirements, max_cost, ttl_minutes } = req.body;
  if (!agent_id || !type || !description) {
    const err = apiError('VALIDATION_ERROR', 'agent_id, type, and description required');
    return res.status(err.status).json(err.body);
  }
  const intentId = router.broadcastIntent(agent_id, { type, description, requirements, max_cost, ttl_minutes });
  res.json({ success: true, intent_id: intentId });
});

app.get('/intents', (req: Request, res: Response) => {
  const type = req.query.type as string;
  const max_cost = req.query.max_cost ? parseFloat(req.query.max_cost as string) : undefined;
  const intents = router.getOpenIntents({ type, max_cost });
  res.json({ success: true, intents, count: intents.length });
});

app.get('/intents/:intent_id', (req: Request, res: Response) => {
  const intent = router.getIntent(req.params.intent_id);
  res.json({ success: true, intent });
});

app.post('/intents/:intent_id/respond', (req: Request, res: Response) => {
  const { responder_id, offer } = req.body;
  if (!responder_id) {
    const err = apiError('VALIDATION_ERROR', 'responder_id required');
    return res.status(err.status).json(err.body);
  }
  const success = router.respondToIntent(req.params.intent_id, responder_id, offer || {});
  res.json({ success });
});

app.post('/intents/:intent_id/accept', (req: Request, res: Response) => {
  const { responder_id } = req.body;
  if (!responder_id) {
    const err = apiError('VALIDATION_ERROR', 'responder_id required');
    return res.status(err.status).json(err.body);
  }
  const success = router.acceptIntentResponse(req.params.intent_id, responder_id);
  res.json({ success });
});

// ============================================
// ESCROW - Trustless execution
// ============================================

app.post('/escrow', (req: Request, res: Response) => {
  const { initiator, counterparty, terms } = req.body;
  if (!initiator || !counterparty || !terms) {
    const err = apiError('VALIDATION_ERROR', 'initiator, counterparty, and terms required');
    return res.status(err.status).json(err.body);
  }
  const escrowId = router.createEscrow(initiator, counterparty, terms);
  res.json({ success: true, escrow_id: escrowId });
});

app.get('/escrow/:escrow_id', (req: Request, res: Response) => {
  const escrow = router.getEscrow(req.params.escrow_id);
  res.json({ success: true, escrow });
});

app.post('/escrow/:escrow_id/confirm', (req: Request, res: Response) => {
  const { agent_id } = req.body;
  if (!agent_id) {
    const err = apiError('VALIDATION_ERROR', 'agent_id required');
    return res.status(err.status).json(err.body);
  }
  const result = router.confirmEscrow(req.params.escrow_id, agent_id);
  res.json({ success: true, ...result });
});

app.post('/escrow/:escrow_id/dispute', (req: Request, res: Response) => {
  const { agent_id, reason } = req.body;
  if (!agent_id || !reason) {
    const err = apiError('VALIDATION_ERROR', 'agent_id and reason required');
    return res.status(err.status).json(err.body);
  }
  const success = router.disputeEscrow(req.params.escrow_id, agent_id, reason);
  res.json({ success });
});

// ============================================
// AGENT DISCOVERY
// ============================================

app.post('/agents/capabilities', (req: Request, res: Response) => {
  const { agent_id, capabilities, tags } = req.body;
  if (!agent_id || !capabilities) {
    const err = apiError('VALIDATION_ERROR', 'agent_id and capabilities required');
    return res.status(err.status).json(err.body);
  }
  router.registerAgentCapabilities(agent_id, capabilities, tags || []);
  res.json({ success: true, agent_id });
});

app.put('/agents/:agent_id/availability', (req: Request, res: Response) => {
  const { available } = req.body;
  router.setAgentAvailability(req.params.agent_id, available !== false);
  res.json({ success: true });
});

app.get('/agents/discover', (req: Request, res: Response) => {
  const capability = req.query.capability as string;
  const tag = req.query.tag as string;
  const min_reputation = req.query.min_reputation ? parseInt(req.query.min_reputation as string) : undefined;
  const agents = router.discoverAgents({ capability, tag, min_reputation });
  res.json({ success: true, agents, count: agents.length });
});

// ============================================
// MULTI-PARTY TRANSACTIONS
// ============================================

app.post('/multi-party', (req: Request, res: Response) => {
  const { initiator, participants, workflow } = req.body;
  if (!initiator || !participants || !workflow) {
    const err = apiError('VALIDATION_ERROR', 'initiator, participants, and workflow required');
    return res.status(err.status).json(err.body);
  }
  const txId = router.createMultiPartyTransaction(initiator, participants, workflow);
  res.json({ success: true, tx_id: txId });
});

app.get('/multi-party/:tx_id', (req: Request, res: Response) => {
  const tx = router.getMultiPartyTransaction(req.params.tx_id);
  res.json({ success: true, transaction: tx });
});

app.post('/multi-party/:tx_id/confirm', (req: Request, res: Response) => {
  const { agent_id } = req.body;
  if (!agent_id) {
    const err = apiError('VALIDATION_ERROR', 'agent_id required');
    return res.status(err.status).json(err.body);
  }
  const result = router.confirmMultiPartyTransaction(req.params.tx_id, agent_id);
  res.json({ success: true, ...result });
});

// ============================================
// SLA AGREEMENTS
// ============================================

app.post('/sla', (req: Request, res: Response) => {
  const { provider, consumer, terms } = req.body;
  if (!provider || !consumer || !terms) {
    const err = apiError('VALIDATION_ERROR', 'provider, consumer, and terms required');
    return res.status(err.status).json(err.body);
  }
  const slaId = router.createSLA(provider, consumer, terms);
  res.json({ success: true, sla_id: slaId });
});

app.get('/sla/:sla_id', (req: Request, res: Response) => {
  const sla = router.getSLA(req.params.sla_id);
  res.json({ success: true, sla });
});

app.post('/sla/:sla_id/record', (req: Request, res: Response) => {
  const { success, latency_ms } = req.body;
  const violation = router.recordSLAMetric(req.params.sla_id, success !== false, latency_ms || 0);
  res.json({ success: true, violation });
});

app.get('/sla/agent/:agent_id', (req: Request, res: Response) => {
  const slas = router.getAgentSLAs(req.params.agent_id);
  res.json({ success: true, slas, count: slas.length });
});

// ============================================
// SUBSCRIPTIONS
// ============================================

app.post('/subscriptions', (req: Request, res: Response) => {
  const { agent_id, topic, filter } = req.body;
  if (!agent_id || !topic) {
    const err = apiError('VALIDATION_ERROR', 'agent_id and topic required');
    return res.status(err.status).json(err.body);
  }
  const subId = router.subscribe(agent_id, topic, filter);
  res.json({ success: true, subscription_id: subId });
});

app.delete('/subscriptions/:agent_id/:sub_id', (req: Request, res: Response) => {
  const success = router.unsubscribe(req.params.agent_id, req.params.sub_id);
  res.json({ success });
});

app.get('/subscriptions/:agent_id', (req: Request, res: Response) => {
  const subs = router.getSubscriptions(req.params.agent_id);
  res.json({ success: true, subscriptions: subs, count: subs.length });
});

app.post('/publish', (req: Request, res: Response) => {
  const { topic, event } = req.body;
  if (!topic || !event) {
    const err = apiError('VALIDATION_ERROR', 'topic and event required');
    return res.status(err.status).json(err.body);
  }
  const notified = router.publish(topic, event);
  res.json({ success: true, notified });
});

// ============================================
// WORKFLOW ORCHESTRATION
// ============================================

app.post('/workflows', (req: Request, res: Response) => {
  const { id, name, description, steps } = req.body;
  if (!id || !name || !steps) {
    const err = apiError('VALIDATION_ERROR', 'id, name, and steps required');
    return res.status(err.status).json(err.body);
  }
  router.defineWorkflow(id, { name, description, steps });
  res.json({ success: true, workflow_id: id });
});

app.get('/workflows', (req: Request, res: Response) => {
  res.json({ success: true, workflows: router.listWorkflows() });
});

app.get('/workflows/:id', (req: Request, res: Response) => {
  const workflow = router.getWorkflow(req.params.id);
  res.json({ success: true, workflow });
});

app.post('/workflows/:id/execute', async (req: Request, res: Response) => {
  const { agent_id, inputs } = req.body;
  if (!agent_id) {
    const err = apiError('VALIDATION_ERROR', 'agent_id required');
    return res.status(err.status).json(err.body);
  }
  const result = await router.executeWorkflow(req.params.id, agent_id, inputs || {});
  res.json(result);
});

// ============================================
// CAPABILITY VERSIONING
// ============================================

app.get('/capabilities/:id/versions', (req: Request, res: Response) => {
  const versions = router.getCapabilityVersions(req.params.id);
  res.json({ success: true, capability_id: req.params.id, versions });
});

app.get('/capabilities/:id/deprecation', (req: Request, res: Response) => {
  const status = router.checkDeprecation(req.params.id);
  res.json({ success: true, capability_id: req.params.id, ...status });
});

// ============================================
// AGENT ANALYTICS & SYSTEM STATS
// ============================================

app.get('/analytics/agent/:agent_id', (req: Request, res: Response) => {
  const analytics = router.getAgentAnalytics(req.params.agent_id);
  res.json({ success: true, analytics });
});

app.get('/system/stats', (req: Request, res: Response) => {
  res.json({ success: true, stats: router.getSystemStats() });
});

// Maintenance endpoint - trigger cleanup
app.post('/system/maintenance', (req: Request, res: Response) => {
  const result = router.performMaintenance();
  res.json({ success: true, ...result });
});

// ============================================
// DISTRIBUTED TRACING
// ============================================

app.post('/trace/start', (req: Request, res: Response) => {
  const traceId = router.startDistributedTrace(req.body.trace_id);
  res.json({ success: true, trace_id: traceId });
});

app.get('/trace/:trace_id', (req: Request, res: Response) => {
  const trace = router.getDistributedTrace(req.params.trace_id);
  res.json({ success: true, trace });
});

app.post('/invoke/traced', async (req: Request, res: Response) => {
  const { capability_id, inputs, trace_id } = req.body;
  const result = await router.tracedInvoke({ capability_id, inputs }, trace_id);
  res.json(result);
});

// ============================================
// DEPENDENCY RESOLUTION
// ============================================

app.get('/capabilities/:id/dependencies', (req: Request, res: Response) => {
  const deps = router.getDependencies(req.params.id);
  res.json({ success: true, capability_id: req.params.id, dependencies: deps });
});

app.post('/invoke/with-dependencies', async (req: Request, res: Response) => {
  const { capability_id, inputs } = req.body;
  const result = await router.invokeWithDependencies({ capability_id, inputs });
  res.json({ success: true, ...result });
});

// ============================================
// FAILOVER
// ============================================

app.post('/invoke/with-failover', async (req: Request, res: Response) => {
  const { capability_id, inputs, preferred_provider } = req.body;
  const result = await router.invokeWithFailover({ capability_id, inputs }, preferred_provider);
  res.json(result);
});

// ============================================
// SMART BATCHING
// ============================================

app.post('/invoke/smart-batch', async (req: Request, res: Response) => {
  const { requests } = req.body;
  if (!requests || !Array.isArray(requests)) {
    const err = apiError('VALIDATION_ERROR', 'requests array required');
    return res.status(err.status).json(err.body);
  }
  const results = await router.smartBatch(requests);
  res.json({ success: true, results, count: results.length });
});

// ============================================
// REQUEST LOG & REPLAY
// ============================================

app.get('/debug/request-log', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 20;
  const log = router.getRequestLog(limit);
  res.json({ success: true, log, count: log.length });
});

app.post('/debug/replay-failed', async (req: Request, res: Response) => {
  const result = await router.replayLastFailedRequest();
  res.json({ success: result !== null, result });
});

// Batch invoke - group multiple requests
app.post('/batch/invoke', async (req: Request, res: Response) => {
  const { requests } = req.body;
  if (!requests || !Array.isArray(requests)) {
    const err = apiError('VALIDATION_ERROR', 'requests array required');
    return res.status(err.status).json(err.body);
  }
  if (requests.length > 10) {
    const err = apiError('VALIDATION_ERROR', 'Maximum 10 requests per batch');
    return res.status(err.status).json(err.body);
  }
  
  const results = await Promise.allSettled(
    requests.map((r: any) => router.invoke({ capability_id: r.capability_id, inputs: r.inputs || {} }))
  );
  
  res.json({
    success: true,
    results: results.map((r, i) => ({
      index: i,
      success: r.status === 'fulfilled' && r.value.success,
      data: r.status === 'fulfilled' ? r.value : { error: 'Failed' }
    })),
    total: requests.length,
    succeeded: results.filter(r => r.status === 'fulfilled' && (r.value as any).success).length
  });
});

// Comprehensive system health with adaptive load factor
app.get('/system/health', async (req: Request, res: Response) => {
  try {
    const { memoryManager } = require('./memory-manager');
    const { getRequestMetrics } = require('./middleware/request-context');
    const { metricsCollector } = require('./metrics');
    
    const memStats = memoryManager.getStats();
    const cacheStats = responseCache.getStats();
    const requestMetrics = getRequestMetrics();
    const summary = metricsCollector.summary();
    
    // Update adaptive rate limiting based on current load
    rateLimiter.updateLoadFactor(memStats.usage_percent, summary.avg_latency);
    
    const health = {
      status: memoryManager.isUnderPressure() ? 'degraded' : 'healthy',
      uptime_seconds: Math.floor(process.uptime()),
      load_factor: rateLimiter.getLoadFactor(),
      memory: {
        heap_used_mb: memStats.heap_used_mb,
        heap_total_mb: memStats.heap_total_mb,
        usage_percent: memStats.usage_percent
      },
      cache: {
        size: cacheStats.size,
        hit_rate_percent: cacheStats.hit_rate_percent
      },
      requests: requestMetrics,
      performance: { avg_latency_ms: summary.avg_latency, success_rate: summary.success_rate },
      collections: memStats.collections
    };
    
    res.json({ success: true, ...health });
  } catch (error) {
    const err = apiError('INTERNAL_ERROR', error instanceof Error ? error.message : 'Health check failed');
    res.status(err.status).json(err.body);
  }
});

// Error handler middleware (must be last)
app.use(errorHandler);

// Graceful shutdown with cleanup
let server: any;

async function gracefulShutdown(signal: string) {
  console.log(`\n🛑 ${signal} received, shutting down gracefully...`);
  
  // Stop accepting new connections
  if (server) {
    server.close(() => {
      console.log('   HTTP server closed');
    });
  }
  
  // Cleanup resources
  try {
    rateLimiter.destroy();
    console.log('   Rate limiter cleaned up');
    
    capabilityTokenManager.destroy();
    console.log('   Token manager cleaned up');
    
    const { agentRateLimiter } = await import('./agent-rate-limiter');
    agentRateLimiter.destroy();
    console.log('   Agent rate limiter cleaned up');
    
    const { responseCache } = await import('./cache');
    responseCache.destroy();
    console.log('   Response cache cleaned up');
  } catch (e) {
    // Ignore cleanup errors
  }
  
  console.log('✅ Graceful shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

if (require.main === module) {
  startServerLegacy();
}
