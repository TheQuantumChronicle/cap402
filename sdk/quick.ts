/**
 * CAP-402 Quick SDK
 * 
 * Zero-friction API for common operations.
 * Security is built-in with sensible defaults - no configuration needed.
 * 
 * Usage:
 *   import { cap402 } from './sdk/quick';
 *   
 *   // One-liners
 *   const price = await cap402.price('SOL');
 *   const wallet = await cap402.wallet('address...');
 *   const swap = await cap402.swap('SOL', 'USDC', 10);
 */

import axios from 'axios';
import { createSafetyGuardrails, SafetyGuardrails, SAFETY_PRESETS } from './safety';

// ============================================
// CONFIGURATION
// ============================================

const DEFAULT_ROUTER = 'https://cap402.com';
let routerUrl = process.env.CAP402_ROUTER || DEFAULT_ROUTER;
let safety: SafetyGuardrails | null = null;
let initialized = false;

// Auto-initialize with standard safety on first use
function ensureInitialized(): void {
  if (!initialized) {
    safety = createSafetyGuardrails(SAFETY_PRESETS.standard);
    initialized = true;
  }
}

// ============================================
// QUICK API
// ============================================

export const cap402 = {
  /**
   * Configure the SDK (optional - sensible defaults are used)
   */
  configure(options: {
    router?: string;
    safety?: 'conservative' | 'standard' | 'aggressive' | 'none';
  } = {}): void {
    if (options.router) {
      routerUrl = options.router;
    }
    
    if (options.safety === 'none') {
      safety = null;
      console.warn('⚠️ Safety guardrails disabled. Use with caution.');
    } else if (options.safety) {
      safety = createSafetyGuardrails(SAFETY_PRESETS[options.safety]);
    }
    
    initialized = true;
  },

  /**
   * Get token price - one liner
   * @example const price = await cap402.price('SOL');
   */
  async price(token: string, quote: string = 'USD'): Promise<number> {
    ensureInitialized();
    
    const response = await axios.post(`${routerUrl}/invoke`, {
      capability_id: 'cap.price.lookup.v1',
      inputs: { base_token: token, quote_token: quote }
    });
    
    if (!response.data.success) {
      throw new Error(response.data.error || 'Price lookup failed');
    }
    
    return response.data.outputs.price;
  },

  /**
   * Get multiple token prices at once
   * @example const prices = await cap402.prices(['SOL', 'ETH', 'BTC']);
   */
  async prices(tokens: string[], quote: string = 'USD'): Promise<Record<string, number>> {
    ensureInitialized();
    
    const requests = tokens.map(token => ({
      capability_id: 'cap.price.lookup.v1',
      inputs: { base_token: token, quote_token: quote }
    }));
    
    const response = await axios.post(`${routerUrl}/batch/invoke`, { requests });
    
    const result: Record<string, number> = {};
    for (let i = 0; i < tokens.length; i++) {
      if (response.data.results[i]?.data?.outputs?.price) {
        result[tokens[i]] = response.data.results[i].data.outputs.price;
      }
    }
    
    return result;
  },

  /**
   * Get wallet snapshot
   * @example const wallet = await cap402.wallet('82MfBW...');
   */
  async wallet(address: string): Promise<{
    address: string;
    balances: Array<{ token: string; amount: number; usd_value?: number }>;
    total_usd?: number;
  }> {
    ensureInitialized();
    
    const response = await axios.post(`${routerUrl}/invoke`, {
      capability_id: 'cap.wallet.snapshot.v1',
      inputs: { address, network: 'solana-mainnet' }
    });
    
    if (!response.data.success) {
      throw new Error(response.data.error || 'Wallet lookup failed');
    }
    
    return response.data.outputs;
  },

  /**
   * Execute a token swap (with built-in safety checks)
   * @example const result = await cap402.swap('SOL', 'USDC', 10);
   */
  async swap(
    tokenIn: string,
    tokenOut: string,
    amount: number,
    options: { slippage?: number; mevProtection?: boolean; dryRun?: boolean } = {}
  ): Promise<{
    success: boolean;
    amount_out?: number;
    price?: number;
    tx_hash?: string;
    dry_run?: boolean;
  }> {
    ensureInitialized();
    
    const slippage = options.slippage ?? 0.5;
    const mevProtection = options.mevProtection ?? true;
    const dryRun = options.dryRun ?? true; // Default to dry run for safety
    
    // Safety checks
    if (safety) {
      const check = await safety.checkBeforeInvoke('cap.swap.execute.v1', {
        token_in: tokenIn,
        token_out: tokenOut,
        amount
      });
      
      if (!check.allowed) {
        throw new Error(`Safety block: ${check.reason}`);
      }
      
      // Estimate USD value for spending check
      try {
        const price = await this.price(tokenIn);
        const usdValue = amount * price;
        
        const spendCheck = await safety.checkSpending(usdValue, 'cap.swap.execute.v1');
        if (!spendCheck.allowed) {
          throw new Error(`Spending limit: ${spendCheck.reason}`);
        }
        
        if (spendCheck.requiresConfirmation && !dryRun) {
          console.warn(`⚠️ ${spendCheck.confirmationPrompt}`);
          console.warn('   Set dryRun: false explicitly to proceed.');
          return { success: false, dry_run: true };
        }
      } catch (e) {
        // Continue if price check fails
      }
      
      safety.recordInvocation();
      safety.recordTrade();
    }
    
    // MEV protection check
    if (mevProtection && !dryRun) {
      try {
        const mevResponse = await axios.post(`${routerUrl}/mev/analyze`, {
          token_in: tokenIn,
          token_out: tokenOut,
          amount,
          slippage
        });
        
        if (mevResponse.data.mev_analysis?.risk_assessment?.overall_risk === 'HIGH') {
          console.warn('⚠️ High MEV risk detected. Consider reducing trade size.');
        }
      } catch {
        // Continue if MEV check fails
      }
    }
    
    if (dryRun) {
      // Simulate the swap
      const price = await this.price(tokenIn);
      const outPrice = await this.price(tokenOut);
      const estimatedOut = (amount * price) / outPrice;
      
      return {
        success: true,
        amount_out: estimatedOut,
        price: price / outPrice,
        dry_run: true
      };
    }
    
    // Execute real swap
    const response = await axios.post(`${routerUrl}/invoke`, {
      capability_id: 'cap.swap.execute.v1',
      inputs: {
        token_in: tokenIn,
        token_out: tokenOut,
        amount_in: amount,
        slippage
      }
    });
    
    if (safety && response.data.success) {
      const price = await this.price(tokenIn).catch(() => 0);
      safety.recordSpending(amount * price, 'cap.swap.execute.v1');
      safety.recordSuccess();
    } else if (safety) {
      safety.recordFailure();
    }
    
    return {
      success: response.data.success,
      amount_out: response.data.outputs?.amount_out,
      price: response.data.outputs?.execution_price,
      tx_hash: response.data.outputs?.tx_hash,
      dry_run: false
    };
  },

  /**
   * Analyze MEV risk for a trade
   * @example const risk = await cap402.mevRisk('SOL', 'USDC', 1000);
   */
  async mevRisk(tokenIn: string, tokenOut: string, amount: number): Promise<{
    risk: 'LOW' | 'MEDIUM' | 'HIGH';
    sandwich_probability: string;
    potential_loss_usd: string;
    recommendations: string[];
  }> {
    ensureInitialized();
    
    const response = await axios.post(`${routerUrl}/mev/analyze`, {
      token_in: tokenIn,
      token_out: tokenOut,
      amount,
      slippage: 0.5
    });
    
    return {
      risk: response.data.mev_analysis?.risk_assessment?.overall_risk || 'LOW',
      sandwich_probability: response.data.mev_analysis?.risk_assessment?.sandwich_probability || '0%',
      potential_loss_usd: response.data.mev_analysis?.potential_loss_usd || '0',
      recommendations: response.data.mev_analysis?.recommendations || []
    };
  },

  /**
   * Discover capabilities
   * @example const caps = await cap402.discover('swap tokens');
   */
  async discover(query: string): Promise<Array<{
    id: string;
    name: string;
    description: string;
    cost_hint: number;
  }>> {
    ensureInitialized();
    
    const response = await axios.post(`${routerUrl}/discover`, { query });
    
    return (response.data.results || []).map((r: any) => ({
      id: r.capability_id,
      name: r.name,
      description: r.description,
      cost_hint: r.cost_hint
    }));
  },

  /**
   * Invoke any capability
   * @example const result = await cap402.invoke('cap.price.lookup.v1', { base_token: 'SOL' });
   */
  async invoke<T = any>(capabilityId: string, inputs: Record<string, any>): Promise<T> {
    ensureInitialized();
    
    if (safety) {
      const check = await safety.checkBeforeInvoke(capabilityId, inputs);
      if (!check.allowed) {
        throw new Error(`Safety block: ${check.reason}`);
      }
      safety.recordInvocation();
    }
    
    const response = await axios.post(`${routerUrl}/invoke`, {
      capability_id: capabilityId,
      inputs
    });
    
    if (!response.data.success) {
      if (safety) safety.recordFailure();
      throw new Error(response.data.error || 'Invocation failed');
    }
    
    if (safety) safety.recordSuccess();
    return response.data.outputs;
  },

  /**
   * Check router health
   * @example const healthy = await cap402.health();
   */
  async health(): Promise<boolean> {
    try {
      const response = await axios.get(`${routerUrl}/health`, { timeout: 5000 });
      return response.data.status === 'healthy';
    } catch {
      return false;
    }
  },

  /**
   * Get available capabilities
   * @example const caps = await cap402.capabilities();
   */
  async capabilities(): Promise<Array<{ id: string; name: string; description: string }>> {
    const response = await axios.get(`${routerUrl}/capabilities`);
    return response.data.capabilities || [];
  },

  /**
   * Get safety status
   */
  safetyStatus(): {
    enabled: boolean;
    paused: boolean;
    session_spending: number;
    hourly_spending: number;
  } | null {
    if (!safety) return null;
    const status = safety.getStatus();
    return {
      enabled: true,
      paused: status.paused,
      session_spending: status.session_spending,
      hourly_spending: status.hourly_spending
    };
  },

  /**
   * Emergency stop - pause all operations
   */
  emergencyStop(): void {
    if (safety) {
      safety.emergencyStop();
    }
    console.error('🚨 EMERGENCY STOP - All operations paused');
  },

  /**
   * Resume after pause
   */
  resume(): void {
    if (safety) {
      safety.resume();
    }
    console.log('✅ Operations resumed');
  }
};

// ============================================
// CONVENIENCE ALIASES
// ============================================

export const getPrice = cap402.price;
export const getPrices = cap402.prices;
export const getWallet = cap402.wallet;
export const swap = cap402.swap;
export const mevRisk = cap402.mevRisk;
export const discover = cap402.discover;
export const invoke = cap402.invoke;
export const health = cap402.health;

// ============================================
// DEFAULT EXPORT
// ============================================

export default cap402;
