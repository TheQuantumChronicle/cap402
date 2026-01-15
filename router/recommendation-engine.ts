/**
 * AI-Powered Recommendation Engine
 * 
 * Learns from agent behavior to provide personalized recommendations:
 * - "Agents like you also use..."
 * - "Based on your workflow, try..."
 * - "Optimize your costs by..."
 * - "Unlock new capabilities by..."
 * 
 * This creates stickiness - the more you use CAP-402, the smarter it gets
 */

import { registry } from './registry';
import { COMPOSITION_TEMPLATES } from './composition-templates';

interface AgentProfile {
  agent_id: string;
  capabilities_used: string[];
  total_invocations: number;
  favorite_mode: 'public' | 'confidential' | 'mixed';
  avg_cost_per_invocation: number;
  trust_level: string;
  badges: string[];
}

interface Recommendation {
  type: 'capability' | 'template' | 'optimization' | 'upgrade' | 'workflow';
  id: string;
  title: string;
  description: string;
  reason: string;
  confidence: number; // 0-1
  potential_value: string;
  action: string;
}

interface WorkflowSuggestion {
  name: string;
  description: string;
  capabilities: string[];
  estimated_cost: number;
  use_case: string;
}

class RecommendationEngine {
  // Capability affinity matrix - which capabilities are commonly used together
  private affinityMatrix: Map<string, Map<string, number>> = new Map();
  
  // Agent archetypes based on usage patterns
  private archetypes = {
    trader: ['cap.price.lookup.v1', 'cap.swap.execute.v1', 'cap.wallet.snapshot.v1'],
    privacy_focused: ['cap.confidential.swap.v1', 'cap.zk.proof.v1', 'cap.cspl.wrap.v1'],
    governance: ['cap.private.governance.v1', 'cap.zk.proof.v1'],
    messaging: ['cap.lightning.message.v1', 'cap.zk.proof.v1'],
    defi_power_user: ['cap.swap.execute.v1', 'cap.confidential.swap.v1', 'cap.cspl.wrap.v1', 'cap.cspl.transfer.v1']
  };

  constructor() {
    this.initializeAffinityMatrix();
  }

  /**
   * Get personalized recommendations for an agent
   */
  getRecommendations(profile: AgentProfile): Recommendation[] {
    const recommendations: Recommendation[] = [];

    // 1. Capability recommendations based on affinity
    const capabilityRecs = this.getCapabilityRecommendations(profile);
    recommendations.push(...capabilityRecs);

    // 2. Template recommendations based on usage
    const templateRecs = this.getTemplateRecommendations(profile);
    recommendations.push(...templateRecs);

    // 3. Optimization recommendations
    const optimizationRecs = this.getOptimizationRecommendations(profile);
    recommendations.push(...optimizationRecs);

    // 4. Upgrade recommendations
    const upgradeRecs = this.getUpgradeRecommendations(profile);
    recommendations.push(...upgradeRecs);

    // Sort by confidence and return top 5
    return recommendations
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);
  }

  /**
   * Get workflow suggestions based on agent's goals
   */
  suggestWorkflows(goal: string, profile?: AgentProfile): WorkflowSuggestion[] {
    const suggestions: WorkflowSuggestion[] = [];
    const goalLower = goal.toLowerCase();

    if (goalLower.includes('trade') || goalLower.includes('swap')) {
      suggestions.push({
        name: 'Private Trading Workflow',
        description: 'Execute trades with full privacy - amounts and routes hidden',
        capabilities: ['cap.cspl.wrap.v1', 'cap.confidential.swap.v1'],
        estimated_cost: 0.06,
        use_case: 'trading'
      });
    }

    if (goalLower.includes('kyc') || goalLower.includes('compliance')) {
      suggestions.push({
        name: 'Compliant Trading',
        description: 'Prove KYC compliance without revealing personal data',
        capabilities: ['cap.zk.proof.v1', 'cap.swap.execute.v1'],
        estimated_cost: 0.02,
        use_case: 'compliance'
      });
    }

    if (goalLower.includes('vote') || goalLower.includes('governance') || goalLower.includes('dao')) {
      suggestions.push({
        name: 'Private DAO Participation',
        description: 'Vote privately while proving eligibility',
        capabilities: ['cap.zk.proof.v1', 'cap.private.governance.v1'],
        estimated_cost: 0.02,
        use_case: 'governance'
      });
    }

    if (goalLower.includes('message') || goalLower.includes('communicate')) {
      suggestions.push({
        name: 'Verified Private Messaging',
        description: 'Send encrypted messages with credential proofs',
        capabilities: ['cap.zk.proof.v1', 'cap.lightning.message.v1'],
        estimated_cost: 0.011,
        use_case: 'messaging'
      });
    }

    if (goalLower.includes('portfolio') || goalLower.includes('balance')) {
      suggestions.push({
        name: 'Portfolio Analysis',
        description: 'Get comprehensive wallet data with pricing',
        capabilities: ['cap.wallet.snapshot.v1', 'cap.price.lookup.v1'],
        estimated_cost: 0.002,
        use_case: 'portfolio'
      });
    }

    return suggestions;
  }

  /**
   * Detect agent archetype based on usage
   */
  detectArchetype(profile: AgentProfile): {
    archetype: string;
    confidence: number;
    description: string;
  } {
    let bestMatch = { archetype: 'explorer', confidence: 0, description: 'General purpose agent' };

    for (const [archetype, caps] of Object.entries(this.archetypes)) {
      const matchCount = caps.filter(c => profile.capabilities_used.includes(c)).length;
      const confidence = matchCount / caps.length;

      if (confidence > bestMatch.confidence) {
        bestMatch = {
          archetype,
          confidence,
          description: this.getArchetypeDescription(archetype)
        };
      }
    }

    return bestMatch;
  }

  /**
   * Get "agents like you" insights
   */
  getAgentsLikeYou(profile: AgentProfile): {
    archetype: string;
    common_next_capabilities: string[];
    avg_invocations_per_day: number;
    popular_templates: string[];
  } {
    const archetype = this.detectArchetype(profile);
    const archetypeCaps = this.archetypes[archetype.archetype as keyof typeof this.archetypes] || [];
    
    // Find capabilities this agent hasn't used yet that similar agents use
    const unusedCaps = archetypeCaps.filter(c => !profile.capabilities_used.includes(c));

    return {
      archetype: archetype.archetype,
      common_next_capabilities: unusedCaps,
      avg_invocations_per_day: this.getArchetypeAvgInvocations(archetype.archetype),
      popular_templates: this.getArchetypeTemplates(archetype.archetype)
    };
  }

  /**
   * Record capability usage to improve recommendations
   */
  recordUsage(agent_id: string, capability_id: string, previousCapability?: string): void {
    if (previousCapability) {
      // Update affinity matrix
      if (!this.affinityMatrix.has(previousCapability)) {
        this.affinityMatrix.set(previousCapability, new Map());
      }
      const affinities = this.affinityMatrix.get(previousCapability)!;
      affinities.set(capability_id, (affinities.get(capability_id) || 0) + 1);
    }
  }

  private getCapabilityRecommendations(profile: AgentProfile): Recommendation[] {
    const recommendations: Recommendation[] = [];
    const allCapabilities = registry.getAllCapabilities();

    // Find capabilities with high affinity to what agent uses
    for (const cap of profile.capabilities_used) {
      const affinities = this.affinityMatrix.get(cap);
      if (affinities) {
        for (const [relatedCap, score] of affinities) {
          if (!profile.capabilities_used.includes(relatedCap)) {
            const capability = registry.getCapability(relatedCap);
            if (capability) {
              recommendations.push({
                type: 'capability',
                id: relatedCap,
                title: capability.name,
                description: capability.description,
                reason: `Agents who use ${cap} often also use this`,
                confidence: Math.min(score / 10, 0.9),
                potential_value: `Expand your workflow with ${capability.name}`,
                action: `POST /invoke {"capability_id": "${relatedCap}", ...}`
              });
            }
          }
        }
      }
    }

    // Add archetype-based recommendations
    const archetype = this.detectArchetype(profile);
    const archetypeCaps = this.archetypes[archetype.archetype as keyof typeof this.archetypes] || [];
    
    for (const cap of archetypeCaps) {
      if (!profile.capabilities_used.includes(cap)) {
        const capability = registry.getCapability(cap);
        if (capability) {
          recommendations.push({
            type: 'capability',
            id: cap,
            title: capability.name,
            description: capability.description,
            reason: `Popular with ${archetype.archetype} agents like you`,
            confidence: archetype.confidence * 0.8,
            potential_value: `Complete your ${archetype.archetype} toolkit`,
            action: `POST /invoke {"capability_id": "${cap}", ...}`
          });
        }
      }
    }

    return recommendations;
  }

  private getTemplateRecommendations(profile: AgentProfile): Recommendation[] {
    const recommendations: Recommendation[] = [];

    for (const template of COMPOSITION_TEMPLATES) {
      // Check if agent uses some but not all capabilities in template
      const usedCount = template.capabilities
        .map(c => c.capability_id)
        .filter(c => profile.capabilities_used.includes(c)).length;
      
      const totalCaps = template.capabilities.length;
      
      if (usedCount > 0 && usedCount < totalCaps) {
        recommendations.push({
          type: 'template',
          id: template.id,
          title: template.name,
          description: template.description,
          reason: `You already use ${usedCount}/${totalCaps} capabilities in this workflow`,
          confidence: usedCount / totalCaps,
          potential_value: `Save ${Math.round(template.estimated_cost * 0.1 * 100) / 100} SOL with composition discount`,
          action: `GET /templates/${template.id}`
        });
      }
    }

    return recommendations;
  }

  private getOptimizationRecommendations(profile: AgentProfile): Recommendation[] {
    const recommendations: Recommendation[] = [];

    // High usage of public capabilities - suggest confidential alternatives
    const publicCaps = profile.capabilities_used.filter(c => 
      c.includes('swap.execute') || c.includes('price.lookup')
    );
    
    if (publicCaps.length > 0 && !profile.capabilities_used.includes('cap.confidential.swap.v1')) {
      recommendations.push({
        type: 'optimization',
        id: 'privacy-upgrade',
        title: 'Upgrade to Private Trading',
        description: 'Switch to confidential swaps for hidden trade amounts',
        reason: 'You frequently trade publicly - consider privacy',
        confidence: 0.7,
        potential_value: 'Hide your trading strategy from competitors',
        action: 'Use cap.confidential.swap.v1 instead of cap.swap.execute.v1'
      });
    }

    // Suggest batching if agent makes many sequential calls
    if (profile.total_invocations > 50) {
      recommendations.push({
        type: 'optimization',
        id: 'batch-calls',
        title: 'Batch Your Calls',
        description: 'Use composition to batch multiple capabilities',
        reason: `You've made ${profile.total_invocations} calls - batching saves 10%`,
        confidence: 0.6,
        potential_value: `Save ~${Math.round(profile.avg_cost_per_invocation * profile.total_invocations * 0.1 * 100) / 100} SOL`,
        action: 'POST /compose with multiple capabilities'
      });
    }

    return recommendations;
  }

  private getUpgradeRecommendations(profile: AgentProfile): Recommendation[] {
    const recommendations: Recommendation[] = [];

    if (profile.trust_level === 'anonymous') {
      recommendations.push({
        type: 'upgrade',
        id: 'verify-identity',
        title: 'Verify Your Identity',
        description: 'Upgrade to verified for 33% cost reduction and 5x rate limits',
        reason: 'Anonymous agents pay 1.5x and have limited rate limits',
        confidence: 0.9,
        potential_value: 'Save 33% on all capability costs',
        action: 'Add email verification credential'
      });
    }

    if (profile.trust_level === 'verified' && profile.total_invocations > 100) {
      recommendations.push({
        type: 'upgrade',
        id: 'trusted-status',
        title: 'Upgrade to Trusted',
        description: 'Get 20% cost reduction and 4x rate limits',
        reason: `You're a power user with ${profile.total_invocations} invocations`,
        confidence: 0.8,
        potential_value: 'Unlock premium capabilities and lower costs',
        action: 'Complete KYC verification'
      });
    }

    // Badge-based recommendations
    if (!profile.badges.includes('privacy_advocate') && 
        profile.capabilities_used.some(c => c.includes('confidential'))) {
      recommendations.push({
        type: 'upgrade',
        id: 'privacy-badge',
        title: 'Earn Privacy Advocate Badge',
        description: 'Use 3 privacy capabilities to earn this badge',
        reason: 'You\'re already using some privacy features',
        confidence: 0.5,
        potential_value: 'Unlock exclusive privacy-focused features',
        action: 'Use cap.zk.proof.v1, cap.cspl.wrap.v1, and cap.lightning.message.v1'
      });
    }

    return recommendations;
  }

  private initializeAffinityMatrix(): void {
    // Pre-populate with known affinities
    const knownAffinities = [
      ['cap.price.lookup.v1', 'cap.swap.execute.v1', 5],
      ['cap.swap.execute.v1', 'cap.wallet.snapshot.v1', 4],
      ['cap.cspl.wrap.v1', 'cap.confidential.swap.v1', 8],
      ['cap.cspl.wrap.v1', 'cap.cspl.transfer.v1', 6],
      ['cap.zk.proof.v1', 'cap.confidential.swap.v1', 5],
      ['cap.zk.proof.v1', 'cap.private.governance.v1', 7],
      ['cap.zk.proof.v1', 'cap.lightning.message.v1', 4],
      ['cap.wallet.snapshot.v1', 'cap.price.lookup.v1', 6]
    ];

    for (const [from, to, score] of knownAffinities) {
      if (!this.affinityMatrix.has(from as string)) {
        this.affinityMatrix.set(from as string, new Map());
      }
      this.affinityMatrix.get(from as string)!.set(to as string, score as number);
    }
  }

  private getArchetypeDescription(archetype: string): string {
    const descriptions: Record<string, string> = {
      trader: 'Focused on price discovery and token swaps',
      privacy_focused: 'Prioritizes confidential operations and ZK proofs',
      governance: 'Active in DAO voting and governance',
      messaging: 'Uses encrypted communication channels',
      defi_power_user: 'Heavy DeFi user with both public and private operations',
      explorer: 'General purpose agent exploring various capabilities'
    };
    return descriptions[archetype] || 'General purpose agent';
  }

  private getArchetypeAvgInvocations(archetype: string): number {
    const avgs: Record<string, number> = {
      trader: 150,
      privacy_focused: 80,
      governance: 30,
      messaging: 100,
      defi_power_user: 250,
      explorer: 50
    };
    return avgs[archetype] || 50;
  }

  private getArchetypeTemplates(archetype: string): string[] {
    const templates: Record<string, string[]> = {
      trader: ['template.private-swap.v1', 'template.portfolio-check.v1'],
      privacy_focused: ['template.private-swap.v1', 'template.private-message-with-proof.v1'],
      governance: ['template.private-governance-vote.v1'],
      messaging: ['template.private-message-with-proof.v1'],
      defi_power_user: ['template.private-swap.v1', 'template.balance-threshold-swap.v1', 'template.verified-trade.v1']
    };
    return templates[archetype] || [];
  }
}

export const recommendationEngine = new RecommendationEngine();
