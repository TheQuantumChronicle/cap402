/**
 * Capability Marketplace
 * 
 * Agents can:
 * - List capabilities they provide for other agents to use
 * - Set pricing (per-invocation, subscription, free)
 * - Browse and purchase access to capabilities
 * - Track usage and earnings
 */

import { agentRegistry } from './agent-registry';
import { generateShortId } from '../utils';

export interface CapabilityListing {
  listing_id: string;
  provider_agent: string;
  capability_id: string;
  name: string;
  description: string;
  pricing: PricingModel;
  terms: ListingTerms;
  stats: ListingStats;
  status: 'active' | 'paused' | 'sold_out';
  created_at: number;
  updated_at: number;
}

export interface PricingModel {
  type: 'free' | 'per_invocation' | 'subscription' | 'tiered';
  price_sol?: number;
  subscription_period_hours?: number;
  tiers?: PricingTier[];
  currency: 'SOL' | 'USDC';
}

export interface PricingTier {
  name: string;
  invocations_included: number;
  price_sol: number;
}

export interface ListingTerms {
  max_invocations_per_day?: number;
  rate_limit_per_minute?: number;
  sla_uptime_percent?: number;
  response_time_guarantee_ms?: number;
  refund_policy?: string;
}

export interface ListingStats {
  total_purchases: number;
  total_invocations: number;
  total_revenue_sol: number;
  average_rating: number;
  rating_count: number;
}

export interface CapabilityPurchase {
  purchase_id: string;
  listing_id: string;
  buyer_agent: string;
  provider_agent: string;
  capability_id: string;
  pricing_type: string;
  amount_paid_sol: number;
  invocations_remaining?: number;
  expires_at?: number;
  purchased_at: number;
  status: 'active' | 'expired' | 'exhausted';
}

export interface MarketplaceReview {
  review_id: string;
  listing_id: string;
  reviewer_agent: string;
  rating: number; // 1-5
  comment?: string;
  created_at: number;
}

class CapabilityMarketplace {
  private listings: Map<string, CapabilityListing> = new Map();
  private purchases: Map<string, CapabilityPurchase> = new Map();
  private reviews: Map<string, MarketplaceReview[]> = new Map();
  private agentPurchases: Map<string, string[]> = new Map(); // agent_id -> purchase_ids

  /**
   * List a capability for sale
   */
  createListing(
    providerAgent: string,
    capabilityId: string,
    name: string,
    description: string,
    pricing: PricingModel,
    terms: ListingTerms = {}
  ): CapabilityListing {
    const listingId = generateShortId('lst', 12);

    const listing: CapabilityListing = {
      listing_id: listingId,
      provider_agent: providerAgent,
      capability_id: capabilityId,
      name,
      description,
      pricing,
      terms,
      stats: {
        total_purchases: 0,
        total_invocations: 0,
        total_revenue_sol: 0,
        average_rating: 0,
        rating_count: 0
      },
      status: 'active',
      created_at: Date.now(),
      updated_at: Date.now()
    };

    this.listings.set(listingId, listing);
    return listing;
  }

  /**
   * Browse marketplace listings
   */
  browseListings(filters?: {
    capability_id?: string;
    provider_agent?: string;
    pricing_type?: string;
    max_price_sol?: number;
    min_rating?: number;
    status?: string;
  }): CapabilityListing[] {
    let results = Array.from(this.listings.values());

    if (filters) {
      if (filters.capability_id) {
        results = results.filter(l => l.capability_id === filters.capability_id);
      }
      if (filters.provider_agent) {
        results = results.filter(l => l.provider_agent === filters.provider_agent);
      }
      if (filters.pricing_type) {
        results = results.filter(l => l.pricing.type === filters.pricing_type);
      }
      if (filters.max_price_sol !== undefined) {
        results = results.filter(l => 
          l.pricing.type === 'free' || 
          (l.pricing.price_sol !== undefined && l.pricing.price_sol <= filters.max_price_sol!)
        );
      }
      if (filters.min_rating !== undefined) {
        results = results.filter(l => l.stats.average_rating >= filters.min_rating!);
      }
      if (filters.status) {
        results = results.filter(l => l.status === filters.status);
      }
    }

    // Sort by rating then purchases
    results.sort((a, b) => {
      if (b.stats.average_rating !== a.stats.average_rating) {
        return b.stats.average_rating - a.stats.average_rating;
      }
      return b.stats.total_purchases - a.stats.total_purchases;
    });

    return results;
  }

  /**
   * Purchase access to a capability
   */
  purchaseCapability(
    buyerAgent: string,
    listingId: string,
    tier?: string
  ): CapabilityPurchase | null {
    const listing = this.listings.get(listingId);
    if (!listing || listing.status !== 'active') {
      return null;
    }

    // Don't allow self-purchase
    if (listing.provider_agent === buyerAgent) {
      return null;
    }

    let amountPaid = 0;
    let invocationsRemaining: number | undefined;
    let expiresAt: number | undefined;

    switch (listing.pricing.type) {
      case 'free':
        amountPaid = 0;
        break;
      case 'per_invocation':
        amountPaid = listing.pricing.price_sol || 0;
        invocationsRemaining = 1;
        break;
      case 'subscription':
        amountPaid = listing.pricing.price_sol || 0;
        expiresAt = Date.now() + (listing.pricing.subscription_period_hours || 24) * 60 * 60 * 1000;
        break;
      case 'tiered':
        if (tier && listing.pricing.tiers) {
          const selectedTier = listing.pricing.tiers.find(t => t.name === tier);
          if (selectedTier) {
            amountPaid = selectedTier.price_sol;
            invocationsRemaining = selectedTier.invocations_included;
          }
        }
        break;
    }

    const purchaseId = generateShortId('pur', 12);

    const purchase: CapabilityPurchase = {
      purchase_id: purchaseId,
      listing_id: listingId,
      buyer_agent: buyerAgent,
      provider_agent: listing.provider_agent,
      capability_id: listing.capability_id,
      pricing_type: listing.pricing.type,
      amount_paid_sol: amountPaid,
      invocations_remaining: invocationsRemaining,
      expires_at: expiresAt,
      purchased_at: Date.now(),
      status: 'active'
    };

    this.purchases.set(purchaseId, purchase);

    // Track by agent
    const agentPurchases = this.agentPurchases.get(buyerAgent) || [];
    agentPurchases.push(purchaseId);
    this.agentPurchases.set(buyerAgent, agentPurchases);

    // Update listing stats
    listing.stats.total_purchases++;
    listing.stats.total_revenue_sol += amountPaid;
    listing.updated_at = Date.now();

    return purchase;
  }

  /**
   * Check if agent has access to a capability via purchase
   */
  hasAccess(agentId: string, capabilityId: string): CapabilityPurchase | null {
    const purchaseIds = this.agentPurchases.get(agentId) || [];
    
    for (const purchaseId of purchaseIds) {
      const purchase = this.purchases.get(purchaseId);
      if (!purchase || purchase.capability_id !== capabilityId) continue;
      if (purchase.status !== 'active') continue;

      // Check expiry
      if (purchase.expires_at && Date.now() > purchase.expires_at) {
        purchase.status = 'expired';
        continue;
      }

      // Check invocations
      if (purchase.invocations_remaining !== undefined && purchase.invocations_remaining <= 0) {
        purchase.status = 'exhausted';
        continue;
      }

      return purchase;
    }

    return null;
  }

  /**
   * Use a purchased capability (decrements invocations)
   */
  useCapability(agentId: string, capabilityId: string): boolean {
    const purchase = this.hasAccess(agentId, capabilityId);
    if (!purchase) return false;

    if (purchase.invocations_remaining !== undefined) {
      purchase.invocations_remaining--;
      if (purchase.invocations_remaining <= 0) {
        purchase.status = 'exhausted';
      }
    }

    // Update listing stats
    const listing = this.listings.get(purchase.listing_id);
    if (listing) {
      listing.stats.total_invocations++;
    }

    return true;
  }

  /**
   * Add a review for a listing
   */
  addReview(
    listingId: string,
    reviewerAgent: string,
    rating: number,
    comment?: string
  ): MarketplaceReview | null {
    const listing = this.listings.get(listingId);
    if (!listing) return null;

    // Must have purchased to review
    const hasPurchased = Array.from(this.purchases.values()).some(
      p => p.listing_id === listingId && p.buyer_agent === reviewerAgent
    );
    if (!hasPurchased) return null;

    const reviewId = generateShortId('rev', 8);
    const review: MarketplaceReview = {
      review_id: reviewId,
      listing_id: listingId,
      reviewer_agent: reviewerAgent,
      rating: Math.max(1, Math.min(5, rating)),
      comment,
      created_at: Date.now()
    };

    const listingReviews = this.reviews.get(listingId) || [];
    // Remove existing review from same agent
    const filtered = listingReviews.filter(r => r.reviewer_agent !== reviewerAgent);
    filtered.push(review);
    this.reviews.set(listingId, filtered);

    // Update average rating
    const totalRating = filtered.reduce((sum, r) => sum + r.rating, 0);
    listing.stats.average_rating = totalRating / filtered.length;
    listing.stats.rating_count = filtered.length;

    return review;
  }

  /**
   * Get reviews for a listing
   */
  getReviews(listingId: string): MarketplaceReview[] {
    return this.reviews.get(listingId) || [];
  }

  /**
   * Get agent's purchases
   */
  getAgentPurchases(agentId: string): CapabilityPurchase[] {
    const purchaseIds = this.agentPurchases.get(agentId) || [];
    return purchaseIds.map(id => this.purchases.get(id)!).filter(Boolean);
  }

  /**
   * Get agent's listings (as provider)
   */
  getAgentListings(agentId: string): CapabilityListing[] {
    return Array.from(this.listings.values()).filter(l => l.provider_agent === agentId);
  }

  /**
   * Get agent's earnings
   */
  getAgentEarnings(agentId: string): {
    total_revenue_sol: number;
    total_sales: number;
    by_listing: Array<{ listing_id: string; name: string; revenue: number; sales: number }>;
  } {
    const listings = this.getAgentListings(agentId);
    const byListing = listings.map(l => ({
      listing_id: l.listing_id,
      name: l.name,
      revenue: l.stats.total_revenue_sol,
      sales: l.stats.total_purchases
    }));

    return {
      total_revenue_sol: byListing.reduce((sum, l) => sum + l.revenue, 0),
      total_sales: byListing.reduce((sum, l) => sum + l.sales, 0),
      by_listing: byListing
    };
  }

  /**
   * Update listing status
   */
  updateListingStatus(listingId: string, status: 'active' | 'paused' | 'sold_out'): boolean {
    const listing = this.listings.get(listingId);
    if (!listing) return false;
    listing.status = status;
    listing.updated_at = Date.now();
    return true;
  }

  /**
   * Get marketplace statistics
   */
  getStats(): {
    total_listings: number;
    active_listings: number;
    total_purchases: number;
    total_volume_sol: number;
    top_capabilities: Array<{ capability_id: string; listings: number }>;
  } {
    const listings = Array.from(this.listings.values());
    const purchases = Array.from(this.purchases.values());

    const capabilityCounts: Record<string, number> = {};
    listings.forEach(l => {
      capabilityCounts[l.capability_id] = (capabilityCounts[l.capability_id] || 0) + 1;
    });

    const topCapabilities = Object.entries(capabilityCounts)
      .map(([capability_id, listings]) => ({ capability_id, listings }))
      .sort((a, b) => b.listings - a.listings)
      .slice(0, 5);

    return {
      total_listings: listings.length,
      active_listings: listings.filter(l => l.status === 'active').length,
      total_purchases: purchases.length,
      total_volume_sol: purchases.reduce((sum, p) => sum + p.amount_paid_sol, 0),
      top_capabilities: topCapabilities
    };
  }
}

export const capabilityMarketplace = new CapabilityMarketplace();
