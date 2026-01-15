/**
 * Agent Achievements System
 * 
 * Gamification layer for agents:
 * - Unlock achievements for milestones
 * - Earn XP for activities
 * - Level up with rewards
 * - Compete on leaderboards
 * - Unlock special capabilities at higher levels
 */

import { activityFeed } from './activity-feed';

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'invocations' | 'social' | 'trust' | 'exploration' | 'special';
  xp_reward: number;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  requirement: AchievementRequirement;
  unlocked_benefit?: string;
}

export interface AchievementRequirement {
  type: 'count' | 'streak' | 'unique' | 'threshold' | 'combination';
  metric: string;
  target: number;
  timeframe_hours?: number;
}

export interface AgentProgress {
  agent_id: string;
  level: number;
  xp: number;
  xp_to_next_level: number;
  achievements_unlocked: string[];
  achievement_progress: Record<string, number>;
  streaks: Record<string, { count: number; last_activity: number }>;
  stats: AgentStats;
  created_at: number;
  updated_at: number;
}

export interface AgentStats {
  total_invocations: number;
  successful_invocations: number;
  unique_capabilities_used: Set<string>;
  unique_agents_interacted: Set<string>;
  delegations_created: number;
  delegations_received: number;
  messages_sent: number;
  workflows_completed: number;
  marketplace_purchases: number;
  marketplace_sales: number;
  endorsements_given: number;
  endorsements_received: number;
}

// XP required for each level (exponential growth)
const LEVEL_XP = [
  0, 100, 250, 500, 1000, 2000, 4000, 8000, 16000, 32000, // 1-10
  50000, 75000, 100000, 150000, 200000, 300000, 500000, 750000, 1000000, 2000000 // 11-20
];

// All available achievements
const ACHIEVEMENTS: Achievement[] = [
  // Invocation achievements
  {
    id: 'first_invoke',
    name: 'First Steps',
    description: 'Complete your first capability invocation',
    icon: '🚀',
    category: 'invocations',
    xp_reward: 10,
    rarity: 'common',
    requirement: { type: 'count', metric: 'invocations', target: 1 }
  },
  {
    id: 'invoke_10',
    name: 'Getting Started',
    description: 'Complete 10 capability invocations',
    icon: '⚡',
    category: 'invocations',
    xp_reward: 50,
    rarity: 'common',
    requirement: { type: 'count', metric: 'invocations', target: 10 }
  },
  {
    id: 'invoke_100',
    name: 'Power User',
    description: 'Complete 100 capability invocations',
    icon: '💪',
    category: 'invocations',
    xp_reward: 200,
    rarity: 'uncommon',
    requirement: { type: 'count', metric: 'invocations', target: 100 }
  },
  {
    id: 'invoke_1000',
    name: 'Capability Master',
    description: 'Complete 1,000 capability invocations',
    icon: '🏆',
    category: 'invocations',
    xp_reward: 1000,
    rarity: 'rare',
    requirement: { type: 'count', metric: 'invocations', target: 1000 },
    unlocked_benefit: 'Priority queue access'
  },
  {
    id: 'perfect_streak_10',
    name: 'Flawless',
    description: '10 successful invocations in a row',
    icon: '✨',
    category: 'invocations',
    xp_reward: 100,
    rarity: 'uncommon',
    requirement: { type: 'streak', metric: 'success_streak', target: 10 }
  },
  {
    id: 'perfect_streak_100',
    name: 'Unstoppable',
    description: '100 successful invocations in a row',
    icon: '🔥',
    category: 'invocations',
    xp_reward: 500,
    rarity: 'rare',
    requirement: { type: 'streak', metric: 'success_streak', target: 100 },
    unlocked_benefit: 'Reduced rate limits'
  },
  
  // Exploration achievements
  {
    id: 'explorer_5',
    name: 'Explorer',
    description: 'Use 5 different capabilities',
    icon: '🔍',
    category: 'exploration',
    xp_reward: 75,
    rarity: 'common',
    requirement: { type: 'unique', metric: 'capabilities_used', target: 5 }
  },
  {
    id: 'explorer_all',
    name: 'Completionist',
    description: 'Use all available capabilities',
    icon: '🌟',
    category: 'exploration',
    xp_reward: 2000,
    rarity: 'legendary',
    requirement: { type: 'unique', metric: 'capabilities_used', target: 13 },
    unlocked_benefit: 'Exclusive beta features'
  },
  {
    id: 'privacy_pioneer',
    name: 'Privacy Pioneer',
    description: 'Use 3 confidential capabilities',
    icon: '🔒',
    category: 'exploration',
    xp_reward: 150,
    rarity: 'uncommon',
    requirement: { type: 'unique', metric: 'confidential_caps_used', target: 3 }
  },
  
  // Social achievements
  {
    id: 'social_butterfly',
    name: 'Social Butterfly',
    description: 'Interact with 10 different agents',
    icon: '🦋',
    category: 'social',
    xp_reward: 100,
    rarity: 'uncommon',
    requirement: { type: 'unique', metric: 'agents_interacted', target: 10 }
  },
  {
    id: 'delegator',
    name: 'Delegator',
    description: 'Create 5 capability delegations',
    icon: '🤝',
    category: 'social',
    xp_reward: 150,
    rarity: 'uncommon',
    requirement: { type: 'count', metric: 'delegations_created', target: 5 }
  },
  {
    id: 'trusted_partner',
    name: 'Trusted Partner',
    description: 'Receive 10 delegations from other agents',
    icon: '🏅',
    category: 'social',
    xp_reward: 300,
    rarity: 'rare',
    requirement: { type: 'count', metric: 'delegations_received', target: 10 }
  },
  {
    id: 'endorser',
    name: 'Community Builder',
    description: 'Endorse 5 other agents',
    icon: '👍',
    category: 'social',
    xp_reward: 100,
    rarity: 'uncommon',
    requirement: { type: 'count', metric: 'endorsements_given', target: 5 }
  },
  {
    id: 'well_endorsed',
    name: 'Well Respected',
    description: 'Receive 10 endorsements',
    icon: '⭐',
    category: 'social',
    xp_reward: 500,
    rarity: 'rare',
    requirement: { type: 'count', metric: 'endorsements_received', target: 10 },
    unlocked_benefit: 'Verified badge'
  },
  
  // Trust achievements
  {
    id: 'trust_50',
    name: 'Trustworthy',
    description: 'Reach trust score of 50',
    icon: '🛡️',
    category: 'trust',
    xp_reward: 200,
    rarity: 'uncommon',
    requirement: { type: 'threshold', metric: 'trust_score', target: 50 }
  },
  {
    id: 'trust_80',
    name: 'Highly Trusted',
    description: 'Reach trust score of 80',
    icon: '💎',
    category: 'trust',
    xp_reward: 500,
    rarity: 'rare',
    requirement: { type: 'threshold', metric: 'trust_score', target: 80 }
  },
  {
    id: 'trust_95',
    name: 'Elite Status',
    description: 'Reach trust score of 95',
    icon: '👑',
    category: 'trust',
    xp_reward: 2000,
    rarity: 'legendary',
    requirement: { type: 'threshold', metric: 'trust_score', target: 95 },
    unlocked_benefit: 'Premium tier access'
  },
  
  // Special achievements
  {
    id: 'workflow_master',
    name: 'Workflow Master',
    description: 'Complete 10 multi-agent workflows',
    icon: '🔄',
    category: 'special',
    xp_reward: 400,
    rarity: 'rare',
    requirement: { type: 'count', metric: 'workflows_completed', target: 10 }
  },
  {
    id: 'marketplace_seller',
    name: 'Entrepreneur',
    description: 'Make 5 marketplace sales',
    icon: '💰',
    category: 'special',
    xp_reward: 300,
    rarity: 'rare',
    requirement: { type: 'count', metric: 'marketplace_sales', target: 5 }
  },
  {
    id: 'early_adopter',
    name: 'Early Adopter',
    description: 'One of the first 100 agents',
    icon: '🌅',
    category: 'special',
    xp_reward: 500,
    rarity: 'epic',
    requirement: { type: 'threshold', metric: 'registration_order', target: 100 }
  },
  {
    id: 'daily_active_7',
    name: 'Dedicated',
    description: 'Active for 7 consecutive days',
    icon: '📅',
    category: 'special',
    xp_reward: 200,
    rarity: 'uncommon',
    requirement: { type: 'streak', metric: 'daily_active', target: 7 }
  },
  {
    id: 'daily_active_30',
    name: 'Committed',
    description: 'Active for 30 consecutive days',
    icon: '🗓️',
    category: 'special',
    xp_reward: 1000,
    rarity: 'epic',
    requirement: { type: 'streak', metric: 'daily_active', target: 30 },
    unlocked_benefit: 'Monthly bonus XP'
  }
];

class AgentAchievementsManager {
  private progress: Map<string, AgentProgress> = new Map();
  private registrationOrder = 0;

  /**
   * Initialize or get agent progress
   */
  getOrCreateProgress(agentId: string): AgentProgress {
    let prog = this.progress.get(agentId);
    if (!prog) {
      this.registrationOrder++;
      prog = {
        agent_id: agentId,
        level: 1,
        xp: 0,
        xp_to_next_level: LEVEL_XP[1],
        achievements_unlocked: [],
        achievement_progress: {},
        streaks: {},
        stats: {
          total_invocations: 0,
          successful_invocations: 0,
          unique_capabilities_used: new Set(),
          unique_agents_interacted: new Set(),
          delegations_created: 0,
          delegations_received: 0,
          messages_sent: 0,
          workflows_completed: 0,
          marketplace_purchases: 0,
          marketplace_sales: 0,
          endorsements_given: 0,
          endorsements_received: 0
        },
        created_at: Date.now(),
        updated_at: Date.now()
      };
      
      // Check early adopter achievement
      if (this.registrationOrder <= 100) {
        prog.achievement_progress['registration_order'] = this.registrationOrder;
      }
      
      this.progress.set(agentId, prog);
    }
    return prog;
  }

  /**
   * Record an activity and check for achievements
   */
  recordActivity(
    agentId: string,
    activity: {
      type: 'invocation' | 'delegation' | 'message' | 'workflow' | 'marketplace' | 'endorsement';
      success?: boolean;
      capability_id?: string;
      other_agent?: string;
      is_sale?: boolean;
    }
  ): { xp_earned: number; achievements_unlocked: Achievement[]; level_up: boolean } {
    const prog = this.getOrCreateProgress(agentId);
    let xpEarned = 0;
    const unlockedAchievements: Achievement[] = [];
    const oldLevel = prog.level;

    // Update stats based on activity type
    switch (activity.type) {
      case 'invocation':
        prog.stats.total_invocations++;
        if (activity.success) {
          prog.stats.successful_invocations++;
          this.updateStreak(prog, 'success_streak', true);
          xpEarned += 1; // Base XP for successful invocation
        } else {
          this.updateStreak(prog, 'success_streak', false);
        }
        if (activity.capability_id) {
          prog.stats.unique_capabilities_used.add(activity.capability_id);
          if (activity.capability_id.includes('confidential') || 
              activity.capability_id.includes('zk') ||
              activity.capability_id.includes('cspl')) {
            prog.achievement_progress['confidential_caps_used'] = 
              (prog.achievement_progress['confidential_caps_used'] || 0) + 1;
          }
        }
        break;
        
      case 'delegation':
        if (activity.other_agent) {
          prog.stats.unique_agents_interacted.add(activity.other_agent);
          if (activity.is_sale) {
            prog.stats.delegations_received++;
          } else {
            prog.stats.delegations_created++;
          }
        }
        xpEarned += 5;
        break;
        
      case 'message':
        if (activity.other_agent) {
          prog.stats.unique_agents_interacted.add(activity.other_agent);
        }
        prog.stats.messages_sent++;
        xpEarned += 2;
        break;
        
      case 'workflow':
        prog.stats.workflows_completed++;
        xpEarned += 20;
        break;
        
      case 'marketplace':
        if (activity.is_sale) {
          prog.stats.marketplace_sales++;
          xpEarned += 15;
        } else {
          prog.stats.marketplace_purchases++;
          xpEarned += 5;
        }
        break;
        
      case 'endorsement':
        if (activity.is_sale) {
          prog.stats.endorsements_received++;
          xpEarned += 10;
        } else {
          prog.stats.endorsements_given++;
          xpEarned += 5;
        }
        break;
    }

    // Update daily active streak
    this.updateStreak(prog, 'daily_active', true);

    // Update achievement progress
    prog.achievement_progress['invocations'] = prog.stats.total_invocations;
    prog.achievement_progress['capabilities_used'] = prog.stats.unique_capabilities_used.size;
    prog.achievement_progress['agents_interacted'] = prog.stats.unique_agents_interacted.size;
    prog.achievement_progress['delegations_created'] = prog.stats.delegations_created;
    prog.achievement_progress['delegations_received'] = prog.stats.delegations_received;
    prog.achievement_progress['endorsements_given'] = prog.stats.endorsements_given;
    prog.achievement_progress['endorsements_received'] = prog.stats.endorsements_received;
    prog.achievement_progress['workflows_completed'] = prog.stats.workflows_completed;
    prog.achievement_progress['marketplace_sales'] = prog.stats.marketplace_sales;

    // Check for newly unlocked achievements
    for (const achievement of ACHIEVEMENTS) {
      if (!prog.achievements_unlocked.includes(achievement.id)) {
        if (this.checkAchievement(prog, achievement)) {
          prog.achievements_unlocked.push(achievement.id);
          xpEarned += achievement.xp_reward;
          unlockedAchievements.push(achievement);
          
          // Record achievement in activity feed
          activityFeed.record('badge_earned', agentId, {
            achievement_id: achievement.id,
            achievement_name: achievement.name,
            xp_reward: achievement.xp_reward,
            rarity: achievement.rarity
          });
        }
      }
    }

    // Add XP and check for level up
    prog.xp += xpEarned;
    while (prog.level < LEVEL_XP.length - 1 && prog.xp >= LEVEL_XP[prog.level]) {
      prog.level++;
      prog.xp_to_next_level = LEVEL_XP[prog.level] || prog.xp_to_next_level * 2;
    }

    prog.updated_at = Date.now();

    return {
      xp_earned: xpEarned,
      achievements_unlocked: unlockedAchievements,
      level_up: prog.level > oldLevel
    };
  }

  private checkAchievement(prog: AgentProgress, achievement: Achievement): boolean {
    const req = achievement.requirement;
    const progress = prog.achievement_progress[req.metric] || 0;
    
    switch (req.type) {
      case 'count':
      case 'threshold':
      case 'unique':
        return progress >= req.target;
        
      case 'streak':
        const streak = prog.streaks[req.metric];
        return streak ? streak.count >= req.target : false;
        
      default:
        return false;
    }
  }

  private updateStreak(prog: AgentProgress, streakType: string, success: boolean): void {
    const now = Date.now();
    const streak = prog.streaks[streakType] || { count: 0, last_activity: 0 };
    
    if (streakType === 'daily_active') {
      const lastDay = new Date(streak.last_activity).toDateString();
      const today = new Date(now).toDateString();
      const yesterday = new Date(now - 86400000).toDateString();
      
      if (lastDay === today) {
        // Already active today, no change
      } else if (lastDay === yesterday) {
        // Consecutive day
        streak.count++;
        streak.last_activity = now;
      } else {
        // Streak broken
        streak.count = 1;
        streak.last_activity = now;
      }
    } else {
      // Success streak
      if (success) {
        streak.count++;
        streak.last_activity = now;
      } else {
        streak.count = 0;
      }
    }
    
    prog.streaks[streakType] = streak;
    prog.achievement_progress[streakType] = streak.count;
  }

  /**
   * Get agent's full achievement profile
   */
  getProfile(agentId: string): {
    level: number;
    xp: number;
    xp_to_next_level: number;
    xp_progress_percent: number;
    achievements: Array<Achievement & { unlocked: boolean; progress?: number }>;
    stats: Record<string, number>;
    streaks: Record<string, number>;
    rank?: number;
  } {
    const prog = this.getOrCreateProgress(agentId);
    
    const achievements = ACHIEVEMENTS.map(a => ({
      ...a,
      unlocked: prog.achievements_unlocked.includes(a.id),
      progress: prog.achievement_progress[a.requirement.metric]
    }));

    const xpForCurrentLevel = prog.level > 1 ? LEVEL_XP[prog.level - 1] : 0;
    const xpNeeded = prog.xp_to_next_level - xpForCurrentLevel;
    const xpProgress = prog.xp - xpForCurrentLevel;

    return {
      level: prog.level,
      xp: prog.xp,
      xp_to_next_level: prog.xp_to_next_level,
      xp_progress_percent: Math.round((xpProgress / xpNeeded) * 100),
      achievements,
      stats: {
        total_invocations: prog.stats.total_invocations,
        successful_invocations: prog.stats.successful_invocations,
        unique_capabilities: prog.stats.unique_capabilities_used.size,
        unique_agents: prog.stats.unique_agents_interacted.size,
        workflows_completed: prog.stats.workflows_completed,
        achievements_unlocked: prog.achievements_unlocked.length
      },
      streaks: Object.fromEntries(
        Object.entries(prog.streaks).map(([k, v]) => [k, v.count])
      ),
      rank: this.getRank(agentId)
    };
  }

  /**
   * Get XP leaderboard
   */
  getLeaderboard(limit: number = 10): Array<{
    rank: number;
    agent_id: string;
    level: number;
    xp: number;
    achievements_count: number;
  }> {
    const sorted = Array.from(this.progress.values())
      .sort((a, b) => b.xp - a.xp)
      .slice(0, limit);

    return sorted.map((p, i) => ({
      rank: i + 1,
      agent_id: p.agent_id,
      level: p.level,
      xp: p.xp,
      achievements_count: p.achievements_unlocked.length
    }));
  }

  private getRank(agentId: string): number {
    const sorted = Array.from(this.progress.values())
      .sort((a, b) => b.xp - a.xp);
    return sorted.findIndex(p => p.agent_id === agentId) + 1;
  }

  /**
   * Get all achievements
   */
  getAllAchievements(): Achievement[] {
    return ACHIEVEMENTS;
  }

  /**
   * Update trust score for achievements
   */
  updateTrustScore(agentId: string, trustScore: number): void {
    const prog = this.getOrCreateProgress(agentId);
    prog.achievement_progress['trust_score'] = trustScore;
  }
}

export const agentAchievements = new AgentAchievementsManager();
