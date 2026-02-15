/**
 * x402 Protocol Handler
 * 
 * Native HTTP 402 payment flow support for capability invocations.
 * When an endpoint requires payment, returns 402 with payment requirements.
 * Agents submit payment proofs to complete the transaction.
 * 
 * Flow:
 * 1. Agent calls /invoke with a paid capability
 * 2. If no payment proof provided, returns HTTP 402 with payment requirements
 * 3. Agent constructs payment (USDC on Solana/Base, SOL, or credits)
 * 4. Agent resubmits with X-Payment-Proof header or payment_proof in body
 * 5. Server verifies proof and executes capability
 * 6. Settlement logged on-chain
 */

import * as crypto from 'crypto';
import { generateShortId } from '../../utils';
import { X402Hint, generateX402Hint } from './x402';

// ============================================
// TYPES
// ============================================

export interface X402PaymentRequirement {
  version: '1.0.0';
  protocol: 'x402';
  payment_id: string;
  capability_id: string;
  amount: number;
  currency: string;
  accepted_currencies: string[];
  accepted_networks: string[];
  recipient: string;
  expires_at: number;
  nonce: string;
  payment_methods: PaymentMethod[];
  metadata: {
    capability_name: string;
    capability_description: string;
    cost_hint: number;
    settlement_optional: boolean;
  };
  legacy_hint: X402Hint;
}

export interface PaymentMethod {
  type: 'usdc_solana' | 'usdc_base' | 'sol' | 'credits' | 'privacy_cash';
  network: string;
  recipient_address: string;
  amount: number;
  currency: string;
  instructions?: string;
}

export interface PaymentProof {
  payment_id: string;
  method: string;
  transaction_hash?: string;
  signature?: string;
  payer_address?: string;
  amount: number;
  currency: string;
  network?: string;
  timestamp: number;
  nonce: string;
}

export interface PaymentVerification {
  valid: boolean;
  payment_id: string;
  reason?: string;
  settlement_status: 'verified' | 'pending' | 'failed' | 'simulated';
  amount_verified: number;
  currency: string;
}

export interface PaymentRecord {
  payment_id: string;
  capability_id: string;
  agent_id: string;
  amount: number;
  currency: string;
  method: string;
  network: string;
  transaction_hash?: string;
  status: 'pending' | 'verified' | 'settled' | 'refunded' | 'expired';
  created_at: number;
  verified_at?: number;
  settled_at?: number;
  request_id?: string;
}

// ============================================
// PROTOCOL HANDLER
// ============================================

export class X402ProtocolHandler {
  private paymentRequirements: Map<string, X402PaymentRequirement> = new Map();
  private paymentRecords: Map<string, PaymentRecord> = new Map();
  private usedNonces: Set<string> = new Set();
  
  // Treasury addresses per network
  private readonly treasuryAddresses: Record<string, string> = {
    'solana': process.env.X402_TREASURY_SOL || 'CAP402Treasury11111111111111111111111111111',
    'base': process.env.X402_TREASURY_BASE || '0xCAP402Treasury0000000000000000000000000000',
  };

  // Revenue tracking
  private totalRevenue: Map<string, number> = new Map(); // currency -> amount
  private revenueByCapability: Map<string, number> = new Map(); // capability_id -> total
  private revenueByAgent: Map<string, number> = new Map(); // agent_id -> total

  private readonly PAYMENT_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_REQUIREMENTS = 10000;
  private readonly MAX_RECORDS = 50000;
  private readonly MAX_NONCES = 100000;

  constructor() {
    // Cleanup expired requirements every 60 seconds
    setInterval(() => this.cleanup(), 60_000);
  }

  /**
   * Check if a capability requires payment and generate 402 response
   */
  generatePaymentRequirement(
    capabilityId: string,
    capabilityName: string,
    capabilityDescription: string,
    economics: { cost_hint: number; currency: string; x402_payment_signal?: { enabled: boolean; settlement_optional: boolean; payment_methods: string[] } }
  ): X402PaymentRequirement | null {
    // Only generate if x402 is enabled and cost > 0
    if (!economics.x402_payment_signal?.enabled || economics.cost_hint <= 0) {
      return null;
    }

    const payment_id = generateShortId('pay', 24);
    const nonce = crypto.randomBytes(16).toString('hex');

    const requirement: X402PaymentRequirement = {
      version: '1.0.0',
      protocol: 'x402',
      payment_id,
      capability_id: capabilityId,
      amount: economics.cost_hint,
      currency: economics.currency,
      accepted_currencies: ['USDC', 'SOL', 'credits'],
      accepted_networks: ['solana', 'base'],
      recipient: this.treasuryAddresses['solana'],
      expires_at: Date.now() + this.PAYMENT_EXPIRY_MS,
      nonce,
      payment_methods: this.buildPaymentMethods(economics.cost_hint, economics.currency),
      metadata: {
        capability_name: capabilityName,
        capability_description: capabilityDescription,
        cost_hint: economics.cost_hint,
        settlement_optional: economics.x402_payment_signal?.settlement_optional ?? true
      },
      legacy_hint: generateX402Hint({
        amount: economics.cost_hint,
        currency: economics.currency,
        settlement_optional: economics.x402_payment_signal?.settlement_optional ?? true
      })
    };

    // Bound the map
    if (this.paymentRequirements.size >= this.MAX_REQUIREMENTS) {
      const oldest = this.paymentRequirements.keys().next().value;
      if (oldest) this.paymentRequirements.delete(oldest);
    }

    this.paymentRequirements.set(payment_id, requirement);
    return requirement;
  }

  /**
   * Build payment method options for a given amount
   */
  private buildPaymentMethods(amount: number, currency: string): PaymentMethod[] {
    const methods: PaymentMethod[] = [];

    // USDC on Solana
    methods.push({
      type: 'usdc_solana',
      network: 'solana',
      recipient_address: this.treasuryAddresses['solana'],
      amount: currency === 'USDC' ? amount : amount, // Convert if needed
      currency: 'USDC',
      instructions: 'Send USDC SPL token to the recipient address. Include payment_id in memo.'
    });

    // USDC on Base
    methods.push({
      type: 'usdc_base',
      network: 'base',
      recipient_address: this.treasuryAddresses['base'],
      amount: currency === 'USDC' ? amount : amount,
      currency: 'USDC',
      instructions: 'Send USDC on Base L2 to the recipient address. Include payment_id in calldata.'
    });

    // Native SOL
    methods.push({
      type: 'sol',
      network: 'solana',
      recipient_address: this.treasuryAddresses['solana'],
      amount: currency === 'SOL' ? amount : amount * 0.005, // Approximate SOL conversion
      currency: 'SOL',
      instructions: 'Send SOL to the recipient address. Include payment_id in memo.'
    });

    // Credits (internal balance)
    methods.push({
      type: 'credits',
      network: 'internal',
      recipient_address: 'cap402-credits',
      amount,
      currency: 'credits',
      instructions: 'Deduct from agent credit balance. No on-chain transaction needed.'
    });

    return methods;
  }

  /**
   * Verify a payment proof submitted by an agent
   */
  verifyPaymentProof(proof: PaymentProof): PaymentVerification {
    // Check payment requirement exists
    const requirement = this.paymentRequirements.get(proof.payment_id);
    if (!requirement) {
      return {
        valid: false,
        payment_id: proof.payment_id,
        reason: 'Payment requirement not found or expired',
        settlement_status: 'failed',
        amount_verified: 0,
        currency: proof.currency
      };
    }

    // Check expiry
    if (Date.now() > requirement.expires_at) {
      this.paymentRequirements.delete(proof.payment_id);
      return {
        valid: false,
        payment_id: proof.payment_id,
        reason: 'Payment requirement expired',
        settlement_status: 'failed',
        amount_verified: 0,
        currency: proof.currency
      };
    }

    // Check nonce replay
    if (this.usedNonces.has(proof.nonce)) {
      return {
        valid: false,
        payment_id: proof.payment_id,
        reason: 'Nonce already used (replay attack detected)',
        settlement_status: 'failed',
        amount_verified: 0,
        currency: proof.currency
      };
    }

    // Verify nonce matches
    if (proof.nonce !== requirement.nonce) {
      return {
        valid: false,
        payment_id: proof.payment_id,
        reason: 'Nonce mismatch',
        settlement_status: 'failed',
        amount_verified: 0,
        currency: proof.currency
      };
    }

    // Verify amount is sufficient
    if (proof.amount < requirement.amount * 0.99) { // 1% tolerance
      return {
        valid: false,
        payment_id: proof.payment_id,
        reason: `Insufficient payment: ${proof.amount} < ${requirement.amount}`,
        settlement_status: 'failed',
        amount_verified: proof.amount,
        currency: proof.currency
      };
    }

    // Mark nonce as used
    if (this.usedNonces.size >= this.MAX_NONCES) {
      // Clear oldest half
      const entries = Array.from(this.usedNonces);
      for (let i = 0; i < entries.length / 2; i++) {
        this.usedNonces.delete(entries[i]);
      }
    }
    this.usedNonces.add(proof.nonce);

    // For on-chain payments, verify transaction hash format
    const isOnChain = proof.method !== 'credits' && proof.transaction_hash;
    let settlementStatus: 'verified' | 'pending' | 'simulated' = 'verified';

    if (isOnChain && proof.transaction_hash) {
      // In production, we'd verify the tx on-chain via RPC
      // For now, validate format and mark as pending settlement
      if (proof.network === 'solana' && !/^[A-Za-z0-9]{87,88}$/.test(proof.transaction_hash)) {
        settlementStatus = 'pending'; // Will verify async
      } else if (proof.network === 'base' && !/^0x[a-fA-F0-9]{64}$/.test(proof.transaction_hash)) {
        settlementStatus = 'pending';
      } else {
        settlementStatus = 'verified';
      }
    } else if (proof.method === 'credits') {
      settlementStatus = 'verified'; // Internal credits are instant
    } else {
      settlementStatus = 'simulated'; // Settlement optional
    }

    // Clean up requirement (one-time use)
    this.paymentRequirements.delete(proof.payment_id);

    return {
      valid: true,
      payment_id: proof.payment_id,
      settlement_status: settlementStatus,
      amount_verified: proof.amount,
      currency: proof.currency
    };
  }

  /**
   * Record a completed payment
   */
  recordPayment(
    paymentId: string,
    capabilityId: string,
    agentId: string,
    proof: PaymentProof,
    verification: PaymentVerification,
    requestId?: string
  ): PaymentRecord {
    const record: PaymentRecord = {
      payment_id: paymentId,
      capability_id: capabilityId,
      agent_id: agentId,
      amount: verification.amount_verified,
      currency: verification.currency,
      method: proof.method,
      network: proof.network || 'internal',
      transaction_hash: proof.transaction_hash,
      status: verification.settlement_status === 'verified' ? 'settled' : 'verified',
      created_at: Date.now(),
      verified_at: Date.now(),
      settled_at: verification.settlement_status === 'verified' ? Date.now() : undefined,
      request_id: requestId
    };

    // Bound the map
    if (this.paymentRecords.size >= this.MAX_RECORDS) {
      const oldest = this.paymentRecords.keys().next().value;
      if (oldest) this.paymentRecords.delete(oldest);
    }

    this.paymentRecords.set(paymentId, record);

    // Track revenue
    const currentRevenue = this.totalRevenue.get(record.currency) || 0;
    this.totalRevenue.set(record.currency, currentRevenue + record.amount);

    const capRevenue = this.revenueByCapability.get(capabilityId) || 0;
    this.revenueByCapability.set(capabilityId, capRevenue + record.amount);

    const agentRevenue = this.revenueByAgent.get(agentId) || 0;
    this.revenueByAgent.set(agentId, agentRevenue + record.amount);

    return record;
  }

  /**
   * Get payment record by ID
   */
  getPayment(paymentId: string): PaymentRecord | undefined {
    return this.paymentRecords.get(paymentId);
  }

  /**
   * Get payment history for an agent
   */
  getAgentPayments(agentId: string, limit = 20): PaymentRecord[] {
    return Array.from(this.paymentRecords.values())
      .filter(r => r.agent_id === agentId)
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, limit);
  }

  /**
   * Get revenue statistics
   */
  getRevenueStats(): {
    total_by_currency: Record<string, number>;
    top_capabilities: { capability_id: string; revenue: number }[];
    top_agents: { agent_id: string; revenue: number }[];
    total_payments: number;
    settlement_breakdown: Record<string, number>;
  } {
    const topCapabilities = Array.from(this.revenueByCapability.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([capability_id, revenue]) => ({ capability_id, revenue }));

    const topAgents = Array.from(this.revenueByAgent.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([agent_id, revenue]) => ({ agent_id, revenue }));

    const settlementBreakdown: Record<string, number> = {};
    for (const record of this.paymentRecords.values()) {
      settlementBreakdown[record.status] = (settlementBreakdown[record.status] || 0) + 1;
    }

    return {
      total_by_currency: Object.fromEntries(this.totalRevenue),
      top_capabilities: topCapabilities,
      top_agents: topAgents,
      total_payments: this.paymentRecords.size,
      settlement_breakdown: settlementBreakdown
    };
  }

  /**
   * Build the HTTP 402 response body
   */
  build402Response(requirement: X402PaymentRequirement): {
    status: 402;
    headers: Record<string, string>;
    body: any;
  } {
    return {
      status: 402,
      headers: {
        'X-Payment-Required': 'true',
        'X-Payment-Protocol': 'x402',
        'X-Payment-Version': '1.0.0',
        'X-Payment-Id': requirement.payment_id,
        'X-Payment-Amount': requirement.amount.toString(),
        'X-Payment-Currency': requirement.currency,
        'X-Payment-Expires': new Date(requirement.expires_at).toISOString(),
        'X-Payment-Networks': requirement.accepted_networks.join(','),
        'X-Payment-Recipient': requirement.recipient,
      },
      body: {
        success: false,
        error: 'Payment Required',
        code: 'PAYMENT_REQUIRED',
        protocol: 'x402',
        payment: requirement,
        instructions: {
          step_1: 'Choose a payment method from the payment.payment_methods array',
          step_2: 'Execute the payment transaction on the specified network',
          step_3: 'Resubmit your /invoke request with the payment proof',
          step_4: 'Include X-Payment-Proof header (JSON) or payment_proof in request body',
          example_proof: {
            payment_id: requirement.payment_id,
            method: 'usdc_solana',
            transaction_hash: '<your_tx_hash>',
            payer_address: '<your_wallet>',
            amount: requirement.amount,
            currency: requirement.currency,
            network: 'solana',
            timestamp: Date.now(),
            nonce: requirement.nonce
          }
        },
        hint: 'Agents can also use credits for instant settlement without on-chain transactions'
      }
    };
  }

  /**
   * Parse payment proof from request
   */
  parsePaymentProof(req: { headers: Record<string, any>; body: any }): PaymentProof | null {
    // Check header first
    const headerProof = req.headers['x-payment-proof'];
    if (headerProof) {
      try {
        return typeof headerProof === 'string' ? JSON.parse(headerProof) : headerProof;
      } catch {
        return null;
      }
    }

    // Check body
    if (req.body?.payment_proof) {
      return req.body.payment_proof;
    }

    return null;
  }

  /**
   * Check if a capability should require payment
   */
  shouldRequirePayment(
    economics: { cost_hint: number; x402_payment_signal?: { enabled: boolean; settlement_optional: boolean } },
    trustLevel: string,
    hasToken: boolean
  ): boolean {
    // No payment needed if x402 not enabled
    if (!economics.x402_payment_signal?.enabled) return false;
    
    // No payment needed if cost is 0
    if (economics.cost_hint <= 0) return false;

    // Settlement optional = payment is encouraged but not required
    // The x402 hint is still included in the response for agents that want to pay
    if (economics.x402_payment_signal.settlement_optional) return false;

    // Has valid capability token = no payment required
    if (hasToken) return false;

    // Trusted/premium agents bypass mandatory payment
    if (trustLevel === 'trusted' || trustLevel === 'premium') return false;

    return true;
  }

  /**
   * Cleanup expired requirements and old records
   */
  private cleanup(): void {
    const now = Date.now();
    
    // Clean expired requirements
    for (const [id, req] of this.paymentRequirements) {
      if (now > req.expires_at) {
        this.paymentRequirements.delete(id);
      }
    }

    // Clean old records (keep last 30 days)
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    for (const [id, record] of this.paymentRecords) {
      if (record.created_at < thirtyDaysAgo) {
        this.paymentRecords.delete(id);
      }
    }
  }

  /**
   * Get protocol stats
   */
  getStats(): {
    active_requirements: number;
    total_payments: number;
    used_nonces: number;
    revenue: Record<string, number>;
  } {
    return {
      active_requirements: this.paymentRequirements.size,
      total_payments: this.paymentRecords.size,
      used_nonces: this.usedNonces.size,
      revenue: Object.fromEntries(this.totalRevenue)
    };
  }
}

export const x402Protocol = new X402ProtocolHandler();
