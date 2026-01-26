import { Capability } from './capabilities';

// Pumpfun Privacy Capabilities - Privacy-first token launches on pump.fun

export const STEALTH_LAUNCH_CAPABILITY: Capability = {
  id: "cap.stealth.launch.v1",
  name: "Privacy Token Launch",
  description: "Launch a token on pump.fun with hidden creator wallet. Creator revealed only on graduation (85 SOL threshold).",
  inputs: {
    schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Token name" },
        symbol: { type: "string", description: "Token symbol" },
        description: { type: "string", description: "Token description" },
        image: { type: "string", description: "Token image URL" },
        twitter: { type: "string", description: "Twitter handle" },
        telegram: { type: "string", description: "Telegram group" },
        website: { type: "string", description: "Website URL" },
        initial_buy_sol: { type: "number", description: "Initial buy amount in SOL" },
        slippage_bps: { type: "number", description: "Slippage tolerance in basis points" },
        privacy_level: { type: "string", enum: ["basic", "enhanced", "maximum"] }
      },
      required: ["name", "symbol", "description", "initial_buy_sol"]
    },
    required: ["name", "symbol", "description", "initial_buy_sol"]
  },
  outputs: {
    schema: {
      type: "object",
      properties: {
        mint_address: { type: "string" },
        signature: { type: "string" },
        privacy_score: { type: "number" },
        pump_fun_url: { type: "string" }
      }
    }
  },
  execution: {
    mode: "confidential",
    proof_type: "arcium-attestation"
  },
  economics: {
    cost_hint: 0.01,
    currency: "SOL"
  },
  performance: { latency_hint: "high", reliability_hint: 95 },
  version: "1.0.0",
  metadata: { tags: ["pumpfun", "privacy", "launch"] }
};

export const PUMPFUN_BUY_CAPABILITY: Capability = {
  id: "cap.pumpfun.buy.v1",
  name: "Pump.fun Buy",
  description: "Buy tokens from pump.fun bonding curve with optional MEV protection",
  inputs: {
    schema: {
      type: "object",
      properties: {
        mint_address: { type: "string", description: "Token mint address" },
        amount_sol: { type: "number", description: "Amount of SOL to spend" },
        slippage_bps: { type: "number", description: "Slippage tolerance in basis points" },
        mev_protection: { type: "boolean", description: "Enable MEV protection via Jito" }
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
        price_per_token: { type: "number" }
      }
    }
  },
  execution: { mode: "public", proof_type: "none" },
  economics: {
    cost_hint: 0.001,
    currency: "SOL"
  },
  performance: { latency_hint: "medium", reliability_hint: 98 },
  version: "1.0.0",
  metadata: { tags: ["pumpfun", "buy", "bonding-curve"] }
};

export const PUMPFUN_SELL_CAPABILITY: Capability = {
  id: "cap.pumpfun.sell.v1",
  name: "Pump.fun Sell",
  description: "Sell tokens back to pump.fun bonding curve",
  inputs: {
    schema: {
      type: "object",
      properties: {
        mint_address: { type: "string", description: "Token mint address" },
        token_amount: { type: "number", description: "Amount of tokens to sell" },
        slippage_bps: { type: "number", description: "Slippage tolerance in basis points" },
        mev_protection: { type: "boolean", description: "Enable MEV protection via Jito" }
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
        sol_received: { type: "number" },
        price_per_token: { type: "number" }
      }
    }
  },
  execution: { mode: "public", proof_type: "none" },
  economics: {
    cost_hint: 0.001,
    currency: "SOL"
  },
  performance: { latency_hint: "medium", reliability_hint: 98 },
  version: "1.0.0",
  metadata: { tags: ["pumpfun", "sell", "bonding-curve"] }
};

export const PUMPFUN_QUOTE_CAPABILITY: Capability = {
  id: "cap.pumpfun.quote.v1",
  name: "Pump.fun Quote",
  description: "Get buy/sell quote from pump.fun bonding curve",
  inputs: {
    schema: {
      type: "object",
      properties: {
        mint_address: { type: "string", description: "Token mint address" },
        side: { type: "string", enum: ["buy", "sell"], description: "Buy or sell" },
        amount: { type: "number", description: "Amount (SOL for buy, tokens for sell)" }
      },
      required: ["mint_address", "side", "amount"]
    },
    required: ["mint_address", "side", "amount"]
  },
  outputs: {
    schema: {
      type: "object",
      properties: {
        expected_output: { type: "number" },
        price_impact: { type: "number" },
        fee: { type: "number" }
      }
    }
  },
  execution: { mode: "public", proof_type: "none" },
  economics: {
    cost_hint: 0,
    currency: "SOL"
  },
  performance: { latency_hint: "low", reliability_hint: 99 },
  version: "1.0.0",
  metadata: { tags: ["pumpfun", "quote", "bonding-curve"] }
};

export const BONDING_CURVE_INFO_CAPABILITY: Capability = {
  id: "cap.pumpfun.curve.v1",
  name: "Bonding Curve Info",
  description: "Get bonding curve information for a pump.fun token",
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
        progress_to_graduation: { type: "number" },
        graduated: { type: "boolean" }
      }
    }
  },
  execution: { mode: "public", proof_type: "none" },
  economics: {
    cost_hint: 0,
    currency: "SOL"
  },
  performance: { latency_hint: "low", reliability_hint: 99 },
  version: "1.0.0",
  metadata: { tags: ["pumpfun", "bonding-curve", "info"] }
};
