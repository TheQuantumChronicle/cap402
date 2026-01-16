/**
 * Real Whale Tracker using Helius Enhanced Transactions API
 * 
 * Tracks actual large transactions on Solana mainnet.
 * Uses Helius for transaction data and optionally Nansen for whale labels.
 */

import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

export interface WhaleMovement {
  wallet: string;
  wallet_label?: string;
  action: 'buy' | 'sell' | 'transfer';
  token: string;
  token_mint?: string;
  amount: number;
  price_usd?: number;
  value_usd: number;
  timestamp: number;
  signature: string;
  source?: string;
  destination?: string;
  significance: string;
}

export interface WhaleTrackerResult {
  movements: WhaleMovement[];
  summary: {
    total_movements: number;
    buy_volume_usd: number;
    sell_volume_usd: number;
    net_flow_usd: number;
    market_sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  };
  alerts: Array<{
    type: string;
    message: string;
    significance: string;
  }>;
  data_source: string;
  tracking_period: string;
}

// Known whale wallets to monitor (real addresses)
const KNOWN_WHALE_WALLETS = [
  'FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5', // Jump Trading
  '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', // Alameda (historical)
  'H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG', // Large SOL holder
  '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', // Raydium
  'GThUX1Atko4tqhN2NaiTazWSeFWMuiUvfFnyJyUghFMJ', // Marinade
];

// Token mint addresses
const TOKEN_MINTS: Record<string, string> = {
  'SOL': 'So11111111111111111111111111111111111111112',
  'USDC': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'USDT': 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  'BONK': 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  'JUP': 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
};

class WhaleTrackerService {
  private heliusApiKeys: string[];
  private currentHeliusKeyIndex: number = 0;
  private nansenApiKeys: string[];
  private currentNansenKeyIndex: number = 0;
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private cacheTTL = 60000; // 1 minute cache

  constructor() {
    // Load all Helius API keys for rotation
    this.heliusApiKeys = [
      process.env.HELIUS_API_KEY || '',
      process.env.HELIUS_API_KEY_2 || '',
      process.env.HELIUS_API_KEY_3 || '',
    ].filter(k => k.length > 0);
    
    // Load all Nansen API keys for rotation
    this.nansenApiKeys = [
      process.env.NANSEN_API_KEY || '',
      process.env.NANSEN_API_KEY_2 || '',
      process.env.NANSEN_API_KEY_3 || '',
    ].filter(k => k.length > 0);
    
    console.log(`🐋 Whale Tracker initialized with ${this.heliusApiKeys.length} Helius keys, ${this.nansenApiKeys.length} Nansen keys`);
  }

  private getHeliusApiKey(): string {
    if (this.heliusApiKeys.length === 0) return '';
    const key = this.heliusApiKeys[this.currentHeliusKeyIndex];
    this.currentHeliusKeyIndex = (this.currentHeliusKeyIndex + 1) % this.heliusApiKeys.length;
    return key;
  }

  private getNansenApiKey(): string | null {
    if (this.nansenApiKeys.length === 0) return null;
    const key = this.nansenApiKeys[this.currentNansenKeyIndex];
    this.currentNansenKeyIndex = (this.currentNansenKeyIndex + 1) % this.nansenApiKeys.length;
    return key;
  }

  /**
   * Get real whale movements using Helius Enhanced Transactions API
   */
  async getWhaleMovements(options: {
    token?: string;
    minValueUsd?: number;
    limit?: number;
    enrichWithNansen?: boolean;
  } = {}): Promise<WhaleTrackerResult> {
    const { token, minValueUsd = 100000, limit = 20, enrichWithNansen = true } = options;
    const cacheKey = `whale_${token || 'all'}_${minValueUsd}`;
    
    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }

    const movements: WhaleMovement[] = [];

    try {
      // Get recent large transactions from Helius
      const transactions = await this.fetchLargeTransactions(minValueUsd, limit);
      
      for (const tx of transactions) {
        const movement = this.parseTransaction(tx, token);
        if (movement && movement.value_usd >= minValueUsd) {
          movements.push(movement);
        }
      }

      // Sort by value
      movements.sort((a, b) => b.value_usd - a.value_usd);

      // Enrich with Nansen labels if enabled (conserves API credits)
      if (enrichWithNansen && this.nansenApiKeys.length > 0) {
        await this.enrichWithNansenLabels(movements);
      }

      // Calculate summary
      const buyVolume = movements
        .filter(m => m.action === 'buy')
        .reduce((sum, m) => sum + m.value_usd, 0);
      const sellVolume = movements
        .filter(m => m.action === 'sell' || m.action === 'transfer')
        .reduce((sum, m) => sum + m.value_usd, 0);
      
      const sentiment = buyVolume > sellVolume * 1.5 ? 'BULLISH' : 
                       sellVolume > buyVolume * 1.5 ? 'BEARISH' : 'NEUTRAL';

      const result: WhaleTrackerResult = {
        movements: movements.slice(0, limit),
        summary: {
          total_movements: movements.length,
          buy_volume_usd: buyVolume,
          sell_volume_usd: sellVolume,
          net_flow_usd: buyVolume - sellVolume,
          market_sentiment: sentiment
        },
        alerts: movements
          .filter(m => m.value_usd > 1000000)
          .map(m => ({
            type: 'WHALE_ALERT',
            message: `${m.wallet.slice(0, 4)}...${m.wallet.slice(-4)} ${m.action} ${m.amount.toLocaleString()} ${m.token} ($${(m.value_usd / 1000000).toFixed(2)}M)`,
            significance: m.significance
          })),
        data_source: enrichWithNansen && this.nansenApiKeys.length > 0 
          ? 'helius_enhanced_transactions + nansen_labels' 
          : 'helius_enhanced_transactions',
        tracking_period: 'last_1_hour'
      };

      // Cache result
      this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
      
      return result;
    } catch (error) {
      console.error('Whale tracker error:', error);
      
      // Return empty result on error
      return {
        movements: [],
        summary: {
          total_movements: 0,
          buy_volume_usd: 0,
          sell_volume_usd: 0,
          net_flow_usd: 0,
          market_sentiment: 'NEUTRAL'
        },
        alerts: [],
        data_source: 'helius_enhanced_transactions',
        tracking_period: 'last_1_hour'
      };
    }
  }

  /**
   * Fetch large transactions from Helius
   */
  private async fetchLargeTransactions(minValueUsd: number, limit: number): Promise<any[]> {
    const heliusKey = this.getHeliusApiKey();
    if (!heliusKey) {
      console.warn('No Helius API key configured');
      return [];
    }

    const transactions: any[] = [];

    // Query recent transactions for known whale wallets
    for (const wallet of KNOWN_WHALE_WALLETS.slice(0, 3)) {
      try {
        const response = await axios.get(
          `https://api.helius.xyz/v0/addresses/${wallet}/transactions`,
          {
            params: {
              'api-key': heliusKey,
              limit: 10,
              type: 'SWAP'
            },
            timeout: 5000
          }
        );

        if (response.data && Array.isArray(response.data)) {
          transactions.push(...response.data.map((tx: any) => ({ ...tx, trackedWallet: wallet })));
        }
      } catch (error) {
        // Continue with other wallets
      }
    }

    // Also get recent parsed transactions
    try {
      const response = await axios.post(
        `https://api.helius.xyz/v0/transactions?api-key=${heliusKey}`,
        {
          transactions: transactions.slice(0, 20).map(t => t.signature).filter(Boolean)
        },
        { timeout: 10000 }
      );

      if (response.data && Array.isArray(response.data)) {
        return response.data;
      }
    } catch (error) {
      // Return raw transactions if parsing fails
    }

    return transactions;
  }

  /**
   * Parse a Helius transaction into a whale movement
   */
  private parseTransaction(tx: any, filterToken?: string): WhaleMovement | null {
    try {
      // Handle Helius enhanced transaction format
      if (tx.type === 'SWAP' || tx.type === 'TRANSFER') {
        const nativeTransfers = tx.nativeTransfers || [];
        const tokenTransfers = tx.tokenTransfers || [];
        
        // Find the largest transfer
        let largestTransfer: any = null;
        let largestValue = 0;

        for (const transfer of [...nativeTransfers, ...tokenTransfers]) {
          const value = transfer.amount * (transfer.tokenPriceUsd || 1);
          if (value > largestValue) {
            largestValue = value;
            largestTransfer = transfer;
          }
        }

        if (!largestTransfer || largestValue < 10000) return null;

        const token = largestTransfer.mint ? 
          this.getTokenSymbol(largestTransfer.mint) : 'SOL';

        if (filterToken && token !== filterToken) return null;

        const action = tx.type === 'SWAP' ? 
          (largestTransfer.fromUserAccount ? 'sell' : 'buy') : 'transfer';

        return {
          wallet: tx.feePayer || largestTransfer.fromUserAccount || 'unknown',
          action,
          token,
          token_mint: largestTransfer.mint,
          amount: largestTransfer.amount,
          price_usd: largestTransfer.tokenPriceUsd,
          value_usd: largestValue,
          timestamp: tx.timestamp * 1000,
          signature: tx.signature,
          source: largestTransfer.fromUserAccount,
          destination: largestTransfer.toUserAccount,
          significance: this.getSignificance(action, largestValue)
        };
      }

      // Handle raw transaction format
      if (tx.trackedWallet) {
        return {
          wallet: tx.trackedWallet,
          action: 'transfer',
          token: 'SOL',
          amount: 0,
          value_usd: 0,
          timestamp: Date.now(),
          signature: tx.signature || 'unknown',
          significance: 'NEUTRAL - Transaction detected'
        };
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  private getTokenSymbol(mint: string): string {
    for (const [symbol, address] of Object.entries(TOKEN_MINTS)) {
      if (address === mint) return symbol;
    }
    return mint.slice(0, 4) + '...' + mint.slice(-4);
  }

  private getSignificance(action: string, valueUsd: number): string {
    if (valueUsd > 10000000) {
      return action === 'buy' ? 'VERY BULLISH - Massive accumulation' :
             action === 'sell' ? 'VERY BEARISH - Major distribution' :
             'SIGNIFICANT - Large movement';
    } else if (valueUsd > 1000000) {
      return action === 'buy' ? 'BULLISH - Large accumulation' :
             action === 'sell' ? 'BEARISH - Profit taking' :
             'NEUTRAL - Large transfer';
    } else {
      return action === 'buy' ? 'SLIGHTLY BULLISH' :
             action === 'sell' ? 'SLIGHTLY BEARISH' :
             'NEUTRAL';
    }
  }

  /**
   * Get wallet transactions from Nansen (FREE TIER - 1 credit per call)
   * Uses /v1/profiler/address/transactions which is available on free plan
   * Note: /profiler/address/labels is 500 credits (Pro only)
   */
  async getWalletTransactions(wallet: string): Promise<{ txCount: number; totalVolumeUsd: number; recentActivity: string; walletLabel?: string } | null> {
    const nansenKey = this.getNansenApiKey();
    if (!nansenKey) return null;

    try {
      const response = await axios.post(
        'https://api.nansen.ai/api/v1/profiler/address/transactions',
        {
          address: wallet,
          chain: 'solana',
          date: {
            from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
            to: new Date().toISOString()
          },
          pagination: {
            page: 1,
            recordsPerPage: 10
          }
        },
        {
          headers: {
            'apiKey': nansenKey,
            'Content-Type': 'application/json'
          },
          timeout: 5000
        }
      );

      // Parse transaction data - Nansen returns address labels in the response!
      if (response.data?.data && Array.isArray(response.data.data)) {
        const txs = response.data.data;
        const totalVolume = txs.reduce((sum: number, tx: any) => sum + (tx.volume_usd || 0), 0);
        // Extract wallet label from first transaction if available
        const firstTx = txs[0];
        const walletLabel = firstTx?.tokens_sent?.[0]?.from_address_label || 
                           firstTx?.tokens_received?.[0]?.to_address_label || null;
        return {
          txCount: txs.length,
          totalVolumeUsd: totalVolume,
          recentActivity: txs.length > 5 ? 'HIGH' : txs.length > 0 ? 'MODERATE' : 'LOW',
          walletLabel
        };
      }
    } catch (error: any) {
      // Handle Nansen API errors gracefully
      const errorMsg = error?.response?.data?.error || error?.response?.data?.detail || error?.message || 'unknown';
      if (errorMsg.includes('Insufficient credits')) {
        console.log('Nansen API: Out of credits - skipping enrichment');
      } else if (errorMsg.includes('Forbidden') || errorMsg.includes('403')) {
        console.log('Nansen API: Endpoint not available on free tier');
      } else {
        console.log('Nansen API error:', errorMsg);
      }
    }

    return null;
  }

  /**
   * Enrich whale movements with Nansen transaction data (FREE TIER)
   * Only calls Nansen for significant movements to conserve API credits (1 credit per call)
   */
  async enrichWithNansenLabels(movements: WhaleMovement[]): Promise<WhaleMovement[]> {
    // Only enrich top 3 movements to conserve API credits
    const toEnrich = movements.slice(0, 3);
    
    for (const movement of toEnrich) {
      if (movement.value_usd > 500000) { // Only for large movements
        const txInfo = await this.getWalletTransactions(movement.wallet);
        if (txInfo) {
          // Use Nansen wallet label if available, otherwise show activity stats
          movement.wallet_label = txInfo.walletLabel || 
            `Activity: ${txInfo.recentActivity} (${txInfo.txCount} txs, $${(txInfo.totalVolumeUsd / 1000000).toFixed(1)}M vol)`;
        }
      }
    }
    
    return movements;
  }
}

export const whaleTrackerService = new WhaleTrackerService();
