/**
 * Unified Error Types for Advanced Features
 * 
 * Consistent error handling across:
 * - Capability Receipts
 * - Privacy Gradient
 * - Capability Negotiation
 * - Usage Metadata
 * - Intent Graphs
 */

export enum ErrorCode {
  // Validation errors (400)
  INVALID_PRIVACY_LEVEL = 'INVALID_PRIVACY_LEVEL',
  INVALID_CAPABILITY_ID = 'INVALID_CAPABILITY_ID',
  INVALID_RECEIPT = 'INVALID_RECEIPT',
  INVALID_NEGOTIATION_REQUEST = 'INVALID_NEGOTIATION_REQUEST',
  INVALID_INTENT_GRAPH = 'INVALID_INTENT_GRAPH',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  CONSTRAINT_VIOLATION = 'CONSTRAINT_VIOLATION',
  
  // Execution errors (500)
  EXECUTION_FAILED = 'EXECUTION_FAILED',
  RECEIPT_GENERATION_FAILED = 'RECEIPT_GENERATION_FAILED',
  NEGOTIATION_FAILED = 'NEGOTIATION_FAILED',
  INTENT_EXECUTION_FAILED = 'INTENT_EXECUTION_FAILED',
  PRIVACY_SELECTION_FAILED = 'PRIVACY_SELECTION_FAILED',
  
  // Verification errors
  RECEIPT_VERIFICATION_FAILED = 'RECEIPT_VERIFICATION_FAILED',
  SIGNATURE_INVALID = 'SIGNATURE_INVALID',
  COMMITMENT_MISMATCH = 'COMMITMENT_MISMATCH',
  
  // Resource errors
  CAPABILITY_NOT_FOUND = 'CAPABILITY_NOT_FOUND',
  NO_OPTIONS_AVAILABLE = 'NO_OPTIONS_AVAILABLE',
  CYCLE_DETECTED = 'CYCLE_DETECTED',
  
  // System errors
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  TIMEOUT = 'TIMEOUT'
}

export interface CAP402Error {
  code: ErrorCode;
  message: string;
  details?: Record<string, any>;
  timestamp: number;
  request_id?: string;
}

export class AdvancedFeatureError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: Record<string, any>;
  public readonly timestamp: number;
  public readonly request_id?: string;

  constructor(
    code: ErrorCode,
    message: string,
    details?: Record<string, any>,
    request_id?: string
  ) {
    super(message);
    this.name = 'AdvancedFeatureError';
    this.code = code;
    this.details = details;
    this.timestamp = Date.now();
    this.request_id = request_id;
  }

  toJSON(): CAP402Error {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp,
      request_id: this.request_id
    };
  }

  static fromValidation(errors: string[], warnings: string[] = []): AdvancedFeatureError {
    return new AdvancedFeatureError(
      ErrorCode.CONSTRAINT_VIOLATION,
      errors[0] || 'Validation failed',
      { errors, warnings }
    );
  }

  static invalidPrivacyLevel(level: number): AdvancedFeatureError {
    return new AdvancedFeatureError(
      ErrorCode.INVALID_PRIVACY_LEVEL,
      `Privacy level must be 0-3, got ${level}`,
      { provided_level: level, valid_range: [0, 1, 2, 3] }
    );
  }

  static capabilityNotFound(capabilityId: string): AdvancedFeatureError {
    return new AdvancedFeatureError(
      ErrorCode.CAPABILITY_NOT_FOUND,
      `Capability ${capabilityId} not found`,
      { capability_id: capabilityId }
    );
  }

  static receiptVerificationFailed(reason: string): AdvancedFeatureError {
    return new AdvancedFeatureError(
      ErrorCode.RECEIPT_VERIFICATION_FAILED,
      `Receipt verification failed: ${reason}`,
      { reason }
    );
  }

  static cycleDetected(nodeIds: string[]): AdvancedFeatureError {
    return new AdvancedFeatureError(
      ErrorCode.CYCLE_DETECTED,
      'Intent graph contains a cycle',
      { involved_nodes: nodeIds }
    );
  }

  static noOptionsAvailable(capabilityId: string, constraints: any): AdvancedFeatureError {
    return new AdvancedFeatureError(
      ErrorCode.NO_OPTIONS_AVAILABLE,
      `No execution options available for ${capabilityId} with given constraints`,
      { capability_id: capabilityId, constraints }
    );
  }

  static executionFailed(capabilityId: string, reason: string): AdvancedFeatureError {
    return new AdvancedFeatureError(
      ErrorCode.EXECUTION_FAILED,
      `Execution of ${capabilityId} failed: ${reason}`,
      { capability_id: capabilityId, reason }
    );
  }
}

/**
 * Check if an error is an AdvancedFeatureError
 */
export function isAdvancedFeatureError(error: any): error is AdvancedFeatureError {
  return error instanceof AdvancedFeatureError;
}

/**
 * Convert any error to a CAP402Error format
 */
export function toCAP402Error(error: any, request_id?: string): CAP402Error {
  if (isAdvancedFeatureError(error)) {
    return error.toJSON();
  }

  return {
    code: ErrorCode.INTERNAL_ERROR,
    message: error instanceof Error ? error.message : String(error),
    timestamp: Date.now(),
    request_id
  };
}

/**
 * Extract error message from any error type
 * Utility to reduce repetitive error handling patterns
 */
export function getErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return fallback;
}

/**
 * Sanitize error message for production to prevent information leakage
 * In production, internal errors are replaced with generic messages
 */
export function getSafeErrorMessage(error: unknown, fallback = 'An error occurred'): string {
  const isProduction = process.env.NODE_ENV === 'production';
  const message = getErrorMessage(error, fallback);
  
  if (!isProduction) {
    return message;
  }
  
  // In production, sanitize potentially sensitive error messages
  const sensitivePatterns = [
    /password/i,
    /secret/i,
    /key/i,
    /token/i,
    /credential/i,
    /database/i,
    /connection/i,
    /internal/i,
    /stack/i,
    /at\s+\w+\s+\(/i, // Stack trace patterns
    /node_modules/i,
    /\/.*\.ts:/i, // File paths
    /\/.*\.js:/i
  ];
  
  // Check if message contains sensitive information
  if (sensitivePatterns.some(pattern => pattern.test(message))) {
    return fallback;
  }
  
  // Truncate long messages
  if (message.length > 200) {
    return message.substring(0, 200) + '...';
  }
  
  return message;
}

/**
 * HTTP status code mapping
 */
export function getHttpStatus(code: ErrorCode): number {
  switch (code) {
    case ErrorCode.INVALID_PRIVACY_LEVEL:
    case ErrorCode.INVALID_CAPABILITY_ID:
    case ErrorCode.INVALID_RECEIPT:
    case ErrorCode.INVALID_NEGOTIATION_REQUEST:
    case ErrorCode.INVALID_INTENT_GRAPH:
    case ErrorCode.MISSING_REQUIRED_FIELD:
    case ErrorCode.CONSTRAINT_VIOLATION:
      return 400;

    case ErrorCode.CAPABILITY_NOT_FOUND:
    case ErrorCode.NO_OPTIONS_AVAILABLE:
      return 404;

    case ErrorCode.RECEIPT_VERIFICATION_FAILED:
    case ErrorCode.SIGNATURE_INVALID:
    case ErrorCode.COMMITMENT_MISMATCH:
      return 422;

    case ErrorCode.TIMEOUT:
      return 408;

    default:
      return 500;
  }
}
