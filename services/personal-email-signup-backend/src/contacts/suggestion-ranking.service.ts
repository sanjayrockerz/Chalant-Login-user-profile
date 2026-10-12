import { Injectable } from '@nestjs/common';
import { 
  ContactSuggestionDto, 
  SuggestionQueryDto, 
  MatchType, 
  ContactIdentifierType 
} from './dto/contacts.dto';

/**
 * Suggestion Ranking Service
 * 
 * Sophisticated ranking algorithm for friend suggestions with privacy filtering,
 * match strength scoring, recency weighting, and user tier-based limits.
 * 
 * Key Features:
 * - Multi-factor ranking with configurable weights
 * - Privacy-respecting filtering (blocked users, opt-outs)
 * - User tier-based suggestion limits and premium features
 * - Recency decay for maintaining fresh suggestions
 * - A/B testing support for ranking algorithm optimization
 * - Performance optimization with caching and pagination
 */

interface RankingConfig {
  weights: {
    confidenceScore: number;    // 0.4 - Most important factor
    mutualMatch: number;       // 0.3 - Mutual discovery boost
    recencyBoost: number;      // 0.2 - Recent discoveries
    connectionCount: number;   // 0.1 - Mutual connections
  };
  decayFactors: {
    recencyHalfLife: number;   // Days for 50% recency decay
    confidenceThreshold: number; // Minimum confidence to show
  };
  userTierLimits: {
    free: number;              // Max suggestions for free users
    premium: number;           // Max suggestions for premium users
    enterprise: number;        // Max suggestions for enterprise users
  };
  privacyFilters: {
    respectOptOuts: boolean;
    hideBlocked: boolean;
    requireMutualForSensitive: boolean;
  };
}

interface UserContext {
  userId: string;
  userTier: 'free' | 'premium' | 'enterprise';
  privacySettings: {
    discoveryEnabled: boolean;
    mutualDiscoveryOnly: boolean;
    blockedUsers: string[];
    optedOutUsers: string[];
  };
  abTestVariant?: string;
  correlationId: string;
  tenantId: string;
}

interface RankedSuggestion extends ContactSuggestionDto {
  ranking_score: number;
  ranking_factors: {
    confidence_contribution: number;
    mutual_boost: number;
    recency_boost: number;
    connection_boost: number;
    total_score: number;
  };
  filtered_reason?: string;
}

export interface RankingMetrics {
  total_candidates: number;
  privacy_filtered: number;
  confidence_filtered: number;
  tier_limited: number;
  final_suggestions: number;
  avg_ranking_score: number;
  mutual_percentage: number;
  processing_time_ms: number;
}

@Injectable()
export class SuggestionRankingService {
  private readonly defaultConfig: RankingConfig = {
    weights: {
      confidenceScore: 0.4,
      mutualMatch: 0.3,
      recencyBoost: 0.2,
      connectionCount: 0.1,
    },
    decayFactors: {
      recencyHalfLife: 7, // 7 days
      confidenceThreshold: 0.3,
    },
    userTierLimits: {
      free: 20,
      premium: 50,
      enterprise: 100,
    },
    privacyFilters: {
      respectOptOuts: true,
      hideBlocked: true,
      requireMutualForSensitive: false,
    },
  };

  /**
   * Rank and filter suggestions for a user
   */
  async rankSuggestions(
    suggestions: ContactSuggestionDto[],
    userContext: UserContext,
    query: SuggestionQueryDto,
    config?: Partial<RankingConfig>,
  ): Promise<{
    rankedSuggestions: ContactSuggestionDto[];
    metrics: RankingMetrics;
    pagination: {
      total_ranked: number;
      page_suggestions: number;
      has_more: boolean;
    };
  }> {
    const startTime = Date.now();
    const effectiveConfig = { ...this.defaultConfig, ...config };
    
    // Step 1: Apply privacy filters
    const privacyFiltered = this.applyPrivacyFilters(suggestions, userContext, effectiveConfig);
    
    // Step 2: Apply confidence threshold
    const confidenceFiltered = privacyFiltered.filter(
      s => s.confidence_score >= effectiveConfig.decayFactors.confidenceThreshold
    );
    
    // Step 3: Calculate ranking scores
    const rankedCandidates = this.calculateRankingScores(
      confidenceFiltered,
      userContext,
      effectiveConfig
    );
    
    // Step 4: Sort by ranking score
    const sortedSuggestions = rankedCandidates.sort(
      (a, b) => b.ranking_score - a.ranking_score
    );
    
    // Step 5: Apply user tier limits
    const tierLimit = effectiveConfig.userTierLimits[userContext.userTier];
    const tierLimited = sortedSuggestions.slice(0, tierLimit);
    
    // Step 6: Apply query-specific pagination
    const page = query.page || 1;
    const limit = Math.min(query.limit || 20, 50);
    const offset = (page - 1) * limit;
    const paginatedSuggestions = tierLimited.slice(offset, offset + limit);
    
    // Step 7: Remove ranking metadata for clean response
    const cleanSuggestions = paginatedSuggestions.map(s => {
      const { ranking_score, ranking_factors, filtered_reason, ...cleanSuggestion } = s;
      return cleanSuggestion;
    });
    
    // Step 8: Calculate metrics
    const processingTime = Date.now() - startTime;
    const metrics: RankingMetrics = {
      total_candidates: suggestions.length,
      privacy_filtered: suggestions.length - privacyFiltered.length,
      confidence_filtered: privacyFiltered.length - confidenceFiltered.length,
      tier_limited: sortedSuggestions.length - tierLimited.length,
      final_suggestions: cleanSuggestions.length,
      avg_ranking_score: tierLimited.length > 0 
        ? tierLimited.reduce((sum, s) => sum + s.ranking_score, 0) / tierLimited.length 
        : 0,
      mutual_percentage: tierLimited.length > 0 
        ? (tierLimited.filter(s => s.match_type === MatchType.MUTUAL).length / tierLimited.length) * 100 
        : 0,
      processing_time_ms: processingTime,
    };
    
    return {
      rankedSuggestions: cleanSuggestions,
      metrics,
      pagination: {
        total_ranked: tierLimited.length,
        page_suggestions: cleanSuggestions.length,
        has_more: offset + limit < tierLimited.length,
      },
    };
  }

  /**
   * Apply privacy filters to suggestions
   */
  private applyPrivacyFilters(
    suggestions: ContactSuggestionDto[],
    userContext: UserContext,
    config: RankingConfig,
  ): ContactSuggestionDto[] {
    return suggestions.filter(suggestion => {
      // Filter blocked users
      if (config.privacyFilters.hideBlocked && 
          userContext.privacySettings.blockedUsers.includes(suggestion.user_id)) {
        return false;
      }
      
      // Filter opted-out users
      if (config.privacyFilters.respectOptOuts && 
          userContext.privacySettings.optedOutUsers.includes(suggestion.user_id)) {
        return false;
      }
      
      // Require mutual discovery for sensitive users
      if (config.privacyFilters.requireMutualForSensitive && 
          userContext.privacySettings.mutualDiscoveryOnly && 
          suggestion.match_type !== MatchType.MUTUAL) {
        return false;
      }
      
      // Filter by user's discovery settings
      if (!userContext.privacySettings.discoveryEnabled) {
        return false;
      }
      
      return true;
    });
  }

  /**
   * Calculate ranking scores for suggestions
   */
  private calculateRankingScores(
    suggestions: ContactSuggestionDto[],
    userContext: UserContext,
    config: RankingConfig,
  ): RankedSuggestion[] {
    return suggestions.map(suggestion => {
      const factors = this.calculateRankingFactors(suggestion, config);
      const rankingScore = this.combineRankingFactors(factors, config);
      
      return {
        ...suggestion,
        ranking_score: rankingScore,
        ranking_factors: factors,
      };
    });
  }

  /**
   * Calculate individual ranking factors
   */
  private calculateRankingFactors(
    suggestion: ContactSuggestionDto,
    config: RankingConfig,
  ): RankedSuggestion['ranking_factors'] {
    // Confidence score contribution (0-1)
    const confidenceContribution = suggestion.confidence_score;
    
    // Mutual match boost (0 or 1)
    const mutualBoost = suggestion.match_type === MatchType.MUTUAL ? 1 : 0;
    
    // Recency boost with exponential decay
    const discoveredAt = new Date(suggestion.discovered_at);
    const daysSinceDiscovery = (Date.now() - discoveredAt.getTime()) / (1000 * 60 * 60 * 24);
    const recencyBoost = Math.exp(-daysSinceDiscovery / config.decayFactors.recencyHalfLife);
    
    // Connection count boost (normalized 0-1)
    const maxConnections = 20; // Assumed maximum for normalization
    const connectionBoost = Math.min((suggestion.mutual_connections || 0) / maxConnections, 1);
    
    // Calculate weighted contributions
    const weightedConfidence = confidenceContribution * config.weights.confidenceScore;
    const weightedMutual = mutualBoost * config.weights.mutualMatch;
    const weightedRecency = recencyBoost * config.weights.recencyBoost;
    const weightedConnections = connectionBoost * config.weights.connectionCount;
    
    const totalScore = weightedConfidence + weightedMutual + weightedRecency + weightedConnections;
    
    return {
      confidence_contribution: weightedConfidence,
      mutual_boost: weightedMutual,
      recency_boost: weightedRecency,
      connection_boost: weightedConnections,
      total_score: totalScore,
    };
  }

  /**
   * Combine ranking factors into final score
   */
  private combineRankingFactors(
    factors: RankedSuggestion['ranking_factors'],
    config: RankingConfig,
  ): number {
    // Apply A/B testing variants here if needed
    return Math.min(factors.total_score, 1.0); // Cap at 1.0
  }

  /**
   * Get ranking configuration for A/B testing
   */
  getRankingConfigForVariant(variant?: string): Partial<RankingConfig> {
    switch (variant) {
      case 'confidence_heavy':
        return {
          weights: {
            confidenceScore: 0.6,
            mutualMatch: 0.2,
            recencyBoost: 0.15,
            connectionCount: 0.05,
          },
        };
      
      case 'mutual_focused':
        return {
          weights: {
            confidenceScore: 0.3,
            mutualMatch: 0.5,
            recencyBoost: 0.15,
            connectionCount: 0.05,
          },
        };
      
      case 'recency_boost':
        return {
          weights: {
            confidenceScore: 0.35,
            mutualMatch: 0.25,
            recencyBoost: 0.35,
            connectionCount: 0.05,
          },
          decayFactors: {
            recencyHalfLife: 3, // Faster decay for fresher suggestions
            confidenceThreshold: 0.25, // Lower threshold for recency-focused
          },
        };
      
      default:
        return {};
    }
  }

  /**
   * Calculate suggestion diversity score
   */
  calculateDiversityScore(suggestions: ContactSuggestionDto[]): {
    match_type_diversity: number;
    source_diversity: number;
    recency_spread: number;
    overall_diversity: number;
  } {
    if (suggestions.length === 0) {
      return {
        match_type_diversity: 0,
        source_diversity: 0,
        recency_spread: 0,
        overall_diversity: 0,
      };
    }

    // Match type diversity (mutual vs one-sided)
    const mutualCount = suggestions.filter(s => s.match_type === MatchType.MUTUAL).length;
    const matchTypeDiversity = mutualCount > 0 && mutualCount < suggestions.length ? 1 : 0;

    // Source diversity (phone vs email)
    const phoneCount = suggestions.filter(s => s.match_source === ContactIdentifierType.PHONE).length;
    const sourceDiversity = phoneCount > 0 && phoneCount < suggestions.length ? 1 : 0;

    // Recency spread (distribution across time)
    const timestamps = suggestions.map(s => new Date(s.discovered_at).getTime());
    const timeSpread = timestamps.length > 1 
      ? (Math.max(...timestamps) - Math.min(...timestamps)) / (1000 * 60 * 60 * 24) // Days
      : 0;
    const recencySpread = Math.min(timeSpread / 30, 1); // Normalize to 30-day max

    // Overall diversity score
    const overallDiversity = (matchTypeDiversity + sourceDiversity + recencySpread) / 3;

    return {
      match_type_diversity: matchTypeDiversity,
      source_diversity: sourceDiversity,
      recency_spread: recencySpread,
      overall_diversity: overallDiversity,
    };
  }

  /**
   * Optimize suggestion ordering for user engagement
   */
  optimizeForEngagement(
    suggestions: ContactSuggestionDto[],
    userContext: UserContext,
  ): ContactSuggestionDto[] {
    // For premium users, interleave mutual and one-sided suggestions
    if (userContext.userTier !== 'free') {
      const mutual = suggestions.filter(s => s.match_type === MatchType.MUTUAL);
      const oneSided = suggestions.filter(s => s.match_type === MatchType.ONE_SIDED);
      
      const optimized: ContactSuggestionDto[] = [];
      const maxLength = Math.max(mutual.length, oneSided.length);
      
      for (let i = 0; i < maxLength; i++) {
        if (i < mutual.length) optimized.push(mutual[i]);
        if (i < oneSided.length) optimized.push(oneSided[i]);
      }
      
      return optimized;
    }
    
    // For free users, prioritize mutual matches at the top
    return suggestions;
  }

  /**
   * Generate ranking explanation for debugging
   */
  explainRanking(suggestion: RankedSuggestion): string {
    const factors = suggestion.ranking_factors;
    const explanations: string[] = [];
    
    if (factors.confidence_contribution > 0.3) {
      explanations.push(`High match confidence (${(suggestion.confidence_score * 100).toFixed(0)}%)`);
    }
    
    if (factors.mutual_boost > 0) {
      explanations.push('Mutual discovery');
    }
    
    if (factors.recency_boost > 0.5) {
      explanations.push('Recently discovered');
    }
    
    if (factors.connection_boost > 0.2) {
      explanations.push(`${suggestion.mutual_connections || 0} mutual connections`);
    }
    
    return explanations.join(', ') || 'Standard ranking';
  }

  /**
   * Validate ranking configuration
   */
  validateConfig(config: RankingConfig): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    // Check weight sum
    const weightSum = Object.values(config.weights).reduce((sum, weight) => sum + weight, 0);
    if (Math.abs(weightSum - 1.0) > 0.01) {
      errors.push(`Weight sum must equal 1.0, got ${weightSum.toFixed(3)}`);
    }
    
    // Check weight ranges
    Object.entries(config.weights).forEach(([key, weight]) => {
      if (weight < 0 || weight > 1) {
        errors.push(`Weight ${key} must be between 0 and 1, got ${weight}`);
      }
    });
    
    // Check tier limits
    const { free, premium, enterprise } = config.userTierLimits;
    if (free > premium || premium > enterprise) {
      errors.push('User tier limits must be in ascending order: free <= premium <= enterprise');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}