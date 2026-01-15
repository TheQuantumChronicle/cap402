/**
 * Real-Time Agent Activity Feed
 * 
 * Tracks and broadcasts agent activities:
 * - Capability invocations
 * - Agent registrations
 * - Delegations and transfers
 * - Workflow executions
 * - Trust changes
 * 
 * Supports SSE (Server-Sent Events) for real-time updates
 */

import { EventEmitter } from 'events';

export interface ActivityEvent {
  id: string;
  type: ActivityType;
  agent_id: string;
  timestamp: number;
  data: Record<string, any>;
  visibility: 'public' | 'private' | 'network';
}

export type ActivityType = 
  | 'agent_registered'
  | 'capability_invoked'
  | 'capability_delegated'
  | 'workflow_started'
  | 'workflow_completed'
  | 'trust_changed'
  | 'badge_earned'
  | 'message_sent'
  | 'marketplace_listing'
  | 'marketplace_purchase'
  | 'consensus_reached'
  | 'chain_completed';

interface FeedSubscription {
  id: string;
  agent_id?: string;
  types?: ActivityType[];
  since?: number;
  callback: (event: ActivityEvent) => void;
}

class ActivityFeed extends EventEmitter {
  private events: ActivityEvent[] = [];
  private subscriptions: Map<string, FeedSubscription> = new Map();
  private readonly MAX_EVENTS = 10000;
  private readonly EVENT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  constructor() {
    super();
    this.setMaxListeners(100);
    
    // Cleanup old events periodically
    const cleanupInterval = setInterval(() => this.cleanup(), 60 * 1000);
    // Prevent timer from keeping process alive during tests
    cleanupInterval.unref();
  }

  /**
   * Record a new activity event
   */
  record(
    type: ActivityType,
    agentId: string,
    data: Record<string, any>,
    visibility: 'public' | 'private' | 'network' = 'public'
  ): ActivityEvent {
    const event: ActivityEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      agent_id: agentId,
      timestamp: Date.now(),
      data,
      visibility
    };

    this.events.push(event);
    
    // Emit for real-time subscribers
    this.emit('activity', event);
    
    // Notify specific subscriptions
    for (const sub of this.subscriptions.values()) {
      if (this.matchesSubscription(event, sub)) {
        sub.callback(event);
      }
    }

    return event;
  }

  /**
   * Get recent events with optional filters
   */
  getRecent(options: {
    limit?: number;
    types?: ActivityType[];
    agent_id?: string;
    since?: number;
    visibility?: 'public' | 'private' | 'network';
  } = {}): ActivityEvent[] {
    let results = [...this.events];

    // Filter by type
    if (options.types && options.types.length > 0) {
      results = results.filter(e => options.types!.includes(e.type));
    }

    // Filter by agent
    if (options.agent_id) {
      results = results.filter(e => e.agent_id === options.agent_id);
    }

    // Filter by time
    if (options.since) {
      results = results.filter(e => e.timestamp > options.since!);
    }

    // Filter by visibility
    if (options.visibility) {
      results = results.filter(e => e.visibility === options.visibility);
    } else {
      // Default to public only
      results = results.filter(e => e.visibility === 'public');
    }

    // Sort by timestamp descending
    results.sort((a, b) => b.timestamp - a.timestamp);

    // Apply limit
    return results.slice(0, options.limit || 50);
  }

  /**
   * Subscribe to real-time events
   */
  subscribe(options: {
    agent_id?: string;
    types?: ActivityType[];
    callback: (event: ActivityEvent) => void;
  }): string {
    const subId = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    this.subscriptions.set(subId, {
      id: subId,
      agent_id: options.agent_id,
      types: options.types,
      callback: options.callback
    });

    return subId;
  }

  /**
   * Unsubscribe from events
   */
  unsubscribe(subscriptionId: string): boolean {
    return this.subscriptions.delete(subscriptionId);
  }

  /**
   * Get activity summary for an agent
   */
  getAgentSummary(agentId: string, hours: number = 24): {
    total_events: number;
    by_type: Record<string, number>;
    recent_activity: ActivityEvent[];
    activity_score: number;
  } {
    const since = Date.now() - hours * 60 * 60 * 1000;
    const agentEvents = this.events.filter(
      e => e.agent_id === agentId && e.timestamp > since
    );

    const byType: Record<string, number> = {};
    for (const event of agentEvents) {
      byType[event.type] = (byType[event.type] || 0) + 1;
    }

    // Calculate activity score
    const weights: Record<string, number> = {
      capability_invoked: 1,
      workflow_completed: 5,
      capability_delegated: 3,
      badge_earned: 10,
      consensus_reached: 4,
      chain_completed: 6
    };

    let activityScore = 0;
    for (const [type, count] of Object.entries(byType)) {
      activityScore += (weights[type] || 1) * count;
    }

    return {
      total_events: agentEvents.length,
      by_type: byType,
      recent_activity: agentEvents.slice(-10).reverse(),
      activity_score: activityScore
    };
  }

  /**
   * Get network-wide activity stats
   */
  getNetworkStats(hours: number = 24): {
    total_events: number;
    events_per_hour: number;
    active_agents: number;
    top_event_types: Array<{ type: string; count: number }>;
    busiest_hour: { hour: number; count: number };
  } {
    const since = Date.now() - hours * 60 * 60 * 1000;
    const recentEvents = this.events.filter(e => e.timestamp > since);

    // Count by type
    const typeCounts: Record<string, number> = {};
    const agentSet = new Set<string>();
    const hourCounts: Record<number, number> = {};

    for (const event of recentEvents) {
      typeCounts[event.type] = (typeCounts[event.type] || 0) + 1;
      agentSet.add(event.agent_id);
      
      const hour = new Date(event.timestamp).getHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    }

    const topEventTypes = Object.entries(typeCounts)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const busiestHour = Object.entries(hourCounts)
      .map(([hour, count]) => ({ hour: parseInt(hour), count }))
      .sort((a, b) => b.count - a.count)[0] || { hour: 0, count: 0 };

    return {
      total_events: recentEvents.length,
      events_per_hour: recentEvents.length / hours,
      active_agents: agentSet.size,
      top_event_types: topEventTypes,
      busiest_hour: busiestHour
    };
  }

  /**
   * Get trending agents (most active)
   */
  getTrendingAgents(limit: number = 10): Array<{
    agent_id: string;
    event_count: number;
    activity_score: number;
  }> {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const recentEvents = this.events.filter(e => e.timestamp > since);

    const agentScores: Record<string, { count: number; score: number }> = {};

    for (const event of recentEvents) {
      if (!agentScores[event.agent_id]) {
        agentScores[event.agent_id] = { count: 0, score: 0 };
      }
      agentScores[event.agent_id].count++;
      
      // Weight by event type
      const weights: Record<string, number> = {
        workflow_completed: 5,
        capability_delegated: 3,
        badge_earned: 10,
        consensus_reached: 4
      };
      agentScores[event.agent_id].score += weights[event.type] || 1;
    }

    return Object.entries(agentScores)
      .map(([agent_id, data]) => ({
        agent_id,
        event_count: data.count,
        activity_score: data.score
      }))
      .sort((a, b) => b.activity_score - a.activity_score)
      .slice(0, limit);
  }

  private matchesSubscription(event: ActivityEvent, sub: FeedSubscription): boolean {
    if (sub.agent_id && event.agent_id !== sub.agent_id) return false;
    if (sub.types && sub.types.length > 0 && !sub.types.includes(event.type)) return false;
    if (sub.since && event.timestamp < sub.since) return false;
    return true;
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.EVENT_TTL_MS;
    this.events = this.events.filter(e => e.timestamp > cutoff);
    
    // Also limit total events
    if (this.events.length > this.MAX_EVENTS) {
      this.events = this.events.slice(-this.MAX_EVENTS);
    }
  }

  /**
   * Get activity feed statistics
   */
  getStats(): {
    totalEvents: number;
    subscriptions: number;
    eventsByType: Record<string, number>;
    eventsLast24h: number;
    eventsLastHour: number;
  } {
    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    const dayAgo = now - 24 * 60 * 60 * 1000;
    
    const eventsByType: Record<string, number> = {};
    let eventsLastHour = 0;
    let eventsLast24h = 0;
    
    for (const event of this.events) {
      eventsByType[event.type] = (eventsByType[event.type] || 0) + 1;
      if (event.timestamp > hourAgo) eventsLastHour++;
      if (event.timestamp > dayAgo) eventsLast24h++;
    }
    
    return {
      totalEvents: this.events.length,
      subscriptions: this.subscriptions.size,
      eventsByType,
      eventsLast24h,
      eventsLastHour
    };
  }
}

export const activityFeed = new ActivityFeed();
