/**
 * Real-Time Trading Signals
 * 
 * WebSocket-based signal delivery for trading agents:
 * - Price movements and momentum
 * - Liquidity changes
 * - Whale wallet activity
 * - MEV risk alerts
 * - A2A trading opportunities
 * 
 * Agents subscribe to signals they care about and get instant delivery.
 */

import { EventEmitter } from 'events';
import { generateShortId } from '../../utils';

export type SignalType = 
  | 'price_movement'      // Significant price change
  | 'momentum_shift'      // Trend reversal detected
  | 'liquidity_change'    // Pool liquidity added/removed
  | 'whale_activity'      // Large wallet movement
  | 'mev_risk'            // MEV bot activity detected
  | 'arbitrage_opportunity' // Cross-DEX price difference
  | 'a2a_quote_available' // Another agent offering a trade
  | 'market_sentiment'    // Aggregate sentiment shift
  | 'volume_spike'        // Unusual volume detected
  | 'support_resistance'  // Price at key level
  | 'divergence'          // Price/indicator divergence
  | 'liquidation_cascade' // Large liquidations incoming
  | 'smart_money_flow';   // Institutional movement detected

export type SignalPriority = 'low' | 'medium' | 'high' | 'critical';

// Technical indicator thresholds
const INDICATOR_THRESHOLDS = {
  RSI_OVERSOLD: 30,
  RSI_OVERBOUGHT: 70,
  VOLUME_SPIKE_MULTIPLIER: 3,
  WHALE_THRESHOLD_USD: 50000,
  LIQUIDATION_CASCADE_USD: 1000000,
} as const;

export interface TradingSignal {
  signal_id: string;
  type: SignalType;
  priority: SignalPriority;
  timestamp: number;
  
  // What token/pair this signal is about
  asset: {
    symbol: string;
    mint?: string;
    pair?: string; // e.g., "SOL/USDC"
  };
  
  // Signal-specific data
  data: {
    // Price signals
    price_change_percent?: number;
    current_price?: number;
    previous_price?: number;
    volume_24h?: number;
    
    // Momentum signals
    trend_direction?: 'bullish' | 'bearish' | 'neutral';
    strength?: number; // 0-100
    timeframe?: string; // e.g., "5m", "1h", "4h"
    
    // Liquidity signals
    liquidity_change_percent?: number;
    pool_address?: string;
    
    // Whale signals
    wallet_address?: string;
    transaction_type?: 'buy' | 'sell' | 'transfer';
    amount_usd?: number;
    
    // MEV signals
    mev_type?: 'sandwich' | 'frontrun' | 'backrun';
    risk_score?: number; // 0-100
    estimated_loss_usd?: number;
    
    // Arbitrage signals
    buy_venue?: string;
    sell_venue?: string;
    spread_percent?: number;
    max_size_usd?: number;
    
    // A2A signals
    offering_agent?: string;
    quote_id?: string;
    expires_at?: number;
    
    // Technical indicators
    rsi?: number;
    macd?: { value: number; signal: number; histogram: number };
    bollinger?: { upper: number; middle: number; lower: number; width: number };
    
    // Volume analysis
    volume_ratio?: number; // Current vs average
    buy_volume_percent?: number;
    sell_volume_percent?: number;
    
    // Support/Resistance
    support_levels?: number[];
    resistance_levels?: number[];
    distance_to_support_percent?: number;
    distance_to_resistance_percent?: number;
    
    // Divergence
    divergence_type?: 'bullish' | 'bearish';
    indicator_diverging?: string;
    
    // Liquidation
    liquidation_price?: number;
    liquidation_amount_usd?: number;
    cascade_risk?: 'low' | 'medium' | 'high';
    
    // Smart money
    institutional_flow?: 'inflow' | 'outflow' | 'neutral';
    flow_amount_usd?: number;
    known_wallet_type?: 'whale' | 'fund' | 'exchange' | 'unknown';
  };
  
  // Actionable recommendation
  recommendation?: {
    action: 'buy' | 'sell' | 'hold' | 'protect' | 'arbitrage';
    confidence: number; // 0-100
    reasoning: string;
    suggested_size_percent?: number; // % of portfolio
    urgency_seconds?: number; // How long this opportunity lasts
  };
  
  // For premium subscribers
  encrypted_alpha?: string; // Encrypted detailed analysis
}

export interface SignalSubscription {
  subscription_id: string;
  agent_id: string;
  types: SignalType[];
  assets?: string[]; // Filter by specific assets
  min_priority?: SignalPriority;
  callback: (signal: TradingSignal) => void;
  created_at: number;
}

interface SignalStats {
  total_signals: number;
  by_type: Record<SignalType, number>;
  by_priority: Record<SignalPriority, number>;
  subscribers: number;
  signals_per_minute: number;
}

class RealTimeSignalService extends EventEmitter {
  private subscriptions: Map<string, SignalSubscription> = new Map();
  private recentSignals: TradingSignal[] = [];
  private readonly MAX_RECENT_SIGNALS = 1000;
  private signalCount = 0;
  private minuteSignalCount = 0;
  private lastMinuteReset = Date.now();
  
  private stats: SignalStats = {
    total_signals: 0,
    by_type: {} as Record<SignalType, number>,
    by_priority: { low: 0, medium: 0, high: 0, critical: 0 },
    subscribers: 0,
    signals_per_minute: 0
  };

  /**
   * Subscribe to trading signals
   */
  subscribe(
    agentId: string,
    types: SignalType[],
    callback: (signal: TradingSignal) => void,
    options?: {
      assets?: string[];
      min_priority?: SignalPriority;
    }
  ): string {
    const subscriptionId = generateShortId('sig_sub', 8);
    
    const subscription: SignalSubscription = {
      subscription_id: subscriptionId,
      agent_id: agentId,
      types,
      assets: options?.assets,
      min_priority: options?.min_priority,
      callback,
      created_at: Date.now()
    };
    
    this.subscriptions.set(subscriptionId, subscription);
    this.stats.subscribers = this.subscriptions.size;
    
    return subscriptionId;
  }

  /**
   * Unsubscribe from signals
   */
  unsubscribe(subscriptionId: string): boolean {
    const result = this.subscriptions.delete(subscriptionId);
    this.stats.subscribers = this.subscriptions.size;
    return result;
  }

  /**
   * Emit a trading signal to all relevant subscribers
   */
  emitSignal(signal: Omit<TradingSignal, 'signal_id' | 'timestamp'>): TradingSignal {
    const fullSignal: TradingSignal = {
      ...signal,
      signal_id: generateShortId('sig', 8),
      timestamp: Date.now()
    };
    
    // Store in recent signals
    this.recentSignals.push(fullSignal);
    if (this.recentSignals.length > this.MAX_RECENT_SIGNALS) {
      this.recentSignals.shift();
    }
    
    // Update stats
    this.stats.total_signals++;
    this.stats.by_type[signal.type] = (this.stats.by_type[signal.type] || 0) + 1;
    this.stats.by_priority[signal.priority]++;
    this.minuteSignalCount++;
    
    // Reset minute counter if needed
    if (Date.now() - this.lastMinuteReset > 60000) {
      this.stats.signals_per_minute = this.minuteSignalCount;
      this.minuteSignalCount = 0;
      this.lastMinuteReset = Date.now();
    }
    
    // Deliver to subscribers
    const priorityOrder: SignalPriority[] = ['low', 'medium', 'high', 'critical'];
    
    for (const subscription of this.subscriptions.values()) {
      // Check type filter
      if (!subscription.types.includes(signal.type)) continue;
      
      // Check asset filter
      if (subscription.assets && subscription.assets.length > 0) {
        const signalAsset = signal.asset.symbol;
        if (!subscription.assets.includes(signalAsset)) continue;
      }
      
      // Check priority filter
      if (subscription.min_priority) {
        const minIndex = priorityOrder.indexOf(subscription.min_priority);
        const signalIndex = priorityOrder.indexOf(signal.priority);
        if (signalIndex < minIndex) continue;
      }
      
      // Deliver signal
      try {
        subscription.callback(fullSignal);
      } catch (e) {
        // Don't let one bad subscriber break others
        console.error(`[SignalService] Error delivering to ${subscription.agent_id}:`, e);
      }
    }
    
    // Emit on EventEmitter for internal use
    this.emit('signal', fullSignal);
    
    return fullSignal;
  }

  /**
   * Generate a price movement signal
   */
  emitPriceMovement(
    symbol: string,
    currentPrice: number,
    previousPrice: number,
    volume24h?: number
  ): TradingSignal {
    const changePercent = ((currentPrice - previousPrice) / previousPrice) * 100;
    const absChange = Math.abs(changePercent);
    
    let priority: SignalPriority = 'low';
    if (absChange >= 10) priority = 'critical';
    else if (absChange >= 5) priority = 'high';
    else if (absChange >= 2) priority = 'medium';
    
    const trend = changePercent > 0 ? 'bullish' : 'bearish';
    
    return this.emitSignal({
      type: 'price_movement',
      priority,
      asset: { symbol },
      data: {
        price_change_percent: changePercent,
        current_price: currentPrice,
        previous_price: previousPrice,
        volume_24h: volume24h,
        trend_direction: trend
      },
      recommendation: absChange >= 5 ? {
        action: changePercent > 0 ? 'hold' : 'buy',
        confidence: Math.min(90, 50 + absChange * 5),
        reasoning: `${symbol} moved ${changePercent.toFixed(2)}% - ${trend} momentum`,
        urgency_seconds: absChange >= 10 ? 60 : 300
      } : undefined
    });
  }

  /**
   * Generate an MEV risk alert
   */
  emitMEVRisk(
    symbol: string,
    mevType: 'sandwich' | 'frontrun' | 'backrun',
    riskScore: number,
    estimatedLossUsd: number
  ): TradingSignal {
    let priority: SignalPriority = 'medium';
    if (riskScore >= 80) priority = 'critical';
    else if (riskScore >= 60) priority = 'high';
    
    return this.emitSignal({
      type: 'mev_risk',
      priority,
      asset: { symbol },
      data: {
        mev_type: mevType,
        risk_score: riskScore,
        estimated_loss_usd: estimatedLossUsd
      },
      recommendation: {
        action: 'protect',
        confidence: riskScore,
        reasoning: `${mevType} attack detected. Use private mempool or split trade.`,
        urgency_seconds: 30
      }
    });
  }

  /**
   * Generate an arbitrage opportunity signal
   */
  emitArbitrageOpportunity(
    symbol: string,
    buyVenue: string,
    sellVenue: string,
    spreadPercent: number,
    maxSizeUsd: number
  ): TradingSignal {
    let priority: SignalPriority = 'medium';
    if (spreadPercent >= 2) priority = 'critical';
    else if (spreadPercent >= 1) priority = 'high';
    
    return this.emitSignal({
      type: 'arbitrage_opportunity',
      priority,
      asset: { symbol },
      data: {
        buy_venue: buyVenue,
        sell_venue: sellVenue,
        spread_percent: spreadPercent,
        max_size_usd: maxSizeUsd
      },
      recommendation: {
        action: 'arbitrage',
        confidence: Math.min(95, 60 + spreadPercent * 15),
        reasoning: `Buy on ${buyVenue}, sell on ${sellVenue} for ${spreadPercent.toFixed(2)}% profit`,
        suggested_size_percent: Math.min(10, spreadPercent * 3),
        urgency_seconds: 15 // Arb opportunities are fleeting
      }
    });
  }

  /**
   * Generate a whale activity signal
   */
  emitWhaleActivity(
    symbol: string,
    walletAddress: string,
    transactionType: 'buy' | 'sell' | 'transfer',
    amountUsd: number
  ): TradingSignal {
    let priority: SignalPriority = 'medium';
    if (amountUsd >= 1000000) priority = 'critical';
    else if (amountUsd >= 100000) priority = 'high';
    
    const trend = transactionType === 'buy' ? 'bullish' : 
                  transactionType === 'sell' ? 'bearish' : 'neutral';
    
    return this.emitSignal({
      type: 'whale_activity',
      priority,
      asset: { symbol },
      data: {
        wallet_address: walletAddress.slice(0, 8) + '...' + walletAddress.slice(-4),
        transaction_type: transactionType,
        amount_usd: amountUsd,
        trend_direction: trend
      },
      recommendation: transactionType !== 'transfer' ? {
        action: transactionType === 'buy' ? 'buy' : 'sell',
        confidence: Math.min(80, 40 + (amountUsd / 50000)),
        reasoning: `Whale ${transactionType} of $${(amountUsd / 1000).toFixed(0)}K detected`,
        urgency_seconds: 120
      } : undefined
    });
  }

  /**
   * Generate an A2A quote available signal
   */
  emitA2AQuote(
    symbol: string,
    offeringAgent: string,
    quoteId: string,
    priceImprovement: number,
    expiresInSeconds: number
  ): TradingSignal {
    return this.emitSignal({
      type: 'a2a_quote_available',
      priority: priceImprovement >= 1 ? 'high' : 'medium',
      asset: { symbol },
      data: {
        offering_agent: offeringAgent,
        quote_id: quoteId,
        spread_percent: priceImprovement,
        expires_at: Date.now() + (expiresInSeconds * 1000)
      },
      recommendation: {
        action: 'buy',
        confidence: 70 + priceImprovement * 10,
        reasoning: `Agent ${offeringAgent} offering ${priceImprovement.toFixed(2)}% better than DEX`,
        urgency_seconds: expiresInSeconds
      }
    });
  }

  /**
   * Generate a volume spike signal
   */
  emitVolumeSpike(
    symbol: string,
    currentVolume: number,
    averageVolume: number,
    buyVolumePercent: number
  ): TradingSignal {
    const volumeRatio = currentVolume / averageVolume;
    let priority: SignalPriority = 'low';
    if (volumeRatio >= 5) priority = 'critical';
    else if (volumeRatio >= 3) priority = 'high';
    else if (volumeRatio >= 2) priority = 'medium';
    
    const trend = buyVolumePercent > 60 ? 'bullish' : buyVolumePercent < 40 ? 'bearish' : 'neutral';
    
    return this.emitSignal({
      type: 'volume_spike',
      priority,
      asset: { symbol },
      data: {
        volume_ratio: Math.round(volumeRatio * 100) / 100,
        buy_volume_percent: buyVolumePercent,
        sell_volume_percent: 100 - buyVolumePercent,
        trend_direction: trend,
        volume_24h: currentVolume
      },
      recommendation: {
        action: trend === 'bullish' ? 'buy' : trend === 'bearish' ? 'sell' : 'hold',
        confidence: Math.min(85, 50 + volumeRatio * 10),
        reasoning: `Volume ${volumeRatio.toFixed(1)}x average, ${buyVolumePercent}% buy pressure`,
        urgency_seconds: 300
      }
    });
  }

  /**
   * Generate a support/resistance signal
   */
  emitSupportResistance(
    symbol: string,
    currentPrice: number,
    supportLevels: number[],
    resistanceLevels: number[]
  ): TradingSignal {
    const nearestSupport = supportLevels.reduce((a, b) => 
      Math.abs(b - currentPrice) < Math.abs(a - currentPrice) && b < currentPrice ? b : a, supportLevels[0]);
    const nearestResistance = resistanceLevels.reduce((a, b) => 
      Math.abs(b - currentPrice) < Math.abs(a - currentPrice) && b > currentPrice ? b : a, resistanceLevels[0]);
    
    const distanceToSupport = ((currentPrice - nearestSupport) / currentPrice) * 100;
    const distanceToResistance = ((nearestResistance - currentPrice) / currentPrice) * 100;
    
    const nearSupport = distanceToSupport < 2;
    const nearResistance = distanceToResistance < 2;
    
    let priority: SignalPriority = 'low';
    if (nearSupport || nearResistance) priority = 'high';
    if (distanceToSupport < 1 || distanceToResistance < 1) priority = 'critical';
    
    return this.emitSignal({
      type: 'support_resistance',
      priority,
      asset: { symbol },
      data: {
        current_price: currentPrice,
        support_levels: supportLevels,
        resistance_levels: resistanceLevels,
        distance_to_support_percent: Math.round(distanceToSupport * 100) / 100,
        distance_to_resistance_percent: Math.round(distanceToResistance * 100) / 100,
        trend_direction: nearSupport ? 'bullish' : nearResistance ? 'bearish' : 'neutral'
      },
      recommendation: nearSupport ? {
        action: 'buy',
        confidence: 70,
        reasoning: `Price at support level $${nearestSupport.toFixed(2)}`,
        urgency_seconds: 60
      } : nearResistance ? {
        action: 'sell',
        confidence: 70,
        reasoning: `Price at resistance level $${nearestResistance.toFixed(2)}`,
        urgency_seconds: 60
      } : undefined
    });
  }

  /**
   * Generate a divergence signal (price vs indicator)
   */
  emitDivergence(
    symbol: string,
    divergenceType: 'bullish' | 'bearish',
    indicator: string,
    currentPrice: number,
    rsi?: number
  ): TradingSignal {
    return this.emitSignal({
      type: 'divergence',
      priority: 'high',
      asset: { symbol },
      data: {
        divergence_type: divergenceType,
        indicator_diverging: indicator,
        current_price: currentPrice,
        rsi,
        trend_direction: divergenceType === 'bullish' ? 'bullish' : 'bearish'
      },
      recommendation: {
        action: divergenceType === 'bullish' ? 'buy' : 'sell',
        confidence: 75,
        reasoning: `${divergenceType} divergence on ${indicator} - potential reversal`,
        urgency_seconds: 600
      }
    });
  }

  /**
   * Generate a liquidation cascade signal
   */
  emitLiquidationCascade(
    symbol: string,
    liquidationPrice: number,
    liquidationAmountUsd: number,
    cascadeRisk: 'low' | 'medium' | 'high'
  ): TradingSignal {
    let priority: SignalPriority = 'medium';
    if (cascadeRisk === 'high') priority = 'critical';
    else if (cascadeRisk === 'medium') priority = 'high';
    
    return this.emitSignal({
      type: 'liquidation_cascade',
      priority,
      asset: { symbol },
      data: {
        liquidation_price: liquidationPrice,
        liquidation_amount_usd: liquidationAmountUsd,
        cascade_risk: cascadeRisk,
        trend_direction: 'bearish'
      },
      recommendation: {
        action: 'protect',
        confidence: cascadeRisk === 'high' ? 90 : 70,
        reasoning: `$${(liquidationAmountUsd / 1000000).toFixed(1)}M in liquidations at $${liquidationPrice.toFixed(2)}`,
        urgency_seconds: cascadeRisk === 'high' ? 30 : 120
      }
    });
  }

  /**
   * Generate a smart money flow signal
   */
  emitSmartMoneyFlow(
    symbol: string,
    flowDirection: 'inflow' | 'outflow' | 'neutral',
    flowAmountUsd: number,
    walletType: 'whale' | 'fund' | 'exchange' | 'unknown'
  ): TradingSignal {
    let priority: SignalPriority = 'medium';
    if (flowAmountUsd >= 5000000) priority = 'critical';
    else if (flowAmountUsd >= 1000000) priority = 'high';
    
    const trend = flowDirection === 'inflow' ? 'bullish' : 
                  flowDirection === 'outflow' ? 'bearish' : 'neutral';
    
    return this.emitSignal({
      type: 'smart_money_flow',
      priority,
      asset: { symbol },
      data: {
        institutional_flow: flowDirection,
        flow_amount_usd: flowAmountUsd,
        known_wallet_type: walletType,
        trend_direction: trend
      },
      recommendation: flowDirection !== 'neutral' ? {
        action: flowDirection === 'inflow' ? 'buy' : 'sell',
        confidence: Math.min(85, 60 + (flowAmountUsd / 500000)),
        reasoning: `${walletType} ${flowDirection} of $${(flowAmountUsd / 1000000).toFixed(1)}M detected`,
        urgency_seconds: 300
      } : undefined
    });
  }

  /**
   * Generate a momentum shift signal with technical indicators
   */
  emitMomentumWithIndicators(
    symbol: string,
    trend: 'bullish' | 'bearish' | 'neutral',
    strength: number,
    rsi: number,
    macd: { value: number; signal: number; histogram: number }
  ): TradingSignal {
    let priority: SignalPriority = 'low';
    if (strength >= 80) priority = 'critical';
    else if (strength >= 60) priority = 'high';
    else if (strength >= 40) priority = 'medium';
    
    const oversold = rsi < INDICATOR_THRESHOLDS.RSI_OVERSOLD;
    const overbought = rsi > INDICATOR_THRESHOLDS.RSI_OVERBOUGHT;
    
    return this.emitSignal({
      type: 'momentum_shift',
      priority,
      asset: { symbol },
      data: {
        trend_direction: trend,
        strength,
        rsi,
        macd,
        timeframe: '1h'
      },
      recommendation: {
        action: oversold ? 'buy' : overbought ? 'sell' : trend === 'bullish' ? 'buy' : 'sell',
        confidence: Math.min(90, strength + (oversold || overbought ? 15 : 0)),
        reasoning: `${trend} momentum (${strength}%), RSI: ${rsi.toFixed(0)}${oversold ? ' OVERSOLD' : overbought ? ' OVERBOUGHT' : ''}`,
        urgency_seconds: strength >= 70 ? 60 : 300
      }
    });
  }

  /**
   * Get recent signals
   */
  getRecentSignals(options?: {
    type?: SignalType;
    asset?: string;
    limit?: number;
    since?: number;
  }): TradingSignal[] {
    let signals = this.recentSignals;
    
    if (options?.type) {
      signals = signals.filter(s => s.type === options.type);
    }
    if (options?.asset) {
      signals = signals.filter(s => s.asset.symbol === options.asset);
    }
    if (options?.since) {
      const since = options.since;
      signals = signals.filter(s => s.timestamp >= since);
    }
    
    const limit = options?.limit || 100;
    return signals.slice(-limit).reverse();
  }

  /**
   * Get signal statistics
   */
  getStats(): SignalStats {
    return { ...this.stats };
  }

  /**
   * Get subscription count for an agent
   */
  getAgentSubscriptions(agentId: string): SignalSubscription[] {
    return Array.from(this.subscriptions.values())
      .filter(s => s.agent_id === agentId);
  }
}

export const signalService = new RealTimeSignalService();
