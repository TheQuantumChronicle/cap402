/**
 * Trading Module
 * 
 * Deep trading infrastructure for agents:
 * - Real-time signals via WebSocket
 * - MEV protection with live risk analysis
 * - Sealed-bid A2A auctions
 */

export { signalService, TradingSignal, SignalType, SignalSubscription } from './realtime-signals';
export { mevProtection, MEVRiskAnalysis, ProtectedExecution, ProtectionLevel } from './mev-protection';
export { sealedAuction, Auction, AuctionType, AuctionStatus, AuctionResult } from './sealed-auction';
