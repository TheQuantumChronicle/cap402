/**
 * Input Validation Middleware
 * 
 * Validates request bodies and parameters before they reach handlers.
 * Provides consistent error responses for invalid inputs.
 */

import { Request, Response, NextFunction } from 'express';

interface ValidationRule {
  field: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  enum?: any[];
}

interface ValidationError {
  field: string;
  message: string;
}

export function validateBody(rules: ValidationRule[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const errors: ValidationError[] = [];
    const body = req.body || {};

    for (const rule of rules) {
      const value = body[rule.field];

      // Check required
      if (rule.required && (value === undefined || value === null || value === '')) {
        errors.push({ field: rule.field, message: `${rule.field} is required` });
        continue;
      }

      // Skip validation if not required and not provided
      if (value === undefined || value === null) continue;

      // Check type
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (actualType !== rule.type) {
        errors.push({ 
          field: rule.field, 
          message: `${rule.field} must be a ${rule.type}, got ${actualType}` 
        });
        continue;
      }

      // String validations
      if (rule.type === 'string') {
        if (rule.minLength && value.length < rule.minLength) {
          errors.push({ 
            field: rule.field, 
            message: `${rule.field} must be at least ${rule.minLength} characters` 
          });
        }
        if (rule.maxLength && value.length > rule.maxLength) {
          errors.push({ 
            field: rule.field, 
            message: `${rule.field} must be at most ${rule.maxLength} characters` 
          });
        }
        if (rule.pattern && !rule.pattern.test(value)) {
          errors.push({ 
            field: rule.field, 
            message: `${rule.field} has invalid format` 
          });
        }
      }

      // Number validations
      if (rule.type === 'number') {
        if (rule.min !== undefined && value < rule.min) {
          errors.push({ 
            field: rule.field, 
            message: `${rule.field} must be at least ${rule.min}` 
          });
        }
        if (rule.max !== undefined && value > rule.max) {
          errors.push({ 
            field: rule.field, 
            message: `${rule.field} must be at most ${rule.max}` 
          });
        }
      }

      // Enum validation
      if (rule.enum && !rule.enum.includes(value)) {
        errors.push({ 
          field: rule.field, 
          message: `${rule.field} must be one of: ${rule.enum.join(', ')}` 
        });
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        validation_errors: errors
      });
    }

    next();
  };
}

export function validateParams(rules: ValidationRule[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const errors: ValidationError[] = [];
    const params = req.params || {};

    for (const rule of rules) {
      const value = params[rule.field];

      if (rule.required && !value) {
        errors.push({ field: rule.field, message: `${rule.field} parameter is required` });
        continue;
      }

      if (value && rule.pattern && !rule.pattern.test(value)) {
        errors.push({ field: rule.field, message: `${rule.field} has invalid format` });
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid parameters',
        validation_errors: errors
      });
    }

    next();
  };
}

// Common validation rules
export const invokeValidation = validateBody([
  { field: 'capability_id', type: 'string', required: true, pattern: /^cap\.[a-z]+\.[a-z]+\.v\d+$/ },
  { field: 'inputs', type: 'object', required: false }
]);

export const discoverValidation = validateBody([
  { field: 'query', type: 'string', required: true, minLength: 2, maxLength: 500 }
]);

export const registerAgentValidation = validateBody([
  { field: 'public_key', type: 'string', required: true, minLength: 10 }
]);

export const delegateValidation = validateBody([
  { field: 'to_agent', type: 'string', required: true },
  { field: 'capability_id', type: 'string', required: true }
]);

export const estimateValidation = validateBody([
  { field: 'capability_id', type: 'string', required: false },
  { field: 'capability_ids', type: 'array', required: false }
]);

export const workflowValidation = validateBody([
  { field: 'goal', type: 'string', required: true, minLength: 5, maxLength: 500 }
]);

// Agent ID validation pattern
export const AGENT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
export const CAPABILITY_ID_PATTERN = /^cap\.[a-z0-9._-]+\.v\d+$/;

// New validation rules for agent endpoints
export const unifiedRegisterValidation = validateBody([
  { field: 'agent_id', type: 'string', required: true, pattern: AGENT_ID_PATTERN },
  { field: 'name', type: 'string', required: true, minLength: 1, maxLength: 128 },
  { field: 'description', type: 'string', required: false, maxLength: 500 },
  { field: 'capabilities', type: 'array', required: false }
]);

export const quickInvokeValidation = validateBody([
  { field: 'agent_id', type: 'string', required: true, pattern: AGENT_ID_PATTERN },
  { field: 'capability', type: 'string', required: true, pattern: CAPABILITY_ID_PATTERN },
  { field: 'inputs', type: 'object', required: false }
]);

export const batchValidation = validateBody([
  { field: 'agent_id', type: 'string', required: true, pattern: AGENT_ID_PATTERN },
  { field: 'operations', type: 'array', required: true }
]);

export const messageValidation = validateBody([
  { field: 'from_agent', type: 'string', required: true, pattern: AGENT_ID_PATTERN },
  { field: 'to_agent', type: 'string', required: true, pattern: AGENT_ID_PATTERN },
  { field: 'subject', type: 'string', required: true, minLength: 1, maxLength: 200 },
  { field: 'content', type: 'string', required: true, minLength: 1, maxLength: 5000 }
]);

export const coordinateValidation = validateBody([
  { field: 'from_agent', type: 'string', required: true, pattern: AGENT_ID_PATTERN },
  { field: 'to_agent', type: 'string', required: true, pattern: AGENT_ID_PATTERN },
  { field: 'capability_id', type: 'string', required: true, pattern: CAPABILITY_ID_PATTERN }
]);

export const agentIdParamValidation = validateParams([
  { field: 'agent_id', type: 'string', required: true, pattern: AGENT_ID_PATTERN }
]);
