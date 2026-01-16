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
   * 
   * @param options - Configuration options
   * @param options.router - Custom router URL (default: https://cap402.com)
   * @param options.safety - Safety preset: 'conservative' | 'standard' | 'aggressive' | 'none'
   * 
   * @example
   * // Use conservative limits for testing
   * cap402.configure({ safety: 'conservative' });
   * 
   * @example
   * // Use custom router
   * cap402.configure({ router: 'https://my-router.com' });
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
   * Get the current price of a token
   * 
   * @param token - Token symbol (e.g., 'SOL', 'ETH', 'BTC')
   * @param quote - Quote currency (default: 'USD')
   * @returns Current price as a number
   * @throws Error if token not found or network issues
   * 
   * @example
   * const solPrice = await cap402.price('SOL');
   * console.log(`SOL: $${solPrice}`); // SOL: $143.34
   * 
   * @example
   * const ethInBtc = await cap402.price('ETH', 'BTC');
   */
  async price(token: string, quote: string = 'USD'): Promise<number> {
    ensureInitialized();
    
    try {
      const response = await axios.post(`${routerUrl}/invoke`, {
        capability_id: 'cap.price.lookup.v1',
        inputs: { base_token: token, quote_token: quote }
      }, { timeout: 10000 });
      
      if (!response.data.success) {
        throw new Error(response.data.error || `Could not get price for ${token}`);
      }
      
      return response.data.outputs.price;
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED') {
        throw new Error(`Cannot connect to CAP-402 router at ${routerUrl}`);
      }
      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
        throw new Error(`Request timed out - router may be slow or unavailable`);
      }
      throw new Error(`Price lookup failed for ${token}: ${error.message}`);
    }
  },

  /**
   * Get multiple token prices in a single batch request
   * 
   * @param tokens - Array of token symbols
   * @param quote - Quote currency (default: 'USD')
   * @returns Object mapping token symbols to prices
   * 
   * @example
   * const prices = await cap402.prices(['SOL', 'ETH', 'BTC']);
   * console.log(prices); // { SOL: 143.34, ETH: 3301.50, BTC: 95423.00 }
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
   * Get a snapshot of wallet balances and total value
   * 
   * @param address - Solana wallet address (base58 encoded)
   * @returns Wallet snapshot with balances and USD values
   * @throws Error if address is invalid or wallet not found
   * 
   * @example
   * const wallet = await cap402.wallet('82MfBW...');
   * console.log(`Total: $${wallet.total_usd}`);
   * wallet.balances.forEach(b => console.log(`${b.token}: ${b.amount}`));
   */
  async wallet(address: string): Promise<{
    address: string;
    balances: Array<{ token: string; amount: number; usd_value?: number }>;
    total_usd?: number;
  }> {
    ensureInitialized();
    
    // Validate address format
    if (!address || address.length < 32) {
      throw new Error(`Invalid wallet address: ${address}`);
    }
    
    try {
      const response = await axios.post(`${routerUrl}/invoke`, {
        capability_id: 'cap.wallet.snapshot.v1',
        inputs: { address, network: 'solana-mainnet' }
      }, { timeout: 15000 });
      
      if (!response.data.success) {
        throw new Error(response.data.error || `Could not get wallet data for ${address.slice(0, 8)}...`);
      }
      
      return response.data.outputs;
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED') {
        throw new Error(`Cannot connect to CAP-402 router at ${routerUrl}`);
      }
      throw new Error(`Wallet lookup failed: ${error.message}`);
    }
  },

  /**
   * Execute a token swap with built-in safety checks
   * 
   * By default, swaps run in dry-run mode (simulated). Set dryRun: false for real execution.
   * Safety guardrails automatically check spending limits and rate limits.
   * 
   * @param tokenIn - Token to sell (e.g., 'SOL')
   * @param tokenOut - Token to buy (e.g., 'USDC')
   * @param amount - Amount of tokenIn to swap
   * @param options - Swap options
   * @param options.slippage - Max slippage percent (default: 0.5)
   * @param options.mevProtection - Enable MEV protection (default: true)
   * @param options.dryRun - Simulate without executing (default: true)
   * @returns Swap result with amount_out and execution details
   * 
   * @example
   * // Dry run (simulation)
   * const sim = await cap402.swap('SOL', 'USDC', 10);
   * console.log(`Would receive: ${sim.amount_out} USDC`);
   * 
   * @example
   * // Real swap (requires wallet signing)
   * const real = await cap402.swap('SOL', 'USDC', 10, { dryRun: false });
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
    
    // Input validation
    if (!tokenIn || !tokenOut) {
      throw new Error('Both tokenIn and tokenOut are required');
    }
    if (tokenIn === tokenOut) {
      throw new Error('Cannot swap a token for itself');
    }
    if (amount <= 0) {
      throw new Error('Amount must be greater than 0');
    }
    
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
   * Analyze MEV (Maximal Extractable Value) risk for a potential trade
   * 
   * Checks for sandwich attack probability, front-running risk, and provides recommendations.
   * 
   * @param tokenIn - Token to sell
   * @param tokenOut - Token to buy
   * @param amount - Trade amount
   * @returns MEV risk assessment with recommendations
   * 
   * @example
   * const risk = await cap402.mevRisk('SOL', 'USDC', 1000);
   * if (risk.risk === 'HIGH') {
   *   console.log('Consider splitting into smaller trades');
   * }
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
   * Discover capabilities using natural language search
   * 
   * @param query - Natural language query (e.g., 'swap tokens privately')
   * @returns Array of matching capabilities with descriptions
   * 
   * @example
   * const caps = await cap402.discover('get token prices');
   * caps.forEach(c => console.log(`${c.id}: ${c.description}`));
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
   * Invoke any capability by ID
   * 
   * Low-level method for invoking capabilities directly. For common operations,
   * prefer the convenience methods (price, wallet, swap).
   * 
   * @param capabilityId - Full capability ID (e.g., 'cap.price.lookup.v1')
   * @param inputs - Capability-specific input parameters
   * @returns Capability outputs (type varies by capability)
   * @throws Error if capability fails or is blocked by safety guardrails
   * 
   * @example
   * const result = await cap402.invoke('cap.price.lookup.v1', { base_token: 'SOL' });
   * console.log(result.price);
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
   * Check if the CAP-402 router is healthy and responding
   * 
   * @returns true if router is healthy, false otherwise
   * 
   * @example
   * if (await cap402.health()) {
   *   console.log('Router is online');
   * }
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
   * Get all available capabilities from the router
   * 
   * @returns Array of all registered capabilities
   * 
   * @example
   * const caps = await cap402.capabilities();
   * console.log(`${caps.length} capabilities available`);
   */
  async capabilities(): Promise<Array<{ id: string; name: string; description: string }>> {
    const response = await axios.get(`${routerUrl}/capabilities`);
    return response.data.capabilities || [];
  },

  /**
   * Get current safety guardrail status
   * 
   * @returns Safety status including spending totals, or null if safety is disabled
   * 
   * @example
   * const status = cap402.safetyStatus();
   * if (status) {
   *   console.log(`Spent this hour: $${status.hourly_spending}`);
   * }
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
   * Emergency stop - immediately pause all operations
   * 
   * Use this if you detect anomalous behavior. All subsequent operations
   * will be blocked until resume() is called.
   * 
   * @example
   * cap402.emergencyStop();
   * // All operations now blocked
   */
  emergencyStop(): void {
    if (safety) {
      safety.emergencyStop();
    }
    console.error('🚨 EMERGENCY STOP - All operations paused');
  },

  /**
   * Resume operations after an emergency stop or pause
   * 
   * @example
   * cap402.resume();
   * // Operations now allowed again
   */
  resume(): void {
    if (safety) {
      safety.resume();
    }
    console.log('✅ Operations resumed');
  },

  /**
   * Track a transaction status by hash
   * 
   * Poll this to check if a submitted transaction has been confirmed.
   * 
   * @param txHash - Transaction hash/signature
   * @returns Transaction status and details
   * 
   * @example
   * const status = await cap402.trackTransaction('5abc123...');
   * if (status.confirmed) {
   *   console.log(`Confirmed in slot ${status.slot}`);
   * }
   */
  async trackTransaction(txHash: string): Promise<{
    found: boolean;
    confirmed: boolean;
    slot?: number;
    block_time?: number;
    error?: string;
  }> {
    try {
      const response = await axios.get(`${routerUrl}/tx/${txHash}`, { timeout: 10000 });
      return {
        found: true,
        confirmed: response.data.confirmed || false,
        slot: response.data.slot,
        block_time: response.data.block_time
      };
    } catch (error: any) {
      if (error.response?.status === 404) {
        return { found: false, confirmed: false };
      }
      return { found: false, confirmed: false, error: error.message };
    }
  },

  /**
   * Wait for a transaction to be confirmed
   * 
   * Polls the transaction status until confirmed or timeout.
   * 
   * @param txHash - Transaction hash/signature
   * @param timeoutMs - Maximum time to wait (default: 60000ms)
   * @returns Final transaction status
   * @throws Error if transaction fails or times out
   * 
   * @example
   * const result = await cap402.waitForConfirmation('5abc123...');
   * console.log(`Confirmed in slot ${result.slot}`);
   */
  async waitForConfirmation(txHash: string, timeoutMs: number = 60000): Promise<{
    confirmed: boolean;
    slot?: number;
    block_time?: number;
  }> {
    const startTime = Date.now();
    const pollInterval = 2000; // 2 seconds
    
    while (Date.now() - startTime < timeoutMs) {
      const status = await this.trackTransaction(txHash);
      
      if (status.confirmed) {
        return {
          confirmed: true,
          slot: status.slot,
          block_time: status.block_time
        };
      }
      
      if (status.error) {
        throw new Error(`Transaction tracking failed: ${status.error}`);
      }
      
      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
    
    throw new Error(`Transaction confirmation timed out after ${timeoutMs}ms`);
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
