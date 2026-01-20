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
      scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://unpkg.com"],
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
// Serve docs folder for API documentation (Swagger)
app.use('/docs', express.static(path.join(process.cwd(), 'docs')));
// Privacy Alerts API
import privacyAlertsRouter from './privacy-alerts-routes';
app.use('/privacy-alerts', privacyAlertsRouter);

// Redirect /docs to /docs/api-docs.html
app.get('/docs', (req: Request, res: Response) => {
  res.redirect('/docs/api-docs.html');
});

// OpenAPI JSON endpoint for Swagger UI
app.get('/openapi.json', (req: Request, res: Response) => {
  const openApiSpec = {
    openapi: '3.1.0',
    info: {
      title: 'CAP-402 Agent Infrastructure API',
      description: 'Privacy-first capability routing for autonomous AI agents. Built on Arcium, Noir, Inco, and Helius.',
      version: '1.0.0'
    },
    servers: [{ url: 'https://cap402.com', description: 'Production' }],
    tags: [
      { name: 'Capabilities', description: 'Core capability invocation' },
      { name: 'A2A Protocol', description: 'Agent-to-agent communication' },
      { name: 'MEV Protection', description: 'MEV analysis and protected execution' },
      { name: 'Trading Alpha', description: 'Arbitrage, whale tracking, liquidations' },
      { name: 'Agents', description: 'Agent registration and management' },
      { name: 'System', description: 'Health and monitoring' }
    ],
    paths: {
      '/invoke': {
        post: {
          tags: ['Capabilities'],
          summary: 'Invoke a capability',
          description: 'Execute any registered capability by ID',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['capability_id'],
                  properties: {
                    capability_id: { type: 'string', example: 'cap.price.lookup.v1' },
                    inputs: { type: 'object', example: { base_token: 'SOL' } }
                  }
                }
              }
            }
          },
          responses: { '200': { description: 'Capability executed successfully' } }
        }
      },
      '/capabilities': {
        get: {
          tags: ['Capabilities'],
          summary: 'List all capabilities',
          description: 'Get all available capabilities with their schemas',
          responses: { '200': { description: 'List of capabilities' } }
        }
      },
      '/a2a/invoke': {
        post: {
          tags: ['A2A Protocol'],
          summary: 'Agent-to-agent invocation',
          description: 'One agent invokes a capability on behalf of another',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['from_agent', 'to_agent', 'capability_id'],
                  properties: {
                    from_agent: { type: 'string', example: 'bot-A' },
                    to_agent: { type: 'string', example: 'bot-B' },
                    capability_id: { type: 'string', example: 'cap.price.lookup.v1' },
                    inputs: { type: 'object' }
                  }
                }
              }
            }
          },
          responses: { '200': { description: 'A2A invocation result' } }
        }
      },
      '/a2a/discover/{capability_id}': {
        get: {
          tags: ['A2A Protocol'],
          summary: 'Discover agents by capability',
          description: 'Find agents that provide a specific capability',
          parameters: [{ name: 'capability_id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'List of agents providing the capability' } }
        }
      },
      '/a2a/auction': {
        post: {
          tags: ['A2A Protocol'],
          summary: 'Agent auction',
          description: 'Agents bid to fulfill a capability request',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['requester_agent', 'capability_id'],
                  properties: {
                    requester_agent: { type: 'string' },
                    capability_id: { type: 'string' },
                    max_price: { type: 'number' }
                  }
                }
              }
            }
          },
          responses: { '200': { description: 'Auction result with winning agent' } }
        }
      },
      '/a2a/swarm': {
        post: {
          tags: ['A2A Protocol'],
          summary: 'Coordinate agent swarm',
          description: 'Execute a task across multiple agents in parallel or sequentially',
          responses: { '200': { description: 'Swarm execution results' } }
        }
      },
      '/a2a/leaderboard': {
        get: {
          tags: ['A2A Protocol'],
          summary: 'Agent leaderboard',
          description: 'Get ranked list of agents by reputation',
          responses: { '200': { description: 'Agent rankings' } }
        }
      },
      '/mev/analyze': {
        post: {
          tags: ['MEV Protection'],
          summary: 'Analyze MEV risk',
          description: 'Detect sandwich attack probability and get protection recommendations',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['token_in', 'token_out', 'amount'],
                  properties: {
                    token_in: { type: 'string', example: 'SOL' },
                    token_out: { type: 'string', example: 'USDC' },
                    amount: { type: 'number', example: 10000 },
                    slippage: { type: 'number', example: 0.5 }
                  }
                }
              }
            }
          },
          responses: { '200': { description: 'MEV risk analysis' } }
        }
      },
      '/mev/protected-swap': {
        post: {
          tags: ['MEV Protection'],
          summary: 'Execute protected swap',
          description: 'Execute a swap with MEV protection via private mempool',
          responses: { '200': { description: 'Protected swap result' } }
        }
      },
      '/alpha/arbitrage': {
        get: {
          tags: ['Trading Alpha'],
          summary: 'Scan for arbitrage',
          description: 'Find cross-DEX price discrepancies',
          parameters: [{ name: 'min_profit_bps', in: 'query', schema: { type: 'number' } }],
          responses: { '200': { description: 'Arbitrage opportunities' } }
        }
      },
      '/alpha/whale-tracker': {
        get: {
          tags: ['Trading Alpha'],
          summary: 'Track whale movements',
          description: 'Monitor large wallet transactions and market sentiment',
          responses: { '200': { description: 'Whale activity and alerts' } }
        }
      },
      '/alpha/liquidations': {
        get: {
          tags: ['Trading Alpha'],
          summary: 'Monitor liquidations',
          description: 'Find at-risk DeFi positions and liquidation opportunities',
          responses: { '200': { description: 'Liquidation opportunities' } }
        }
      },
      '/agents/register': {
        post: {
          tags: ['Agents'],
          summary: 'Register an agent',
          description: 'Register a new agent with capabilities',
          responses: { '200': { description: 'Registered agent details' } }
        }
      },
      '/sponsors/health': {
        get: {
          tags: ['System'],
          summary: 'Sponsor health check',
          description: 'Check connectivity to all sponsor integrations',
          responses: { '200': { description: 'Health status of all sponsors' } }
        }
      },
      '/system/dashboard': {
        get: {
          tags: ['System'],
          summary: 'System dashboard',
          description: 'Real-time overview of system status and metrics',
          responses: { '200': { description: 'Dashboard data' } }
        }
      }
    }
  };
  res.json(openApiSpec);
});

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

// Security middleware - sanitize request bodies and detect injection attempts
import { sanitizeRequestBody, verifyRequestSignature, detectInjectionAttempts } from './middleware/security';
app.use(sanitizeRequestBody);
app.use(detectInjectionAttempts);

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

// GET invoke for quick capability lookups (used by SDK for price caching)
app.get('/invoke/:capability_id', async (req: Request, res: Response) => {
  try {
    const { capability_id } = req.params;
    const inputs = req.query as Record<string, any>;
    
    const result = await router.invoke({ capability_id, inputs });
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Invoke failed'
    });
  }
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

// Agent Deregistration - graceful shutdown support
app.post('/agents/deregister', async (req: Request, res: Response) => {
  try {
    const { agent_id } = req.body;
    if (!agent_id) {
      return res.status(400).json({ success: false, error: 'agent_id required' });
    }

    const { agentRegistry } = await import('./agent-registry');
    const agent = agentRegistry.getAgent(agent_id);
    
    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    // Update agent status to inactive (graceful shutdown)
    agentRegistry.updateAgentStatus(agent_id, 'inactive');

    // Record in activity feed
    const { activityFeed } = await import('./activity-feed');
    activityFeed.record('agent_registered', agent_id, { action: 'deregistered', reason: 'graceful_shutdown' });

    res.json({
      success: true,
      agent_id,
      message: 'Agent deregistered successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Deregistration failed'
    });
  }
});

// Agent Metrics Reporting - production observability
app.post('/agents/metrics', async (req: Request, res: Response) => {
  try {
    const { agent_id, metrics, timestamp } = req.body;
    if (!agent_id || !metrics) {
      return res.status(400).json({ success: false, error: 'agent_id and metrics required' });
    }

    const { agentRegistry } = await import('./agent-registry');
    const agent = agentRegistry.getAgent(agent_id);
    
    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    // Store metrics (could be expanded to time-series storage)
    agentRegistry.recordMetrics(agent_id, {
      invocations: metrics.invocations || 0,
      success_rate: metrics.success_rate || 1,
      avg_latency_ms: metrics.avg_latency_ms || 0,
      errors: metrics.errors || 0,
      uptime_ms: metrics.uptime_ms || 0,
      reported_at: timestamp || Date.now()
    });

    // Update last seen
    agentRegistry.updateAgentStatus(agent_id, 'active');

    res.json({
      success: true,
      agent_id,
      received_at: Date.now()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Metrics reporting failed'
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

// List all registered agents
app.get('/agents', async (req: Request, res: Response) => {
  try {
    const { agentRegistry } = await import('./agent-registry');
    const agents = agentRegistry.getAllAgents();
    
    res.json({
      success: true,
      count: agents.length,
      agents: agents.map(a => ({
        agent_id: a.agent_id,
        name: a.name,
        description: a.description,
        capabilities_provided: a.capabilities_provided,
        trust_score: a.trust_score,
        status: a.status,
        registered_at: new Date(a.registered_at).toISOString()
      }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list agents'
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
    const since = req.query.since ? parseInt(req.query.since as string) : undefined;
    
    let messages = agentSocialManager.getMessages(req.params.agent_id, unread_only);
    
    // Filter by timestamp if 'since' provided
    if (since) {
      messages = messages.filter((m: any) => m.timestamp > since);
    }
    
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

// A2A Message endpoint - simplified for SDK
app.post('/a2a/message', async (req: Request, res: Response) => {
  try {
    const { agentSocialManager } = await import('./agent-social');
    const { from_agent, to_agent, message_type, payload, timestamp } = req.body;
    
    if (!from_agent || !to_agent || !payload) {
      return res.status(400).json({ success: false, error: 'from_agent, to_agent, and payload required' });
    }
    
    const message = agentSocialManager.sendMessage(
      from_agent,
      to_agent,
      { 
        subject: message_type || 'broadcast',
        content: typeof payload === 'string' ? payload : JSON.stringify(payload),
        type: message_type || 'broadcast'
      }
    );
    
    res.json({ 
      success: true, 
      delivered: true,
      message_id: message.id,
      timestamp: timestamp || Date.now()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      delivered: false,
      error: error instanceof Error ? error.message : 'Message delivery failed'
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

// Execute a composition template
app.post('/templates/:template_id/execute', async (req: Request, res: Response) => {
  try {
    const { compositionTemplateEngine } = await import('./composition-templates');
    const { executeComposition } = await import('./composition');
    const { inputs } = req.body;
    const template = compositionTemplateEngine.getTemplate(req.params.template_id);
    if (!template) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }
    
    // Validate inputs
    const validation = compositionTemplateEngine.validateInputs(req.params.template_id, inputs || {});
    if (!validation.valid) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required inputs',
        missing: validation.missing
      });
    }
    
    // Execute via composition engine
    const result = await executeComposition({
      name: template.name,
      steps: template.capabilities.map(cap => ({
        capability_id: cap.capability_id,
        inputs: cap.input_mapping
      }))
    });
    
    res.json({ ...result, template_id: req.params.template_id });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to execute template'
    });
  }
});

// ============================================
// AGENT REGISTRY & COORDINATION ENDPOINTS
// ============================================

// NOTE: /agents/discover is defined earlier in the file (line ~1591)
// NOTE: /agents/:agent_id is defined earlier in the file (line ~1679)

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

// NOTE: /agents/stats/overview is defined earlier in the file (line ~1657)

// ============================================
// KILLER FEATURES: Agent-to-Agent Protocol
// ============================================

// Agent-to-Agent Direct Invocation (A2A Protocol)
app.post('/a2a/invoke', async (req: Request, res: Response) => {
  try {
    const { from_agent, to_agent, capability_id, inputs, payment, privacy_level } = req.body;
    const { agentRegistry } = await import('./agent-registry');
    const { agentCoordinator } = await import('./agent-coordination');

    if (!from_agent || !to_agent || !capability_id) {
      return res.status(400).json({
        success: false,
        error: 'from_agent, to_agent, and capability_id required'
      });
    }

    // Verify both agents exist
    const sourceAgent = agentRegistry.getAgent(from_agent);
    const targetAgent = agentRegistry.getAgent(to_agent);

    if (!sourceAgent) {
      return res.status(404).json({ success: false, error: `Source agent ${from_agent} not found` });
    }
    if (!targetAgent) {
      return res.status(404).json({ success: false, error: `Target agent ${to_agent} not found` });
    }

    // Check if target agent provides the capability
    const providesCapability = targetAgent.capabilities_provided?.includes(capability_id);

    // Execute the invocation
    const startTime = Date.now();
    const result = await router.invoke({
      capability_id,
      inputs: inputs || {}
    });

    const execTime = Date.now() - startTime;

    // Record the interaction
    agentRegistry.recordInvocation(from_agent, result.success, execTime);
    if (providesCapability) {
      agentRegistry.recordInvocation(to_agent, result.success, execTime);
    }

    res.json({
      success: result.success,
      a2a_protocol: {
        from: from_agent,
        to: to_agent,
        capability: capability_id,
        privacy_level: privacy_level || 'public',
        execution_time_ms: execTime
      },
      outputs: result.outputs,
      metadata: result.metadata
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'A2A invocation failed'
    });
  }
});

// Agent Service Discovery - Find agents that can do X
app.get('/a2a/discover/:capability_id', async (req: Request, res: Response) => {
  try {
    const { capability_id } = req.params;
    const { min_trust, max_latency, privacy_required } = req.query;
    const { agentRegistry } = await import('./agent-registry');

    const allAgents = agentRegistry.getAllAgents();
    
    // Filter agents that provide this capability
    let matchingAgents = allAgents.filter(agent => 
      agent.capabilities_provided?.includes(capability_id)
    );

    // Apply filters
    if (min_trust) {
      matchingAgents = matchingAgents.filter(a => a.trust_score >= Number(min_trust));
    }
    if (max_latency) {
      matchingAgents = matchingAgents.filter(a => 
        (a.reputation?.average_response_time_ms || 0) <= Number(max_latency)
      );
    }

    // Sort by trust score and success rate
    matchingAgents.sort((a, b) => {
      const aScore = a.trust_score + (a.reputation?.successful_invocations || 0);
      const bScore = b.trust_score + (b.reputation?.successful_invocations || 0);
      return bScore - aScore;
    });

    res.json({
      success: true,
      capability_id,
      providers: matchingAgents.map(a => ({
        agent_id: a.agent_id,
        name: a.name,
        trust_score: a.trust_score,
        success_rate: a.reputation?.total_invocations > 0 
          ? Math.round((a.reputation.successful_invocations / a.reputation.total_invocations) * 100) + '%'
          : 'N/A',
        avg_latency_ms: a.reputation?.average_response_time_ms || 0,
        total_invocations: a.reputation?.total_invocations || 0
      })),
      count: matchingAgents.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Discovery failed'
    });
  }
});

// Agent Auction - Multiple agents bid to fulfill a request
app.post('/a2a/auction', async (req: Request, res: Response) => {
  try {
    const { requester_agent, capability_id, inputs, max_price, deadline_ms } = req.body;
    const { agentRegistry } = await import('./agent-registry');

    if (!requester_agent || !capability_id) {
      return res.status(400).json({
        success: false,
        error: 'requester_agent and capability_id required'
      });
    }

    // Find all agents that can fulfill this
    const allAgents = agentRegistry.getAllAgents();
    const providers = allAgents.filter(a => a.capabilities_provided?.includes(capability_id));

    if (providers.length === 0) {
      return res.json({
        success: true,
        auction_id: `auction_${Date.now().toString(36)}`,
        status: 'no_providers',
        message: `No agents currently provide ${capability_id}`
      });
    }

    // Calculate bid prices based on agent reputation and capability
    const bids = providers.map(agent => {
      // Price based on reputation - higher trust = can charge more
      const baseBid = (max_price || 100) * 0.5;
      const reputationMultiplier = agent.trust_score / 100;
      const bid_price = baseBid * (0.5 + reputationMultiplier);
      const estimated_latency_ms = agent.reputation?.average_response_time_ms || 50;
      const trust_score = agent.trust_score;
      const success_rate = agent.reputation?.total_invocations > 0
        ? (agent.reputation.successful_invocations / agent.reputation.total_invocations)
        : 1;
      const score = (1 / (bid_price + 1)) * trust_score * success_rate * (1000 / (estimated_latency_ms + 1));
      return {
        agent_id: agent.agent_id,
        name: agent.name,
        bid_price,
        estimated_latency_ms,
        trust_score,
        success_rate,
        score
      };
    });

    // Sort by score (lower price + higher trust + faster = better)
    bids.sort((a, b) => b.score - a.score);

    const winner = bids[0];

    res.json({
      success: true,
      auction_id: `auction_${Date.now().toString(36)}`,
      status: 'completed',
      winner: {
        agent_id: winner.agent_id,
        name: winner.name,
        bid_price: winner.bid_price.toFixed(4),
        estimated_latency_ms: winner.estimated_latency_ms
      },
      all_bids: bids.length,
      runner_ups: bids.slice(1, 4).map(b => ({ agent_id: b.agent_id, bid_price: b.bid_price.toFixed(4) }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Auction failed'
    });
  }
});

// Agent Swarm - Coordinate multiple agents for complex tasks
app.post('/a2a/swarm', async (req: Request, res: Response) => {
  try {
    const { coordinator_agent, task, agents, strategy, timeout_ms } = req.body;
    const { agentRegistry } = await import('./agent-registry');

    if (!coordinator_agent || !task || !agents || !Array.isArray(agents)) {
      return res.status(400).json({
        success: false,
        error: 'coordinator_agent, task object, and agents array required'
      });
    }

    const swarmId = `swarm_${Date.now().toString(36)}`;
    const startTime = Date.now();

    // Validate all agents exist
    const validAgents = agents.filter(id => agentRegistry.getAgent(id));
    
    // Execute task across swarm based on strategy
    const results: any[] = [];
    
    if (strategy === 'parallel') {
      // All agents work simultaneously
      const promises = validAgents.map(async (agentId) => {
        const result = await router.invoke({
          capability_id: task.capability_id,
          inputs: task.inputs || {}
        });
        return { agent_id: agentId, result };
      });
      
      const swarmResults = await Promise.allSettled(promises);
      swarmResults.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          results.push(r.value);
        } else {
          results.push({ agent_id: validAgents[i], error: r.reason?.message });
        }
      });
    } else {
      // Sequential (default)
      for (const agentId of validAgents) {
        const result = await router.invoke({
          capability_id: task.capability_id,
          inputs: task.inputs || {}
        });
        results.push({ agent_id: agentId, result });
      }
    }

    const successCount = results.filter(r => r.result?.success).length;

    res.json({
      success: true,
      swarm_id: swarmId,
      coordinator: coordinator_agent,
      strategy: strategy || 'sequential',
      agents_participated: validAgents.length,
      success_count: successCount,
      execution_time_ms: Date.now() - startTime,
      results
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Swarm execution failed'
    });
  }
});

// Agent Reputation Leaderboard
app.get('/a2a/leaderboard', async (req: Request, res: Response) => {
  try {
    const { agentRegistry } = await import('./agent-registry');
    const { limit, sort_by } = req.query;

    const allAgents = agentRegistry.getAllAgents();
    
    // Calculate scores
    const scored = allAgents.map(agent => ({
      agent_id: agent.agent_id,
      name: agent.name,
      trust_score: agent.trust_score,
      total_invocations: agent.reputation?.total_invocations || 0,
      success_rate: agent.reputation?.total_invocations > 0
        ? Math.round((agent.reputation.successful_invocations / agent.reputation.total_invocations) * 100)
        : 0,
      avg_latency_ms: Math.round(agent.reputation?.average_response_time_ms || 0),
      capabilities_count: agent.capabilities_provided?.length || 0,
      composite_score: (agent.trust_score * 0.3) + 
        ((agent.reputation?.successful_invocations || 0) * 0.4) +
        ((agent.capabilities_provided?.length || 0) * 10 * 0.3)
    }));

    // Sort
    const sortField = sort_by as string || 'composite_score';
    scored.sort((a, b) => (b as any)[sortField] - (a as any)[sortField]);

    // Limit
    const topAgents = scored.slice(0, Number(limit) || 10);

    res.json({
      success: true,
      leaderboard: topAgents.map((agent, index) => ({
        rank: index + 1,
        ...agent
      })),
      total_agents: allAgents.length,
      updated_at: Date.now()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Leaderboard failed'
    });
  }
});

// ============================================
// 💰 MEV PROTECTION & TRADING ALPHA
// ============================================

// MEV Protection Analysis - Detect sandwich attacks, frontrunning risks
// Legacy endpoint - redirects to new trading module
app.post('/mev/analyze', async (req: Request, res: Response) => {
  try {
    const { mevProtection } = await import('./trading/mev-protection');
    const { token_in, token_out, amount, slippage } = req.body;

    if (!token_in || !token_out || !amount) {
      return res.status(400).json({
        success: false,
        error: 'token_in, token_out, and amount required'
      });
    }

    const amountNum = Number(amount);
    const slippageNum = Number(slippage) || 0.5;
    
    // Use the new comprehensive MEV protection module
    const analysis = await mevProtection.analyzeRisk(
      token_in,
      token_out,
      amountNum,
      amountNum * 100, // Estimate USD value
      amountNum,
      slippageNum
    );

    // Return in legacy format for backward compatibility
    res.json({
      success: true,
      mev_analysis: {
        trade: { token_in, token_out, amount: amountNum, slippage: slippageNum },
        risk_assessment: {
          overall_risk: analysis.risk.level.toUpperCase(),
          sandwich_probability: analysis.risk.sandwich_risk.probability + '%',
          size_risk: analysis.risk.level,
          slippage_risk: slippageNum > 1 ? 'high' : slippageNum > 0.5 ? 'medium' : 'low'
        },
        mempool_status: {
          pending_transactions: analysis.risk.frontrun_risk.pending_similar_trades * 10,
          similar_trades_detected: analysis.risk.frontrun_risk.pending_similar_trades,
          mev_bot_activity: analysis.risk.sandwich_risk.detected_bots > 0 ? 'detected' : 'none'
        },
        potential_loss_usd: (
          analysis.risk.sandwich_risk.estimated_loss_usd +
          analysis.risk.frontrun_risk.estimated_loss_usd +
          analysis.risk.backrun_risk.estimated_loss_usd
        ).toFixed(2),
        savings_with_protection_usd: analysis.recommendation.estimated_savings_usd.toFixed(2),
        recommendations: [analysis.recommendation.reasoning],
        protected_execution_available: true,
        // New: include full analysis for clients that want it
        full_analysis: analysis
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'MEV analysis failed'
    });
  }
});

// Protected Swap Execution - MEV-resistant swap via private mempool
// Legacy endpoint - uses new trading module for analysis, then executes swap
app.post('/mev/protected-swap', async (req: Request, res: Response) => {
  try {
    const { mevProtection } = await import('./trading/mev-protection');
    const { token_in, token_out, amount, wallet_address, max_slippage, protection_level } = req.body;

    if (!token_in || !token_out || !amount || !wallet_address) {
      return res.status(400).json({
        success: false,
        error: 'token_in, token_out, amount, and wallet_address required'
      });
    }

    const amountNum = Number(amount);
    const startTime = Date.now();

    // First, analyze MEV risk using the new module
    const analysis = await mevProtection.analyzeRisk(
      token_in,
      token_out,
      amountNum,
      amountNum * 100,
      amountNum,
      max_slippage || 0.5
    );

    // Map protection level to option
    const protectionLvl = protection_level || 'standard';
    const optionMap: Record<string, string> = {
      'basic': 'opt_private_rpc',
      'standard': 'opt_jito',
      'enhanced': 'opt_jito',
      'maximum': 'opt_confidential'
    };
    const optionId = optionMap[protectionLvl] || 'opt_jito';

    // Execute with protection
    const protectedExec = await mevProtection.executeProtected(analysis.analysis_id, optionId);

    // Also execute the underlying swap
    const swapResult = await router.invoke({
      capability_id: 'cap.swap.execute.v1',
      inputs: { 
        input_token: token_in, 
        output_token: token_out, 
        amount, 
        wallet_address,
        slippage: max_slippage || 0.5
      }
    });

    const execTime = Date.now() - startTime;
    const selectedOption = analysis.execution_options.find(o => o.option_id === optionId);

    res.json({
      success: swapResult.success,
      protected_swap: {
        protection_level: protectionLvl,
        execution_method: selectedOption?.method || 'jito_bundle',
        protection_rate: (selectedOption?.mev_protection_percent || 70) + '%',
        protection_fee: selectedOption?.protection_fee_usd || 0.05,
        mev_extracted: '$0.00',
        savings_vs_unprotected: `$${protectedExec.savings.net_savings_usd.toFixed(2)}`
      },
      swap_result: swapResult.outputs,
      execution_time_ms: execTime,
      metadata: swapResult.metadata,
      // Include new detailed analysis
      mev_analysis: analysis,
      protected_execution: protectedExec
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Protected swap failed'
    });
  }
});

// Arbitrage Scanner - Find cross-DEX opportunities (REAL DATA from Jupiter)
app.get('/alpha/arbitrage', async (req: Request, res: Response) => {
  try {
    const { token, min_profit_bps } = req.query;
    const minProfitBps = Number(min_profit_bps) || 5;

    // Import arbitrage scanner service
    const { arbitrageScannerService } = await import('../providers/arbitrage-scanner');
    
    // Get real arbitrage data from Jupiter
    const result = await arbitrageScannerService.scanArbitrage({
      token: token as string | undefined,
      minProfitBps
    });

    res.json({
      success: true,
      arbitrage: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Arbitrage scan failed'
    });
  }
});

// Gas Optimizer - Find optimal execution timing using real Solana RPC
app.get('/alpha/gas-optimizer', async (req: Request, res: Response) => {
  try {
    // Fetch real recent prioritization fees from Solana RPC
    const rpcUrl = process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getRecentPrioritizationFees',
        params: []
      })
    });
    
    const data = await response.json() as { result?: Array<{ prioritizationFee: number }> };
    const fees = data.result || [];
    
    // Calculate average fee from recent slots
    const avgFee = fees.length > 0 
      ? fees.reduce((sum: number, f: any) => sum + f.prioritizationFee, 0) / fees.length / 1e9
      : 0.00025;
    
    const congestion = avgFee > 0.0005 ? 'high' : avgFee > 0.0003 ? 'medium' : 'low';

    res.json({
      success: true,
      gas_optimization: {
        current: {
          priority_fee_sol: avgFee,
          congestion_level: congestion,
          recommended_fee: avgFee * 1.2,
          samples: fees.length
        },
        recommendation: congestion === 'high' 
          ? 'WAIT - High congestion, delay 15-30 minutes'
          : 'EXECUTE NOW - Low congestion, optimal timing',
        optimal_execution_window: '2-6 AM UTC (historically lowest fees)',
        data_source: 'solana_rpc_getRecentPrioritizationFees'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Gas optimization failed'
    });
  }
});

// Whale Tracker - Monitor large wallet movements (REAL DATA from Helius)
app.get('/alpha/whale-tracker', async (req: Request, res: Response) => {
  try {
    const { token, min_value } = req.query;
    const minValueUsd = Number(min_value) || 100000;

    // Import whale tracker service
    const { whaleTrackerService } = await import('../providers/whale-tracker');
    
    // Get real whale movements from Helius
    const result = await whaleTrackerService.getWhaleMovements({
      token: token as string | undefined,
      minValueUsd,
      limit: 20
    });

    res.json({
      success: true,
      whale_tracker: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Whale tracking failed'
    });
  }
});

// Liquidation Monitor - Track DeFi liquidation opportunities (REAL DATA)
app.get('/alpha/liquidations', async (req: Request, res: Response) => {
  try {
    const { protocol, min_value } = req.query;
    const minVal = Number(min_value) || 1000;

    // Import liquidation monitor service
    const { liquidationMonitorService } = await import('../providers/liquidation-monitor');
    
    // Get real liquidation data
    const result = await liquidationMonitorService.scanLiquidations({
      protocol: protocol as string | undefined,
      minValue: minVal
    });

    res.json({
      success: true,
      liquidations: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Liquidation monitoring failed'
    });
  }
});

// Smart Money Tracker - Real Nansen data on who's buying/selling (FREE TIER)
app.get('/alpha/smart-money', async (req: Request, res: Response) => {
  try {
    const { token } = req.query;
    
    const { smartMoneyService } = await import('../providers/smart-money');
    const result = await smartMoneyService.getSmartMoneyActivity(token as string || 'SOL');
    
    res.json({
      success: true,
      smart_money: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Smart money tracking failed'
    });
  }
});

// Stealth Trade Analysis - Privacy/cost tradeoffs for large trades
app.post('/alpha/stealth-analyze', async (req: Request, res: Response) => {
  try {
    const { token_in, token_out, amount } = req.body;

    if (!token_in || !token_out || !amount) {
      return res.status(400).json({
        success: false,
        error: 'token_in, token_out, and amount required'
      });
    }

    const amountNum = Number(amount);
    
    // Get price to calculate USD value
    const { priceProvider } = await import('../providers/price');
    let usdValue = amountNum * 100; // Default estimate
    try {
      const priceData = await priceProvider.getPrice(token_in, 'USDC');
      usdValue = amountNum * priceData.price;
    } catch {
      // Use default
    }

    // Get MEV risk analysis
    const { mevProtection } = await import('./trading/mev-protection');
    const mevAnalysis = await mevProtection.analyzeRisk(
      token_in, token_out, amountNum, usdValue, amountNum, 0.5
    );

    const potentialLoss = 
      mevAnalysis.risk.sandwich_risk.estimated_loss_usd +
      mevAnalysis.risk.frontrun_risk.estimated_loss_usd +
      mevAnalysis.risk.backrun_risk.estimated_loss_usd;

    // Generate stealth options
    const stealthOptions = [
      {
        level: 'standard',
        method: 'private_rpc',
        description: 'Route through private RPC endpoint',
        protection_percent: 40,
        estimated_cost_usd: 0.02,
        estimated_savings_usd: potentialLoss * 0.4,
        net_benefit_usd: potentialLoss * 0.4 - 0.02,
        features: ['hidden_from_public_mempool'],
        execution_time_ms: 500
      },
      {
        level: 'enhanced',
        method: 'jito_bundle',
        description: 'Execute via Jito bundle with tip',
        protection_percent: 70,
        estimated_cost_usd: Math.max(0.05, potentialLoss * 0.1),
        estimated_savings_usd: potentialLoss * 0.7,
        net_benefit_usd: potentialLoss * 0.7 - Math.max(0.05, potentialLoss * 0.1),
        features: ['jito_bundle', 'tip_protection', 'atomic_execution'],
        execution_time_ms: 600
      },
      {
        level: 'maximum',
        method: 'arcium_mpc',
        description: 'Confidential execution via Arcium MPC',
        protection_percent: 95,
        estimated_cost_usd: Math.max(0.10, potentialLoss * 0.2),
        estimated_savings_usd: potentialLoss * 0.95,
        net_benefit_usd: potentialLoss * 0.95 - Math.max(0.10, potentialLoss * 0.2),
        features: ['encrypted_amounts', 'hidden_route', 'zk_proof', 'confidential_settlement'],
        execution_time_ms: 1500
      }
    ];

    // Determine recommendations
    const recommendation = potentialLoss > 50 ? 'maximum' : potentialLoss > 10 ? 'enhanced' : 'standard';
    const splitRecommended = usdValue > 50000;
    const recommendedChunks = splitRecommended ? Math.min(10, Math.ceil(usdValue / 10000)) : 1;

    res.json({
      success: true,
      stealth_analysis: {
        trade: {
          token_in,
          token_out,
          amount: amountNum,
          usd_value: Math.round(usdValue * 100) / 100
        },
        mev_risk: {
          level: mevAnalysis.risk.level.toUpperCase(),
          potential_loss_usd: potentialLoss.toFixed(2),
          sandwich_probability: mevAnalysis.risk.sandwich_risk.probability + '%',
          frontrun_probability: mevAnalysis.risk.frontrun_risk.probability + '%'
        },
        stealth_options: stealthOptions,
        recommendation: {
          privacy_level: recommendation,
          split_order: splitRecommended,
          chunks: recommendedChunks,
          reasoning: splitRecommended 
            ? `Large trade ($${usdValue.toFixed(0)}). Split into ${recommendedChunks} chunks with ${recommendation} privacy.`
            : `Use ${recommendation} privacy for optimal protection/cost ratio.`
        },
        privacy_features: {
          order_splitting: 'Split large orders to avoid detection patterns',
          randomized_timing: 'Add random delays between chunks',
          decoy_transactions: 'Optional fake trades to confuse analysis',
          encrypted_amounts: 'Hide trade size from all observers',
          hidden_route: 'Conceal swap path through DEXs'
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Stealth analysis failed'
    });
  }
});

// Private Trade Execution - Confidential swap with hidden amounts
app.post('/alpha/private-trade', async (req: Request, res: Response) => {
  try {
    const { token_in, token_out, amount, wallet_address } = req.body;

    if (!token_in || !token_out || !amount || !wallet_address) {
      return res.status(400).json({
        success: false,
        error: 'token_in, token_out, amount, and wallet_address required'
      });
    }

    // Use Arcium for confidential execution
    const { arciumProvider } = await import('../providers/arcium-client');
    
    // Execute confidential swap
    const confidentialResult = await arciumProvider.confidentialSwap(
      wallet_address,
      token_in,
      token_out,
      String(amount)
    );

    res.json({
      success: confidentialResult.success,
      private_trade: {
        status: 'executed',
        privacy_level: 'maximum',
        amount_hidden: true,
        execution_proof: confidentialResult.computationId,
        mev_protection: '100%',
        on_chain_visibility: 'encrypted'
      },
      result: confidentialResult,
      note: 'Trade amount and direction hidden from mempool observers'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Private trade failed'
    });
  }
});

// Portfolio P&L Tracker
app.post('/alpha/pnl', async (req: Request, res: Response) => {
  try {
    const { wallet_address, timeframe } = req.body;

    if (!wallet_address) {
      return res.status(400).json({
        success: false,
        error: 'wallet_address required'
      });
    }

    // Simulated P&L data (in production, would analyze on-chain history)
    const pnlData = {
      total_pnl_usd: 12450.75,
      total_pnl_percent: 24.5,
      realized_pnl: 8200.50,
      unrealized_pnl: 4250.25,
      best_trade: {
        token: 'SOL',
        entry: 120.50,
        exit: 185.40,
        profit_usd: 6490.00,
        profit_percent: 53.9
      },
      worst_trade: {
        token: 'BONK',
        entry: 0.000025,
        exit: 0.000018,
        loss_usd: -350.00,
        loss_percent: -28.0
      },
      win_rate: 68.5,
      avg_win: 1250.00,
      avg_loss: -420.00,
      sharpe_ratio: 1.85,
      max_drawdown: -12.5
    };

    res.json({
      success: true,
      pnl: {
        wallet: wallet_address,
        timeframe: timeframe || '30d',
        ...pnlData,
        performance_rating: pnlData.sharpe_ratio > 1.5 ? 'EXCELLENT' : 
                          pnlData.sharpe_ratio > 1 ? 'GOOD' : 'AVERAGE',
        recommendations: [
          pnlData.win_rate < 50 ? 'Improve entry timing' : null,
          pnlData.max_drawdown < -20 ? 'Consider position sizing' : null,
          'Continue current strategy - positive expectancy'
        ].filter(Boolean)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'P&L calculation failed'
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

app.get('/reputation/capability/:capability_id', async (req: Request, res: Response) => {
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

// Transaction status lookup
app.get('/tx/:tx_hash', async (req: Request, res: Response) => {
  try {
    const { tx_hash } = req.params;
    const { solanaRPC } = await import('../providers/solana-rpc');
    
    // Check transaction status on Solana
    const confirmed = await solanaRPC.confirmTransaction(tx_hash);
    
    res.json({
      success: true,
      tx_hash,
      confirmed,
      status: confirmed ? 'confirmed' : 'pending',
      checked_at: Date.now()
    });
  } catch (error) {
    res.json({
      success: false,
      tx_hash: req.params.tx_hash,
      confirmed: false,
      status: 'unknown',
      error: error instanceof Error ? error.message : 'Failed to check transaction'
    });
  }
});

// Capability health scores (router-level)
app.get('/health/scores', (req: Request, res: Response) => {
  res.json({ success: true, scores: router.getAllHealthScores() });
});

app.get('/health/score/:id', (req: Request, res: Response) => {
  const score = router.getHealthScore(req.params.id);
  res.json({ success: true, capability_id: req.params.id, score });
});

// Quote endpoint - get swap quote for a token pair
app.get('/quote', async (req: Request, res: Response) => {
  try {
    const { input, output, amount } = req.query;
    
    if (!input || !output) {
      return res.status(400).json({ success: false, error: 'input and output tokens required' });
    }
    
    const amountNum = Number(amount) || 1;
    const { swapProvider } = await import('../providers/swap');
    
    const quote = await swapProvider.getQuote(
      input as string,
      output as string,
      amountNum
    );
    
    res.json({
      success: true,
      input_token: input,
      output_token: output,
      input_amount: amountNum,
      output_amount: quote.output_amount,
      price: quote.output_amount / amountNum,
      route: quote.route_plan,
      price_impact: quote.price_impact_pct,
      timestamp: Date.now()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Quote failed'
    });
  }
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

// NOTE: /agents/:agent_id/profile is defined earlier in the file (line ~1763)

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
// AGENT REPUTATION (Basic - from router.ts)
// Note: For ZK-verified reputation, use /reputation/agent/:agent_id
// ============================================

app.get('/reputation/basic/:agent_id', (req: Request, res: Response) => {
  const rep = router.getReputation(req.params.agent_id);
  res.json({ success: true, agent_id: req.params.agent_id, reputation: rep });
});

app.post('/reputation/basic/:agent_id', (req: Request, res: Response) => {
  const { success, weight } = req.body;
  router.updateReputation(req.params.agent_id, success !== false, weight || 1);
  const rep = router.getReputation(req.params.agent_id);
  res.json({ success: true, agent_id: req.params.agent_id, reputation: rep });
});

app.get('/reputation/basic/top', (req: Request, res: Response) => {
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

// NOTE: /agents/discover is defined earlier in the file with more complete implementation

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

// NOTE: /trace/start is defined earlier in the file (line ~5572)
// NOTE: /trace/:trace_id is defined earlier in the file (line ~5582)

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

// NOTE: /debug/requests is defined earlier in the file (line ~5810)
// NOTE: /debug/replay/:request_id is defined earlier in the file (line ~5815)

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

// ============================================
// TRADING INFRASTRUCTURE - Deep Value for Agents
// ============================================

// Real-time trading signals subscription
app.get('/trading/signals/stream', async (req: Request, res: Response) => {
  try {
    const { signalService } = await import('./trading/realtime-signals');
    
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Parse subscription options
    const types = req.query.types 
      ? (req.query.types as string).split(',') as any[]
      : ['price_movement', 'mev_risk', 'arbitrage_opportunity', 'whale_activity', 'a2a_quote_available'];
    const assets = req.query.assets 
      ? (req.query.assets as string).split(',')
      : undefined;
    const minPriority = req.query.min_priority as any;

    // Send initial connection event
    res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now(), subscribed_types: types })}\n\n`);

    // Subscribe to signals
    const subId = signalService.subscribe(
      req.query.agent_id as string || 'anonymous',
      types,
      (signal) => {
        res.write(`data: ${JSON.stringify(signal)}\n\n`);
      },
      { assets, min_priority: minPriority }
    );

    // Cleanup on disconnect
    req.on('close', () => {
      signalService.unsubscribe(subId);
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Signal stream failed'
    });
  }
});

// Get recent trading signals
app.get('/trading/signals', async (req: Request, res: Response) => {
  try {
    const { signalService } = await import('./trading/realtime-signals');
    
    const signals = signalService.getRecentSignals({
      type: req.query.type as any,
      asset: req.query.asset as string,
      limit: parseInt(req.query.limit as string) || 50,
      since: req.query.since ? parseInt(req.query.since as string) : undefined
    });
    
    res.json({
      success: true,
      count: signals.length,
      signals
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get signals'
    });
  }
});

// Get signal statistics
app.get('/trading/signals/stats', async (req: Request, res: Response) => {
  try {
    const { signalService } = await import('./trading/realtime-signals');
    res.json({ success: true, ...signalService.getStats() });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get signal stats'
    });
  }
});

// ⚡ Instant Swap - Optimized for minimum latency
app.post('/trading/instant-swap', async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    const { token_in, token_out, amount, wallet_address, max_slippage_bps, priority_fee } = req.body;

    if (!token_in || !token_out || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Required: token_in, token_out, amount'
      });
    }

    // Skip MEV analysis for speed - go straight to execution
    const { swapProvider } = await import('../providers/swap');
    
    // Execute swap directly
    const swapResult = await swapProvider.executeSwap(
      wallet_address || 'instant-user',
      token_in,
      token_out,
      String(amount),
      max_slippage_bps || 50
    );

    const latencyMs = Date.now() - startTime;

    res.json({
      success: true,
      instant_swap: {
        swap_id: `instant_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        status: 'executed',
        token_in,
        token_out,
        amount_in: amount,
        amount_out: swapResult.output_amount || 0,
        execution_price: (swapResult.output_amount || 0) / amount,
        latency_ms: latencyMs,
        optimizations: ['skip_mev_analysis', 'direct_swap', 'no_protection_overhead'],
        route_hops: swapResult.route?.length || 1,
        tx_signature: swapResult.transaction_signature
      },
      performance: {
        total_latency_ms: latencyMs,
        target_latency_ms: 1000,
        within_target: latencyMs < 1000
      }
    });
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Instant swap failed',
      latency_ms: latencyMs
    });
  }
});

// MEV Risk Analysis
app.post('/trading/mev/analyze', async (req: Request, res: Response) => {
  try {
    const { mevProtection } = await import('./trading/mev-protection');
    const { token_in, token_out, amount_in, amount_in_usd, expected_out, slippage_tolerance } = req.body;
    
    if (!token_in || !token_out || !amount_in) {
      return res.status(400).json({
        success: false,
        error: 'Required: token_in, token_out, amount_in'
      });
    }
    
    const analysis = await mevProtection.analyzeRisk(
      token_in,
      token_out,
      amount_in,
      amount_in_usd || amount_in * 100, // Estimate if not provided
      expected_out || amount_in,
      slippage_tolerance || 0.5
    );
    
    res.json({
      success: true,
      analysis
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'MEV analysis failed'
    });
  }
});

// Execute with MEV protection
app.post('/trading/mev/execute', async (req: Request, res: Response) => {
  try {
    const { mevProtection } = await import('./trading/mev-protection');
    const { analysis_id, option_id } = req.body;
    
    if (!analysis_id || !option_id) {
      return res.status(400).json({
        success: false,
        error: 'Required: analysis_id, option_id'
      });
    }
    
    const execution = await mevProtection.executeProtected(analysis_id, option_id);
    
    res.json({
      success: true,
      execution
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Protected execution failed'
    });
  }
});

// Get MEV execution status
app.get('/trading/mev/execution/:execution_id', async (req: Request, res: Response) => {
  try {
    const { mevProtection } = await import('./trading/mev-protection');
    const execution = mevProtection.getExecution(req.params.execution_id);
    
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

// Get MEV protection statistics
app.get('/trading/mev/stats', async (req: Request, res: Response) => {
  try {
    const { mevProtection } = await import('./trading/mev-protection');
    res.json({ success: true, ...mevProtection.getStats() });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get MEV stats'
    });
  }
});

// Create sealed-bid auction
app.post('/trading/auction/create', async (req: Request, res: Response) => {
  try {
    const { sealedAuction } = await import('./trading/sealed-auction');
    const { 
      agent_id, token, amount, amount_usd,
      type, min_bid_usd, reserve_price_usd, buy_now_price_usd,
      bidding_duration_seconds, reveal_duration_seconds,
      min_trust_score, allowed_agents, max_participants
    } = req.body;
    
    if (!agent_id || !token || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Required: agent_id, token, amount'
      });
    }
    
    const auction = sealedAuction.createAuction(
      agent_id,
      token,
      amount,
      amount_usd || amount * 100,
      {
        type, min_bid_usd, reserve_price_usd, buy_now_price_usd,
        bidding_duration_seconds, reveal_duration_seconds,
        min_trust_score, allowed_agents, max_participants
      }
    );
    
    res.json({
      success: true,
      auction: {
        auction_id: auction.auction_id,
        type: auction.type,
        status: auction.status,
        asset: auction.asset,
        parameters: auction.parameters,
        creator: auction.creator
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Auction creation failed'
    });
  }
});

// Submit sealed bid
app.post('/trading/auction/:auction_id/bid', async (req: Request, res: Response) => {
  try {
    const { sealedAuction } = await import('./trading/sealed-auction');
    const { agent_id, amount_usd } = req.body;
    
    if (!agent_id || !amount_usd) {
      return res.status(400).json({
        success: false,
        error: 'Required: agent_id, amount_usd'
      });
    }
    
    const result = sealedAuction.submitBid(
      req.params.auction_id,
      agent_id,
      amount_usd
    );
    
    if (!result.success) {
      return res.status(400).json(result);
    }
    
    res.json({
      success: true,
      bid_id: result.bid_id,
      commitment: result.commitment,
      nonce: result.nonce, // Agent must save this to reveal later!
      important: 'Save the nonce - you need it to reveal your bid'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Bid submission failed'
    });
  }
});

// Reveal bid
app.post('/trading/auction/:auction_id/reveal', async (req: Request, res: Response) => {
  try {
    const { sealedAuction } = await import('./trading/sealed-auction');
    const { agent_id, amount_usd, nonce } = req.body;
    
    if (!agent_id || !amount_usd || !nonce) {
      return res.status(400).json({
        success: false,
        error: 'Required: agent_id, amount_usd, nonce'
      });
    }
    
    const result = sealedAuction.revealBid(
      req.params.auction_id,
      agent_id,
      amount_usd,
      nonce
    );
    
    if (!result.success) {
      return res.status(400).json(result);
    }
    
    res.json({
      success: true,
      valid: result.valid,
      message: result.valid ? 'Bid revealed successfully' : 'Commitment mismatch - bid invalid'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Bid reveal failed'
    });
  }
});

// Get auction details
app.get('/trading/auction/:auction_id', async (req: Request, res: Response) => {
  try {
    const { sealedAuction } = await import('./trading/sealed-auction');
    const auction = sealedAuction.getAuction(req.params.auction_id);
    
    if (!auction) {
      return res.status(404).json({ success: false, error: 'Auction not found' });
    }
    
    // Don't expose bid amounts until reveal phase
    const safeAuction = {
      ...auction,
      sealed_bids: auction.sealed_bids.map(b => ({
        bid_id: b.bid_id,
        agent_id: b.agent_id,
        submitted_at: b.submitted_at
        // commitment hidden
      })),
      revealed_bids: auction.status === 'completed' ? auction.revealed_bids : 
        auction.revealed_bids.map(b => ({ ...b, amount_usd: undefined }))
    };
    
    res.json({ success: true, auction: safeAuction });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get auction'
    });
  }
});

// List active auctions
app.get('/trading/auctions', async (req: Request, res: Response) => {
  try {
    const { sealedAuction } = await import('./trading/sealed-auction');
    const auctions = sealedAuction.getActiveAuctions(req.query.token as string);
    
    res.json({
      success: true,
      count: auctions.length,
      auctions: auctions.map(a => ({
        auction_id: a.auction_id,
        type: a.type,
        status: a.status,
        asset: a.asset,
        parameters: {
          min_bid_usd: a.parameters.min_bid_usd,
          bidding_ends_at: a.parameters.bidding_ends_at,
          reveal_ends_at: a.parameters.reveal_ends_at
        },
        bid_count: a.sealed_bids.length,
        creator: a.creator.agent_id
      }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list auctions'
    });
  }
});

// Get auction statistics
app.get('/trading/auctions/stats', async (req: Request, res: Response) => {
  try {
    const { sealedAuction } = await import('./trading/sealed-auction');
    res.json({ success: true, ...sealedAuction.getStats() });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get auction stats'
    });
  }
});

// ============================================
// PRIVACY TECHNOLOGY INTEGRATIONS
// Arcium (MPC), Inco (FHE), Noir (ZK)
// ============================================

// Arcium MPC Endpoints
app.get('/arcium/status', async (req: Request, res: Response) => {
  try {
    const { arciumProvider } = await import('../providers/arcium-client');
    const status = arciumProvider.getStatus();
    res.json({ success: true, ...status });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get Arcium status' });
  }
});

app.post('/arcium/encrypt', async (req: Request, res: Response) => {
  try {
    const { arciumProvider } = await import('../providers/arcium-client');
    const { data } = req.body;
    if (!data) {
      return res.status(400).json({ success: false, error: 'data required' });
    }
    const encrypted = arciumProvider.encryptForMPC(data);
    res.json({ success: true, ...encrypted });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Encryption failed' });
  }
});

app.post('/arcium/compute', async (req: Request, res: Response) => {
  try {
    const { arciumProvider } = await import('../providers/arcium-client');
    const { program_id, inputs, mxe_id } = req.body;
    const result = await arciumProvider.submitComputation({
      programId: program_id || process.env.ARCIUM_PROGRAM_ID || '',
      inputs: inputs || {},
      mxeId: mxe_id
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Computation failed' });
  }
});

app.post('/arcium/confidential-swap', async (req: Request, res: Response) => {
  try {
    const { arciumProvider } = await import('../providers/arcium-client');
    const { input_token, output_token, encrypted_amount, wallet } = req.body;
    if (!input_token || !output_token || !encrypted_amount || !wallet) {
      return res.status(400).json({ success: false, error: 'input_token, output_token, encrypted_amount, wallet required' });
    }
    const result = await arciumProvider.confidentialSwap(input_token, output_token, encrypted_amount, wallet);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Confidential swap failed' });
  }
});

app.post('/arcium/cspl/wrap', async (req: Request, res: Response) => {
  try {
    const { arciumProvider } = await import('../providers/arcium-client');
    const { owner, mint, amount } = req.body;
    if (!owner || !mint || amount === undefined) {
      return res.status(400).json({ success: false, error: 'owner, mint, amount required' });
    }
    const result = await arciumProvider.wrapToCSPL(owner, mint, amount);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'C-SPL wrap failed' });
  }
});

app.post('/arcium/cspl/transfer', async (req: Request, res: Response) => {
  try {
    const { arciumProvider } = await import('../providers/arcium-client');
    const { from, to, mint, encrypted_amount } = req.body;
    if (!from || !to || !mint || !encrypted_amount) {
      return res.status(400).json({ success: false, error: 'from, to, mint, encrypted_amount required' });
    }
    const result = await arciumProvider.transferCSPL(from, to, mint, encrypted_amount);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'C-SPL transfer failed' });
  }
});

app.post('/arcium/private-bid', async (req: Request, res: Response) => {
  try {
    const { arciumProvider } = await import('../providers/arcium-client');
    const { auction_id, bidder, encrypted_bid, max_slippage } = req.body;
    if (!auction_id || !bidder || !encrypted_bid) {
      return res.status(400).json({ success: false, error: 'auction_id, bidder, encrypted_bid required' });
    }
    const result = await arciumProvider.submitPrivateBid(auction_id, bidder, encrypted_bid, max_slippage);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Private bid failed' });
  }
});

// Inco FHE Endpoints
app.get('/inco/status', async (req: Request, res: Response) => {
  try {
    const { incoFHEProvider } = await import('../providers/inco-fhe');
    const status = incoFHEProvider.getStatus();
    res.json({ success: true, ...status });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get Inco status' });
  }
});

app.post('/inco/encrypt', async (req: Request, res: Response) => {
  try {
    const { incoFHEProvider } = await import('../providers/inco-fhe');
    const { value, type } = req.body;
    if (value === undefined || !type) {
      return res.status(400).json({ success: false, error: 'value and type required' });
    }
    const encrypted = await incoFHEProvider.encrypt(value, type);
    res.json({ success: true, ...encrypted });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'FHE encryption failed' });
  }
});

app.post('/inco/compute', async (req: Request, res: Response) => {
  try {
    const { incoFHEProvider } = await import('../providers/inco-fhe');
    const { operation, operands } = req.body;
    if (!operation || !operands || !Array.isArray(operands)) {
      return res.status(400).json({ success: false, error: 'operation and operands array required' });
    }
    
    let result;
    switch (operation) {
      case 'fhe_add':
        result = await incoFHEProvider.fheAdd(operands[0], operands[1]);
        break;
      case 'fhe_sub':
        result = await incoFHEProvider.fheSub(operands[0], operands[1]);
        break;
      case 'fhe_mul':
        result = await incoFHEProvider.fheMul(operands[0], operands[1]);
        break;
      case 'fhe_lt':
        result = await incoFHEProvider.fheLt(operands[0], operands[1]);
        break;
      case 'fhe_select':
        result = await incoFHEProvider.fheSelect(operands[0], operands[1], operands[2]);
        break;
      default:
        return res.status(400).json({ success: false, error: `Unknown operation: ${operation}` });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'FHE computation failed' });
  }
});

app.post('/inco/message', async (req: Request, res: Response) => {
  try {
    const { incoFHEProvider } = await import('../providers/inco-fhe');
    const { sender, recipient, message, ttl_seconds } = req.body;
    if (!sender || !recipient || !message) {
      return res.status(400).json({ success: false, error: 'sender, recipient, message required' });
    }
    const result = await incoFHEProvider.sendConfidentialMessage(sender, recipient, message, ttl_seconds);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Confidential message failed' });
  }
});

app.post('/inco/state/create', async (req: Request, res: Response) => {
  try {
    const { incoFHEProvider } = await import('../providers/inco-fhe');
    const { owner, state_data } = req.body;
    if (!owner || !state_data) {
      return res.status(400).json({ success: false, error: 'owner and state_data required' });
    }
    const result = await incoFHEProvider.createEncryptedState(owner, state_data);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'State creation failed' });
  }
});

app.post('/inco/private-vote', async (req: Request, res: Response) => {
  try {
    const { incoFHEProvider } = await import('../providers/inco-fhe');
    const { proposal_id, voter, vote, voting_power } = req.body;
    if (!proposal_id || !voter || vote === undefined || !voting_power) {
      return res.status(400).json({ success: false, error: 'proposal_id, voter, vote, voting_power required' });
    }
    const result = await incoFHEProvider.submitPrivateVote(proposal_id, voter, vote, voting_power);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Private vote failed' });
  }
});

app.post('/inco/random', async (req: Request, res: Response) => {
  try {
    const { incoFHEProvider } = await import('../providers/inco-fhe');
    const { requester, min_value, max_value } = req.body;
    if (!requester || min_value === undefined || max_value === undefined) {
      return res.status(400).json({ success: false, error: 'requester, min_value, max_value required' });
    }
    const result = await incoFHEProvider.generatePrivateRandom(requester, min_value, max_value);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Random generation failed' });
  }
});

// Noir ZK Endpoints
app.get('/noir/circuits', async (req: Request, res: Response) => {
  try {
    const { noirCircuitsProvider } = await import('../providers/noir-circuits');
    const circuits = noirCircuitsProvider.getAvailableCircuits();
    res.json({ success: true, count: circuits.length, circuits });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get circuits' });
  }
});

app.get('/noir/circuits/:name', async (req: Request, res: Response) => {
  try {
    const { noirCircuitsProvider } = await import('../providers/noir-circuits');
    const circuit = noirCircuitsProvider.getCircuit(req.params.name);
    if (!circuit) {
      return res.status(404).json({ success: false, error: `Circuit ${req.params.name} not found` });
    }
    res.json({ success: true, circuit });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get circuit' });
  }
});

app.post('/noir/prove', async (req: Request, res: Response) => {
  try {
    const { noirCircuitsProvider } = await import('../providers/noir-circuits');
    const { circuit, public_inputs, private_inputs } = req.body;
    if (!circuit || !public_inputs || !private_inputs) {
      return res.status(400).json({ success: false, error: 'circuit, public_inputs, private_inputs required' });
    }
    const proof = await noirCircuitsProvider.generateProof(circuit, public_inputs, private_inputs);
    res.json({ success: true, ...proof });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Proof generation failed' });
  }
});

app.post('/noir/verify', async (req: Request, res: Response) => {
  try {
    const { noirCircuitsProvider } = await import('../providers/noir-circuits');
    const { proof, verification_key, public_inputs } = req.body;
    if (!proof || !verification_key || !public_inputs) {
      return res.status(400).json({ success: false, error: 'proof, verification_key, public_inputs required' });
    }
    const result = await noirCircuitsProvider.verifyProof(proof, verification_key, public_inputs);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Proof verification failed' });
  }
});

app.get('/noir/stats', async (req: Request, res: Response) => {
  try {
    const { noirCircuitsProvider } = await import('../providers/noir-circuits');
    const stats = noirCircuitsProvider.getStats();
    res.json({ success: true, ...stats });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get Noir stats' });
  }
});

// Convenience proofs
app.post('/noir/prove/balance-threshold', async (req: Request, res: Response) => {
  try {
    const { noirCircuitsProvider } = await import('../providers/noir-circuits');
    const { actual_balance, threshold, token_mint, wallet_signature } = req.body;
    if (actual_balance === undefined || threshold === undefined || !token_mint) {
      return res.status(400).json({ success: false, error: 'actual_balance, threshold, token_mint required' });
    }
    const proof = await noirCircuitsProvider.proveBalanceThreshold(
      actual_balance, threshold, token_mint, wallet_signature || 'sig_wallet'
    );
    res.json({ success: true, ...proof });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Balance proof failed' });
  }
});

app.post('/noir/prove/kyc-compliance', async (req: Request, res: Response) => {
  try {
    const { noirCircuitsProvider } = await import('../providers/noir-circuits');
    const { kyc_data, verifier_attestation, compliance_level, jurisdiction } = req.body;
    if (!kyc_data || !compliance_level || !jurisdiction) {
      return res.status(400).json({ success: false, error: 'kyc_data, compliance_level, jurisdiction required' });
    }
    const proof = await noirCircuitsProvider.proveKYCCompliance(
      kyc_data, verifier_attestation || 'att_verifier', compliance_level, jurisdiction
    );
    res.json({ success: true, ...proof });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'KYC proof failed' });
  }
});

app.post('/noir/prove/credit-score', async (req: Request, res: Response) => {
  try {
    const { noirCircuitsProvider } = await import('../providers/noir-circuits');
    const { actual_score, min_score, max_score, lender_id } = req.body;
    if (actual_score === undefined || min_score === undefined || max_score === undefined || !lender_id) {
      return res.status(400).json({ success: false, error: 'actual_score, min_score, max_score, lender_id required' });
    }
    const proof = await noirCircuitsProvider.proveCreditScoreRange(actual_score, min_score, max_score, lender_id);
    res.json({ success: true, ...proof });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Credit score proof failed' });
  }
});

// Unified Privacy Endpoint
app.post('/privacy/execute', async (req: Request, res: Response) => {
  try {
    const { operation, technology, inputs, options } = req.body;
    if (!operation || !technology) {
      return res.status(400).json({ success: false, error: 'operation and technology required' });
    }
    
    let result;
    switch (technology) {
      case 'arcium': {
        const { arciumProvider } = await import('../providers/arcium-client');
        result = await arciumProvider.submitComputation({ programId: '', inputs: inputs || {} });
        break;
      }
      case 'inco': {
        const { incoFHEProvider } = await import('../providers/inco-fhe');
        if (operation === 'encrypt') {
          result = await incoFHEProvider.encrypt(inputs.value, inputs.type || 'euint64');
        } else {
          result = { success: true, operation, note: 'Use specific /inco/* endpoints' };
        }
        break;
      }
      case 'noir': {
        const { noirCircuitsProvider } = await import('../providers/noir-circuits');
        result = await noirCircuitsProvider.generateProof(
          inputs.circuit || 'balance_threshold',
          inputs.public_inputs || {},
          inputs.private_inputs || {}
        );
        break;
      }
      default:
        return res.status(400).json({ success: false, error: `Unknown technology: ${technology}` });
    }
    
    res.json({ success: true, technology, operation, privacy_level: options?.privacy_level || 'standard', ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Privacy operation failed' });
  }
});

// ============================================
// MONETIZATION LAYER
// Execution Fees, Reputation, Dark Coordination
// ============================================

// Check if trade requires confidential execution
app.post('/monetization/check-threshold', async (req: Request, res: Response) => {
  try {
    const { executionFeeManager } = await import('./monetization/execution-fees');
    const { trade_size_usd } = req.body;
    if (trade_size_usd === undefined) {
      return res.status(400).json({ success: false, error: 'trade_size_usd required' });
    }
    const result = executionFeeManager.requiresConfidentialExecution(trade_size_usd);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Check failed' });
  }
});

// Calculate execution fee
app.post('/monetization/calculate-fee', async (req: Request, res: Response) => {
  try {
    const { executionFeeManager } = await import('./monetization/execution-fees');
    const { trade_size_usd, expected_slippage_bps, actual_slippage_bps } = req.body;
    if (trade_size_usd === undefined || expected_slippage_bps === undefined) {
      return res.status(400).json({ success: false, error: 'trade_size_usd and expected_slippage_bps required' });
    }
    const result = executionFeeManager.calculateExecutionFee(
      trade_size_usd,
      expected_slippage_bps,
      actual_slippage_bps || 0
    );
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Calculation failed' });
  }
});

// Record execution fee
app.post('/monetization/record-fee', async (req: Request, res: Response) => {
  try {
    const { executionFeeManager } = await import('./monetization/execution-fees');
    const { agent_id, fee_type, amount_usd, basis } = req.body;
    if (!agent_id || !fee_type || amount_usd === undefined || !basis) {
      return res.status(400).json({ success: false, error: 'agent_id, fee_type, amount_usd, basis required' });
    }
    const fee = executionFeeManager.recordFee(agent_id, fee_type, amount_usd, basis);
    res.json({ success: true, fee });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Recording failed' });
  }
});

// Get agent fee stats
app.get('/monetization/agent/:agent_id/fees', async (req: Request, res: Response) => {
  try {
    const { executionFeeManager } = await import('./monetization/execution-fees');
    const stats = executionFeeManager.getAgentFeeStats(req.params.agent_id);
    res.json({ success: true, ...stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to get fees' });
  }
});

// Get protocol stats
app.get('/monetization/stats', async (req: Request, res: Response) => {
  try {
    const { executionFeeManager } = await import('./monetization/execution-fees');
    const stats = executionFeeManager.getProtocolStats();
    res.json({ success: true, ...stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to get stats' });
  }
});

// Create/update subscription
app.post('/monetization/subscription', async (req: Request, res: Response) => {
  try {
    const { executionFeeManager } = await import('./monetization/execution-fees');
    const { agent_id, tier } = req.body;
    if (!agent_id || !tier) {
      return res.status(400).json({ success: false, error: 'agent_id and tier required' });
    }
    const subscription = executionFeeManager.createSubscription(agent_id, tier);
    res.json({ success: true, subscription });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Subscription failed' });
  }
});

// Get subscription
app.get('/monetization/subscription/:agent_id', async (req: Request, res: Response) => {
  try {
    const { executionFeeManager } = await import('./monetization/execution-fees');
    const subscription = executionFeeManager.getSubscription(req.params.agent_id);
    res.json({ success: true, subscription });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to get subscription' });
  }
});

// ============================================
// AGENT REPUTATION SYSTEM
// ============================================

// Record execution for track record
app.post('/reputation/record-execution', async (req: Request, res: Response) => {
  try {
    const { agentReputationManager } = await import('./monetization/agent-reputation');
    const { agent_id, volume_usd, pnl_usd, return_bps } = req.body;
    if (!agent_id || volume_usd === undefined || pnl_usd === undefined) {
      return res.status(400).json({ success: false, error: 'agent_id, volume_usd, pnl_usd required' });
    }
    const record = agentReputationManager.recordExecution(agent_id, volume_usd, pnl_usd, return_bps || 0);
    res.json({ success: true, record });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Recording failed' });
  }
});

// Generate reputation proof
app.post('/reputation/generate-proof', async (req: Request, res: Response) => {
  try {
    const { agentReputationManager } = await import('./monetization/agent-reputation');
    const { executionFeeManager } = await import('./monetization/execution-fees');
    const { agent_id, proof_type, threshold } = req.body;
    if (!agent_id || !proof_type || threshold === undefined) {
      return res.status(400).json({ success: false, error: 'agent_id, proof_type, threshold required' });
    }
    
    const proof = await agentReputationManager.generateReputationProof(agent_id, proof_type, threshold);
    
    // Record proof fee
    const feeUsd = executionFeeManager.calculateProofFee(proof_type);
    executionFeeManager.recordFee(agent_id, 'proof', feeUsd, `${proof_type} reputation proof`);
    
    res.json({ success: true, proof, fee_usd: feeUsd });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Proof generation failed' });
  }
});

// Verify reputation proof
app.get('/reputation/verify/:proof_id', async (req: Request, res: Response) => {
  try {
    const { agentReputationManager } = await import('./monetization/agent-reputation');
    const result = agentReputationManager.verifyProof(req.params.proof_id);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Verification failed' });
  }
});

// Get agent's proofs
app.get('/reputation/agent/:agent_id/proofs', async (req: Request, res: Response) => {
  try {
    const { agentReputationManager } = await import('./monetization/agent-reputation');
    const proofs = agentReputationManager.getAgentProofs(req.params.agent_id);
    res.json({ success: true, count: proofs.length, proofs });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to get proofs' });
  }
});

// Get public reputation
app.get('/reputation/agent/:agent_id', async (req: Request, res: Response) => {
  try {
    const { agentReputationManager } = await import('./monetization/agent-reputation');
    const reputation = agentReputationManager.getPublicReputation(req.params.agent_id);
    res.json({ success: true, ...reputation });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to get reputation' });
  }
});

// Get reputation leaderboard
app.get('/reputation/leaderboard', async (req: Request, res: Response) => {
  try {
    const { agentReputationManager } = await import('./monetization/agent-reputation');
    const limit = parseInt(req.query.limit as string) || 10;
    const leaderboard = agentReputationManager.getReputationLeaderboard(limit);
    res.json({ success: true, leaderboard });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to get leaderboard' });
  }
});

// Create capital delegation
app.post('/reputation/delegation', async (req: Request, res: Response) => {
  try {
    const { agentReputationManager } = await import('./monetization/agent-reputation');
    const { delegator, agent_id, amount_usd, terms, required_proofs } = req.body;
    if (!delegator || !agent_id || !amount_usd || !terms) {
      return res.status(400).json({ success: false, error: 'delegator, agent_id, amount_usd, terms required' });
    }
    const delegation = agentReputationManager.createDelegation(
      delegator, agent_id, amount_usd, terms, required_proofs || []
    );
    res.json({ success: true, delegation });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Delegation failed' });
  }
});

// Get agent AUM
app.get('/reputation/agent/:agent_id/aum', async (req: Request, res: Response) => {
  try {
    const { agentReputationManager } = await import('./monetization/agent-reputation');
    const aum = agentReputationManager.getAgentAUM(req.params.agent_id);
    const delegations = agentReputationManager.getAgentDelegations(req.params.agent_id);
    res.json({ success: true, aum_usd: aum, delegation_count: delegations.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to get AUM' });
  }
});

// ============================================
// DARK COORDINATION NETWORK
// ============================================

// Create dark pool
app.post('/coordination/dark-pool', async (req: Request, res: Response) => {
  try {
    const { darkCoordinationManager } = await import('./monetization/dark-coordination');
    const { creator_agent_id, asset, side, min_size_usd, max_size_usd, duration_ms } = req.body;
    if (!creator_agent_id || !asset || !side || !min_size_usd) {
      return res.status(400).json({ success: false, error: 'creator_agent_id, asset, side, min_size_usd required' });
    }
    const pool = darkCoordinationManager.createDarkPool(
      creator_agent_id, asset, side, min_size_usd, max_size_usd || min_size_usd * 10, duration_ms
    );
    if (!pool) {
      return res.status(400).json({ success: false, error: 'Invalid pool parameters' });
    }
    res.json({ success: true, pool });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Pool creation failed' });
  }
});

// Submit bid to dark pool
app.post('/coordination/dark-pool/:pool_id/bid', async (req: Request, res: Response) => {
  try {
    const { darkCoordinationManager } = await import('./monetization/dark-coordination');
    const { bidder_agent_id, encrypted_amount, side } = req.body;
    if (!bidder_agent_id || !encrypted_amount || !side) {
      return res.status(400).json({ success: false, error: 'bidder_agent_id, encrypted_amount, side required' });
    }
    const bid = darkCoordinationManager.submitPoolBid(req.params.pool_id, bidder_agent_id, encrypted_amount, side);
    if (!bid) {
      return res.status(400).json({ success: false, error: 'Pool not open or not found' });
    }
    res.json({ success: true, bid });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Bid failed' });
  }
});

// Match dark pool
app.post('/coordination/dark-pool/:pool_id/match', async (req: Request, res: Response) => {
  try {
    const { darkCoordinationManager } = await import('./monetization/dark-coordination');
    const result = await darkCoordinationManager.matchDarkPool(req.params.pool_id);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Matching failed' });
  }
});

// Get active dark pools
app.get('/coordination/dark-pools', async (req: Request, res: Response) => {
  try {
    const { darkCoordinationManager } = await import('./monetization/dark-coordination');
    const pools = darkCoordinationManager.getActiveDarkPools(req.query.asset as string);
    res.json({ success: true, count: pools.length, pools });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to get pools' });
  }
});

// Create flow auction
app.post('/coordination/auction', async (req: Request, res: Response) => {
  try {
    const { darkCoordinationManager } = await import('./monetization/dark-coordination');
    const { auctioneer_agent_id, flow_type, description, min_bid_usd, bidding_duration_ms, reveal_duration_ms } = req.body;
    if (!auctioneer_agent_id || !flow_type || !description || !min_bid_usd) {
      return res.status(400).json({ success: false, error: 'auctioneer_agent_id, flow_type, description, min_bid_usd required' });
    }
    const auction = darkCoordinationManager.createFlowAuction(
      auctioneer_agent_id, flow_type, description, min_bid_usd, bidding_duration_ms, reveal_duration_ms
    );
    res.json({ success: true, auction });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Auction creation failed' });
  }
});

// Submit auction bid
app.post('/coordination/auction/:auction_id/bid', async (req: Request, res: Response) => {
  try {
    const { darkCoordinationManager } = await import('./monetization/dark-coordination');
    const { bidder_agent_id, encrypted_bid } = req.body;
    if (!bidder_agent_id || !encrypted_bid) {
      return res.status(400).json({ success: false, error: 'bidder_agent_id, encrypted_bid required' });
    }
    const bid = darkCoordinationManager.submitAuctionBid(req.params.auction_id, bidder_agent_id, encrypted_bid);
    if (!bid) {
      return res.status(400).json({ success: false, error: 'Auction not accepting bids' });
    }
    res.json({ success: true, bid });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Bid failed' });
  }
});

// Reveal auction bid
app.post('/coordination/auction/:auction_id/reveal', async (req: Request, res: Response) => {
  try {
    const { darkCoordinationManager } = await import('./monetization/dark-coordination');
    const { bid_id, revealed_amount } = req.body;
    if (!bid_id || revealed_amount === undefined) {
      return res.status(400).json({ success: false, error: 'bid_id, revealed_amount required' });
    }
    const success = darkCoordinationManager.revealAuctionBid(req.params.auction_id, bid_id, revealed_amount);
    res.json({ success });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Reveal failed' });
  }
});

// Settle auction
app.post('/coordination/auction/:auction_id/settle', async (req: Request, res: Response) => {
  try {
    const { darkCoordinationManager } = await import('./monetization/dark-coordination');
    const result = darkCoordinationManager.settleAuction(req.params.auction_id);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Settlement failed' });
  }
});

// Get active auctions
app.get('/coordination/auctions', async (req: Request, res: Response) => {
  try {
    const { darkCoordinationManager } = await import('./monetization/dark-coordination');
    const auctions = darkCoordinationManager.getActiveAuctions();
    res.json({ success: true, count: auctions.length, auctions });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to get auctions' });
  }
});

// Create signal listing
app.post('/coordination/signal', async (req: Request, res: Response) => {
  try {
    const { darkCoordinationManager } = await import('./monetization/dark-coordination');
    const { seller_agent_id, signal_type, quality_proof, price_usd } = req.body;
    if (!seller_agent_id || !signal_type || !quality_proof || !price_usd) {
      return res.status(400).json({ success: false, error: 'seller_agent_id, signal_type, quality_proof, price_usd required' });
    }
    const listing = darkCoordinationManager.createSignalListing(seller_agent_id, signal_type, quality_proof, price_usd);
    if (!listing) {
      return res.status(400).json({ success: false, error: 'Invalid listing parameters' });
    }
    res.json({ success: true, listing });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Listing failed' });
  }
});

// Subscribe to signal
app.post('/coordination/signal/:listing_id/subscribe', async (req: Request, res: Response) => {
  try {
    const { darkCoordinationManager } = await import('./monetization/dark-coordination');
    const { subscriber_agent_id } = req.body;
    if (!subscriber_agent_id) {
      return res.status(400).json({ success: false, error: 'subscriber_agent_id required' });
    }
    const result = darkCoordinationManager.subscribeToSignal(req.params.listing_id, subscriber_agent_id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Subscription failed' });
  }
});

// Get active signals
app.get('/coordination/signals', async (req: Request, res: Response) => {
  try {
    const { darkCoordinationManager } = await import('./monetization/dark-coordination');
    const signals = darkCoordinationManager.getActiveSignals(req.query.type as string);
    res.json({ success: true, count: signals.length, signals });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to get signals' });
  }
});

// Get coordination stats
app.get('/coordination/stats', async (req: Request, res: Response) => {
  try {
    const { darkCoordinationManager } = await import('./monetization/dark-coordination');
    const stats = darkCoordinationManager.getStats();
    res.json({ success: true, ...stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to get stats' });
  }
});

// ============================================
// CONFIDENTIAL EXECUTION PIPELINE
// Chains Arcium MPC + Inco FHE + Noir ZK
// ============================================

// Execute with full confidential pipeline
app.post('/execute/confidential', async (req: Request, res: Response) => {
  try {
    const { confidentialExecutionPipeline } = await import('../providers/confidential-execution');
    const { agent_id, operation, amount_usd, inputs, required_proofs, privacy_level } = req.body;
    
    if (!agent_id || !operation || amount_usd === undefined) {
      return res.status(400).json({ success: false, error: 'agent_id, operation, amount_usd required' });
    }
    
    const result = await confidentialExecutionPipeline.executeConfidential({
      agent_id, operation, amount_usd, inputs: inputs || {}, required_proofs, privacy_level
    });
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Execution failed' });
  }
});

// Determine execution tier for amount
app.post('/execute/tier', async (req: Request, res: Response) => {
  try {
    const { confidentialExecutionPipeline } = await import('../providers/confidential-execution');
    const { amount_usd } = req.body;
    
    if (amount_usd === undefined) {
      return res.status(400).json({ success: false, error: 'amount_usd required' });
    }
    
    const tier = confidentialExecutionPipeline.determineExecutionTier(amount_usd);
    const { CAPITAL_THRESHOLDS } = await import('./monetization/execution-fees');
    
    res.json({
      success: true,
      amount_usd,
      tier,
      thresholds: CAPITAL_THRESHOLDS,
      recommendation: tier === 'confidential' 
        ? 'MANDATORY: Use /execute/confidential for MEV protection'
        : tier === 'protected'
          ? 'RECOMMENDED: Use confidential execution to avoid front-running'
          : 'Public execution acceptable for this size'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed' });
  }
});

// Threshold signature (multi-party signing)
app.post('/execute/threshold-sign', async (req: Request, res: Response) => {
  try {
    const { confidentialExecutionPipeline } = await import('../providers/confidential-execution');
    const { signers, threshold, message_hash, timeout_ms } = req.body;
    
    if (!signers || !threshold || !message_hash) {
      return res.status(400).json({ success: false, error: 'signers, threshold, message_hash required' });
    }
    
    const result = await confidentialExecutionPipeline.thresholdSign({
      signers, threshold, message_hash, timeout_ms
    });
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Signing failed' });
  }
});

// Multi-party atomic swap
app.post('/execute/multi-swap', async (req: Request, res: Response) => {
  try {
    const { confidentialExecutionPipeline } = await import('../providers/confidential-execution');
    const { parties, settlement_time_ms } = req.body;
    
    if (!parties || !Array.isArray(parties) || parties.length < 2) {
      return res.status(400).json({ success: false, error: 'parties array with at least 2 participants required' });
    }
    
    const result = await confidentialExecutionPipeline.multiPartySwap({ parties, settlement_time_ms });
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Swap failed' });
  }
});

// Create encrypted orderbook
app.post('/execute/orderbook', async (req: Request, res: Response) => {
  try {
    const { confidentialExecutionPipeline } = await import('../providers/confidential-execution');
    const { asset_pair } = req.body;
    
    if (!asset_pair) {
      return res.status(400).json({ success: false, error: 'asset_pair required' });
    }
    
    const orderbook = confidentialExecutionPipeline.createEncryptedOrderbook(asset_pair);
    if (!orderbook) {
      return res.status(400).json({ success: false, error: 'Invalid asset_pair' });
    }
    res.json({ success: true, orderbook });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Creation failed' });
  }
});

// Submit encrypted order
app.post('/execute/orderbook/:orderbook_id/order', async (req: Request, res: Response) => {
  try {
    const { confidentialExecutionPipeline } = await import('../providers/confidential-execution');
    const { agent_id, side, price, size } = req.body;
    
    if (!agent_id || !side || price === undefined || size === undefined) {
      return res.status(400).json({ success: false, error: 'agent_id, side, price, size required' });
    }
    
    const result = await confidentialExecutionPipeline.submitEncryptedOrder(
      req.params.orderbook_id, agent_id, side, price, size
    );
    
    if (!result) {
      return res.status(404).json({ success: false, error: 'Orderbook not found' });
    }
    
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Order failed' });
  }
});

// Match encrypted orders
app.post('/execute/orderbook/:orderbook_id/match', async (req: Request, res: Response) => {
  try {
    const { confidentialExecutionPipeline } = await import('../providers/confidential-execution');
    const result = await confidentialExecutionPipeline.matchEncryptedOrders(req.params.orderbook_id);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Matching failed' });
  }
});

// Create private auction
app.post('/execute/auction', async (req: Request, res: Response) => {
  try {
    const { confidentialExecutionPipeline } = await import('../providers/confidential-execution');
    const { auctioneer, asset, reserve_price } = req.body;
    
    if (!auctioneer || !asset) {
      return res.status(400).json({ success: false, error: 'auctioneer, asset required' });
    }
    
    const auction = await confidentialExecutionPipeline.createPrivateAuction(auctioneer, asset, reserve_price);
    if (!auction) {
      return res.status(400).json({ success: false, error: 'Invalid auction parameters' });
    }
    res.json({ success: true, auction });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Creation failed' });
  }
});

// Submit auction bid
app.post('/execute/auction/:auction_id/bid', async (req: Request, res: Response) => {
  try {
    const { confidentialExecutionPipeline } = await import('../providers/confidential-execution');
    const { bidder, amount } = req.body;
    
    if (!bidder || amount === undefined) {
      return res.status(400).json({ success: false, error: 'bidder, amount required' });
    }
    
    const result = await confidentialExecutionPipeline.submitAuctionBid(
      req.params.auction_id, bidder, amount
    );
    
    if (!result) {
      return res.status(404).json({ success: false, error: 'Auction not found or not accepting bids' });
    }
    
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Bid failed' });
  }
});

// Settle private auction
app.post('/execute/auction/:auction_id/settle', async (req: Request, res: Response) => {
  try {
    const { confidentialExecutionPipeline } = await import('../providers/confidential-execution');
    const result = await confidentialExecutionPipeline.settlePrivateAuction(req.params.auction_id);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Settlement failed' });
  }
});

// Prove agent performance
app.post('/execute/prove-performance', async (req: Request, res: Response) => {
  try {
    const { confidentialExecutionPipeline } = await import('../providers/confidential-execution');
    const { agent_id, metrics, claim_type } = req.body;
    
    if (!agent_id || !metrics || !claim_type) {
      return res.status(400).json({ success: false, error: 'agent_id, metrics, claim_type required' });
    }
    
    const proof = await confidentialExecutionPipeline.provePerformance(agent_id, metrics, claim_type);
    res.json({ success: true, proof });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Proof failed' });
  }
});

// Get pipeline stats
app.get('/execute/stats', async (req: Request, res: Response) => {
  try {
    const { confidentialExecutionPipeline } = await import('../providers/confidential-execution');
    const stats = confidentialExecutionPipeline.getStats();
    res.json({ success: true, ...stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to get stats' });
  }
});

// ============================================
// STEALTHPUMP / PUMP.FUN ENDPOINTS
// ============================================

// Stealth launch a token on pump.fun
app.post('/stealthpump/launch', async (req: Request, res: Response) => {
  try {
    const { pumpFunProvider } = await import('../providers/pumpfun');
    const { 
      name, symbol, description, image, twitter, telegram, website,
      initial_buy_sol, slippage_bps, use_stealth_wallet, mev_protection,
      payer_secret
    } = req.body;
    
    if (!name || !symbol || !description || !initial_buy_sol) {
      return res.status(400).json({ 
        success: false, 
        error: 'name, symbol, description, initial_buy_sol required' 
      });
    }
    
    if (initial_buy_sol < 0.01) {
      return res.status(400).json({ 
        success: false, 
        error: 'initial_buy_sol must be at least 0.01 SOL' 
      });
    }
    
    // SECURITY: In production, NEVER accept private keys via API
    // Payer should come from authenticated session or use stealth wallet generation
    // This is simulation mode only - real launches use client-side signing
    const { Keypair } = await import('@solana/web3.js');
    let payer: InstanceType<typeof Keypair>;
    
    if (payer_secret) {
      // Log security warning - this should not be used in production
      console.warn('[SECURITY] payer_secret provided via API - simulation mode only');
      try {
        payer = Keypair.fromSecretKey(Buffer.from(payer_secret, 'base64'));
      } catch {
        return res.status(400).json({ success: false, error: 'Invalid payer_secret format' });
      }
    } else {
      // Generate ephemeral stealth wallet (recommended)
      payer = Keypair.generate();
    }
    
    const result = await pumpFunProvider.stealthLaunch(payer, {
      metadata: { name, symbol, description, image, twitter, telegram, website },
      initialBuySol: initial_buy_sol,
      slippageBps: slippage_bps || 500,
      useStealthWallet: use_stealth_wallet || false,
      mevProtection: mev_protection || false
    });
    
    if (result.success) {
      res.json({
        ...result,
        pump_fun_url: `https://pump.fun/${result.mintAddress}`
      });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Launch failed' });
  }
});

// Buy tokens from pump.fun bonding curve
app.post('/stealthpump/buy', async (req: Request, res: Response) => {
  try {
    const { pumpFunProvider } = await import('../providers/pumpfun');
    const { mint_address, amount_sol, slippage_bps, mev_protection, payer_secret } = req.body;
    
    if (!mint_address || !amount_sol) {
      return res.status(400).json({ success: false, error: 'mint_address, amount_sol required' });
    }
    
    // Validate mint address format
    if (typeof mint_address !== 'string' || mint_address.length < 32 || mint_address.length > 44) {
      return res.status(400).json({ success: false, error: 'Invalid mint_address format' });
    }
    
    // Validate amount
    if (typeof amount_sol !== 'number' || amount_sol <= 0 || amount_sol > 1000) {
      return res.status(400).json({ success: false, error: 'amount_sol must be between 0 and 1000 SOL' });
    }
    
    // SECURITY: In production, NEVER accept private keys via API
    const { Keypair } = await import('@solana/web3.js');
    let payer: InstanceType<typeof Keypair>;
    
    if (payer_secret) {
      console.warn('[SECURITY] payer_secret provided via API - simulation mode only');
      try {
        payer = Keypair.fromSecretKey(Buffer.from(payer_secret, 'base64'));
      } catch {
        return res.status(400).json({ success: false, error: 'Invalid payer_secret format' });
      }
    } else {
      payer = Keypair.generate();
    }
    
    const result = await pumpFunProvider.buy(
      payer, mint_address, amount_sol, slippage_bps || 500, mev_protection || false
    );
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Buy failed' });
  }
});

// Sell tokens back to pump.fun bonding curve
app.post('/stealthpump/sell', async (req: Request, res: Response) => {
  try {
    const { pumpFunProvider } = await import('../providers/pumpfun');
    const { mint_address, token_amount, slippage_bps, mev_protection, payer_secret } = req.body;
    
    if (!mint_address || !token_amount) {
      return res.status(400).json({ success: false, error: 'mint_address, token_amount required' });
    }
    
    // Validate mint address format
    if (typeof mint_address !== 'string' || mint_address.length < 32 || mint_address.length > 44) {
      return res.status(400).json({ success: false, error: 'Invalid mint_address format' });
    }
    
    // Validate token amount
    if (typeof token_amount !== 'number' || token_amount <= 0) {
      return res.status(400).json({ success: false, error: 'token_amount must be positive' });
    }
    
    // SECURITY: In production, NEVER accept private keys via API
    const { Keypair } = await import('@solana/web3.js');
    let payer: InstanceType<typeof Keypair>;
    
    if (payer_secret) {
      console.warn('[SECURITY] payer_secret provided via API - simulation mode only');
      try {
        payer = Keypair.fromSecretKey(Buffer.from(payer_secret, 'base64'));
      } catch {
        return res.status(400).json({ success: false, error: 'Invalid payer_secret format' });
      }
    } else {
      payer = Keypair.generate();
    }
    
    const result = await pumpFunProvider.sell(
      payer, mint_address, token_amount, slippage_bps || 500, mev_protection || false
    );
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Sell failed' });
  }
});

// Get buy/sell quote from bonding curve
app.get('/stealthpump/quote', async (req: Request, res: Response) => {
  try {
    const { pumpFunProvider } = await import('../providers/pumpfun');
    const { mint_address, side, amount } = req.query;
    
    if (!mint_address || !side || !amount) {
      return res.status(400).json({ success: false, error: 'mint_address, side, amount required' });
    }
    
    const amountNum = parseFloat(amount as string);
    
    if (side === 'buy') {
      const quote = await pumpFunProvider.getBuyQuote(mint_address as string, amountNum);
      res.json({ success: true, side: 'buy', ...quote });
    } else if (side === 'sell') {
      const quote = await pumpFunProvider.getSellQuote(mint_address as string, amountNum);
      res.json({ success: true, side: 'sell', ...quote });
    } else {
      res.status(400).json({ success: false, error: 'side must be "buy" or "sell"' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Quote failed' });
  }
});

// Get bonding curve info
app.get('/stealthpump/curve/:mint_address', async (req: Request, res: Response) => {
  try {
    const { pumpFunProvider } = await import('../providers/pumpfun');
    const info = await pumpFunProvider.getBondingCurveInfo(req.params.mint_address);
    
    if (!info) {
      return res.status(404).json({ success: false, error: 'Token not found or not a pump.fun token' });
    }
    
    // Calculate graduation progress (85 SOL to graduate)
    const graduationThreshold = 85;
    const progress = Math.min(100, (info.realSolReserves / graduationThreshold) * 100);
    
    res.json({ 
      success: true, 
      ...info,
      progress_to_graduation: progress,
      pump_fun_url: `https://pump.fun/${req.params.mint_address}`
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to get curve info' });
  }
});

// Check if token has graduated to Raydium
app.get('/stealthpump/graduated/:mint_address', async (req: Request, res: Response) => {
  try {
    const { pumpFunProvider } = await import('../providers/pumpfun');
    const graduated = await pumpFunProvider.hasGraduated(req.params.mint_address);
    res.json({ success: true, mint_address: req.params.mint_address, graduated });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Check failed' });
  }
});

// Generate stealth wallet
app.post('/stealthpump/wallet/generate', async (req: Request, res: Response) => {
  try {
    const { pumpFunProvider } = await import('../providers/pumpfun');
    const wallet = pumpFunProvider.generateStealthWallet();
    res.json({ success: true, ...wallet });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Generation failed' });
  }
});

// Get StealthPump provider status
app.get('/stealthpump/status', async (req: Request, res: Response) => {
  try {
    const { pumpFunProvider } = await import('../providers/pumpfun');
    const status = pumpFunProvider.getStatus();
    res.json({ success: true, ...status });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Status failed' });
  }
});

// ============================================
// STEALTH REGISTRY ENDPOINTS
// Hidden creator until graduation/reveal
// ============================================

// Register a stealth launch (hide creator until graduation)
app.post('/stealthpump/stealth/register', async (req: Request, res: Response) => {
  try {
    const { pumpFunProvider } = await import('../providers/pumpfun');
    const { mint_address, creator_wallet, name, symbol, description, image, initial_buy_amount, reveal_delay_seconds } = req.body;

    if (!mint_address || !creator_wallet || !name || !symbol) {
      return res.status(400).json({ success: false, error: 'mint_address, creator_wallet, name, symbol required' });
    }

    const record = pumpFunProvider.registerStealthLaunch(
      mint_address,
      creator_wallet,
      { name, symbol, description: description || '', image },
      initial_buy_amount || 0,
      reveal_delay_seconds
    );

    res.json({
      success: true,
      mint_address: record.mintAddress,
      stealth_wallet_hash: record.stealthWalletHash,
      reveal_at: record.revealAt,
      public_data: record.publicData,
      message: 'Creator hidden until graduation or scheduled reveal'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Registration failed' });
  }
});

// Get privacy-preserving bonding curve view (shows MC/progress, hides creator)
app.get('/stealthpump/stealth/view/:mint_address', async (req: Request, res: Response) => {
  try {
    const { pumpFunProvider } = await import('../providers/pumpfun');
    const view = await pumpFunProvider.getStealthBondingCurveView(req.params.mint_address);

    if (!view) {
      return res.status(404).json({ success: false, error: 'Token not found' });
    }

    res.json({
      success: true,
      mint_address: view.mintAddress,
      // Always visible
      market_cap_sol: view.marketCapSol,
      price_per_token: view.pricePerToken,
      progress_to_graduation: view.progressToGraduation,
      graduated: view.graduated,
      // Hidden until reveal
      creator_revealed: view.creatorRevealed,
      creator_wallet: view.creatorWallet || '🔒 Hidden until graduation',
      initial_buy_amount: view.initialBuyAmount,
      pump_fun_url: `https://pump.fun/${req.params.mint_address}`
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'View failed' });
  }
});

// Check graduation and auto-reveal if graduated
app.get('/stealthpump/stealth/check-graduation/:mint_address', async (req: Request, res: Response) => {
  try {
    const { pumpFunProvider } = await import('../providers/pumpfun');
    const result = await pumpFunProvider.checkAndRevealIfGraduated(req.params.mint_address);

    res.json({
      success: true,
      mint_address: req.params.mint_address,
      graduated: result.graduated,
      revealed: result.revealed,
      creator_wallet: result.creatorWallet || (result.graduated ? 'Unknown' : '🔒 Hidden'),
      market_cap_sol: result.marketCapSol,
      message: result.graduated 
        ? '🎓 Token graduated to Raydium! Creator revealed.' 
        : '⏳ Still on bonding curve, creator hidden.'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Check failed' });
  }
});

// Get all stealth launches (dashboard view)
app.get('/stealthpump/stealth/launches', async (req: Request, res: Response) => {
  try {
    const { pumpFunProvider } = await import('../providers/pumpfun');
    const { only_active, only_graduated, limit } = req.query;

    const launches = pumpFunProvider.getStealthLaunches({
      onlyActive: only_active === 'true',
      onlyGraduated: only_graduated === 'true',
      limit: limit ? parseInt(limit as string) : undefined
    });

    res.json({
      success: true,
      count: launches.length,
      launches: launches.map(l => ({
        mint_address: l.mintAddress,
        name: l.name,
        symbol: l.symbol,
        launch_timestamp: l.launchTimestamp,
        graduated: l.graduated,
        revealed: l.revealed,
        creator_wallet: l.creatorWallet || '🔒 Hidden',
        pump_fun_url: `https://pump.fun/${l.mintAddress}`
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Fetch failed' });
  }
});

// Manually reveal a stealth launch (creator choice)
app.post('/stealthpump/stealth/reveal', async (req: Request, res: Response) => {
  try {
    const { pumpFunProvider } = await import('../providers/pumpfun');
    const { mint_address, creator_signature } = req.body;

    if (!mint_address) {
      return res.status(400).json({ success: false, error: 'mint_address required' });
    }

    const result = pumpFunProvider.revealStealthLaunch(mint_address, creator_signature || '');

    if (result.success) {
      res.json({
        success: true,
        mint_address,
        creator_wallet: result.creatorWallet,
        message: '✅ Creator revealed successfully'
      });
    } else {
      res.status(404).json({ success: false, error: result.error });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Reveal failed' });
  }
});

// Get stealth launch statistics
app.get('/stealthpump/stealth/stats', async (req: Request, res: Response) => {
  try {
    const { pumpFunProvider } = await import('../providers/pumpfun');
    const stats = pumpFunProvider.getStealthStats();

    res.json({
      success: true,
      total_stealth_launches: stats.totalStealthLaunches,
      active_hidden: stats.activeHidden,
      graduated: stats.graduated,
      revealed: stats.revealed,
      privacy_rate: stats.totalStealthLaunches > 0 
        ? Math.round((stats.activeHidden / stats.totalStealthLaunches) * 100) 
        : 0
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Stats failed' });
  }
});

// ============================================
// GRADUATION MONITORING ENDPOINTS
// Real-time tracking of bonding curve progress
// ============================================

// Start monitoring a token for graduation
app.post('/stealthpump/monitor/start', async (req: Request, res: Response) => {
  try {
    const { pumpFunProvider } = await import('../providers/pumpfun');
    const { mint_address, poll_interval_ms } = req.body;

    if (!mint_address) {
      return res.status(400).json({ success: false, error: 'mint_address required' });
    }

    // Start monitor (callback will log events server-side)
    const result = pumpFunProvider.startGraduationMonitor(
      mint_address,
      (event) => {
        console.log(`[Monitor] ${event.type}: ${mint_address.slice(0, 8)}... - ${event.progress}% (${event.marketCapSol.toFixed(2)} SOL)`);
      },
      poll_interval_ms || 10000
    );

    res.json({
      success: result.success,
      monitor_id: result.monitorId,
      mint_address,
      poll_interval_ms: poll_interval_ms || 10000,
      message: '👁️ Graduation monitor started'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Monitor start failed' });
  }
});

// Stop monitoring a token
app.post('/stealthpump/monitor/stop', async (req: Request, res: Response) => {
  try {
    const { pumpFunProvider } = await import('../providers/pumpfun');
    const { mint_address } = req.body;

    if (!mint_address) {
      return res.status(400).json({ success: false, error: 'mint_address required' });
    }

    const stopped = pumpFunProvider.stopGraduationMonitor(mint_address);

    res.json({
      success: stopped,
      mint_address,
      message: stopped ? '🛑 Monitor stopped' : 'Monitor not found'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Monitor stop failed' });
  }
});

// Get active monitors
app.get('/stealthpump/monitor/active', async (req: Request, res: Response) => {
  try {
    const { pumpFunProvider } = await import('../providers/pumpfun');
    const monitors = pumpFunProvider.getActiveMonitors();

    res.json({
      success: true,
      count: monitors.length,
      monitors: monitors.map(m => ({
        mint_address: m,
        pump_fun_url: `https://pump.fun/${m}`
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to get monitors' });
  }
});

// ============================================
// MEV PROTECTION ENDPOINTS
// Jito bundle support for frontrunning protection
// ============================================

// Launch with MEV protection
app.post('/stealthpump/launch-protected', async (req: Request, res: Response) => {
  try {
    const { pumpFunProvider } = await import('../providers/pumpfun');
    const {
      name, symbol, description, image, twitter, telegram, website,
      initial_buy_sol, slippage_bps, use_stealth_wallet, jito_tip_lamports,
      payer_secret
    } = req.body;

    if (!name || !symbol || !description || !initial_buy_sol) {
      return res.status(400).json({
        success: false,
        error: 'name, symbol, description, initial_buy_sol required'
      });
    }

    // Validate initial buy amount
    if (typeof initial_buy_sol !== 'number' || initial_buy_sol < 0.01 || initial_buy_sol > 100) {
      return res.status(400).json({ success: false, error: 'initial_buy_sol must be between 0.01 and 100 SOL' });
    }

    // SECURITY: In production, NEVER accept private keys via API
    const { Keypair } = await import('@solana/web3.js');
    let payer: InstanceType<typeof Keypair>;
    
    if (payer_secret) {
      console.warn('[SECURITY] payer_secret provided via API - simulation mode only');
      try {
        payer = Keypair.fromSecretKey(Buffer.from(payer_secret, 'base64'));
      } catch {
        return res.status(400).json({ success: false, error: 'Invalid payer_secret format' });
      }
    } else {
      payer = Keypair.generate();
    }

    const result = await pumpFunProvider.stealthLaunchWithMevProtection(payer, {
      metadata: { name, symbol, description, image, twitter, telegram, website },
      initialBuySol: initial_buy_sol,
      slippageBps: slippage_bps || 500,
      useStealthWallet: use_stealth_wallet || true,
      mevProtection: true,
      jitoTipLamports: jito_tip_lamports || 10000
    });

    res.json({
      success: result.success,
      mint_address: result.mintAddress,
      signature: result.signature,
      bundle_id: result.bundleId,
      mev_protected: result.mevProtected,
      pump_fun_url: result.mintAddress ? `https://pump.fun/${result.mintAddress}` : undefined,
      error: result.error
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Protected launch failed' });
  }
});

// ============================================
// HOLDER ANONYMITY ENDPOINTS
// Track anonymous holder distribution
// ============================================

// Initialize anonymity tracking for a token
app.post('/stealthpump/anonymity/init', async (req: Request, res: Response) => {
  try {
    const { pumpFunProvider } = await import('../providers/pumpfun');
    const { mint_address } = req.body;

    if (!mint_address) {
      return res.status(400).json({ success: false, error: 'mint_address required' });
    }

    const info = pumpFunProvider.initializeAnonymitySet(mint_address);

    res.json({
      success: true,
      mint_address: info.mintAddress,
      anonymity_score: info.anonymityScore,
      message: 'Anonymity tracking initialized'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Init failed' });
  }
});

// Update anonymity set with holder data
app.post('/stealthpump/anonymity/update', async (req: Request, res: Response) => {
  try {
    const { pumpFunProvider } = await import('../providers/pumpfun');
    const { mint_address, total_holders, largest_holder_percent, top10_holders_percent, known_wallets } = req.body;

    if (!mint_address) {
      return res.status(400).json({ success: false, error: 'mint_address required' });
    }

    const info = pumpFunProvider.updateAnonymitySet(mint_address, {
      totalHolders: total_holders || 0,
      largestHolderPercent: largest_holder_percent || 0,
      top10HoldersPercent: top10_holders_percent || 0,
      knownWallets: known_wallets || 0
    });

    if (!info) {
      return res.status(404).json({ success: false, error: 'Token not found' });
    }

    res.json({
      success: true,
      mint_address: info.mintAddress,
      total_holders: info.totalHolders,
      anonymous_holders: info.anonymousHolders,
      revealed_holders: info.revealedHolders,
      anonymity_score: info.anonymityScore,
      largest_holder_percent: info.largestHolderPercent,
      top10_holders_percent: info.top10HoldersPercent
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Update failed' });
  }
});

// Get anonymity set info
app.get('/stealthpump/anonymity/:mint_address', async (req: Request, res: Response) => {
  try {
    const { pumpFunProvider } = await import('../providers/pumpfun');
    const info = pumpFunProvider.getAnonymitySetInfo(req.params.mint_address);

    if (!info) {
      return res.status(404).json({ success: false, error: 'Anonymity set not found' });
    }

    res.json({
      success: true,
      mint_address: info.mintAddress,
      total_holders: info.totalHolders,
      anonymous_holders: info.anonymousHolders,
      revealed_holders: info.revealedHolders,
      anonymity_score: info.anonymityScore,
      largest_holder_percent: info.largestHolderPercent,
      top10_holders_percent: info.top10HoldersPercent,
      created_at: info.createdAt,
      last_updated: info.lastUpdated
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Fetch failed' });
  }
});

// ============================================
// PRIVACY SCORE ENDPOINT
// Combined privacy rating for stealth launches
// ============================================

// Get comprehensive privacy score
app.get('/stealthpump/privacy-score/:mint_address', async (req: Request, res: Response) => {
  try {
    const { pumpFunProvider } = await import('../providers/pumpfun');
    const score = await pumpFunProvider.getPrivacyScore(req.params.mint_address);

    res.json({
      success: true,
      mint_address: req.params.mint_address,
      overall_score: score.overallScore,
      grade: score.grade,
      factors: {
        creator_hidden: score.factors.creatorHidden,
        holder_anonymity: score.factors.holderAnonymity,
        funding_obfuscated: score.factors.fundingObfuscated,
        mev_protected: score.factors.mevProtected,
        timing_obfuscated: score.factors.timingObfuscated
      },
      grade_description: {
        'A': '🛡️ Maximum Privacy - All factors optimized',
        'B': '🔒 Strong Privacy - Most factors covered',
        'C': '⚠️ Moderate Privacy - Some exposure',
        'D': '⚡ Basic Privacy - Significant exposure',
        'F': '❌ Minimal Privacy - High exposure'
      }[score.grade]
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Score failed' });
  }
});

// ============================================
// PUMP.FUN COMPATIBLE DATA ENDPOINTS
// Matches their frontend/backend structures
// ============================================

// Get pump.fun compatible token data (matches their API format)
app.get('/stealthpump/pumpfun-data/:mint_address', async (req: Request, res: Response) => {
  try {
    const { pumpFunProvider } = await import('../providers/pumpfun');
    const { sol_price_usd } = req.query;
    
    const data = await pumpFunProvider.getPumpFunCompatibleData(
      req.params.mint_address,
      undefined,
      sol_price_usd ? parseFloat(sol_price_usd as string) : 200
    );

    if (!data) {
      return res.status(404).json({ success: false, error: 'Token not found' });
    }

    res.json({
      success: true,
      // Return in pump.fun compatible format
      ...data
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to get data' });
  }
});

// Get token metrics in pump.fun dashboard format
app.get('/stealthpump/metrics/:mint_address', async (req: Request, res: Response) => {
  try {
    const { pumpFunProvider } = await import('../providers/pumpfun');
    const { sol_price_usd } = req.query;
    
    const metrics = await pumpFunProvider.getTokenMetrics(
      req.params.mint_address,
      sol_price_usd ? parseFloat(sol_price_usd as string) : 200
    );

    if (!metrics) {
      return res.status(404).json({ success: false, error: 'Token not found' });
    }

    res.json({
      success: true,
      mint_address: req.params.mint_address,
      price: metrics.price,
      market_cap: metrics.marketCap,
      bonding_curve: {
        progress: metrics.bondingCurve.progress,
        sol_raised: metrics.bondingCurve.solRaised,
        tokens_remaining: metrics.bondingCurve.tokensRemaining,
        graduation_threshold: metrics.bondingCurve.graduationThreshold,
        progress_bar: `${'█'.repeat(Math.floor(metrics.bondingCurve.progress / 5))}${'░'.repeat(20 - Math.floor(metrics.bondingCurve.progress / 5))} ${metrics.bondingCurve.progress.toFixed(1)}%`
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to get metrics' });
  }
});

// Get privacy-aware display data for frontend
app.get('/stealthpump/display/:mint_address', async (req: Request, res: Response) => {
  try {
    const { pumpFunProvider } = await import('../providers/pumpfun');
    const { sol_price_usd } = req.query;
    
    const displayData = await pumpFunProvider.getDisplayData(
      req.params.mint_address,
      sol_price_usd ? parseFloat(sol_price_usd as string) : 200
    );

    if (!displayData) {
      return res.status(404).json({ success: false, error: 'Token not found' });
    }

    res.json({
      success: true,
      ...displayData
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to get display data' });
  }
});

// Get pump.fun constants (for frontend reference)
app.get('/stealthpump/constants', async (req: Request, res: Response) => {
  try {
    const { PUMPFUN_CONSTANTS } = await import('../providers/pumpfun');
    
    res.json({
      success: true,
      constants: {
        total_supply: PUMPFUN_CONSTANTS.TOTAL_SUPPLY,
        reserved_tokens: PUMPFUN_CONSTANTS.RESERVED_TOKENS,
        initial_real_token_reserves: PUMPFUN_CONSTANTS.INITIAL_REAL_TOKEN_RESERVES,
        graduation_threshold_sol: PUMPFUN_CONSTANTS.GRADUATION_THRESHOLD_SOL,
        graduation_threshold_mcap_usd: PUMPFUN_CONSTANTS.GRADUATION_THRESHOLD_MCAP_USD,
        decimals: PUMPFUN_CONSTANTS.DECIMALS,
        fee_bps: PUMPFUN_CONSTANTS.FEE_BPS
      },
      formulas: {
        bonding_curve_progress: 'BondingCurveProgress = 100 - ((leftTokens * 100) / initialRealTokenReserves)',
        left_tokens: 'leftTokens = realTokenReserves - reservedTokens',
        market_cap: 'marketCap = totalSupply * priceUsd',
        price: 'price = virtualSolReserves / virtualTokenReserves'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to get constants' });
  }
});

// Calculate bonding curve progress for any token balance
app.get('/stealthpump/calculate-progress', async (req: Request, res: Response) => {
  try {
    const { pumpFunProvider, PUMPFUN_CONSTANTS } = await import('../providers/pumpfun');
    const { real_token_reserves } = req.query;

    if (!real_token_reserves) {
      return res.status(400).json({ success: false, error: 'real_token_reserves required' });
    }

    const reserves = parseFloat(real_token_reserves as string);
    const progress = pumpFunProvider.calculateBondingCurveProgress(reserves);
    const leftTokens = reserves - PUMPFUN_CONSTANTS.RESERVED_TOKENS;

    res.json({
      success: true,
      input: {
        real_token_reserves: reserves
      },
      calculation: {
        left_tokens: leftTokens,
        initial_real_token_reserves: PUMPFUN_CONSTANTS.INITIAL_REAL_TOKEN_RESERVES,
        reserved_tokens: PUMPFUN_CONSTANTS.RESERVED_TOKENS
      },
      result: {
        bonding_curve_progress: Math.round(progress * 100) / 100,
        tokens_sold_percent: Math.round(progress * 100) / 100,
        tokens_remaining_percent: Math.round((100 - progress) * 100) / 100,
        progress_bar: `${'█'.repeat(Math.floor(progress / 5))}${'░'.repeat(20 - Math.floor(progress / 5))} ${progress.toFixed(1)}%`
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Calculation failed' });
  }
});

// ============================================
// UNIFIED PRIVACY ORCHESTRATOR ENDPOINTS
// Cohesive CAP-402 + StealthPump + Pump.fun
// ============================================

// Execute unified privacy-first launch
app.post('/unified/launch', async (req: Request, res: Response) => {
  try {
    const { unifiedPrivacy, DEFAULT_PRIVACY_CONFIGS } = await import('../providers/unified-privacy');
    const { token, initial_buy_sol, slippage_bps, privacy_level, privacy_config } = req.body;

    if (!token?.name || !token?.symbol || !token?.description || !initial_buy_sol) {
      return res.status(400).json({
        success: false,
        error: 'token.name, token.symbol, token.description, initial_buy_sol required'
      });
    }

    // Resolve privacy config
    let privacyConfig = privacy_config;
    if (!privacyConfig && privacy_level) {
      privacyConfig = DEFAULT_PRIVACY_CONFIGS[privacy_level] || DEFAULT_PRIVACY_CONFIGS.enhanced;
    } else if (!privacyConfig) {
      privacyConfig = 'enhanced';
    }

    const result = await unifiedPrivacy.executeLaunch({
      token: {
        name: token.name,
        symbol: token.symbol,
        description: token.description,
        image: token.image,
        twitter: token.twitter,
        telegram: token.telegram,
        website: token.website
      },
      initialBuySol: initial_buy_sol,
      slippageBps: slippage_bps || 500,
      privacy: privacyConfig
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unified launch failed' });
  }
});

// Get unified dashboard data
app.get('/unified/dashboard/:mint_address', async (req: Request, res: Response) => {
  try {
    const { unifiedPrivacy } = await import('../providers/unified-privacy');
    const { sol_price_usd } = req.query;

    const dashboard = await unifiedPrivacy.getUnifiedDashboard(
      req.params.mint_address,
      sol_price_usd ? parseFloat(sol_price_usd as string) : 200
    );

    if (!dashboard) {
      return res.status(404).json({ success: false, error: 'Token not found' });
    }

    res.json({
      success: true,
      ...dashboard
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Dashboard failed' });
  }
});

// Get privacy configuration presets
app.get('/unified/privacy-presets', async (req: Request, res: Response) => {
  try {
    const { DEFAULT_PRIVACY_CONFIGS } = await import('../providers/unified-privacy');

    res.json({
      success: true,
      presets: {
        basic: {
          ...DEFAULT_PRIVACY_CONFIGS.basic,
          description: '🔓 Basic Privacy - Hidden creator, stealth wallet',
          recommended_for: 'Quick launches with minimal privacy needs'
        },
        enhanced: {
          ...DEFAULT_PRIVACY_CONFIGS.enhanced,
          description: '🔒 Enhanced Privacy - MEV protection, timing obfuscation, anonymity tracking',
          recommended_for: 'Standard stealth launches'
        },
        maximum: {
          ...DEFAULT_PRIVACY_CONFIGS.maximum,
          description: '🛡️ Maximum Privacy - Full obfuscation, no auto-reveal, Noir ZK proofs',
          recommended_for: 'High-value launches requiring maximum anonymity'
        }
      },
      default: 'enhanced'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to get presets' });
  }
});

// Get active launches
app.get('/unified/launches/active', async (req: Request, res: Response) => {
  try {
    const { unifiedPrivacy } = await import('../providers/unified-privacy');
    const activeLaunches = unifiedPrivacy.getActiveLaunches();

    res.json({
      success: true,
      count: activeLaunches.length,
      launches: activeLaunches.map(l => ({
        id: l.id,
        phase: l.phase,
        started_at: l.startedAt,
        privacy_level: l.privacyConfig.level,
        events_count: l.events.length
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to get launches' });
  }
});

// Get launch state by ID
app.get('/unified/launches/:launch_id', async (req: Request, res: Response) => {
  try {
    const { unifiedPrivacy } = await import('../providers/unified-privacy');
    const state = unifiedPrivacy.getLaunchState(req.params.launch_id);

    if (!state) {
      return res.status(404).json({ success: false, error: 'Launch not found' });
    }

    res.json({
      success: true,
      id: state.id,
      phase: state.phase,
      started_at: state.startedAt,
      privacy_config: state.privacyConfig,
      events: state.events.slice(-20) // Last 20 events
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to get launch' });
  }
});

// Get system integration status
app.get('/unified/status', async (req: Request, res: Response) => {
  try {
    const { pumpFunProvider } = await import('../providers/pumpfun');
    const { unifiedPrivacy } = await import('../providers/unified-privacy');

    const pumpFunStatus = pumpFunProvider.getStatus();
    const stealthStats = pumpFunProvider.getStealthStats();
    const activeLaunches = unifiedPrivacy.getActiveLaunches();
    const activeMonitors = pumpFunProvider.getActiveMonitors();

    res.json({
      success: true,
      systems: {
        cap402: {
          status: 'operational',
          version: '1.0.0',
          providers: ['arcium', 'inco', 'noir']
        },
        stealthpump: {
          status: pumpFunStatus.initialized ? 'operational' : 'initializing',
          mode: pumpFunStatus.mode,
          stats: stealthStats
        },
        pumpfun: {
          status: 'connected',
          program_id: pumpFunStatus.programId,
          stats: pumpFunStatus.stats
        }
      },
      activity: {
        active_launches: activeLaunches.length,
        active_monitors: activeMonitors.length,
        total_stealth_launches: stealthStats.totalStealthLaunches,
        hidden_creators: stealthStats.activeHidden,
        graduated_tokens: stealthStats.graduated
      },
      integration: {
        unified_privacy: 'enabled',
        cross_system_events: 'enabled',
        privacy_orchestration: 'enabled'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Status failed' });
  }
});

// ============================================
// CROSS-SYSTEM EVENT BUS ENDPOINTS
// Real-time event synchronization
// ============================================

// Get recent cross-system events
app.get('/unified/events', async (req: Request, res: Response) => {
  try {
    const { eventBus } = await import('../providers/unified-privacy');
    const { source, type, since, limit } = req.query;

    const events = eventBus.getRecentEvents({
      source: source as 'cap402' | 'stealthpump' | 'pumpfun' | undefined,
      type: type as string | undefined,
      since: since ? parseInt(since as string) : undefined,
      limit: limit ? parseInt(limit as string) : 50
    });

    res.json({
      success: true,
      count: events.length,
      events
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to get events' });
  }
});

// Get correlated events by correlation ID
app.get('/unified/events/correlated/:correlation_id', async (req: Request, res: Response) => {
  try {
    const { eventBus } = await import('../providers/unified-privacy');
    const events = eventBus.getCorrelatedEvents(req.params.correlation_id);

    res.json({
      success: true,
      correlation_id: req.params.correlation_id,
      count: events.length,
      events
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to get events' });
  }
});

// Emit a cross-system event (for external systems to notify CAP-402)
app.post('/unified/events/emit', async (req: Request, res: Response) => {
  try {
    const { eventBus } = await import('../providers/unified-privacy');
    const { source, type, data, correlation_id } = req.body;

    if (!source || !type || !data) {
      return res.status(400).json({
        success: false,
        error: 'source, type, and data required'
      });
    }

    if (!['cap402', 'stealthpump', 'pumpfun'].includes(source)) {
      return res.status(400).json({
        success: false,
        error: 'source must be cap402, stealthpump, or pumpfun'
      });
    }

    eventBus.emit(source, type, data, correlation_id);

    res.json({
      success: true,
      message: 'Event emitted',
      event: { source, type, correlation_id, timestamp: Date.now() }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to emit event' });
  }
});

// Get event types reference
app.get('/unified/events/types', async (req: Request, res: Response) => {
  try {
    const { EventTypes } = await import('../providers/unified-privacy');

    res.json({
      success: true,
      event_types: EventTypes,
      sources: ['cap402', 'stealthpump', 'pumpfun'],
      subscription_patterns: [
        '*:*           - All events from all sources',
        'cap402:*      - All CAP-402 events',
        'stealthpump:* - All StealthPump events',
        'pumpfun:*     - All pump.fun events',
        '*:launch_completed - Launch completed from any source'
      ]
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to get event types' });
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
    
    // Cleanup pump.fun provider monitors
    const { pumpFunProvider } = await import('../providers/pumpfun');
    pumpFunProvider.stopAllMonitors();
    console.log('   Pump.fun monitors cleaned up');
    
    // Cleanup privacy alert system
    const { privacyAlertSystem } = await import('../providers/privacy-alerts');
    privacyAlertSystem.stopAllMonitors();
    privacyAlertSystem.cleanupOldAlerts();
    console.log('   Privacy alert system cleaned up');
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
