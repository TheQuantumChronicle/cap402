/**
 * Unified Privacy Layer for CAP-402 + StealthPump + Pump.fun
 * 
 * Provides cohesive privacy orchestration across all three systems:
 * - CAP-402: Privacy providers (Arcium MPC, Inco FHE, Noir ZK)
 * - StealthPump: Stealth launch coordination
 * - Pump.fun: Bonding curve integration
 * 
 * Key Features:
 * - Unified privacy configuration
 * - Cross-system event synchronization
 * - Privacy-first launch orchestration
 * - Seamless wallet abstraction
 */

import { Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import crypto from 'crypto';
import { pumpFunProvider, TokenMetadata, PUMPFUN_CONSTANTS } from './pumpfun';

// ============================================
// UNIFIED PRIVACY CONFIGURATION
// Single source of truth for privacy settings
// ============================================

export interface UnifiedPrivacyConfig {
  // Privacy Level
  level: 'basic' | 'enhanced' | 'maximum';
  
  // Creator Privacy
  hideCreator: boolean;
  revealOnGraduation: boolean;
  revealDelaySeconds?: number;
  
  // Transaction Privacy
  useStealthWallet: boolean;
  obfuscateFunding: boolean;
  mevProtection: boolean;
  jitoTipLamports?: number;
  
  // Timing Privacy
  randomizeTimings: boolean;
  minDelayMs?: number;
  maxDelayMs?: number;
  
  // Holder Privacy
  trackAnonymitySet: boolean;
  alertOnDeanonymization: boolean;
  
  // CAP-402 Provider Selection
  preferredProvider?: 'arcium' | 'inco' | 'noir';
  fallbackEnabled: boolean;
}

export const DEFAULT_PRIVACY_CONFIGS: Record<string, UnifiedPrivacyConfig> = {
  basic: {
    level: 'basic',
    hideCreator: true,
    revealOnGraduation: true,
    useStealthWallet: true,
    obfuscateFunding: false,
    mevProtection: false,
    randomizeTimings: false,
    trackAnonymitySet: false,
    alertOnDeanonymization: false,
    fallbackEnabled: true
  },
  enhanced: {
    level: 'enhanced',
    hideCreator: true,
    revealOnGraduation: true,
    revealDelaySeconds: 3600, // 1 hour after graduation
    useStealthWallet: true,
    obfuscateFunding: true,
    mevProtection: true,
    jitoTipLamports: 10000,
    randomizeTimings: true,
    minDelayMs: 1000,
    maxDelayMs: 5000,
    trackAnonymitySet: true,
    alertOnDeanonymization: false,
    preferredProvider: 'arcium',
    fallbackEnabled: true
  },
  maximum: {
    level: 'maximum',
    hideCreator: true,
    revealOnGraduation: false, // Never auto-reveal
    useStealthWallet: true,
    obfuscateFunding: true,
    mevProtection: true,
    jitoTipLamports: 50000,
    randomizeTimings: true,
    minDelayMs: 3000,
    maxDelayMs: 15000,
    trackAnonymitySet: true,
    alertOnDeanonymization: true,
    preferredProvider: 'noir',
    fallbackEnabled: true
  }
};

// ============================================
// UNIFIED LAUNCH REQUEST
// Single interface for privacy-first launches
// ============================================

export interface UnifiedLaunchRequest {
  // Token Details
  token: {
    name: string;
    symbol: string;
    description: string;
    image?: string;
    twitter?: string;
    telegram?: string;
    website?: string;
  };
  
  // Launch Parameters
  initialBuySol: number;
  slippageBps?: number;
  
  // Privacy Configuration
  privacy: UnifiedPrivacyConfig | 'basic' | 'enhanced' | 'maximum';
  
  // Funding Source (optional - will generate stealth wallet if not provided)
  fundingWallet?: {
    publicKey: string;
    secretKey: string;
  };
}

export interface UnifiedLaunchResult {
  success: boolean;
  
  // Token Info
  mintAddress?: string;
  bondingCurveAddress?: string;
  pumpFunUrl?: string;
  
  // Transaction Info
  signature?: string;
  bundleId?: string;
  
  // Privacy Info
  privacyLevel: string;
  privacyScore?: number;
  privacyGrade?: string;
  stealthWalletUsed: boolean;
  creatorHidden: boolean;
  mevProtected: boolean;
  
  // Stealth Registry
  stealthRegistryId?: string;
  revealScheduledAt?: number;
  
  // Error
  error?: string;
}

// ============================================
// UNIFIED PRIVACY ORCHESTRATOR
// Coordinates all privacy operations
// ============================================

class UnifiedPrivacyOrchestrator {
  private eventListeners: Map<string, ((event: PrivacyEvent) => void)[]> = new Map();
  private activeLaunches: Map<string, LaunchState> = new Map();

  /**
   * Execute a unified privacy-first launch
   * Orchestrates CAP-402, StealthPump, and Pump.fun
   */
  async executeLaunch(request: UnifiedLaunchRequest): Promise<UnifiedLaunchResult> {
    const launchId = `launch_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    
    // Resolve privacy config
    const privacyConfig = typeof request.privacy === 'string' 
      ? DEFAULT_PRIVACY_CONFIGS[request.privacy]
      : request.privacy;

    // Initialize launch state
    const state: LaunchState = {
      id: launchId,
      phase: 'initializing',
      startedAt: Date.now(),
      privacyConfig,
      events: []
    };
    this.activeLaunches.set(launchId, state);

    try {
      // Phase 1: Generate or prepare stealth wallet
      this.emitEvent({ type: 'phase_started', launchId, phase: 'wallet_preparation' });
      state.phase = 'wallet_preparation';
      
      let stealthWallet: { publicKey: string; secretKey: string };
      if (privacyConfig.useStealthWallet) {
        stealthWallet = pumpFunProvider.generateStealthWallet();
        this.emitEvent({ type: 'stealth_wallet_generated', launchId, publicKey: stealthWallet.publicKey });
      } else if (request.fundingWallet) {
        stealthWallet = request.fundingWallet;
      } else {
        stealthWallet = pumpFunProvider.generateStealthWallet();
      }

      // Phase 2: Apply timing obfuscation if enabled
      if (privacyConfig.randomizeTimings) {
        const delay = this.calculateRandomDelay(privacyConfig.minDelayMs || 1000, privacyConfig.maxDelayMs || 5000);
        this.emitEvent({ type: 'timing_delay', launchId, delayMs: delay });
        await this.sleep(delay);
      }

      // Phase 3: Execute stealth launch via pump.fun provider
      this.emitEvent({ type: 'phase_started', launchId, phase: 'token_creation' });
      state.phase = 'token_creation';

      const keypair = Keypair.fromSecretKey(Buffer.from(stealthWallet.secretKey, 'base64'));
      
      const launchResult = privacyConfig.mevProtection
        ? await pumpFunProvider.stealthLaunchWithMevProtection(keypair, {
            metadata: request.token,
            initialBuySol: request.initialBuySol,
            slippageBps: request.slippageBps || 500,
            useStealthWallet: true,
            mevProtection: true,
            jitoTipLamports: privacyConfig.jitoTipLamports || 10000
          })
        : await pumpFunProvider.stealthLaunch(keypair, {
            metadata: request.token,
            initialBuySol: request.initialBuySol,
            slippageBps: request.slippageBps || 500,
            useStealthWallet: true,
            mevProtection: false
          });

      if (!launchResult.success) {
        throw new Error(launchResult.error || 'Launch failed');
      }

      // Phase 4: Register in stealth registry
      this.emitEvent({ type: 'phase_started', launchId, phase: 'stealth_registration' });
      state.phase = 'stealth_registration';

      const stealthRecord = pumpFunProvider.registerStealthLaunch(
        launchResult.mintAddress!,
        stealthWallet.publicKey,
        request.token,
        request.initialBuySol,
        privacyConfig.revealDelaySeconds
      );

      // Phase 5: Initialize anonymity tracking if enabled
      if (privacyConfig.trackAnonymitySet) {
        pumpFunProvider.initializeAnonymitySet(launchResult.mintAddress!);
        this.emitEvent({ type: 'anonymity_tracking_started', launchId, mintAddress: launchResult.mintAddress! });
      }

      // Phase 6: Start graduation monitoring if auto-reveal enabled
      if (privacyConfig.revealOnGraduation) {
        pumpFunProvider.startGraduationMonitor(
          launchResult.mintAddress!,
          (event) => {
            this.emitEvent({
              type: event.type === 'graduated' ? 'token_graduated' : 'graduation_progress',
              launchId,
              mintAddress: launchResult.mintAddress!,
              progress: event.progress,
              graduated: event.graduated
            });
          },
          10000 // Poll every 10 seconds
        );
      }

      // Phase 7: Calculate privacy score
      const privacyScore = await pumpFunProvider.getPrivacyScore(launchResult.mintAddress!);

      // Complete
      state.phase = 'completed';
      this.emitEvent({ type: 'launch_completed', launchId, mintAddress: launchResult.mintAddress! });

      return {
        success: true,
        mintAddress: launchResult.mintAddress,
        bondingCurveAddress: launchResult.bondingCurveAddress,
        pumpFunUrl: `https://pump.fun/${launchResult.mintAddress}`,
        signature: launchResult.signature,
        bundleId: (launchResult as any).bundleId,
        privacyLevel: privacyConfig.level,
        privacyScore: privacyScore.overallScore,
        privacyGrade: privacyScore.grade,
        stealthWalletUsed: privacyConfig.useStealthWallet,
        creatorHidden: privacyConfig.hideCreator,
        mevProtected: privacyConfig.mevProtection,
        stealthRegistryId: stealthRecord.stealthWalletHash,
        revealScheduledAt: stealthRecord.revealAt
      };

    } catch (error) {
      state.phase = 'failed';
      this.emitEvent({ type: 'launch_failed', launchId, error: error instanceof Error ? error.message : 'Unknown error' });
      
      return {
        success: false,
        privacyLevel: privacyConfig.level,
        stealthWalletUsed: privacyConfig.useStealthWallet,
        creatorHidden: privacyConfig.hideCreator,
        mevProtected: privacyConfig.mevProtection,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get unified dashboard data for a token
   * Aggregates data from all three systems
   */
  async getUnifiedDashboard(mintAddress: string, solPriceUsd: number = 200): Promise<UnifiedDashboardData | null> {
    // Get pump.fun data
    const pumpFunData = await pumpFunProvider.getPumpFunCompatibleData(mintAddress, undefined, solPriceUsd);
    if (!pumpFunData) return null;

    // Get stealth view
    const stealthView = await pumpFunProvider.getStealthBondingCurveView(mintAddress);

    // Get privacy score
    const privacyScore = await pumpFunProvider.getPrivacyScore(mintAddress);

    // Get anonymity info
    const anonymityInfo = pumpFunProvider.getAnonymitySetInfo(mintAddress);

    // Get token metrics
    const metrics = await pumpFunProvider.getTokenMetrics(mintAddress, solPriceUsd);

    return {
      // Token Identity
      token: {
        mint: mintAddress,
        name: pumpFunData.name,
        symbol: pumpFunData.symbol,
        image: pumpFunData.image_uri || undefined
      },

      // Market Data (always visible)
      market: {
        priceSol: pumpFunData.price_sol,
        priceUsd: pumpFunData.price_usd,
        marketCapSol: pumpFunData.market_cap_sol,
        marketCapUsd: pumpFunData.usd_market_cap,
        bondingCurveProgress: stealthView?.progressToGraduation || 0,
        solRaised: metrics?.bondingCurve.solRaised || 0,
        graduated: pumpFunData.complete,
        isLive: pumpFunData.is_currently_live
      },

      // Privacy Status
      privacy: {
        score: privacyScore.overallScore,
        grade: privacyScore.grade,
        creatorRevealed: stealthView?.creatorRevealed || false,
        creatorWallet: stealthView?.creatorRevealed ? stealthView.creatorWallet : undefined,
        factors: privacyScore.factors
      },

      // Anonymity Metrics
      anonymity: anonymityInfo ? {
        score: anonymityInfo.anonymityScore,
        totalHolders: anonymityInfo.totalHolders,
        anonymousHolders: anonymityInfo.anonymousHolders,
        revealedHolders: anonymityInfo.revealedHolders,
        largestHolderPercent: anonymityInfo.largestHolderPercent,
        top10HoldersPercent: anonymityInfo.top10HoldersPercent
      } : undefined,

      // Links
      links: {
        pumpFun: `https://pump.fun/${mintAddress}`,
        solscan: `https://solscan.io/token/${mintAddress}`,
        birdeye: pumpFunData.complete ? `https://birdeye.so/token/${mintAddress}` : undefined,
        dexscreener: pumpFunData.complete ? `https://dexscreener.com/solana/${mintAddress}` : undefined
      },

      // Timestamps
      timestamps: {
        created: pumpFunData.created_timestamp,
        lastUpdated: Date.now()
      }
    };
  }

  /**
   * Subscribe to privacy events
   */
  onEvent(eventType: string, callback: (event: PrivacyEvent) => void): () => void {
    const listeners = this.eventListeners.get(eventType) || [];
    listeners.push(callback);
    this.eventListeners.set(eventType, listeners);

    // Return unsubscribe function
    return () => {
      const current = this.eventListeners.get(eventType) || [];
      this.eventListeners.set(eventType, current.filter(cb => cb !== callback));
    };
  }

  /**
   * Subscribe to all events
   */
  onAllEvents(callback: (event: PrivacyEvent) => void): () => void {
    return this.onEvent('*', callback);
  }

  /**
   * Get active launch state
   */
  getLaunchState(launchId: string): LaunchState | undefined {
    return this.activeLaunches.get(launchId);
  }

  /**
   * Get all active launches
   */
  getActiveLaunches(): LaunchState[] {
    return Array.from(this.activeLaunches.values()).filter(l => l.phase !== 'completed' && l.phase !== 'failed');
  }

  // Private helpers
  private emitEvent(event: PrivacyEvent): void {
    // Emit to specific listeners
    const listeners = this.eventListeners.get(event.type) || [];
    listeners.forEach(cb => cb(event));

    // Emit to wildcard listeners
    const wildcardListeners = this.eventListeners.get('*') || [];
    wildcardListeners.forEach(cb => cb(event));

    // Store in launch state
    const launchId = (event as any).launchId;
    if (launchId) {
      const state = this.activeLaunches.get(launchId);
      if (state) {
        state.events.push({ ...event, timestamp: Date.now() });
      }
    }

    console.log(`[Privacy] ${event.type}:`, JSON.stringify(event));
  }

  private calculateRandomDelay(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================
// TYPES
// ============================================

interface LaunchState {
  id: string;
  phase: 'initializing' | 'wallet_preparation' | 'funding' | 'token_creation' | 'stealth_registration' | 'completed' | 'failed';
  startedAt: number;
  privacyConfig: UnifiedPrivacyConfig;
  events: (PrivacyEvent & { timestamp: number })[];
}

interface PrivacyEvent {
  type: string;
  [key: string]: any;
}

interface UnifiedDashboardData {
  token: {
    mint: string;
    name: string;
    symbol: string;
    image?: string;
  };
  market: {
    priceSol: number;
    priceUsd: number;
    marketCapSol: number;
    marketCapUsd: number;
    bondingCurveProgress: number;
    solRaised: number;
    graduated: boolean;
    isLive: boolean;
  };
  privacy: {
    score: number;
    grade: string;
    creatorRevealed: boolean;
    creatorWallet?: string;
    factors: {
      creatorHidden: boolean;
      holderAnonymity: number;
      fundingObfuscated: boolean;
      mevProtected: boolean;
      timingObfuscated: boolean;
    };
  };
  anonymity?: {
    score: number;
    totalHolders: number;
    anonymousHolders: number;
    revealedHolders: number;
    largestHolderPercent: number;
    top10HoldersPercent: number;
  };
  links: {
    pumpFun: string;
    solscan: string;
    birdeye?: string;
    dexscreener?: string;
  };
  timestamps: {
    created: number;
    lastUpdated: number;
  };
}

// ============================================
// CROSS-SYSTEM EVENT SYNCHRONIZATION
// Enables real-time updates across CAP-402, StealthPump, and pump.fun
// ============================================

export interface CrossSystemEvent {
  source: 'cap402' | 'stealthpump' | 'pumpfun';
  type: string;
  data: any;
  timestamp: number;
  correlationId?: string;
}

class CrossSystemEventBus {
  private subscribers: Map<string, ((event: CrossSystemEvent) => void)[]> = new Map();
  private eventHistory: CrossSystemEvent[] = [];
  private maxHistorySize: number = 1000;

  /**
   * Emit an event to all subscribers
   */
  emit(source: CrossSystemEvent['source'], type: string, data: any, correlationId?: string): void {
    const event: CrossSystemEvent = {
      source,
      type,
      data,
      timestamp: Date.now(),
      correlationId
    };

    // Store in history
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    // Notify subscribers
    const key = `${source}:${type}`;
    const specificSubscribers = this.subscribers.get(key) || [];
    const wildcardSubscribers = this.subscribers.get('*:*') || [];
    const sourceWildcard = this.subscribers.get(`${source}:*`) || [];
    const typeWildcard = this.subscribers.get(`*:${type}`) || [];

    [...specificSubscribers, ...wildcardSubscribers, ...sourceWildcard, ...typeWildcard]
      .forEach(cb => {
        try {
          cb(event);
        } catch (e) {
          console.error('[EventBus] Subscriber error:', e);
        }
      });

    console.log(`[EventBus] ${source}:${type}`, JSON.stringify(data).slice(0, 200));
  }

  /**
   * Subscribe to events
   * Pattern: "source:type" or "*:*" for all, "cap402:*" for all CAP-402 events
   */
  subscribe(pattern: string, callback: (event: CrossSystemEvent) => void): () => void {
    const subscribers = this.subscribers.get(pattern) || [];
    subscribers.push(callback);
    this.subscribers.set(pattern, subscribers);

    // Return unsubscribe function
    return () => {
      const current = this.subscribers.get(pattern) || [];
      this.subscribers.set(pattern, current.filter(cb => cb !== callback));
    };
  }

  /**
   * Get recent events, optionally filtered
   */
  getRecentEvents(options?: {
    source?: CrossSystemEvent['source'];
    type?: string;
    since?: number;
    limit?: number;
  }): CrossSystemEvent[] {
    let events = [...this.eventHistory];

    if (options?.source) {
      events = events.filter(e => e.source === options.source);
    }
    if (options?.type) {
      events = events.filter(e => e.type === options.type);
    }
    if (options?.since) {
      const sinceTime = options.since;
      events = events.filter(e => e.timestamp >= sinceTime);
    }

    events.sort((a, b) => b.timestamp - a.timestamp);

    if (options?.limit) {
      events = events.slice(0, options.limit);
    }

    return events;
  }

  /**
   * Get events by correlation ID (for tracking related events across systems)
   */
  getCorrelatedEvents(correlationId: string): CrossSystemEvent[] {
    return this.eventHistory.filter(e => e.correlationId === correlationId);
  }

  /**
   * Clear event history
   */
  clearHistory(): void {
    this.eventHistory = [];
  }
}

// Singleton event bus
export const eventBus = new CrossSystemEventBus();

// ============================================
// PREDEFINED EVENT TYPES
// Standard events for cross-system communication
// ============================================

export const EventTypes = {
  // Launch Events
  LAUNCH_INITIATED: 'launch_initiated',
  LAUNCH_PHASE_CHANGED: 'launch_phase_changed',
  LAUNCH_COMPLETED: 'launch_completed',
  LAUNCH_FAILED: 'launch_failed',

  // Privacy Events
  PRIVACY_SCORE_UPDATED: 'privacy_score_updated',
  CREATOR_REVEALED: 'creator_revealed',
  ANONYMITY_CHANGED: 'anonymity_changed',
  MEV_PROTECTION_APPLIED: 'mev_protection_applied',

  // Market Events
  BONDING_CURVE_UPDATED: 'bonding_curve_updated',
  TOKEN_GRADUATED: 'token_graduated',
  TRADE_EXECUTED: 'trade_executed',

  // System Events
  SYSTEM_STATUS_CHANGED: 'system_status_changed',
  PROVIDER_SWITCHED: 'provider_switched',
  ERROR_OCCURRED: 'error_occurred'
} as const;

// Helper to emit CAP-402 events
export function emitCAP402Event(type: string, data: any, correlationId?: string): void {
  eventBus.emit('cap402', type, data, correlationId);
}

// Helper to emit StealthPump events
export function emitStealthPumpEvent(type: string, data: any, correlationId?: string): void {
  eventBus.emit('stealthpump', type, data, correlationId);
}

// Helper to emit pump.fun events
export function emitPumpFunEvent(type: string, data: any, correlationId?: string): void {
  eventBus.emit('pumpfun', type, data, correlationId);
}

// Export singleton instance
export const unifiedPrivacy = new UnifiedPrivacyOrchestrator();

// Export types
export type { LaunchState, PrivacyEvent, UnifiedDashboardData };
