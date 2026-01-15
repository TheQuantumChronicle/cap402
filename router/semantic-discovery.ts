/**
 * Semantic Capability Discovery
 * 
 * This is a key differentiator - agents can discover capabilities
 * using natural language queries instead of knowing exact capability IDs.
 * 
 * Example: "I need to swap tokens privately" → cap.confidential.swap.v1
 * Example: "Prove my balance without revealing it" → cap.zk.proof.v1
 * 
 * This makes CAP-402 the "Google for agent capabilities"
 */

import { CORE_CAPABILITIES, Capability } from '../spec/capabilities';

interface DiscoveryResult {
  capability: Capability;
  relevance_score: number;
  match_reasons: string[];
}

interface SemanticQuery {
  query: string;
  filters?: {
    mode?: 'public' | 'confidential';
    max_cost?: number;
    tags?: string[];
    provider?: string;
  };
  agent_context?: {
    agent_id?: string;
    capabilities_used?: string[];
    trust_level?: string;
    specialization?: string;
  };
  limit?: number;
}

class SemanticDiscoveryEngine {
  private capabilities: Capability[] = CORE_CAPABILITIES;

  // Keyword mappings for semantic matching
  private semanticMappings: Map<string, string[]> = new Map([
    ['swap', ['swap', 'exchange', 'trade', 'convert', 'dex']],
    ['price', ['price', 'cost', 'value', 'quote', 'rate']],
    ['wallet', ['wallet', 'balance', 'holdings', 'portfolio', 'assets']],
    ['private', ['private', 'confidential', 'hidden', 'secret', 'encrypted']],
    ['proof', ['proof', 'prove', 'verify', 'attest', 'zk', 'zero-knowledge']],
    ['message', ['message', 'send', 'communicate', 'notify', 'chat']],
    ['transfer', ['transfer', 'send', 'move', 'pay', 'remit']],
    ['governance', ['governance', 'vote', 'dao', 'proposal', 'decision']],
    ['trade', ['trade', 'order', 'buy', 'sell', 'market']],
    ['compute', ['compute', 'calculate', 'process', 'fhe', 'homomorphic']],
    ['token', ['token', 'coin', 'asset', 'currency', 'spl']],
    ['nft', ['nft', 'collectible', 'art', 'digital asset']],
    ['kyc', ['kyc', 'identity', 'compliance', 'verification']],
    ['balance', ['balance', 'amount', 'holdings', 'funds']]
  ]);

  /**
   * Discover capabilities using natural language
   */
  async discover(query: SemanticQuery): Promise<DiscoveryResult[]> {
    const results: DiscoveryResult[] = [];
    const queryLower = query.query.toLowerCase();
    const queryWords = queryLower.split(/\s+/);

    for (const capability of this.capabilities) {
      const score = this.calculateRelevance(capability, queryWords, queryLower);
      const matchReasons = this.getMatchReasons(capability, queryWords, queryLower);

      // Apply filters
      if (query.filters) {
        if (query.filters.mode && capability.execution.mode !== query.filters.mode) {
          continue;
        }
        if (query.filters.max_cost && capability.economics.cost_hint > query.filters.max_cost) {
          continue;
        }
        if (query.filters.tags && capability.metadata?.tags) {
          const hasTag = query.filters.tags.some(t => 
            capability.metadata?.tags?.includes(t)
          );
          if (!hasTag) continue;
        }
      }

      if (score > 0) {
        results.push({
          capability,
          relevance_score: score,
          match_reasons: matchReasons
        });
      }
    }

    // Sort by relevance and limit
    results.sort((a, b) => b.relevance_score - a.relevance_score);
    return results.slice(0, query.limit || 5);
  }

  /**
   * Get capability recommendations based on context
   */
  async recommend(context: {
    recent_capabilities?: string[];
    agent_type?: string;
    use_case?: string;
  }): Promise<DiscoveryResult[]> {
    const recommendations: DiscoveryResult[] = [];

    // Recommend based on use case
    if (context.use_case) {
      const useCaseCapabilities = this.getCapabilitiesForUseCase(context.use_case);
      for (const cap of useCaseCapabilities) {
        recommendations.push({
          capability: cap,
          relevance_score: 0.9,
          match_reasons: [`Recommended for ${context.use_case} use case`]
        });
      }
    }

    // Recommend complementary capabilities based on recent usage
    if (context.recent_capabilities && context.recent_capabilities.length > 0) {
      const complementary = this.getComplementaryCapabilities(context.recent_capabilities);
      for (const cap of complementary) {
        recommendations.push({
          capability: cap,
          relevance_score: 0.8,
          match_reasons: ['Commonly used together with your recent capabilities']
        });
      }
    }

    return recommendations.slice(0, 5);
  }

  /**
   * Get capability by intent
   */
  async resolveIntent(intent: string): Promise<Capability | null> {
    const results = await this.discover({ query: intent, limit: 1 });
    return results.length > 0 ? results[0].capability : null;
  }

  private calculateRelevance(
    capability: Capability,
    queryWords: string[],
    fullQuery: string
  ): number {
    let score = 0;

    // Check name match
    const nameLower = capability.name.toLowerCase();
    for (const word of queryWords) {
      if (nameLower.includes(word)) score += 3;
    }

    // Check description match
    const descLower = capability.description.toLowerCase();
    for (const word of queryWords) {
      if (descLower.includes(word)) score += 2;
    }

    // Check tags match
    if (capability.metadata?.tags) {
      for (const tag of capability.metadata.tags) {
        for (const word of queryWords) {
          if (tag.includes(word)) score += 2;
        }
      }
    }

    // Check semantic mappings
    for (const [concept, synonyms] of this.semanticMappings) {
      const queryHasConcept = synonyms.some(s => fullQuery.includes(s));
      const capHasConcept = 
        capability.name.toLowerCase().includes(concept) ||
        capability.description.toLowerCase().includes(concept) ||
        capability.metadata?.tags?.some(t => t.includes(concept));

      if (queryHasConcept && capHasConcept) {
        score += 4;
      }
    }

    // Boost for privacy-related queries matching confidential capabilities
    const privacyTerms = ['private', 'confidential', 'hidden', 'secret', 'encrypted', 'zk'];
    const queryWantsPrivacy = privacyTerms.some(t => fullQuery.includes(t));
    if (queryWantsPrivacy && capability.execution.mode === 'confidential') {
      score += 5;
    }

    return score;
  }

  private getMatchReasons(
    capability: Capability,
    queryWords: string[],
    fullQuery: string
  ): string[] {
    const reasons: string[] = [];

    // Name match
    const nameLower = capability.name.toLowerCase();
    const nameMatches = queryWords.filter(w => nameLower.includes(w));
    if (nameMatches.length > 0) {
      reasons.push(`Name matches: ${nameMatches.join(', ')}`);
    }

    // Tag match
    if (capability.metadata?.tags) {
      const tagMatches = capability.metadata.tags.filter(tag =>
        queryWords.some(w => tag.includes(w))
      );
      if (tagMatches.length > 0) {
        reasons.push(`Tags match: ${tagMatches.join(', ')}`);
      }
    }

    // Privacy match
    const privacyTerms = ['private', 'confidential', 'hidden', 'secret', 'encrypted'];
    if (privacyTerms.some(t => fullQuery.includes(t)) && capability.execution.mode === 'confidential') {
      reasons.push('Supports confidential execution');
    }

    return reasons;
  }

  private getCapabilitiesForUseCase(useCase: string): Capability[] {
    const useCaseMap: Record<string, string[]> = {
      'trading': ['cap.price.lookup.v1', 'cap.swap.execute.v1', 'cap.confidential.swap.v1'],
      'defi': ['cap.swap.execute.v1', 'cap.confidential.swap.v1', 'cap.cspl.wrap.v1'],
      'privacy': ['cap.confidential.swap.v1', 'cap.zk.proof.v1', 'cap.lightning.message.v1'],
      'compliance': ['cap.zk.proof.v1', 'cap.document.parse.v1'],
      'messaging': ['cap.lightning.message.v1'],
      'governance': ['cap.private.governance.v1', 'cap.zk.proof.v1'],
      'portfolio': ['cap.wallet.snapshot.v1', 'cap.price.lookup.v1']
    };

    const capIds = useCaseMap[useCase.toLowerCase()] || [];
    return this.capabilities.filter(c => capIds.includes(c.id));
  }

  private getComplementaryCapabilities(recentIds: string[]): Capability[] {
    const complementaryMap: Record<string, string[]> = {
      'cap.price.lookup.v1': ['cap.swap.execute.v1', 'cap.wallet.snapshot.v1'],
      'cap.wallet.snapshot.v1': ['cap.price.lookup.v1', 'cap.cspl.wrap.v1'],
      'cap.swap.execute.v1': ['cap.price.lookup.v1', 'cap.confidential.swap.v1'],
      'cap.confidential.swap.v1': ['cap.cspl.wrap.v1', 'cap.zk.proof.v1'],
      'cap.zk.proof.v1': ['cap.confidential.swap.v1', 'cap.private.governance.v1'],
      'cap.cspl.wrap.v1': ['cap.cspl.transfer.v1', 'cap.confidential.swap.v1']
    };

    const complementaryIds = new Set<string>();
    for (const id of recentIds) {
      const complements = complementaryMap[id] || [];
      complements.forEach(c => complementaryIds.add(c));
    }

    // Remove already used capabilities
    recentIds.forEach(id => complementaryIds.delete(id));

    return this.capabilities.filter(c => complementaryIds.has(c.id));
  }

  /**
   * Discover capabilities with agent context awareness
   * Boosts results based on what similar agents use
   */
  async discoverForAgent(
    query: string,
    agentContext: {
      agent_id: string;
      capabilities_used: string[];
      trust_level: string;
      specialization?: string;
    }
  ): Promise<DiscoveryResult[]> {
    // Get base results
    const baseResults = await this.discover({ query, limit: 10 });

    // Boost based on agent context
    for (const result of baseResults) {
      // Boost if capability matches agent's specialization
      if (agentContext.specialization) {
        const specMap: Record<string, string[]> = {
          'trading': ['cap.price.lookup.v1', 'cap.swap.execute.v1', 'cap.confidential.swap.v1'],
          'privacy': ['cap.zk.proof.v1', 'cap.confidential.swap.v1', 'cap.cspl.wrap.v1', 'cap.fhe.compute.v1'],
          'research': ['cap.price.lookup.v1', 'cap.wallet.snapshot.v1'],
          'governance': ['cap.private.governance.v1', 'cap.zk.proof.v1']
        };
        const specCaps = specMap[agentContext.specialization] || [];
        if (specCaps.includes(result.capability.id)) {
          result.relevance_score += 3;
          result.match_reasons.push(`Matches your ${agentContext.specialization} specialization`);
        }
      }

      // Boost complementary capabilities
      if (agentContext.capabilities_used.length > 0) {
        const complementary = this.getComplementaryCapabilities(agentContext.capabilities_used);
        if (complementary.some(c => c.id === result.capability.id)) {
          result.relevance_score += 2;
          result.match_reasons.push('Complements your recent capability usage');
        }
      }

      // Adjust for trust level (higher trust = access to confidential)
      if (result.capability.execution.mode === 'confidential') {
        if (agentContext.trust_level === 'premium' || agentContext.trust_level === 'trusted') {
          result.relevance_score += 1;
          result.match_reasons.push('Available at your trust level');
        } else {
          result.relevance_score -= 2;
          result.match_reasons.push('Requires higher trust level');
        }
      }
    }

    // Re-sort after boosting
    baseResults.sort((a, b) => b.relevance_score - a.relevance_score);
    return baseResults.slice(0, 5);
  }

  /**
   * Get personalized recommendations for an agent
   */
  async getAgentRecommendations(agentContext: {
    agent_id: string;
    capabilities_used: string[];
    trust_level: string;
    recent_queries?: string[];
  }): Promise<{
    next_capabilities: DiscoveryResult[];
    upgrade_path: string[];
    similar_agents_use: string[];
  }> {
    // Get complementary capabilities
    const complementary = this.getComplementaryCapabilities(agentContext.capabilities_used);
    const nextCapabilities: DiscoveryResult[] = complementary.map(cap => ({
      capability: cap,
      relevance_score: 0.85,
      match_reasons: ['Commonly used with your current capabilities']
    }));

    // Suggest upgrade path based on trust level
    const upgradePath: string[] = [];
    if (agentContext.trust_level === 'anonymous') {
      upgradePath.push('Verify email to unlock cap.wallet.snapshot.v1 with full history');
      upgradePath.push('Complete KYC to access confidential capabilities');
    } else if (agentContext.trust_level === 'verified') {
      upgradePath.push('Complete KYC to unlock cap.confidential.swap.v1');
      upgradePath.push('Build reputation to access premium capabilities');
    }

    // Simulate what similar agents use (based on capabilities overlap)
    const similarAgentsUse: string[] = [];
    if (agentContext.capabilities_used.includes('cap.price.lookup.v1')) {
      similarAgentsUse.push('cap.swap.execute.v1', 'cap.wallet.snapshot.v1');
    }
    if (agentContext.capabilities_used.includes('cap.zk.proof.v1')) {
      similarAgentsUse.push('cap.confidential.swap.v1', 'cap.cspl.wrap.v1');
    }

    return {
      next_capabilities: nextCapabilities.slice(0, 3),
      upgrade_path: upgradePath,
      similar_agents_use: [...new Set(similarAgentsUse)].filter(
        id => !agentContext.capabilities_used.includes(id)
      )
    };
  }
}

export const semanticDiscovery = new SemanticDiscoveryEngine();
