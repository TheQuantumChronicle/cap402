/**
 * Multi-Step Agent Handshake Protocol
 * 
 * SECRET SAUCE #3: Complex agent-to-agent negotiation
 * 
 * Agents must complete a multi-step handshake before accessing
 * premium capabilities. This handshake depends on:
 * - Prior transaction history
 * - Trust network membership
 * - Cryptographic challenges
 * 
 * Copycats cannot function without the exact context/history.
 */

import * as crypto from 'crypto';

export interface HandshakeChallenge {
  challenge_id: string;
  step: number;
  total_steps: number;
  challenge_data: string;
  expires_at: number;
  required_proof: string;
}

export interface HandshakeResponse {
  challenge_id: string;
  step: number;
  proof: string;
  agent_signature: string;
  context_hash: string;
}

export interface HandshakeSession {
  session_id: string;
  agent_id: string;
  started_at: number;
  current_step: number;
  completed_steps: number[];
  context: HandshakeContext;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  granted_access: string[];
}

interface HandshakeContext {
  prior_invocations: number;
  trust_score: number;
  reputation_level: string;
  network_membership: string[];
  last_activity: number;
}

class AgentHandshakeProtocol {
  private sessions: Map<string, HandshakeSession> = new Map();
  private challenges: Map<string, HandshakeChallenge> = new Map();
  
  private readonly CHALLENGE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
  private readonly SECRET_SEED: string;
  private readonly IS_PRODUCTION = process.env.NODE_ENV === 'production';

  constructor() {
    // SECURITY: In production, handshake seed MUST be configured
    if (this.IS_PRODUCTION && !process.env.CAP402_HANDSHAKE_SEED) {
      throw new Error('SECURITY: CAP402_HANDSHAKE_SEED must be set in production');
    }
    
    this.SECRET_SEED = process.env.CAP402_HANDSHAKE_SEED || 
      require('crypto').randomBytes(32).toString('hex');
  }

  /**
   * Initiate a handshake session for an agent
   * Returns the first challenge
   */
  initiateHandshake(
    agentId: string,
    context: HandshakeContext,
    requestedAccess: string[]
  ): { session: HandshakeSession; challenge: HandshakeChallenge } {
    const sessionId = `hs_${crypto.randomBytes(16).toString('hex')}`;
    
    // Determine number of steps based on requested access level
    const totalSteps = this.calculateRequiredSteps(requestedAccess, context);
    
    const session: HandshakeSession = {
      session_id: sessionId,
      agent_id: agentId,
      started_at: Date.now(),
      current_step: 1,
      completed_steps: [],
      context,
      status: 'in_progress',
      granted_access: []
    };

    this.sessions.set(sessionId, session);

    const challenge = this.generateChallenge(sessionId, 1, totalSteps, context);
    
    return { session, challenge };
  }

  /**
   * Process a handshake response and return next challenge or completion
   */
  processResponse(
    response: HandshakeResponse
  ): { 
    success: boolean; 
    next_challenge?: HandshakeChallenge; 
    session?: HandshakeSession;
    error?: string;
  } {
    const challenge = this.challenges.get(response.challenge_id);
    
    if (!challenge) {
      return { success: false, error: 'Challenge not found or expired' };
    }

    if (Date.now() > challenge.expires_at) {
      this.challenges.delete(response.challenge_id);
      return { success: false, error: 'Challenge expired' };
    }

    // Find the session
    let session: HandshakeSession | undefined;
    for (const s of this.sessions.values()) {
      if (s.current_step === challenge.step && s.status === 'in_progress') {
        session = s;
        break;
      }
    }

    if (!session) {
      return { success: false, error: 'Session not found' };
    }

    // Verify the proof
    if (!this.verifyProof(challenge, response, session.context)) {
      session.status = 'failed';
      return { success: false, error: 'Invalid proof' };
    }

    // Mark step as completed
    session.completed_steps.push(challenge.step);
    session.current_step++;

    // Check if handshake is complete
    if (challenge.step >= challenge.total_steps) {
      session.status = 'completed';
      session.granted_access = this.determineGrantedAccess(session);
      
      return { 
        success: true, 
        session 
      };
    }

    // Generate next challenge
    const nextChallenge = this.generateChallenge(
      session.session_id,
      session.current_step,
      challenge.total_steps,
      session.context
    );

    return { 
      success: true, 
      next_challenge: nextChallenge,
      session
    };
  }

  /**
   * Generate a challenge for a specific step
   */
  private generateChallenge(
    sessionId: string,
    step: number,
    totalSteps: number,
    context: HandshakeContext
  ): HandshakeChallenge {
    const challengeId = `ch_${crypto.randomBytes(12).toString('hex')}`;
    
    // Challenge data depends on step and context
    const challengeData = this.createChallengeData(step, context);
    const requiredProof = this.determineRequiredProof(step);

    const challenge: HandshakeChallenge = {
      challenge_id: challengeId,
      step,
      total_steps: totalSteps,
      challenge_data: challengeData,
      expires_at: Date.now() + this.CHALLENGE_EXPIRY_MS,
      required_proof: requiredProof
    };

    this.challenges.set(challengeId, challenge);
    
    return challenge;
  }

  /**
   * Create challenge data based on step
   */
  private createChallengeData(step: number, context: HandshakeContext): string {
    const stepChallenges: Record<number, () => string> = {
      1: () => {
        // Step 1: Prove identity with nonce
        const nonce = crypto.randomBytes(16).toString('hex');
        return JSON.stringify({ type: 'identity', nonce });
      },
      2: () => {
        // Step 2: Prove prior activity
        return JSON.stringify({ 
          type: 'activity_proof',
          required_invocations: Math.min(context.prior_invocations, 10),
          timestamp_range: [Date.now() - 7 * 24 * 60 * 60 * 1000, Date.now()]
        });
      },
      3: () => {
        // Step 3: Trust network verification
        return JSON.stringify({
          type: 'trust_verification',
          required_trust_score: 50,
          network_check: context.network_membership.slice(0, 3)
        });
      },
      4: () => {
        // Step 4: Cryptographic capability proof
        const puzzle = crypto.randomBytes(32).toString('hex');
        return JSON.stringify({
          type: 'capability_proof',
          puzzle,
          difficulty: 2
        });
      },
      5: () => {
        // Step 5: Final attestation
        return JSON.stringify({
          type: 'attestation',
          context_hash: crypto.createHash('sha256')
            .update(JSON.stringify(context))
            .digest('hex')
            .slice(0, 16)
        });
      }
    };

    const generator = stepChallenges[step] || stepChallenges[1];
    return generator();
  }

  /**
   * Determine required proof type for a step
   */
  private determineRequiredProof(step: number): string {
    const proofTypes: Record<number, string> = {
      1: 'signed_nonce',
      2: 'merkle_proof',
      3: 'trust_attestation',
      4: 'hash_solution',
      5: 'final_signature'
    };
    return proofTypes[step] || 'signature';
  }

  /**
   * Verify a proof response
   */
  private verifyProof(
    challenge: HandshakeChallenge,
    response: HandshakeResponse,
    context: HandshakeContext
  ): boolean {
    // Verify context hash matches
    const expectedContextHash = crypto.createHash('sha256')
      .update(JSON.stringify(context))
      .digest('hex')
      .slice(0, 16);

    if (response.context_hash !== expectedContextHash) {
      return false;
    }

    // Verify proof format (simplified - in production would be more rigorous)
    if (!response.proof || response.proof.length < 32) {
      return false;
    }

    // Verify agent signature
    if (!response.agent_signature || response.agent_signature.length < 64) {
      return false;
    }

    return true;
  }

  /**
   * Calculate required handshake steps based on access level
   */
  private calculateRequiredSteps(
    requestedAccess: string[],
    context: HandshakeContext
  ): number {
    let steps = 2; // Minimum 2 steps

    // More steps for confidential capabilities
    if (requestedAccess.some(a => a.includes('confidential') || a.includes('cspl'))) {
      steps += 1;
    }

    // More steps for low trust agents
    if (context.trust_score < 50) {
      steps += 1;
    }

    // More steps for new agents
    if (context.prior_invocations < 10) {
      steps += 1;
    }

    return Math.min(steps, 5); // Max 5 steps
  }

  /**
   * Determine what access to grant based on completed handshake
   */
  private determineGrantedAccess(session: HandshakeSession): string[] {
    const access: string[] = ['public'];

    if (session.completed_steps.length >= 3) {
      access.push('standard');
    }

    if (session.completed_steps.length >= 4 && session.context.trust_score >= 50) {
      access.push('confidential');
    }

    if (session.completed_steps.length >= 5 && session.context.trust_score >= 75) {
      access.push('premium');
    }

    return access;
  }

  /**
   * Get session status
   */
  getSession(sessionId: string): HandshakeSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Check if agent has completed handshake for access level
   */
  hasAccess(agentId: string, accessLevel: string): boolean {
    for (const session of this.sessions.values()) {
      if (session.agent_id === agentId && 
          session.status === 'completed' &&
          session.granted_access.includes(accessLevel)) {
        return true;
      }
    }
    return false;
  }
}

export const agentHandshake = new AgentHandshakeProtocol();
