/**
 * Webhook Manager
 * 
 * Handles async notifications from agents to external services.
 * Supports multiple webhook endpoints with retry logic.
 */

import axios, { AxiosError } from 'axios';
import { EventEmitter } from 'events';
import * as crypto from 'crypto';

// ============================================
// TYPES
// ============================================

export interface WebhookConfig {
  id: string;
  url: string;
  secret?: string;
  events: string[];
  enabled: boolean;
  retry_attempts?: number;
  retry_delay_ms?: number;
  timeout_ms?: number;
  headers?: Record<string, string>;
}

export interface WebhookPayload {
  event: string;
  agent_id: string;
  timestamp: number;
  data: any;
  webhook_id: string;
  delivery_id: string;
}

export interface WebhookDelivery {
  delivery_id: string;
  webhook_id: string;
  event: string;
  payload: WebhookPayload;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  last_attempt?: number;
  response_code?: number;
  error?: string;
  created_at: number;
}

// ============================================
// WEBHOOK MANAGER
// ============================================

export class WebhookManager extends EventEmitter {
  private webhooks: Map<string, WebhookConfig> = new Map();
  private deliveries: Map<string, WebhookDelivery> = new Map();
  private pendingQueue: WebhookDelivery[] = [];
  private isProcessing = false;
  private agentId: string;
  private maxDeliveries = 1000;

  constructor(agentId: string) {
    super();
    this.agentId = agentId;
  }

  // ============================================
  // WEBHOOK MANAGEMENT
  // ============================================

  registerWebhook(config: WebhookConfig): void {
    this.webhooks.set(config.id, {
      retry_attempts: 3,
      retry_delay_ms: 1000,
      timeout_ms: 10000,
      ...config
    });
    this.emit('webhook_registered', { id: config.id, url: config.url });
  }

  unregisterWebhook(webhookId: string): void {
    this.webhooks.delete(webhookId);
    this.emit('webhook_unregistered', { id: webhookId });
  }

  getWebhook(webhookId: string): WebhookConfig | undefined {
    return this.webhooks.get(webhookId);
  }

  listWebhooks(): WebhookConfig[] {
    return Array.from(this.webhooks.values());
  }

  enableWebhook(webhookId: string): boolean {
    const webhook = this.webhooks.get(webhookId);
    if (webhook) {
      webhook.enabled = true;
      return true;
    }
    return false;
  }

  disableWebhook(webhookId: string): boolean {
    const webhook = this.webhooks.get(webhookId);
    if (webhook) {
      webhook.enabled = false;
      return true;
    }
    return false;
  }

  // ============================================
  // EVENT DISPATCH
  // ============================================

  async dispatch(event: string, data: any): Promise<string[]> {
    const deliveryIds: string[] = [];

    // Find webhooks subscribed to this event
    this.webhooks.forEach((webhook) => {
      if (!webhook.enabled) return;
      if (!webhook.events.includes(event) && !webhook.events.includes('*')) return;

      const deliveryId = this.createDelivery(webhook, event, data);
      deliveryIds.push(deliveryId);
    });

    // Process queue
    this.processQueue();

    return deliveryIds;
  }

  private createDelivery(webhook: WebhookConfig, event: string, data: any): string {
    const deliveryId = `del_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    const payload: WebhookPayload = {
      event,
      agent_id: this.agentId,
      timestamp: Date.now(),
      data,
      webhook_id: webhook.id,
      delivery_id: deliveryId
    };

    const delivery: WebhookDelivery = {
      delivery_id: deliveryId,
      webhook_id: webhook.id,
      event,
      payload,
      status: 'pending',
      attempts: 0,
      created_at: Date.now()
    };

    this.deliveries.set(deliveryId, delivery);
    this.pendingQueue.push(delivery);

    // Cleanup old deliveries
    if (this.deliveries.size > this.maxDeliveries) {
      const oldest = Array.from(this.deliveries.keys()).slice(0, 100);
      oldest.forEach(id => this.deliveries.delete(id));
    }

    return deliveryId;
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.pendingQueue.length > 0) {
      const delivery = this.pendingQueue.shift()!;
      await this.attemptDelivery(delivery);
    }

    this.isProcessing = false;
  }

  private async attemptDelivery(delivery: WebhookDelivery): Promise<void> {
    const webhook = this.webhooks.get(delivery.webhook_id);
    if (!webhook || !webhook.enabled) {
      delivery.status = 'failed';
      delivery.error = 'Webhook not found or disabled';
      return;
    }

    const maxAttempts = webhook.retry_attempts || 3;

    while (delivery.attempts < maxAttempts) {
      delivery.attempts++;
      delivery.last_attempt = Date.now();

      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Webhook-ID': webhook.id,
          'X-Delivery-ID': delivery.delivery_id,
          'X-Agent-ID': this.agentId,
          ...webhook.headers
        };

        // Add signature if secret is configured
        if (webhook.secret) {
          const signature = this.signPayload(delivery.payload, webhook.secret);
          headers['X-Webhook-Signature'] = signature;
        }

        const response = await axios.post(webhook.url, delivery.payload, {
          headers,
          timeout: webhook.timeout_ms || 10000
        });

        delivery.status = 'delivered';
        delivery.response_code = response.status;

        this.emit('webhook_delivered', {
          delivery_id: delivery.delivery_id,
          webhook_id: webhook.id,
          event: delivery.event,
          attempts: delivery.attempts
        });

        return;

      } catch (error) {
        const axiosError = error as AxiosError;
        delivery.response_code = axiosError.response?.status;
        delivery.error = axiosError.message;

        if (delivery.attempts < maxAttempts) {
          // Wait before retry with exponential backoff
          const delay = (webhook.retry_delay_ms || 1000) * Math.pow(2, delivery.attempts - 1);
          await this.sleep(delay);
        }
      }
    }

    // All attempts failed
    delivery.status = 'failed';
    this.emit('webhook_failed', {
      delivery_id: delivery.delivery_id,
      webhook_id: webhook.id,
      event: delivery.event,
      attempts: delivery.attempts,
      error: delivery.error
    });
  }

  private signPayload(payload: WebhookPayload, secret: string): string {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(JSON.stringify(payload));
    return `sha256=${hmac.digest('hex')}`;
  }

  // ============================================
  // DELIVERY STATUS
  // ============================================

  getDelivery(deliveryId: string): WebhookDelivery | undefined {
    return this.deliveries.get(deliveryId);
  }

  getDeliveries(options?: {
    webhook_id?: string;
    status?: 'pending' | 'delivered' | 'failed';
    event?: string;
    limit?: number;
  }): WebhookDelivery[] {
    let results = Array.from(this.deliveries.values());

    if (options?.webhook_id) {
      results = results.filter(d => d.webhook_id === options.webhook_id);
    }
    if (options?.status) {
      results = results.filter(d => d.status === options.status);
    }
    if (options?.event) {
      results = results.filter(d => d.event === options.event);
    }

    results.sort((a, b) => b.created_at - a.created_at);

    if (options?.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  async retryDelivery(deliveryId: string): Promise<boolean> {
    const delivery = this.deliveries.get(deliveryId);
    if (!delivery || delivery.status !== 'failed') {
      return false;
    }

    delivery.status = 'pending';
    delivery.attempts = 0;
    this.pendingQueue.push(delivery);
    this.processQueue();

    return true;
  }

  // ============================================
  // STATS
  // ============================================

  getStats(): {
    webhooks: number;
    deliveries: { total: number; pending: number; delivered: number; failed: number };
  } {
    let pending = 0;
    let delivered = 0;
    let failed = 0;

    this.deliveries.forEach(d => {
      if (d.status === 'pending') pending++;
      else if (d.status === 'delivered') delivered++;
      else if (d.status === 'failed') failed++;
    });

    return {
      webhooks: this.webhooks.size,
      deliveries: {
        total: this.deliveries.size,
        pending,
        delivered,
        failed
      }
    };
  }

  // ============================================
  // HELPERS
  // ============================================

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================
// FACTORY
// ============================================

export function createWebhookManager(agentId: string): WebhookManager {
  return new WebhookManager(agentId);
}
