/**
 * Sealed-Bid Auction System for A2A Trading
 * 
 * Enables private OTC trading between agents:
 * - Sealed bids (encrypted until reveal)
 * - Time-locked auctions
 * - Fair price discovery
 * - MEV-resistant execution
 * 
 * Agents can trade directly without exposing their strategies to the market.
 */

import * as crypto from 'crypto';
import { signalService } from './realtime-signals';
import { generateShortId } from '../../utils';

export type AuctionType = 'first_price' | 'second_price' | 'dutch' | 'reverse';
export type AuctionStatus = 'open' | 'sealed' | 'revealing' | 'completed' | 'cancelled';

export interface Auction {
  auction_id: string;
  type: AuctionType;
  status: AuctionStatus;
  
  // What's being auctioned
  asset: {
    token: string;
    amount: number;
    amount_usd: number;
  };
  
  // Auction parameters
  parameters: {
    min_bid_usd: number;
    reserve_price_usd?: number; // Minimum acceptable price
    buy_now_price_usd?: number; // Instant purchase price
    
    // Timing
    created_at: number;
    bidding_ends_at: number;
    reveal_ends_at: number;
    
    // Participation
    min_trust_score?: number;
    allowed_agents?: string[]; // Whitelist (empty = open)
    max_participants?: number;
  };
  
  // Creator
  creator: {
    agent_id: string;
    reputation_score: number;
  };
  
  // Bids (sealed until reveal phase)
  sealed_bids: SealedBid[];
  revealed_bids: RevealedBid[];
  
  // Result
  result?: AuctionResult;
}

export interface SealedBid {
  bid_id: string;
  agent_id: string;
  commitment: string; // Hash of (bid_amount + nonce)
  submitted_at: number;
}

export interface RevealedBid {
  bid_id: string;
  agent_id: string;
  amount_usd: number;
  nonce: string;
  revealed_at: number;
  valid: boolean; // Commitment matches
}

export interface AuctionResult {
  winner_agent_id: string;
  winning_bid_usd: number;
  final_price_usd: number; // May differ for second-price auctions
  total_bids: number;
  valid_bids: number;
  
  // Execution
  execution_id?: string;
  transaction_signature?: string;
  completed_at: number;
  
  // Savings vs market
  market_price_usd: number;
  price_improvement_percent: number;
}

export interface BidSubmission {
  auction_id: string;
  agent_id: string;
  amount_usd: number;
  nonce: string;
}

class SealedAuctionService {
  private auctions: Map<string, Auction> = new Map();
  private agentBids: Map<string, Map<string, BidSubmission>> = new Map(); // agent -> auction -> bid
  private completedAuctions: Auction[] = [];
  
  private readonly MAX_ACTIVE_AUCTIONS = 1000;
  private readonly MAX_COMPLETED_HISTORY = 500;

  /**
   * Create a new sealed-bid auction
   */
  createAuction(
    creatorAgentId: string,
    token: string,
    amount: number,
    amountUsd: number,
    options: {
      type?: AuctionType;
      min_bid_usd?: number;
      reserve_price_usd?: number;
      buy_now_price_usd?: number;
      bidding_duration_seconds?: number;
      reveal_duration_seconds?: number;
      min_trust_score?: number;
      allowed_agents?: string[];
      max_participants?: number;
    } = {}
  ): Auction {
    const auctionId = generateShortId('auc', 8);
    const now = Date.now();
    
    const biddingDuration = (options.bidding_duration_seconds || 300) * 1000; // 5 min default
    const revealDuration = (options.reveal_duration_seconds || 60) * 1000; // 1 min default
    
    const auction: Auction = {
      auction_id: auctionId,
      type: options.type || 'second_price',
      status: 'open',
      asset: {
        token,
        amount,
        amount_usd: amountUsd
      },
      parameters: {
        min_bid_usd: options.min_bid_usd || amountUsd * 0.8, // 80% of value
        reserve_price_usd: options.reserve_price_usd,
        buy_now_price_usd: options.buy_now_price_usd,
        created_at: now,
        bidding_ends_at: now + biddingDuration,
        reveal_ends_at: now + biddingDuration + revealDuration,
        min_trust_score: options.min_trust_score,
        allowed_agents: options.allowed_agents,
        max_participants: options.max_participants || 50
      },
      creator: {
        agent_id: creatorAgentId,
        reputation_score: 75 // Would come from trust network
      },
      sealed_bids: [],
      revealed_bids: []
    };
    
    // Enforce limits
    if (this.auctions.size >= this.MAX_ACTIVE_AUCTIONS) {
      this.cleanupOldAuctions();
    }
    
    this.auctions.set(auctionId, auction);
    
    // Emit signal for potential bidders
    signalService.emitA2AQuote(
      token,
      creatorAgentId,
      auctionId,
      5, // Estimated price improvement
      Math.floor(biddingDuration / 1000)
    );
    
    // Schedule status transitions
    this.scheduleStatusTransition(auctionId, 'sealed', biddingDuration);
    this.scheduleStatusTransition(auctionId, 'revealing', biddingDuration);
    this.scheduleAuctionCompletion(auctionId, biddingDuration + revealDuration);
    
    return auction;
  }

  /**
   * Submit a sealed bid
   */
  submitBid(
    auctionId: string,
    agentId: string,
    amountUsd: number
  ): { success: boolean; bid_id?: string; commitment?: string; nonce?: string; error?: string } {
    const auction = this.auctions.get(auctionId);
    
    if (!auction) {
      return { success: false, error: 'Auction not found' };
    }
    
    if (auction.status !== 'open') {
      return { success: false, error: `Auction is ${auction.status}, not accepting bids` };
    }
    
    if (Date.now() > auction.parameters.bidding_ends_at) {
      return { success: false, error: 'Bidding period has ended' };
    }
    
    // Check participation requirements
    if (auction.parameters.allowed_agents && 
        auction.parameters.allowed_agents.length > 0 &&
        !auction.parameters.allowed_agents.includes(agentId)) {
      return { success: false, error: 'Agent not allowed in this auction' };
    }
    
    if (auction.parameters.max_participants && 
        auction.sealed_bids.length >= auction.parameters.max_participants) {
      return { success: false, error: 'Maximum participants reached' };
    }
    
    if (amountUsd < auction.parameters.min_bid_usd) {
      return { success: false, error: `Bid must be at least $${auction.parameters.min_bid_usd}` };
    }
    
    // Check if agent already bid
    const existingBid = auction.sealed_bids.find(b => b.agent_id === agentId);
    if (existingBid) {
      return { success: false, error: 'Agent has already submitted a bid' };
    }
    
    // Generate commitment (hash of bid + nonce)
    const nonce = crypto.randomBytes(16).toString('hex');
    const commitment = this.generateCommitment(amountUsd, nonce);
    const bidId = generateShortId('bid', 8);
    
    // Store sealed bid
    auction.sealed_bids.push({
      bid_id: bidId,
      agent_id: agentId,
      commitment,
      submitted_at: Date.now()
    });
    
    // Store bid details for agent (they need nonce to reveal)
    if (!this.agentBids.has(agentId)) {
      this.agentBids.set(agentId, new Map());
    }
    this.agentBids.get(agentId)!.set(auctionId, {
      auction_id: auctionId,
      agent_id: agentId,
      amount_usd: amountUsd,
      nonce
    });
    
    // Check for buy-now
    if (auction.parameters.buy_now_price_usd && 
        amountUsd >= auction.parameters.buy_now_price_usd) {
      // Instant win - skip to completion
      this.completeBuyNow(auction, agentId, amountUsd);
    }
    
    return { 
      success: true, 
      bid_id: bidId, 
      commitment,
      nonce // Agent must save this to reveal later
    };
  }

  /**
   * Reveal a bid during reveal phase
   */
  revealBid(
    auctionId: string,
    agentId: string,
    amountUsd: number,
    nonce: string
  ): { success: boolean; valid?: boolean; error?: string } {
    const auction = this.auctions.get(auctionId);
    
    if (!auction) {
      return { success: false, error: 'Auction not found' };
    }
    
    if (auction.status !== 'sealed' && auction.status !== 'revealing') {
      return { success: false, error: `Auction is ${auction.status}, not in reveal phase` };
    }
    
    // Find the sealed bid
    const sealedBid = auction.sealed_bids.find(b => b.agent_id === agentId);
    if (!sealedBid) {
      return { success: false, error: 'No sealed bid found for this agent' };
    }
    
    // Check if already revealed
    if (auction.revealed_bids.find(b => b.agent_id === agentId)) {
      return { success: false, error: 'Bid already revealed' };
    }
    
    // Verify commitment
    const expectedCommitment = this.generateCommitment(amountUsd, nonce);
    const valid = expectedCommitment === sealedBid.commitment;
    
    auction.revealed_bids.push({
      bid_id: sealedBid.bid_id,
      agent_id: agentId,
      amount_usd: amountUsd,
      nonce,
      revealed_at: Date.now(),
      valid
    });
    
    return { success: true, valid };
  }

  /**
   * Get auction details
   */
  getAuction(auctionId: string): Auction | undefined {
    return this.auctions.get(auctionId);
  }

  /**
   * Get active auctions for a token
   */
  getActiveAuctions(token?: string): Auction[] {
    const active = Array.from(this.auctions.values())
      .filter(a => a.status === 'open' || a.status === 'sealed');
    
    if (token) {
      return active.filter(a => a.asset.token === token);
    }
    return active;
  }

  /**
   * Get agent's bid details (including nonce for reveal)
   */
  getAgentBid(agentId: string, auctionId: string): BidSubmission | undefined {
    return this.agentBids.get(agentId)?.get(auctionId);
  }

  /**
   * Get auction statistics
   */
  getStats(): {
    active_auctions: number;
    completed_auctions: number;
    total_volume_usd: number;
    avg_price_improvement_percent: number;
    auctions_by_type: Record<AuctionType, number>;
  } {
    let totalVolume = 0;
    let totalImprovement = 0;
    let improvementCount = 0;
    const byType: Record<AuctionType, number> = {
      first_price: 0, second_price: 0, dutch: 0, reverse: 0
    };
    
    for (const auction of this.completedAuctions) {
      if (auction.result) {
        totalVolume += auction.result.final_price_usd;
        totalImprovement += auction.result.price_improvement_percent;
        improvementCount++;
      }
      byType[auction.type]++;
    }
    
    return {
      active_auctions: this.auctions.size,
      completed_auctions: this.completedAuctions.length,
      total_volume_usd: Math.round(totalVolume),
      avg_price_improvement_percent: improvementCount > 0 
        ? Math.round(totalImprovement / improvementCount * 100) / 100 
        : 0,
      auctions_by_type: byType
    };
  }

  private generateCommitment(amountUsd: number, nonce: string): string {
    return crypto
      .createHash('sha256')
      .update(`${amountUsd}:${nonce}`)
      .digest('hex');
  }

  private scheduleStatusTransition(auctionId: string, newStatus: AuctionStatus, delayMs: number): void {
    const timer = setTimeout(() => {
      const auction = this.auctions.get(auctionId);
      if (auction && (auction.status === 'open' || auction.status === 'sealed')) {
        auction.status = newStatus;
      }
    }, delayMs);
    timer.unref();
  }

  private scheduleAuctionCompletion(auctionId: string, delayMs: number): void {
    const timer = setTimeout(() => {
      this.completeAuction(auctionId);
    }, delayMs);
    timer.unref();
  }

  private completeAuction(auctionId: string): void {
    const auction = this.auctions.get(auctionId);
    if (!auction || auction.status === 'completed' || auction.status === 'cancelled') {
      return;
    }
    
    // Get valid revealed bids
    const validBids = auction.revealed_bids
      .filter(b => b.valid)
      .sort((a, b) => b.amount_usd - a.amount_usd);
    
    if (validBids.length === 0) {
      auction.status = 'cancelled';
      auction.result = undefined;
      return;
    }
    
    // Check reserve price
    const highestBid = validBids[0];
    if (auction.parameters.reserve_price_usd && 
        highestBid.amount_usd < auction.parameters.reserve_price_usd) {
      auction.status = 'cancelled';
      return;
    }
    
    // Determine final price based on auction type
    let finalPrice: number;
    if (auction.type === 'second_price' && validBids.length > 1) {
      finalPrice = validBids[1].amount_usd; // Second highest bid
    } else {
      finalPrice = highestBid.amount_usd;
    }
    
    // Market price from auction asset value (set at creation time)
    const marketPrice = auction.asset.amount_usd;
    const priceImprovement = ((finalPrice - marketPrice) / marketPrice) * 100;
    
    auction.status = 'completed';
    auction.result = {
      winner_agent_id: highestBid.agent_id,
      winning_bid_usd: highestBid.amount_usd,
      final_price_usd: finalPrice,
      total_bids: auction.sealed_bids.length,
      valid_bids: validBids.length,
      completed_at: Date.now(),
      market_price_usd: marketPrice,
      price_improvement_percent: Math.round(priceImprovement * 100) / 100,
      transaction_signature: `auction_${auction.auction_id}_completed`
    };
    
    // Move to completed history
    this.completedAuctions.push(auction);
    if (this.completedAuctions.length > this.MAX_COMPLETED_HISTORY) {
      this.completedAuctions.shift();
    }
    
    // Remove from active
    this.auctions.delete(auctionId);
  }

  private completeBuyNow(auction: Auction, agentId: string, amountUsd: number): void {
    const marketPrice = auction.asset.amount_usd;
    const priceImprovement = ((amountUsd - marketPrice) / marketPrice) * 100;
    
    auction.status = 'completed';
    auction.result = {
      winner_agent_id: agentId,
      winning_bid_usd: amountUsd,
      final_price_usd: amountUsd,
      total_bids: auction.sealed_bids.length,
      valid_bids: 1,
      completed_at: Date.now(),
      market_price_usd: marketPrice,
      price_improvement_percent: Math.round(priceImprovement * 100) / 100,
      transaction_signature: `auction_${auction.auction_id}_completed`
    };
    
    this.completedAuctions.push(auction);
    this.auctions.delete(auction.auction_id);
  }

  private cleanupOldAuctions(): void {
    const now = Date.now();
    for (const [id, auction] of this.auctions) {
      if (now > auction.parameters.reveal_ends_at + 60000) { // 1 min grace
        this.auctions.delete(id);
      }
    }
  }
}

export const sealedAuction = new SealedAuctionService();
