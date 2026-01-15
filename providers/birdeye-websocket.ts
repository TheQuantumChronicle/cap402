import WebSocket from 'ws';
import * as dotenv from 'dotenv';

dotenv.config();

export interface BirdEyePriceUpdate {
  token: string;
  price: number;
  timestamp: number;
  volume_24h: number;
  price_change_24h: number;
}

export type PriceUpdateCallback = (update: BirdEyePriceUpdate) => void;

class BirdEyeWebSocketClient {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private wsUrl: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 5000;
  private subscribers: Map<string, Set<PriceUpdateCallback>> = new Map();
  private isConnecting = false;

  constructor() {
    this.apiKey = process.env.BIRDEYE_API_KEY || '';
    this.wsUrl = process.env.BIRDEYE_WS_URL || 'wss://public-api.birdeye.so/socket/solana';
  }

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
      return;
    }

    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      try {
        const url = this.wsUrl.includes('?') 
          ? this.wsUrl 
          : `${this.wsUrl}?x-api-key=${this.apiKey}`;

        this.ws = new WebSocket(url);

        this.ws.on('open', () => {
          console.log('BirdEye WebSocket connected');
          this.reconnectAttempts = 0;
          this.isConnecting = false;
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

        this.ws.on('error', (error) => {
          console.error('BirdEye WebSocket error:', error);
          this.isConnecting = false;
          reject(error);
        });

        this.ws.on('close', () => {
          console.log('BirdEye WebSocket closed');
          this.isConnecting = false;
          this.handleReconnect();
        });
      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());
      
      if (message.type === 'price_update' && message.data) {
        const update: BirdEyePriceUpdate = {
          token: message.data.address || message.data.symbol,
          price: message.data.value || message.data.price,
          timestamp: message.data.unixTime || Date.now(),
          volume_24h: message.data.v24hUSD || 0,
          price_change_24h: message.data.priceChange24h || 0
        };

        this.notifySubscribers(update.token, update);
      }
    } catch (error) {
      console.error('Failed to parse BirdEye message:', error);
    }
  }

  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached for BirdEye WebSocket');
      return;
    }

    this.reconnectAttempts++;
    console.log(`Reconnecting to BirdEye WebSocket (attempt ${this.reconnectAttempts})...`);

    setTimeout(() => {
      this.connect().catch(err => {
        console.error('Reconnection failed:', err);
      });
    }, this.reconnectDelay * this.reconnectAttempts);
  }

  subscribe(token: string, callback: PriceUpdateCallback): void {
    if (!this.subscribers.has(token)) {
      this.subscribers.set(token, new Set());
    }
    this.subscribers.get(token)!.add(callback);

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscription(token);
    } else {
      this.connect().then(() => {
        this.sendSubscription(token);
      }).catch(err => {
        console.error('Failed to connect for subscription:', err);
      });
    }
  }

  unsubscribe(token: string, callback: PriceUpdateCallback): void {
    const callbacks = this.subscribers.get(token);
    if (callbacks) {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.subscribers.delete(token);
        this.sendUnsubscription(token);
      }
    }
  }

  private sendSubscription(token: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'subscribe',
        data: {
          address: token,
          chainId: 'solana'
        }
      }));
    }
  }

  private sendUnsubscription(token: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'unsubscribe',
        data: {
          address: token
        }
      }));
    }
  }

  private notifySubscribers(token: string, update: BirdEyePriceUpdate): void {
    const callbacks = this.subscribers.get(token);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(update);
        } catch (error) {
          console.error('Subscriber callback error:', error);
        }
      });
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.subscribers.clear();
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export const birdEyeClient = new BirdEyeWebSocketClient();
