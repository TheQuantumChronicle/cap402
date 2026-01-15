/**
 * Security Middleware
 * 
 * Additional security layers for CAP-402:
 * - Request signing verification
 * - Input sanitization
 * - Payload validation
 */

import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';

const SIGNING_SECRET = process.env.CAP402_SIGNING_SECRET || crypto.randomBytes(32).toString('hex');

/**
 * Verify request signature for sensitive operations
 * Signature: HMAC-SHA256(timestamp + method + path + body)
 */
export function verifyRequestSignature(req: Request, res: Response, next: NextFunction): void {
  const signature = req.headers['x-cap402-signature'] as string;
  const timestamp = req.headers['x-cap402-timestamp'] as string;
  
  // Skip signature check if not provided (for backward compatibility)
  if (!signature || !timestamp) {
    return next();
  }
  
  // Check timestamp freshness (5 minute window)
  const requestTime = parseInt(timestamp, 10);
  const now = Date.now();
  if (isNaN(requestTime) || Math.abs(now - requestTime) > 5 * 60 * 1000) {
    res.status(401).json({
      success: false,
      error: 'Request timestamp expired or invalid'
    });
    return;
  }
  
  // Compute expected signature
  const payload = `${timestamp}:${req.method}:${req.path}:${JSON.stringify(req.body || {})}`;
  const expectedSignature = crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(payload)
    .digest('hex');
  
  // Timing-safe comparison
  try {
    const valid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
    
    if (!valid) {
      res.status(401).json({
        success: false,
        error: 'Invalid request signature'
      });
      return;
    }
  } catch {
    res.status(401).json({
      success: false,
      error: 'Invalid request signature format'
    });
    return;
  }
  
  next();
}

/**
 * Sanitize common injection patterns from string inputs
 */
export function sanitizeInput(input: string): string {
  if (typeof input !== 'string') return input;
  
  return input
    .replace(/[<>]/g, '') // Remove HTML brackets
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, '') // Remove event handlers
    .trim();
}

/**
 * Deep sanitize object values
 */
export function sanitizeObject(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return sanitizeInput(obj);
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeObject);
  
  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    // Skip prototype pollution attempts
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    sanitized[sanitizeInput(key)] = sanitizeObject(value);
  }
  return sanitized;
}

/**
 * Middleware to sanitize request body
 */
export function sanitizeRequestBody(req: Request, res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }
  next();
}

/**
 * Validate required fields in request body
 */
export function validateRequiredFields(fields: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const missing = fields.filter(field => {
      const value = req.body[field];
      return value === undefined || value === null || value === '';
    });
    
    if (missing.length > 0) {
      res.status(400).json({
        success: false,
        error: `Missing required fields: ${missing.join(', ')}`
      });
      return;
    }
    
    next();
  };
}

/**
 * Validate field types in request body
 */
export function validateFieldTypes(schema: Record<string, 'string' | 'number' | 'boolean' | 'object' | 'array'>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors: string[] = [];
    
    for (const [field, expectedType] of Object.entries(schema)) {
      const value = req.body[field];
      if (value === undefined) continue; // Skip undefined (use validateRequiredFields for required)
      
      let valid = false;
      switch (expectedType) {
        case 'string':
          valid = typeof value === 'string';
          break;
        case 'number':
          valid = typeof value === 'number' && !isNaN(value) && isFinite(value);
          break;
        case 'boolean':
          valid = typeof value === 'boolean';
          break;
        case 'object':
          valid = typeof value === 'object' && value !== null && !Array.isArray(value);
          break;
        case 'array':
          valid = Array.isArray(value);
          break;
      }
      
      if (!valid) {
        errors.push(`${field} must be a ${expectedType}`);
      }
    }
    
    if (errors.length > 0) {
      res.status(400).json({
        success: false,
        error: errors.join('; ')
      });
      return;
    }
    
    next();
  };
}

/**
 * Generate request signature for clients
 */
export function generateRequestSignature(
  method: string,
  path: string,
  body: any,
  secret: string = SIGNING_SECRET
): { signature: string; timestamp: string } {
  const timestamp = Date.now().toString();
  const payload = `${timestamp}:${method}:${path}:${JSON.stringify(body || {})}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  return { signature, timestamp };
}
