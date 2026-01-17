/**
 * Security Audit Log
 * 
 * Tracks all security-relevant events for forensics and compliance.
 * Events are timestamped and include context for investigation.
 */

import { generateShortId } from '../../utils';

export type AuditEventType = 
  | 'token_issued'
  | 'token_validated'
  | 'token_rejected'
  | 'token_revoked'
  | 'handshake_initiated'
  | 'handshake_completed'
  | 'handshake_failed'
  | 'trust_registered'
  | 'trust_endorsed'
  | 'trust_violation'
  | 'access_denied'
  | 'rate_limit_exceeded'
  | 'semantic_decrypt_attempt'
  | 'semantic_decrypt_failed'
  | 'suspicious_activity';

export interface AuditEvent {
  event_id: string;
  timestamp: number;
  event_type: AuditEventType;
  agent_id: string | null;
  ip_address: string | null;
  details: Record<string, any>;
  severity: 'info' | 'warning' | 'critical';
  request_id?: string;
}

interface AuditStats {
  total_events: number;
  events_by_type: Record<string, number>;
  events_by_severity: Record<string, number>;
  recent_critical: AuditEvent[];
  suspicious_agents: string[];
}

class SecurityAuditLog {
  private events: AuditEvent[] = [];
  private readonly MAX_EVENTS = 10000;
  private suspiciousAgents: Map<string, number> = new Map();

  /**
   * Log a security event
   */
  log(
    eventType: AuditEventType,
    agentId: string | null,
    details: Record<string, any>,
    options: {
      ipAddress?: string;
      requestId?: string;
      severity?: 'info' | 'warning' | 'critical';
    } = {}
  ): AuditEvent {
    const event: AuditEvent = {
      event_id: generateShortId('audit', 8),
      timestamp: Date.now(),
      event_type: eventType,
      agent_id: agentId,
      ip_address: options.ipAddress || null,
      details,
      severity: options.severity || this.getSeverity(eventType),
      request_id: options.requestId
    };

    this.events.push(event);

    // Track suspicious agents
    if (event.severity === 'warning' || event.severity === 'critical') {
      if (agentId) {
        const count = (this.suspiciousAgents.get(agentId) || 0) + 1;
        this.suspiciousAgents.set(agentId, count);
      }
    }

    // Trim old events
    if (this.events.length > this.MAX_EVENTS) {
      this.events = this.events.slice(-this.MAX_EVENTS);
    }

    // Log critical events to console
    if (event.severity === 'critical') {
      console.error(`[SECURITY CRITICAL] ${eventType}`, {
        agent_id: agentId,
        details,
        timestamp: new Date(event.timestamp).toISOString()
      });
    }

    return event;
  }

  /**
   * Get default severity for event type
   */
  private getSeverity(eventType: AuditEventType): 'info' | 'warning' | 'critical' {
    const severityMap: Record<AuditEventType, 'info' | 'warning' | 'critical'> = {
      'token_issued': 'info',
      'token_validated': 'info',
      'token_rejected': 'warning',
      'token_revoked': 'info',
      'handshake_initiated': 'info',
      'handshake_completed': 'info',
      'handshake_failed': 'warning',
      'trust_registered': 'info',
      'trust_endorsed': 'info',
      'trust_violation': 'warning',
      'access_denied': 'warning',
      'rate_limit_exceeded': 'warning',
      'semantic_decrypt_attempt': 'info',
      'semantic_decrypt_failed': 'critical',
      'suspicious_activity': 'critical'
    };
    return severityMap[eventType] || 'info';
  }

  /**
   * Get recent events
   */
  getRecentEvents(count: number = 100): AuditEvent[] {
    return this.events.slice(-count).reverse();
  }

  /**
   * Get events for a specific agent
   */
  getAgentEvents(agentId: string, count: number = 50): AuditEvent[] {
    return this.events
      .filter(e => e.agent_id === agentId)
      .slice(-count)
      .reverse();
  }

  /**
   * Get events by type
   */
  getEventsByType(eventType: AuditEventType, count: number = 50): AuditEvent[] {
    return this.events
      .filter(e => e.event_type === eventType)
      .slice(-count)
      .reverse();
  }

  /**
   * Get critical events in time range
   */
  getCriticalEvents(sinceMs: number = 60 * 60 * 1000): AuditEvent[] {
    const since = Date.now() - sinceMs;
    return this.events
      .filter(e => e.severity === 'critical' && e.timestamp > since)
      .reverse();
  }

  /**
   * Get audit statistics
   */
  getStats(): AuditStats {
    const eventsByType: Record<string, number> = {};
    const eventsBySeverity: Record<string, number> = { info: 0, warning: 0, critical: 0 };

    for (const event of this.events) {
      eventsByType[event.event_type] = (eventsByType[event.event_type] || 0) + 1;
      eventsBySeverity[event.severity]++;
    }

    // Get agents with 3+ suspicious events
    const suspiciousAgents = Array.from(this.suspiciousAgents.entries())
      .filter(([_, count]) => count >= 3)
      .map(([agentId]) => agentId);

    return {
      total_events: this.events.length,
      events_by_type: eventsByType,
      events_by_severity: eventsBySeverity,
      recent_critical: this.getCriticalEvents(),
      suspicious_agents: suspiciousAgents
    };
  }

  /**
   * Check if agent is flagged as suspicious
   */
  isSuspicious(agentId: string): boolean {
    return (this.suspiciousAgents.get(agentId) || 0) >= 3;
  }

  /**
   * Clear suspicious flag for agent
   */
  clearSuspiciousFlag(agentId: string): void {
    this.suspiciousAgents.delete(agentId);
  }

  /**
   * Export events for external analysis
   */
  exportEvents(sinceMs?: number): AuditEvent[] {
    if (sinceMs) {
      const since = Date.now() - sinceMs;
      return this.events.filter(e => e.timestamp > since);
    }
    return [...this.events];
  }
}

export const securityAuditLog = new SecurityAuditLog();
