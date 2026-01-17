/**
 * Cryptographic Capability Tokens
 * 
 * SECRET SAUCE #1: Capability-bound access control
 * 
 * Agents must possess valid cryptographic tokens to:
 * - Execute specific capability types
 * - Interpret encrypted semantic fields
 * - Access premium/confidential capabilities
 * 
 * Without valid tokens, copycat implementations will fail at runtime
 * even if they replicate our schema perfectly.
 */

import * as crypto from 'crypto';
import { generateShortId } from '../../utils';

export interface CapabilityToken {
  token_id: string;
  agent_id: string;
  capabilities: string[];
  permissions: TokenPermissions;
  issued_at: number;
  expires_at: number;
  signature: string;
  nonce: string;
}

export interface TokenPermissions {
  can_invoke: boolean;
  can_compose: boolean;
  can_delegate: boolean;
  max_invocations_per_hour: number;
  allowed_modes: ('public' | 'confidential')[];
  semantic_access_level: 'basic' | 'standard' | 'advanced' | 'premium';
}

interface TokenValidationResult {
  valid: boolean;
  reason?: string;
  permissions?: TokenPermissions;
  remaining_invocations?: number;
}

class CapabilityTokenManager {
  private readonly SECRET_KEY: string;
  private readonly SEMANTIC_SALT: string;
  private readonly IS_PRODUCTION = process.env.NODE_ENV === 'production';
  
  constructor() {
    // SECURITY: In production, secrets MUST be configured via environment
    if (this.IS_PRODUCTION) {
      if (!process.env.CAP402_TOKEN_SECRET) {
        throw new Error('SECURITY: CAP402_TOKEN_SECRET must be set in production');
      }
      if (!process.env.CAP402_SEMANTIC_SALT) {
        throw new Error('SECURITY: CAP402_SEMANTIC_SALT must be set in production');
      }
    }
    
    this.SECRET_KEY = process.env.CAP402_TOKEN_SECRET || 
      require('crypto').randomBytes(32).toString('hex');
    this.SEMANTIC_SALT = process.env.CAP402_SEMANTIC_SALT || 
      require('crypto').randomBytes(16).toString('hex');
  }
  
  private tokens: Map<string, CapabilityToken> = new Map();
  private usageTracking: Map<string, { count: number; window_start: number }> = new Map();
  private revokedTokens: Set<string> = new Set();
  private cleanupInterval?: NodeJS.Timeout;

  /**
   * Start automatic cleanup of expired tokens
   */
  startCleanup(intervalMs: number = 60000): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      let cleaned = 0;
      for (const [tokenId, token] of this.tokens.entries()) {
        if (now > token.expires_at) {
          this.tokens.delete(tokenId);
          cleaned++;
        }
      }
      if (cleaned > 0) {
        console.log(`[TOKEN CLEANUP] Removed ${cleaned} expired tokens`);
      }
    }, intervalMs);
    // Prevent timer from keeping process alive during tests
    this.cleanupInterval.unref();
  }

  /**
   * Stop cleanup and clear all data
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.tokens.clear();
    this.usageTracking.clear();
    this.revokedTokens.clear();
  }

  /**
   * Issue a new capability token to an agent
   * Token is cryptographically signed and includes semantic access permissions
   */
  issueToken(
    agentId: string,
    capabilities: string[],
    permissions: Partial<TokenPermissions> = {},
    expiresInMs: number = 24 * 60 * 60 * 1000 // 24 hours default
  ): CapabilityToken {
    const tokenId = generateShortId('ctkn', 16);
    const nonce = crypto.randomBytes(12).toString('hex'); // Keep crypto for security-critical nonce
    const issuedAt = Date.now();
    const expiresAt = issuedAt + expiresInMs;

    const fullPermissions: TokenPermissions = {
      can_invoke: true,
      can_compose: true,
      can_delegate: false,
      max_invocations_per_hour: 100,
      allowed_modes: ['public'],
      semantic_access_level: 'basic',
      ...permissions
    };

    // Create signature over token data
    const signaturePayload = JSON.stringify({
      token_id: tokenId,
      agent_id: agentId,
      capabilities,
      permissions: fullPermissions,
      issued_at: issuedAt,
      expires_at: expiresAt,
      nonce
    });

    const signature = this.signPayload(signaturePayload);

    const token: CapabilityToken = {
      token_id: tokenId,
      agent_id: agentId,
      capabilities,
      permissions: fullPermissions,
      issued_at: issuedAt,
      expires_at: expiresAt,
      signature,
      nonce
    };

    this.tokens.set(tokenId, token);
    return token;
  }

  /**
   * Validate a capability token for a specific operation
   */
  validateToken(
    tokenId: string,
    capabilityId: string,
    mode: 'public' | 'confidential'
  ): TokenValidationResult {
    const { securityAuditLog } = require('./audit-log');
    const token = this.tokens.get(tokenId);

    // Check if token was revoked
    if (this.isRevoked(tokenId)) {
      securityAuditLog.log('token_rejected', null, {
        token_id: tokenId,
        reason: 'Token was revoked',
        capability_id: capabilityId
      }, { severity: 'warning' });
      return { valid: false, reason: 'Token was revoked' };
    }

    if (!token) {
      securityAuditLog.log('token_rejected', null, {
        token_id: tokenId,
        reason: 'Token not found',
        capability_id: capabilityId
      }, { severity: 'warning' });
      return { valid: false, reason: 'Token not found' };
    }

    // Check expiration
    if (Date.now() > token.expires_at) {
      securityAuditLog.log('token_rejected', token.agent_id, {
        token_id: tokenId,
        reason: 'Token expired',
        expired_at: new Date(token.expires_at).toISOString()
      }, { severity: 'warning' });
      return { valid: false, reason: 'Token expired' };
    }

    // Verify signature
    const signaturePayload = JSON.stringify({
      token_id: token.token_id,
      agent_id: token.agent_id,
      capabilities: token.capabilities,
      permissions: token.permissions,
      issued_at: token.issued_at,
      expires_at: token.expires_at,
      nonce: token.nonce
    });

    if (!this.verifySignature(signaturePayload, token.signature)) {
      securityAuditLog.log('token_rejected', token.agent_id, {
        token_id: tokenId,
        reason: 'Invalid signature - possible tampering',
        capability_id: capabilityId
      }, { severity: 'critical' });
      return { valid: false, reason: 'Invalid signature - token may be tampered' };
    }

    // Check capability access
    const hasCapability = token.capabilities.includes(capabilityId) || 
                          token.capabilities.includes('*');
    if (!hasCapability) {
      return { valid: false, reason: `Token does not grant access to ${capabilityId}` };
    }

    // Check mode access
    if (!token.permissions.allowed_modes.includes(mode)) {
      return { valid: false, reason: `Token does not allow ${mode} mode execution` };
    }

    // Check rate limits
    const usage = this.checkUsage(tokenId);
    if (usage.count >= token.permissions.max_invocations_per_hour) {
      return { 
        valid: false, 
        reason: 'Rate limit exceeded',
        remaining_invocations: 0
      };
    }

    return {
      valid: true,
      permissions: token.permissions,
      remaining_invocations: token.permissions.max_invocations_per_hour - usage.count
    };
  }

  /**
   * Record token usage for rate limiting
   */
  recordUsage(tokenId: string): void {
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;
    
    let usage = this.usageTracking.get(tokenId);
    
    if (!usage || now - usage.window_start > hourMs) {
      usage = { count: 0, window_start: now };
    }
    
    usage.count++;
    this.usageTracking.set(tokenId, usage);
  }

  /**
   * Get current usage for a token
   */
  private checkUsage(tokenId: string): { count: number; window_start: number } {
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;
    
    const usage = this.usageTracking.get(tokenId);
    
    if (!usage || now - usage.window_start > hourMs) {
      return { count: 0, window_start: now };
    }
    
    return usage;
  }

  /**
   * Sign a payload with HMAC-SHA256
   */
  private signPayload(payload: string): string {
    return crypto
      .createHmac('sha256', this.SECRET_KEY)
      .update(payload)
      .digest('hex');
  }

  /**
   * Verify a signature
   */
  private verifySignature(payload: string, signature: string): boolean {
    const expectedSignature = this.signPayload(payload);
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  }

  /**
   * Generate a semantic decryption key for a token
   * This key is required to interpret encrypted semantic fields
   */
  generateSemanticKey(token: CapabilityToken): string {
    const keyMaterial = `${token.token_id}:${token.agent_id}:${token.nonce}:${this.SEMANTIC_SALT}`;
    return crypto
      .createHash('sha256')
      .update(keyMaterial)
      .digest('hex')
      .slice(0, 32);
  }

  /**
   * Revoke a token
   */
  revokeToken(tokenId: string, reason: string = 'manual_revocation'): boolean {
    const token = this.tokens.get(tokenId);
    if (token) {
      this.revokedTokens.add(tokenId);
      this.tokens.delete(tokenId);
      
      // Audit log
      const { securityAuditLog } = require('./audit-log');
      securityAuditLog.log('token_revoked', token.agent_id, {
        token_id: tokenId,
        reason,
        capabilities: token.capabilities
      });
      
      return true;
    }
    return false;
  }

  /**
   * Check if token was revoked
   */
  isRevoked(tokenId: string): boolean {
    return this.revokedTokens.has(tokenId);
  }

  /**
   * Get token by ID (for internal use)
   */
  getToken(tokenId: string): CapabilityToken | undefined {
    return this.tokens.get(tokenId);
  }

  /**
   * Get all tokens for an agent
   */
  getAgentTokens(agentId: string): CapabilityToken[] {
    return Array.from(this.tokens.values())
      .filter(t => t.agent_id === agentId && Date.now() < t.expires_at);
  }

  /**
   * Revoke all tokens for an agent
   */
  revokeAllAgentTokens(agentId: string, reason: string = 'agent_revocation'): number {
    const tokens = this.getAgentTokens(agentId);
    for (const token of tokens) {
      this.revokeToken(token.token_id, reason);
    }
    return tokens.length;
  }

  /**
   * Get revocation stats
   */
  getRevocationStats(): { total_revoked: number; revoked_ids: string[] } {
    return {
      total_revoked: this.revokedTokens.size,
      revoked_ids: Array.from(this.revokedTokens as Set<string>).slice(-100)
    };
  }
}

export const capabilityTokenManager = new CapabilityTokenManager();
