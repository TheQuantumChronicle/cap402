import axios from 'axios';
import * as dotenv from 'dotenv';
import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

dotenv.config();

// Solana connection for real swap execution
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

// Wallet for swap execution (from env)
function getWalletKeypair(): Keypair | null {
  const secretKey = process.env.X402_SECRET;
  if (!secretKey) {
    console.warn('⚠️  X402_SECRET not set - swap execution disabled');
    return null;
  }
  try {
    return Keypair.fromSecretKey(bs58.decode(secretKey));
  } catch (e) {
    console.error('Invalid X402_SECRET format');
    return null;
  }
}

// Common token mints on Solana
export const TOKEN_MINTS = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  RAY: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  ORCA: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',
  MSOL: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
  JITOSOL: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn'
} as const;

export interface SwapQuote {
  input_mint: string;
  output_mint: string;
  input_amount: number;
  output_amount: number;
  price_impact_pct: number;
  route_plan: any[];
  fees: {
    total: number;
    platform_fee: number;
    network_fee: number;
  };
  minimum_received: number;
  other_amount_threshold: number;
}

export interface SwapResult {
  success: boolean;
  transaction_signature?: string;
  input_amount?: number;
  output_amount?: number;
  price_impact?: number;
  route?: any[];
  fees?: any;
  error?: string;
  confirmed?: boolean;
  slot?: number;
}

class SwapProvider {
  // Jupiter Lite API - free public endpoint (no API key required)
  private getJupiterBaseUrl(): string {
    return process.env.JUPITER_API_URL || 'https://lite-api.jup.ag/swap/v1';
  }
  private get jupiterQuoteUrl(): string {
    return `${this.getJupiterBaseUrl()}/quote`;
  }
  private get jupiterSwapUrl(): string {
    return `${this.getJupiterBaseUrl()}/swap`;
  }
  private jupiterPriceUrl = 'https://price.jup.ag/v6/price';
  private jupiterApiKey = process.env.JUPITER_API_KEY || '';
  
  // Rate limiter to avoid hitting Jupiter API limits
  private lastCall = 0;
  private minDelay = 200; // 200ms between calls
  
  // Cache for token prices
  private priceCache: Map<string, { price: number; timestamp: number }> = new Map();
  private priceCacheTTL = 10000; // 10 seconds
  
  // Stats tracking
  private quoteCount = 0;
  private swapCount = 0;
  private lastError: string | null = null;

  /**
   * Get provider status and stats
   */
  getStatus(): {
    quoteCount: number;
    swapCount: number;
    cacheSize: number;
    lastError: string | null;
  } {
    return {
      quoteCount: this.quoteCount,
      swapCount: this.swapCount,
      cacheSize: this.priceCache.size,
      lastError: this.lastError
    };
  }

  private async rateLimit() {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastCall;
    if (timeSinceLastCall < this.minDelay) {
      await new Promise(resolve => setTimeout(resolve, this.minDelay - timeSinceLastCall));
    }
    this.lastCall = Date.now();
  }

  async getQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number = 50
  ): Promise<SwapQuote> {
    this.quoteCount++;
    try {
      await this.rateLimit();
      
      // Convert SOL amount to lamports (1 SOL = 1e9 lamports)
      const amountInLamports = Math.floor(amount * 1e9);
      
      const headers: Record<string, string> = {};
      if (this.jupiterApiKey) {
        headers['x-api-key'] = this.jupiterApiKey;
      }
      
      const response = await axios.get(this.jupiterQuoteUrl, {
        params: {
          inputMint,
          outputMint,
          amount: amountInLamports,
          slippageBps,
          restrictIntermediateTokens: true,
        },
        headers,
        timeout: 10000
      });

      const quote = response.data;

      const outAmount = parseInt(quote.outAmount) / 1e9;
      const otherAmountThreshold = parseInt(quote.otherAmountThreshold || quote.outAmount) / 1e9;
      
      return {
        input_mint: inputMint,
        output_mint: outputMint,
        input_amount: amount,
        output_amount: outAmount,
        price_impact_pct: parseFloat(quote.priceImpactPct || '0'),
        route_plan: quote.routePlan || [],
        fees: {
          total: parseInt(quote.platformFee?.amount || '0') / 1e9,
          platform_fee: parseInt(quote.platformFee?.amount || '0') / 1e9,
          network_fee: 0.000005 // Estimated Solana network fee
        },
        minimum_received: otherAmountThreshold,
        other_amount_threshold: otherAmountThreshold
      };
    } catch (error) {
      // NO SIMULATION - fail with clear error message
      if (axios.isAxiosError(error)) {
        this.lastError = `Jupiter API error: ${error.response?.data?.error || error.message}`;
        throw new Error(this.lastError);
      }
      this.lastError = error instanceof Error ? error.message : 'Unknown error';
      throw error;
    }
  }

  /**
   * Execute a REAL swap on Solana via Jupiter
   * This spends real SOL/tokens from the configured wallet
   */
  async executeSwap(
    inputToken: string,
    outputToken: string,
    amount: number,
    walletAddress: string,
    slippageBps: number = 50
  ): Promise<SwapResult> {
    this.swapCount++;
    
    // Safety check: limit swap amount to prevent accidents
    const MAX_SWAP_SOL = 0.1; // Max 0.1 SOL per swap for safety
    if (inputToken === TOKEN_MINTS.SOL && amount > MAX_SWAP_SOL) {
      throw new Error(`Swap amount ${amount} SOL exceeds safety limit of ${MAX_SWAP_SOL} SOL`);
    }
    
    const wallet = getWalletKeypair();
    if (!wallet) {
      throw new Error('Wallet not configured - cannot execute real swap. Set X402_SECRET in .env');
    }
    
    try {
      await this.rateLimit();
      
      // 1. Get quote from Jupiter
      const inputMint = TOKEN_MINTS[inputToken as keyof typeof TOKEN_MINTS] || inputToken;
      const outputMint = TOKEN_MINTS[outputToken as keyof typeof TOKEN_MINTS] || outputToken;
      const amountInLamports = Math.floor(amount * 1e9);
      
      const quoteResponse = await axios.get(this.jupiterQuoteUrl, {
        params: {
          inputMint,
          outputMint,
          amount: amountInLamports,
          slippageBps,
        },
        timeout: 10000
      });
      
      const quoteData = quoteResponse.data;
      
      // 2. Get serialized swap transaction from Jupiter
      const swapResponse = await axios.post(this.jupiterSwapUrl, {
        quoteResponse: quoteData,
        userPublicKey: wallet.publicKey.toString(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto'
      }, {
        timeout: 15000
      });
      
      const { swapTransaction } = swapResponse.data;
      
      // 3. Deserialize and sign the transaction
      const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
      transaction.sign([wallet]);
      
      // 4. Send to Solana network
      const rawTransaction = transaction.serialize();
      const txSignature = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: true,
        maxRetries: 3
      });
      
      console.log(`🔄 Swap TX sent: ${txSignature}`);
      
      // 5. Wait for confirmation
      const confirmation = await connection.confirmTransaction(txSignature, 'confirmed');
      
      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }
      
      console.log(`✅ Swap confirmed: ${txSignature}`);
      
      const outputAmount = parseInt(quoteData.outAmount) / 1e9;
      
      return {
        success: true,
        transaction_signature: txSignature,
        input_amount: amount,
        output_amount: outputAmount,
        price_impact: parseFloat(quoteData.priceImpactPct || '0'),
        route: quoteData.routePlan || [],
        fees: {
          total: parseInt(quoteData.platformFee?.amount || '0') / 1e9,
          platform_fee: parseInt(quoteData.platformFee?.amount || '0') / 1e9,
          network_fee: 0.000005
        },
        confirmed: true,
        slot: confirmation.context.slot
      };
      
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Unknown swap error';
      console.error('❌ Swap execution failed:', this.lastError);
      
      // NO FALLBACK - fail hard, no simulation
      throw new Error(`Real swap failed: ${this.lastError}`);
    }
  }

  async getBestRoute(
    inputToken: string,
    outputToken: string,
    amount: number
  ): Promise<any[]> {
    try {
      const quote = await this.getQuote(inputToken, outputToken, amount);
      return quote.route_plan;
    } catch (error) {
      console.error('Failed to get best route:', error);
      return [];
    }
  }
}

export const swapProvider = new SwapProvider();
