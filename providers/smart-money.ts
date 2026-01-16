/**
 * Smart Money Tracker using Nansen API (FREE TIER)
 * 
 * Uses /v1/tgm/who-bought-sold endpoint (1 credit per call)
 * Returns real smart money buy/sell activity with wallet labels
 */

import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

export interface SmartMoneyTrader {
  address: string;
  label: string;
  bought_volume_usd: number;
  sold_volume_usd: number;
  net_volume_usd: number;
  action: 'accumulating' | 'distributing' | 'neutral';
}

export interface SmartMoneyResult {
  token: string;
  token_address: string;
  traders: SmartMoneyTrader[];
  summary: {
    total_traders: number;
    accumulators: number;
    distributors: number;
    total_buy_volume_usd: number;
    total_sell_volume_usd: number;
    net_flow_usd: number;
    sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  };
  data_source: string;
  period: string;
}

// Token addresses
const TOKENS: Record<string, string> = {
  SOL: 'So11111111111111111111111111111111111111112',
  JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  WIF: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  PYTH: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
};

class SmartMoneyService {
  private nansenApiKeys: string[];
  private currentKeyIndex: number = 0;
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private cacheTTL = 300000; // 5 minute cache

  constructor() {
    this.nansenApiKeys = [
      process.env.NANSEN_API_KEY || '',
      process.env.NANSEN_API_KEY_2 || '',
      process.env.NANSEN_API_KEY_3 || '',
    ].filter(k => k.length > 0);
    
    console.log(`💰 Smart Money Service initialized with ${this.nansenApiKeys.length} Nansen keys`);
  }

  private getApiKey(): string {
    if (this.nansenApiKeys.length === 0) return '';
    const key = this.nansenApiKeys[this.currentKeyIndex];
    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.nansenApiKeys.length;
    return key;
  }

  /**
   * Get smart money activity for a token
   */
  async getSmartMoneyActivity(token: string = 'SOL'): Promise<SmartMoneyResult> {
    const tokenAddress = TOKENS[token.toUpperCase()] || token;
    const cacheKey = `sm_${token}`;
    
    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }

    const apiKey = this.getApiKey();
    if (!apiKey) {
      return this.emptyResult(token, tokenAddress);
    }

    try {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      
      const response = await axios.post(
        'https://api.nansen.ai/api/v1/tgm/who-bought-sold',
        {
          chain: 'solana',
          token_address: tokenAddress,
          date: {
            from: yesterday.toISOString(),
            to: now.toISOString()
          },
          pagination: {
            page: 1,
            per_page: 20
          }
        },
        {
          headers: {
            'apiKey': apiKey,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      if (!response.data?.data || !Array.isArray(response.data.data)) {
        return this.emptyResult(token, tokenAddress);
      }

      const traders: SmartMoneyTrader[] = response.data.data.map((t: any) => {
        const bought = t.bought_volume_usd || 0;
        const sold = t.sold_volume_usd || 0;
        const net = bought - sold;
        
        return {
          address: t.address,
          label: t.address_label || `${t.address.slice(0, 4)}...${t.address.slice(-4)}`,
          bought_volume_usd: bought,
          sold_volume_usd: sold,
          net_volume_usd: net,
          action: net > bought * 0.2 ? 'accumulating' : 
                  net < -sold * 0.2 ? 'distributing' : 'neutral'
        };
      });

      const totalBuy = traders.reduce((sum, t) => sum + t.bought_volume_usd, 0);
      const totalSell = traders.reduce((sum, t) => sum + t.sold_volume_usd, 0);
      const netFlow = totalBuy - totalSell;
      
      const result: SmartMoneyResult = {
        token: token.toUpperCase(),
        token_address: tokenAddress,
        traders: traders.slice(0, 10),
        summary: {
          total_traders: traders.length,
          accumulators: traders.filter(t => t.action === 'accumulating').length,
          distributors: traders.filter(t => t.action === 'distributing').length,
          total_buy_volume_usd: totalBuy,
          total_sell_volume_usd: totalSell,
          net_flow_usd: netFlow,
          sentiment: netFlow > totalBuy * 0.1 ? 'BULLISH' : 
                    netFlow < -totalSell * 0.1 ? 'BEARISH' : 'NEUTRAL'
        },
        data_source: 'nansen_tgm_who_bought_sold',
        period: 'last_24_hours'
      };

      this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
      return result;

    } catch (error: any) {
      const errorMsg = error?.response?.data?.error || error?.message || 'unknown';
      console.log('Smart Money API error:', errorMsg);
      return this.emptyResult(token, tokenAddress);
    }
  }

  private emptyResult(token: string, tokenAddress: string): SmartMoneyResult {
    return {
      token: token.toUpperCase(),
      token_address: tokenAddress,
      traders: [],
      summary: {
        total_traders: 0,
        accumulators: 0,
        distributors: 0,
        total_buy_volume_usd: 0,
        total_sell_volume_usd: 0,
        net_flow_usd: 0,
        sentiment: 'NEUTRAL'
      },
      data_source: 'nansen_tgm_who_bought_sold',
      period: 'last_24_hours'
    };
  }
}

export const smartMoneyService = new SmartMoneyService();
