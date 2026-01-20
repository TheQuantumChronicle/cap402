/**
 * StealthPump Capabilities
 * 
 * Token launch capabilities piggybacking off pump.fun with privacy features.
 */

import { Capability } from './capabilities';

export const STEALTH_LAUNCH_CAPABILITY: Capability = {
  id: "cap.stealthpump.launch.v1",
  name: "Stealth Token Launch",
  description: "Launch a token on pump.fun with privacy features - hidden creator wallet, bundled initial buy, MEV protection",
  inputs: {
    schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Token name" },
        symbol: { type: "string", description: "Token symbol (max 10 chars)" },
        description: { type: "string", description: "Token description" },
        image: { type: "string", description: "Image URL or base64" },
        twitter: { type: "string", description: "Twitter handle (optional)" },
        telegram: { type: "string", description: "Telegram group (optional)" },
        website: { type: "string", description: "Website URL (optional)" },
        initial_buy_sol: { type: "number", description: "SOL amount for initial buy (min 0.01)" },
        slippage_bps: { type: "number", description: "Slippage tolerance in basis points (default 500 = 5%)" },
        use_stealth_wallet: { type: "boolean", description: "Use fresh wallet for launch (hides creator)" },
        mev_protection: { type: "boolean", description: "Use Jito bundles for MEV protection" }
      },
      required: ["name", "symbol", "description", "initial_buy_sol"]
    },
    required: ["name", "symbol", "description", "initial_buy_sol"]
  },
  outputs: {
    schema: {
      type: "object",
      properties: {
        mint_address: { type: "string", description: "Token mint address" },
        signature: { type: "string", description: "Transaction signature" },
        bonding_curve: { type: "string", description: "Bonding curve PDA address" },
        creator_wallet: { type: "string", description: "Creator wallet (or stealth wallet)" },
        initial_tokens: { type: "number", description: "Tokens received from initial buy" },
        pump_fun_url: { type: "string", description: "Link to token on pump.fun" }
      }
    }
  },
  execution: {
    mode: "public",
    proof_type: null,
    executor_hint: "pumpfun-executor"
  },
  economics: {
    cost_hint: 0.02,  // ~0.02 SOL for create + fees
    currency: "SOL",
    x402_payment_signal: {
      enabled: true,
      settlement_optional: false,
      payment_methods: ["SOL"]
    },
    privacy_cash_compatible: false
  },
  performance: {
    latency_hint: "medium",
    reliability_hint: 0.95,
    throughput_limit: 10
  },
  version: "1.0.0",
  deprecated: false,
  composable: true,
  metadata: {
    tags: ["token-launch", "pump.fun", "stealth", "meme-coin", "bonding-curve"],
    provider_hints: ["pumpfun"],
    use_cases: ["Launch meme tokens", "Fair launch with hidden creator", "MEV-protected launches"]
  }
};

export const PUMPFUN_BUY_CAPABILITY: Capability = {
  id: "cap.stealthpump.buy.v1",
  name: "Pump.fun Buy",
  description: "Buy tokens from a pump.fun bonding curve with optional MEV protection",
  inputs: {
    schema: {
      type: "object",
      properties: {
        mint_address: { type: "string", description: "Token mint address" },
        amount_sol: { type: "number", description: "SOL amount to spend" },
        slippage_bps: { type: "number", description: "Slippage tolerance in basis points" },
        mev_protection: { type: "boolean", description: "Use Jito bundles for MEV protection" }
      },
      required: ["mint_address", "amount_sol"]
    },
    required: ["mint_address", "amount_sol"]
  },
  outputs: {
    schema: {
      type: "object",
      properties: {
        signature: { type: "string" },
        tokens_received: { type: "number" },
        sol_spent: { type: "number" },
        price_per_token: { type: "number" },
        new_market_cap: { type: "number" }
      }
    }
  },
  execution: {
    mode: "public",
    proof_type: null,
    executor_hint: "pumpfun-executor"
  },
  economics: {
    cost_hint: 0.001,
    currency: "SOL",
    x402_payment_signal: {
      enabled: true,
      settlement_optional: false,
      payment_methods: ["SOL"]
    },
    privacy_cash_compatible: false
  },
  performance: {
    latency_hint: "low",
    reliability_hint: 0.98,
    throughput_limit: 50
  },
  version: "1.0.0",
  deprecated: false,
  composable: true,
  metadata: {
    tags: ["buy", "pump.fun", "bonding-curve", "trade"],
    provider_hints: ["pumpfun"]
  }
};

export const PUMPFUN_SELL_CAPABILITY: Capability = {
  id: "cap.stealthpump.sell.v1",
  name: "Pump.fun Sell",
  description: "Sell tokens back to a pump.fun bonding curve",
  inputs: {
    schema: {
      type: "object",
      properties: {
        mint_address: { type: "string", description: "Token mint address" },
        token_amount: { type: "number", description: "Amount of tokens to sell" },
        slippage_bps: { type: "number", description: "Slippage tolerance in basis points" },
        mev_protection: { type: "boolean", description: "Use Jito bundles for MEV protection" }
      },
      required: ["mint_address", "token_amount"]
    },
    required: ["mint_address", "token_amount"]
  },
  outputs: {
    schema: {
      type: "object",
      properties: {
        signature: { type: "string" },
        tokens_sold: { type: "number" },
        sol_received: { type: "number" },
        price_per_token: { type: "number" }
      }
    }
  },
  execution: {
    mode: "public",
    proof_type: null,
    executor_hint: "pumpfun-executor"
  },
  economics: {
    cost_hint: 0.001,
    currency: "SOL",
    x402_payment_signal: {
      enabled: true,
      settlement_optional: false,
      payment_methods: ["SOL"]
    },
    privacy_cash_compatible: false
  },
  performance: {
    latency_hint: "low",
    reliability_hint: 0.98,
    throughput_limit: 50
  },
  version: "1.0.0",
  deprecated: false,
  composable: true,
  metadata: {
    tags: ["sell", "pump.fun", "bonding-curve", "trade"],
    provider_hints: ["pumpfun"]
  }
};

export const PUMPFUN_QUOTE_CAPABILITY: Capability = {
  id: "cap.stealthpump.quote.v1",
  name: "Pump.fun Quote",
  description: "Get buy/sell quote from pump.fun bonding curve without executing",
  inputs: {
    schema: {
      type: "object",
      properties: {
        mint_address: { type: "string", description: "Token mint address" },
        side: { type: "string", enum: ["buy", "sell"], description: "Quote side" },
        amount: { type: "number", description: "SOL amount (buy) or token amount (sell)" }
      },
      required: ["mint_address", "side", "amount"]
    },
    required: ["mint_address", "side", "amount"]
  },
  outputs: {
    schema: {
      type: "object",
      properties: {
        tokens_out: { type: "number", description: "Tokens received (buy)" },
        sol_out: { type: "number", description: "SOL received (sell)" },
        price_impact: { type: "number", description: "Price impact percentage" },
        new_price: { type: "number", description: "New price after trade" },
        current_market_cap: { type: "number" }
      }
    }
  },
  execution: {
    mode: "public",
    proof_type: null,
    executor_hint: "pumpfun-executor"
  },
  economics: {
    cost_hint: 0,
    currency: "SOL",
    x402_payment_signal: {
      enabled: false,
      settlement_optional: true,
      payment_methods: []
    },
    privacy_cash_compatible: false
  },
  performance: {
    latency_hint: "low",
    reliability_hint: 0.99,
    throughput_limit: 100
  },
  version: "1.0.0",
  deprecated: false,
  composable: true,
  metadata: {
    tags: ["quote", "pump.fun", "bonding-curve", "price"],
    provider_hints: ["pumpfun"]
  }
};

export const BONDING_CURVE_INFO_CAPABILITY: Capability = {
  id: "cap.stealthpump.curve-info.v1",
  name: "Bonding Curve Info",
  description: "Get current state of a pump.fun bonding curve",
  inputs: {
    schema: {
      type: "object",
      properties: {
        mint_address: { type: "string", description: "Token mint address" }
      },
      required: ["mint_address"]
    },
    required: ["mint_address"]
  },
  outputs: {
    schema: {
      type: "object",
      properties: {
        virtual_sol_reserves: { type: "number" },
        virtual_token_reserves: { type: "number" },
        real_sol_reserves: { type: "number" },
        real_token_reserves: { type: "number" },
        token_total_supply: { type: "number" },
        complete: { type: "boolean", description: "Has graduated to Raydium" },
        price_per_token: { type: "number" },
        market_cap_sol: { type: "number" },
        progress_to_graduation: { type: "number", description: "0-100% progress to Raydium" }
      }
    }
  },
  execution: {
    mode: "public",
    proof_type: null,
    executor_hint: "pumpfun-executor"
  },
  economics: {
    cost_hint: 0,
    currency: "SOL",
    x402_payment_signal: {
      enabled: false,
      settlement_optional: true,
      payment_methods: []
    },
    privacy_cash_compatible: false
  },
  performance: {
    latency_hint: "low",
    reliability_hint: 0.99,
    throughput_limit: 100
  },
  version: "1.0.0",
  deprecated: false,
  composable: true,
  metadata: {
    tags: ["info", "pump.fun", "bonding-curve", "market-data"],
    provider_hints: ["pumpfun"]
  }
};
