/**
 * Centralized Error Handling
 * 
 * Provides consistent error responses across all API endpoints.
 * Use these helpers instead of inline error responses.
 */

import { Response } from 'express';

// Standard error codes with HTTP status mapping
export const ErrorCodes = {
  VALIDATION_ERROR: { code: 'VALIDATION_ERROR', status: 400 },
  UNAUTHORIZED: { code: 'UNAUTHORIZED', status: 401 },
  FORBIDDEN: { code: 'FORBIDDEN', status: 403 },
  NOT_FOUND: { code: 'NOT_FOUND', status: 404 },
  CONFLICT: { code: 'CONFLICT', status: 409 },
  RATE_LIMITED: { code: 'RATE_LIMITED', status: 429 },
  INTERNAL_ERROR: { code: 'INTERNAL_ERROR', status: 500 },
  SERVICE_UNAVAILABLE: { code: 'SERVICE_UNAVAILABLE', status: 503 }
} as const;

export type ErrorCode = keyof typeof ErrorCodes;

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface ApiErrorResult {
  status: number;
  body: ApiErrorResponse;
}

/**
 * Create a standardized API error response
 */
export function createApiError(code: ErrorCode, message: string, details?: unknown): ApiErrorResult {
  const { code: errorCode, status } = ErrorCodes[code];
  return { 
    status, 
    body: { 
      success: false, 
      error: { code: errorCode, message, details } 
    } 
  };
}

/**
 * Send an error response directly
 */
export function sendError(res: Response, code: ErrorCode, message: string, details?: unknown): void {
  const err = createApiError(code, message, details);
  res.status(err.status).json(err.body);
}

/**
 * Common validation error helpers
 */
export const ValidationErrors = {
  missingField: (field: string) => createApiError('VALIDATION_ERROR', `${field} is required`),
  missingFields: (fields: string[]) => createApiError('VALIDATION_ERROR', `Missing required fields: ${fields.join(', ')}`),
  invalidType: (field: string, expected: string) => createApiError('VALIDATION_ERROR', `${field} must be ${expected}`),
  invalidValue: (field: string, reason: string) => createApiError('VALIDATION_ERROR', `Invalid ${field}: ${reason}`),
  arrayRequired: (field: string) => createApiError('VALIDATION_ERROR', `${field} must be an array`),
  maxLength: (field: string, max: number) => createApiError('VALIDATION_ERROR', `${field} exceeds maximum length of ${max}`),
  minLength: (field: string, min: number) => createApiError('VALIDATION_ERROR', `${field} must have at least ${min} items`),
  outOfRange: (field: string, min: number, max: number) => createApiError('VALIDATION_ERROR', `${field} must be between ${min} and ${max}`)
};

/**
 * Common not found error helpers
 */
export const NotFoundErrors = {
  capability: (id: string) => createApiError('NOT_FOUND', `Capability ${id} not found`),
  agent: (id: string) => createApiError('NOT_FOUND', `Agent ${id} not found`),
  session: (id: string) => createApiError('NOT_FOUND', `Session ${id} not found`),
  resource: (type: string, id: string) => createApiError('NOT_FOUND', `${type} ${id} not found`)
};

/**
 * Wrap async route handlers with error catching
 */
export function asyncHandler(fn: (req: any, res: Response, next?: any) => Promise<any>) {
  return (req: any, res: Response, next?: any) => {
    Promise.resolve(fn(req, res, next)).catch((error: Error) => {
      console.error('Unhandled route error:', error);
      sendError(res, 'INTERNAL_ERROR', error.message || 'An unexpected error occurred');
    });
  };
}

/**
 * Extract error message safely from unknown error
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'An unexpected error occurred';
}
