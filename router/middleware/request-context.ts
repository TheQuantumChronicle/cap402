/**
 * Request Context Middleware
 * 
 * Adds correlation IDs and timing to all requests.
 * Enables request tracing across the system.
 */

import { Request, Response, NextFunction } from 'express';
import { generateId } from '../../utils';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      startTime: number;
      agentId?: string;
      trustLevel?: string;
    }
  }
}

// Request metrics for monitoring
const requestMetrics = {
  total: 0,
  success: 0,
  clientError: 0,
  serverError: 0,
  avgLatencyMs: 0,
  latencySum: 0,
  // Percentile tracking
  latencies: [] as number[],
  maxLatencyTracked: 1000
};

export function getRequestMetrics() {
  const sorted = [...requestMetrics.latencies].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;
  
  return {
    total: requestMetrics.total,
    success: requestMetrics.success,
    clientError: requestMetrics.clientError,
    serverError: requestMetrics.serverError,
    avgLatencyMs: requestMetrics.total > 0 
      ? Math.round(requestMetrics.latencySum / requestMetrics.total) 
      : 0,
    p50_ms: p50,
    p95_ms: p95,
    p99_ms: p99,
    success_rate: requestMetrics.total > 0
      ? Math.round(requestMetrics.success / requestMetrics.total * 100)
      : 100
  };
}

export function requestContext(req: Request, res: Response, next: NextFunction) {
  // Generate or use provided request ID (validate format if provided)
  const providedId = req.headers['x-request-id'] as string;
  if (providedId && /^[a-zA-Z0-9_-]{1,64}$/.test(providedId)) {
    req.requestId = providedId;
  } else {
    req.requestId = generateId('req');
  }
  req.startTime = Date.now();

  // Add to response headers
  res.setHeader('X-Request-ID', req.requestId);

  // Log request start (skip health checks to reduce noise)
  const method = req.method;
  const path = req.path;
  if (!path.startsWith('/health') && path !== '/metrics') {
    console.log(`[${new Date().toISOString()}] ${method} ${path} - ${req.requestId}`);
  }

  // Log response on finish and track metrics
  res.on('finish', () => {
    const duration = Date.now() - req.startTime;
    const status = res.statusCode;
    
    // Update metrics
    requestMetrics.total++;
    requestMetrics.latencySum += duration;
    if (status < 400) requestMetrics.success++;
    else if (status < 500) requestMetrics.clientError++;
    else requestMetrics.serverError++;
    
    // Track latency for percentiles (with limit)
    if (requestMetrics.latencies.length >= requestMetrics.maxLatencyTracked) {
      requestMetrics.latencies.shift();
    }
    requestMetrics.latencies.push(duration);
    
    // Log (skip health checks)
    if (!path.startsWith('/health') && path !== '/metrics') {
      const statusEmoji = status < 400 ? '✓' : status < 500 ? '⚠' : '✗';
      console.log(`[${new Date().toISOString()}] ${statusEmoji} ${method} ${path} - ${status} - ${duration}ms`);
    }
  });

  next();
}

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  const isDev = process.env.NODE_ENV === 'development';
  
  // Avoid double-sending if headers already sent
  if (res.headersSent) {
    return next(err);
  }

  // Determine status code from common error patterns
  let statusCode = 500;
  if (err.message?.includes('not found')) statusCode = 404;
  else if (err.message?.includes('unauthorized') || err.message?.includes('invalid token')) statusCode = 401;
  else if (err.message?.includes('forbidden')) statusCode = 403;
  else if (err.message?.includes('validation') || err.message?.includes('invalid')) statusCode = 400;

  console.error(`[${new Date().toISOString()}] ERROR ${req.requestId} [${statusCode}]:`, err.message);
  if (isDev && err.stack) console.error(err.stack);
  
  res.status(statusCode).json({
    success: false,
    error: statusCode === 500 ? 'Internal server error' : err.message,
    request_id: req.requestId,
    ...(isDev && { message: err.message, stack: err.stack })
  });
}
