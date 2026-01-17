/**
 * CAP-402 Agent Reputation System
 * 
 * ZK-verified agent reputation without revealing:
 * - Wallet history
 * - Exact PnL
 * - Identity
 * 
 * Agents prove credibility, not data.
 */

import { generateId, sha256Hex } from '../../utils';

export interface TrackRecord {
  agent_id: string;
  total_executions: number;
  profitable_executions: number;
  total_volume_usd: number;
  total_pnl_usd: number;  // Only stored encrypted
  win_rate: number;       // Derived, can be proven via ZK
  avg_return_bps: number; // Derived, can be proven via ZK
  max_drawdown_bps: number;
  sharpe_ratio: number;
  first_execution_at: number;
  last_execution_at: number;
  verified: boolean;
}

export interface ReputationProof {
  proof_id: string;
  agent_id: string;
  proof_type: 'profitable_executions' | 'volume_threshold' | 'win_rate' | 'max_drawdown' | 'track_record_age';
  public_claim: string;
  proof: string;
  verification_key: string;
  created_at: number;
  expires_at: number;
  verified: boolean;
}

export interface CapitalDelegation {
  delegation_id: string;
  delegator: string;
  agent_id: string;
  amount_usd: number;
  terms: {
    max_drawdown_bps: number;
    profit_share_bps: number;
    lock_period_days: number;
  };
  required_proofs: string[];
  status: 'pending' | 'active' | 'withdrawn' | 'liquidated';
  created_at: number;
}

class AgentReputationManager {
  private trackRecords: Map<string, TrackRecord> = new Map();
  private proofs: Map<string, ReputationProof> = new Map();
  private delegations: Map<string, CapitalDelegation> = new Map();
  private agentProofs: Map<string, string[]> = new Map(); // agent_id -> proof_ids
  
  /**
   * Initialize or get track record for agent
   */
  getOrCreateTrackRecord(agentId: string): TrackRecord {
    let record = this.trackRecords.get(agentId);
    if (!record) {
      record = {
        agent_id: agentId,
        total_executions: 0,
        profitable_executions: 0,
        total_volume_usd: 0,
        total_pnl_usd: 0,
        win_rate: 0,
        avg_return_bps: 0,
        max_drawdown_bps: 0,
        sharpe_ratio: 0,
        first_execution_at: Date.now(),
        last_execution_at: Date.now(),
        verified: false
      };
      this.trackRecords.set(agentId, record);
    }
    return record;
  }
  
  /**
   * Record an execution for track record
   */
  recordExecution(
    agentId: string,
    volumeUsd: number,
    pnlUsd: number,
    returnBps: number
  ): TrackRecord {
    const record = this.getOrCreateTrackRecord(agentId);
    
    record.total_executions++;
    record.total_volume_usd += volumeUsd;
    record.total_pnl_usd += pnlUsd;
    record.last_execution_at = Date.now();
    
    if (pnlUsd > 0) {
      record.profitable_executions++;
    }
    
    // Update derived metrics (guard against division by zero)
    record.win_rate = record.total_executions > 0 
      ? record.profitable_executions / record.total_executions 
      : 0;
    record.avg_return_bps = record.total_volume_usd > 0 
      ? (record.total_pnl_usd / record.total_volume_usd) * 10000 
      : 0;
    
    // Track max drawdown (simplified)
    if (returnBps < -record.max_drawdown_bps) {
      record.max_drawdown_bps = Math.abs(returnBps);
    }
    
    return record;
  }
  
  /**
   * Generate a ZK proof for a reputation claim
   */
  async generateReputationProof(
    agentId: string,
    proofType: ReputationProof['proof_type'],
    threshold: number
  ): Promise<ReputationProof> {
    const record = this.getOrCreateTrackRecord(agentId);
    
    let publicClaim: string;
    let meetsThreshold: boolean;
    
    switch (proofType) {
      case 'profitable_executions':
        meetsThreshold = record.profitable_executions >= threshold;
        publicClaim = `Agent has >= ${threshold} profitable executions`;
        break;
      case 'volume_threshold':
        meetsThreshold = record.total_volume_usd >= threshold;
        publicClaim = `Agent has processed >= $${threshold.toLocaleString()} volume`;
        break;
      case 'win_rate':
        meetsThreshold = record.win_rate * 100 >= threshold;
        publicClaim = `Agent has >= ${threshold}% win rate`;
        break;
      case 'max_drawdown':
        meetsThreshold = record.max_drawdown_bps <= threshold;
        publicClaim = `Agent max drawdown <= ${threshold} bps`;
        break;
      case 'track_record_age':
        const ageDays = (Date.now() - record.first_execution_at) / (24 * 60 * 60 * 1000);
        meetsThreshold = ageDays >= threshold;
        publicClaim = `Agent track record >= ${threshold} days`;
        break;
      default:
        throw new Error(`Unknown proof type: ${proofType}`);
    }
    
    // Generate ZK proof (simulated - in production uses Noir)
    const proofData = {
      agent_id: agentId,
      proof_type: proofType,
      threshold,
      meets_threshold: meetsThreshold,
      timestamp: Date.now()
    };
    
    const proofHash = sha256Hex(JSON.stringify(proofData)).slice(2);
    
    const proof: ReputationProof = {
      proof_id: generateId('rep_proof'),
      agent_id: agentId,
      proof_type: proofType,
      public_claim: publicClaim,
      proof: `0x${proofHash}`,
      verification_key: `vk_reputation_${proofType}_v1`,
      created_at: Date.now(),
      expires_at: Date.now() + (30 * 24 * 60 * 60 * 1000), // 30 days
      verified: meetsThreshold
    };
    
    this.proofs.set(proof.proof_id, proof);
    
    // Track proofs by agent
    const agentProofIds = this.agentProofs.get(agentId) || [];
    agentProofIds.push(proof.proof_id);
    this.agentProofs.set(agentId, agentProofIds);
    
    return proof;
  }
  
  /**
   * Verify a reputation proof
   */
  verifyProof(proofId: string): { valid: boolean; proof: ReputationProof | null } {
    const proof = this.proofs.get(proofId);
    if (!proof) {
      return { valid: false, proof: null };
    }
    
    // Check expiration
    if (proof.expires_at < Date.now()) {
      return { valid: false, proof };
    }
    
    return { valid: proof.verified, proof };
  }
  
  /**
   * Get all valid proofs for an agent
   */
  getAgentProofs(agentId: string): ReputationProof[] {
    const proofIds = this.agentProofs.get(agentId) || [];
    return proofIds
      .map(id => this.proofs.get(id))
      .filter((p): p is ReputationProof => p !== undefined && p.expires_at > Date.now());
  }
  
  /**
   * Create capital delegation request
   */
  createDelegation(
    delegator: string,
    agentId: string,
    amountUsd: number,
    terms: CapitalDelegation['terms'],
    requiredProofs: string[]
  ): CapitalDelegation {
    // Verify agent has required proofs
    const agentProofs = this.getAgentProofs(agentId);
    const hasRequiredProofs = requiredProofs.every(required =>
      agentProofs.some(p => p.proof_type === required && p.verified)
    );
    
    const delegation: CapitalDelegation = {
      delegation_id: generateId('del'),
      delegator,
      agent_id: agentId,
      amount_usd: amountUsd,
      terms,
      required_proofs: requiredProofs,
      status: hasRequiredProofs ? 'active' : 'pending',
      created_at: Date.now()
    };
    
    this.delegations.set(delegation.delegation_id, delegation);
    return delegation;
  }
  
  /**
   * Get delegations for an agent
   */
  getAgentDelegations(agentId: string): CapitalDelegation[] {
    return Array.from(this.delegations.values())
      .filter(d => d.agent_id === agentId);
  }
  
  /**
   * Get total AUM for an agent
   */
  getAgentAUM(agentId: string): number {
    return this.getAgentDelegations(agentId)
      .filter(d => d.status === 'active')
      .reduce((sum, d) => sum + d.amount_usd, 0);
  }
  
  /**
   * Get public reputation summary (no sensitive data)
   */
  getPublicReputation(agentId: string): {
    agent_id: string;
    reputation_score: number;
    verified_claims: string[];
    total_delegations: number;
    aum_usd: number;
    track_record_days: number;
  } {
    const record = this.trackRecords.get(agentId);
    const proofs = this.getAgentProofs(agentId);
    const delegations = this.getAgentDelegations(agentId);
    
    // Calculate reputation score (0-100)
    let score = 0;
    if (record) {
      score += Math.min(20, record.total_executions / 10); // Up to 20 points for executions
      score += Math.min(20, record.win_rate * 20);          // Up to 20 points for win rate
      score += Math.min(20, proofs.length * 5);             // Up to 20 points for proofs
      score += Math.min(20, delegations.length * 4);        // Up to 20 points for delegations
      score += Math.min(20, this.getAgentAUM(agentId) / 100000); // Up to 20 points for AUM
    }
    
    const trackRecordDays = record 
      ? Math.floor((Date.now() - record.first_execution_at) / (24 * 60 * 60 * 1000))
      : 0;
    
    return {
      agent_id: agentId,
      reputation_score: Math.min(100, Math.round(score)),
      verified_claims: proofs.filter(p => p.verified).map(p => p.public_claim),
      total_delegations: delegations.filter(d => d.status === 'active').length,
      aum_usd: this.getAgentAUM(agentId),
      track_record_days: trackRecordDays
    };
  }
  
  /**
   * Get leaderboard of top agents by reputation
   */
  getReputationLeaderboard(limit: number = 10): Array<{
    rank: number;
    agent_id: string;
    reputation_score: number;
    aum_usd: number;
    verified_proofs: number;
  }> {
    const agents = Array.from(this.trackRecords.keys());
    
    return agents
      .map(agentId => {
        const rep = this.getPublicReputation(agentId);
        return {
          agent_id: agentId,
          reputation_score: rep.reputation_score,
          aum_usd: rep.aum_usd,
          verified_proofs: rep.verified_claims.length
        };
      })
      .sort((a, b) => b.reputation_score - a.reputation_score)
      .slice(0, limit)
      .map((agent, index) => ({ rank: index + 1, ...agent }));
  }
}

export const agentReputationManager = new AgentReputationManager();
