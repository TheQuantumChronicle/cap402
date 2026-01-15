/**
 * Helius Webhook Integration
 * 
 * Real-time event streaming from Helius for wallet monitoring,
 * transaction tracking, and on-chain state changes.
 * 
 * This enhances the Helius integration beyond simple API calls
 * to demonstrate real-time data feeding routing decisions.
 */

import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

export interface HeliusWebhook {
  webhookId: string;
  wallet: string;
  webhookURL: string;
  transactionTypes: string[];
  accountAddresses: string[];
  webhookType: string;
}

export interface HeliusEvent {
  type: 'transaction' | 'balance_change' | 'nft_event';
  wallet: string;
  timestamp: number;
  data: any;
}

class HeliusWebhookManager {
  private apiKey: string;
  private webhooks: Map<string, HeliusWebhook> = new Map();
  private eventHandlers: Map<string, (event: HeliusEvent) => void> = new Map();

  constructor() {
    this.apiKey = process.env.HELIUS_API_KEY || '';
  }

  /**
   * Create a webhook for wallet monitoring
   */
  async createWalletWebhook(
    wallet: string,
    webhookURL: string,
    transactionTypes: string[] = ['any']
  ): Promise<HeliusWebhook> {
    try {
      const response = await axios.post(
        `https://api.helius.xyz/v0/webhooks?api-key=${this.apiKey}`,
        {
          webhookURL,
          transactionTypes,
          accountAddresses: [wallet],
          webhookType: 'enhanced'
        }
      );

      const webhook: HeliusWebhook = {
        webhookId: response.data.webhookID,
        wallet,
        webhookURL,
        transactionTypes,
        accountAddresses: [wallet],
        webhookType: 'enhanced'
      };

      this.webhooks.set(wallet, webhook);
      console.log(`✅ Helius webhook created for ${wallet}`);
      
      return webhook;
    } catch (error) {
      console.error(`❌ Failed to create Helius webhook: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Delete a webhook
   */
  async deleteWebhook(wallet: string): Promise<void> {
    const webhook = this.webhooks.get(wallet);
    if (!webhook) return;

    try {
      await axios.delete(
        `https://api.helius.xyz/v0/webhooks/${webhook.webhookId}?api-key=${this.apiKey}`
      );
      
      this.webhooks.delete(wallet);
      this.eventHandlers.delete(wallet);
      console.log(`✅ Helius webhook deleted for ${wallet}`);
    } catch (error) {
      console.error(`❌ Failed to delete Helius webhook: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Register an event handler for a wallet
   */
  onWalletEvent(wallet: string, handler: (event: HeliusEvent) => void): void {
    this.eventHandlers.set(wallet, handler);
  }

  /**
   * Process incoming webhook event
   */
  processEvent(wallet: string, eventData: any): void {
    const handler = this.eventHandlers.get(wallet);
    if (!handler) return;

    const event: HeliusEvent = {
      type: this.determineEventType(eventData),
      wallet,
      timestamp: Date.now(),
      data: eventData
    };

    handler(event);
  }

  private determineEventType(eventData: any): 'transaction' | 'balance_change' | 'nft_event' {
    if (eventData.type === 'NFT_SALE' || eventData.type === 'NFT_LISTING') {
      return 'nft_event';
    } else if (eventData.nativeBalanceChange) {
      return 'balance_change';
    }
    return 'transaction';
  }

  /**
   * Get all active webhooks
   */
  getActiveWebhooks(): HeliusWebhook[] {
    return Array.from(this.webhooks.values());
  }
}

export const heliusWebhookManager = new HeliusWebhookManager();
