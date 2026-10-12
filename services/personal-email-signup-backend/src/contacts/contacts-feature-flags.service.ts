import { Injectable } from "@nestjs/common";

/**
 * Contact Discovery Feature Flag Service
 *
 * Manages staged rollout, A/B testing, and emergency controls for contact discovery features.
 * Integrates with existing feature flag infrastructure for gradual deployment and rollback.
 *
 * Key Features:
 * - Staged rollout with user tier-based access controls
 * - A/B testing for UX flows and ranking algorithms
 * - Emergency kill switches for rapid rollback
 * - User segment targeting and cohort management
 * - Real-time configuration updates without deployment
 * - Comprehensive monitoring and rollback triggers
 */

interface FeatureFlagConfig {
  enabled: boolean;
  rolloutPercentage: number;
  userTiers: Array<"free" | "premium" | "enterprise">;
  tenantWhitelist?: string[];
  tenantBlacklist?: string[];
  minAppVersion?: string;
  maxConcurrentUsers?: number;
  emergencyKillSwitch: boolean;
  rollbackTriggers: {
    errorRateThreshold: number; // Error rate % to trigger rollback
    latencyThreshold: number; // Response time ms to trigger rollback
    optOutRateThreshold: number; // Privacy opt-out % to trigger rollback
  };
}

interface ABTestConfig {
  enabled: boolean;
  variants: Array<{
    name: string;
    weight: number; // Percentage allocation
    config: Record<string, any>;
  }>;
  targetSegments: Array<{
    userTier: "free" | "premium" | "enterprise";
    percentage: number;
  }>;
  duration: {
    startDate: string;
    endDate: string;
  };
  successMetrics: string[];
}

interface UserContext {
  userId: string;
  userTier: "free" | "premium" | "enterprise";
  tenantId: string;
  appVersion: string;
  correlationId: string;
  ipAddress?: string;
  userAgent?: string;
}

interface FeatureFlagEvaluation {
  featureEnabled: boolean;
  variant?: string;
  config?: Record<string, any>;
  reason: string;
  cacheable: boolean;
  ttl: number; // Cache TTL in seconds
}

@Injectable()
export class ContactsFeatureFlagService {
  private readonly flagCache = new Map<string, FeatureFlagEvaluation>();
  private readonly CACHE_TTL = 300; // 5 minutes

  // Feature flag configurations
  private readonly featureFlags: Record<string, FeatureFlagConfig> = {
    contacts_upload: {
      enabled: true,
      rolloutPercentage: 25, // Start with 25% rollout
      userTiers: ["premium", "enterprise"], // Premium users first
      emergencyKillSwitch: false,
      rollbackTriggers: {
        errorRateThreshold: 5.0, // 5% error rate
        latencyThreshold: 10000, // 10 second timeout
        optOutRateThreshold: 15.0, // 15% opt-out rate
      },
    },
    suggestion_ranking_v2: {
      enabled: true,
      rolloutPercentage: 50,
      userTiers: ["free", "premium", "enterprise"],
      emergencyKillSwitch: false,
      rollbackTriggers: {
        errorRateThreshold: 2.0,
        latencyThreshold: 1000,
        optOutRateThreshold: 10.0,
      },
    },
    privacy_transparency_enhanced: {
      enabled: true,
      rolloutPercentage: 100, // Full rollout for privacy features
      userTiers: ["free", "premium", "enterprise"],
      emergencyKillSwitch: false,
      rollbackTriggers: {
        errorRateThreshold: 1.0,
        latencyThreshold: 500,
        optOutRateThreshold: 20.0,
      },
    },
    contact_deduplication_ml: {
      enabled: false, // Not yet ready
      rolloutPercentage: 0,
      userTiers: ["enterprise"], // Enterprise beta only
      emergencyKillSwitch: false,
      rollbackTriggers: {
        errorRateThreshold: 1.0,
        latencyThreshold: 5000,
        optOutRateThreshold: 5.0,
      },
    },
  };

  // A/B test configurations
  private readonly abTests: Record<string, ABTestConfig> = {
    contact_upload_flow: {
      enabled: true,
      variants: [
        {
          name: "permission_first",
          weight: 25,
          config: {
            showPermissionDialogFirst: true,
            educationScreens: 1,
          },
        },
        {
          name: "education_first",
          weight: 50,
          config: {
            showPermissionDialogFirst: false,
            educationScreens: 2,
          },
        },
        {
          name: "social_proof",
          weight: 25,
          config: {
            showPermissionDialogFirst: false,
            educationScreens: 2,
            showSocialProof: true,
          },
        },
      ],
      targetSegments: [
        { userTier: "free", percentage: 100 },
        { userTier: "premium", percentage: 50 },
        { userTier: "enterprise", percentage: 25 },
      ],
      duration: {
        startDate: "2024-01-01T00:00:00Z",
        endDate: "2024-03-01T00:00:00Z",
      },
      successMetrics: ["upload_completion_rate", "suggestion_interaction_rate"],
    },
    ranking_algorithm: {
      enabled: true,
      variants: [
        {
          name: "confidence_heavy",
          weight: 33,
          config: {
            weights: {
              confidenceScore: 0.6,
              mutualMatch: 0.2,
              recencyBoost: 0.15,
              connectionCount: 0.05,
            },
          },
        },
        {
          name: "mutual_focused",
          weight: 33,
          config: {
            weights: {
              confidenceScore: 0.3,
              mutualMatch: 0.5,
              recencyBoost: 0.15,
              connectionCount: 0.05,
            },
          },
        },
        {
          name: "balanced",
          weight: 34,
          config: {
            weights: {
              confidenceScore: 0.4,
              mutualMatch: 0.3,
              recencyBoost: 0.2,
              connectionCount: 0.1,
            },
          },
        },
      ],
      targetSegments: [
        { userTier: "free", percentage: 100 },
        { userTier: "premium", percentage: 100 },
        { userTier: "enterprise", percentage: 100 },
      ],
      duration: {
        startDate: "2024-01-15T00:00:00Z",
        endDate: "2024-02-15T00:00:00Z",
      },
      successMetrics: ["suggestion_acceptance_rate", "diversity_score"],
    },
  };

  /**
   * Evaluate if a feature is enabled for a user
   */
  async evaluateFeatureFlag(
    flagName: string,
    userContext: UserContext,
  ): Promise<FeatureFlagEvaluation> {
    // Check cache first
    const cacheKey = `${flagName}:${userContext.userId}`;
    const cached = this.flagCache.get(cacheKey);
    if (cached && this.isCacheValid(cached)) {
      return cached;
    }

    const config = this.featureFlags[flagName];
    if (!config) {
      const result: FeatureFlagEvaluation = {
        featureEnabled: false,
        reason: "Feature flag not found",
        cacheable: true,
        ttl: this.CACHE_TTL,
      };
      this.flagCache.set(cacheKey, result);
      return result;
    }

    // Check emergency kill switch
    if (config.emergencyKillSwitch) {
      const result: FeatureFlagEvaluation = {
        featureEnabled: false,
        reason: "Emergency kill switch activated",
        cacheable: false, // Don't cache emergency states
        ttl: 0,
      };
      return result;
    }

    // Check if feature is globally enabled
    if (!config.enabled) {
      const result: FeatureFlagEvaluation = {
        featureEnabled: false,
        reason: "Feature globally disabled",
        cacheable: true,
        ttl: this.CACHE_TTL,
      };
      this.flagCache.set(cacheKey, result);
      return result;
    }

    // Check user tier eligibility
    if (!config.userTiers.includes(userContext.userTier)) {
      const result: FeatureFlagEvaluation = {
        featureEnabled: false,
        reason: `User tier ${userContext.userTier} not eligible`,
        cacheable: true,
        ttl: this.CACHE_TTL,
      };
      this.flagCache.set(cacheKey, result);
      return result;
    }

    // Check tenant whitelist/blacklist
    if (
      config.tenantWhitelist &&
      !config.tenantWhitelist.includes(userContext.tenantId)
    ) {
      const result: FeatureFlagEvaluation = {
        featureEnabled: false,
        reason: "Tenant not in whitelist",
        cacheable: true,
        ttl: this.CACHE_TTL,
      };
      this.flagCache.set(cacheKey, result);
      return result;
    }

    if (
      config.tenantBlacklist &&
      config.tenantBlacklist.includes(userContext.tenantId)
    ) {
      const result: FeatureFlagEvaluation = {
        featureEnabled: false,
        reason: "Tenant in blacklist",
        cacheable: true,
        ttl: this.CACHE_TTL,
      };
      this.flagCache.set(cacheKey, result);
      return result;
    }

    // Check rollout percentage
    const userHash = this.calculateUserHash(userContext.userId, flagName);
    const userPercentile = userHash % 100;

    if (userPercentile >= config.rolloutPercentage) {
      const result: FeatureFlagEvaluation = {
        featureEnabled: false,
        reason: `User not in rollout percentage (${config.rolloutPercentage}%)`,
        cacheable: true,
        ttl: this.CACHE_TTL,
      };
      this.flagCache.set(cacheKey, result);
      return result;
    }

    // Feature is enabled for this user
    const result: FeatureFlagEvaluation = {
      featureEnabled: true,
      reason: "Feature enabled for user",
      cacheable: true,
      ttl: this.CACHE_TTL,
    };
    this.flagCache.set(cacheKey, result);
    return result;
  }

  /**
   * Evaluate A/B test variant for a user
   */
  async evaluateABTest(
    testName: string,
    userContext: UserContext,
  ): Promise<FeatureFlagEvaluation> {
    const config = this.abTests[testName];
    if (!config) {
      return {
        featureEnabled: false,
        reason: "A/B test not found",
        cacheable: true,
        ttl: this.CACHE_TTL,
      };
    }

    // Check if test is enabled and active
    if (!config.enabled || !this.isTestActive(config)) {
      return {
        featureEnabled: false,
        reason: "A/B test not active",
        cacheable: true,
        ttl: this.CACHE_TTL,
      };
    }

    // Check user tier targeting
    const tierSegment = config.targetSegments.find(
      (s) => s.userTier === userContext.userTier,
    );
    if (!tierSegment) {
      return {
        featureEnabled: false,
        reason: "User tier not targeted for test",
        cacheable: true,
        ttl: this.CACHE_TTL,
      };
    }

    // Check if user is in the target percentage for their tier
    const userHash = this.calculateUserHash(userContext.userId, testName);
    const userPercentile = userHash % 100;

    if (userPercentile >= tierSegment.percentage) {
      return {
        featureEnabled: false,
        reason: "User not in target segment",
        cacheable: true,
        ttl: this.CACHE_TTL,
      };
    }

    // Assign variant based on hash
    const variant = this.assignVariant(
      config.variants,
      userContext.userId,
      testName,
    );

    return {
      featureEnabled: true,
      variant: variant.name,
      config: variant.config,
      reason: `Assigned to variant: ${variant.name}`,
      cacheable: true,
      ttl: this.CACHE_TTL,
    };
  }

  /**
   * Get configuration for a specific feature flag
   */
  getFeatureFlagConfig(flagName: string): FeatureFlagConfig | null {
    return this.featureFlags[flagName] || null;
  }

  /**
   * Update feature flag configuration (admin operation)
   */
  async updateFeatureFlagConfig(
    flagName: string,
    config: Partial<FeatureFlagConfig>,
    adminUserId: string,
  ): Promise<void> {
    if (!this.featureFlags[flagName]) {
      throw new Error(`Feature flag ${flagName} not found`);
    }

    // Merge with existing config
    this.featureFlags[flagName] = {
      ...this.featureFlags[flagName],
      ...config,
    };

    // Clear cache for this flag
    this.clearCacheForFlag(flagName);

    // Log admin action
    console.log("Feature flag updated", {
      flagName,
      config,
      adminUserId,
      timestamp: new Date().toISOString(),
      eventType: "feature_flag_update",
    });
  }

  /**
   * Emergency kill switch activation
   */
  async activateKillSwitch(
    flagName: string,
    reason: string,
    adminUserId: string,
  ): Promise<void> {
    if (!this.featureFlags[flagName]) {
      throw new Error(`Feature flag ${flagName} not found`);
    }

    this.featureFlags[flagName].emergencyKillSwitch = true;
    this.clearCacheForFlag(flagName);

    // Log emergency action
    console.error("Emergency kill switch activated", {
      flagName,
      reason,
      adminUserId,
      timestamp: new Date().toISOString(),
      eventType: "emergency_kill_switch",
      severity: "critical",
    });
  }

  /**
   * Check if rollback should be triggered based on metrics
   */
  async checkRollbackTriggers(
    flagName: string,
    metrics: {
      errorRate: number;
      avgLatency: number;
      optOutRate: number;
    },
  ): Promise<boolean> {
    const config = this.featureFlags[flagName];
    if (!config) return false;

    const triggers = config.rollbackTriggers;

    if (metrics.errorRate > triggers.errorRateThreshold) {
      await this.activateKillSwitch(
        flagName,
        `Error rate ${metrics.errorRate}% exceeded threshold ${triggers.errorRateThreshold}%`,
        "system",
      );
      return true;
    }

    if (metrics.avgLatency > triggers.latencyThreshold) {
      await this.activateKillSwitch(
        flagName,
        `Latency ${metrics.avgLatency}ms exceeded threshold ${triggers.latencyThreshold}ms`,
        "system",
      );
      return true;
    }

    if (metrics.optOutRate > triggers.optOutRateThreshold) {
      await this.activateKillSwitch(
        flagName,
        `Opt-out rate ${metrics.optOutRate}% exceeded threshold ${triggers.optOutRateThreshold}%`,
        "system",
      );
      return true;
    }

    return false;
  }

  /**
   * Get rollout status for all features
   */
  getRolloutStatus(): Record<
    string,
    {
      enabled: boolean;
      rolloutPercentage: number;
      userTiers: string[];
      killSwitchActive: boolean;
    }
  > {
    const status: Record<string, any> = {};

    Object.entries(this.featureFlags).forEach(([flagName, config]) => {
      status[flagName] = {
        enabled: config.enabled,
        rolloutPercentage: config.rolloutPercentage,
        userTiers: config.userTiers,
        killSwitchActive: config.emergencyKillSwitch,
      };
    });

    return status;
  }

  // Private helper methods

  private calculateUserHash(userId: string, seed: string): number {
    // Simple hash function for deterministic variant assignment
    let hash = 0;
    const input = `${userId}:${seed}`;

    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    return Math.abs(hash);
  }

  private assignVariant(
    variants: ABTestConfig["variants"],
    userId: string,
    testName: string,
  ): ABTestConfig["variants"][0] {
    const hash = this.calculateUserHash(userId, testName);
    const percentile = hash % 100;

    let cumulativeWeight = 0;
    for (const variant of variants) {
      cumulativeWeight += variant.weight;
      if (percentile < cumulativeWeight) {
        return variant;
      }
    }

    // Fallback to first variant
    return variants[0];
  }

  private isTestActive(config: ABTestConfig): boolean {
    const now = new Date();
    const startDate = new Date(config.duration.startDate);
    const endDate = new Date(config.duration.endDate);

    return now >= startDate && now <= endDate;
  }

  private isCacheValid(cached: FeatureFlagEvaluation): boolean {
    if (!cached.cacheable) return false;

    // For simplicity, assume cache is always valid for this demo
    // In production, would check timestamp against TTL
    return true;
  }

  private clearCacheForFlag(flagName: string): void {
    // Remove all cache entries for this flag
    for (const key of this.flagCache.keys()) {
      if (key.startsWith(`${flagName}:`)) {
        this.flagCache.delete(key);
      }
    }
  }
}

/**
 * Feature Flag Middleware for automatic evaluation
 */
export interface FeatureFlagMiddleware {
  /**
   * Evaluate multiple feature flags for a request
   */
  evaluateFlags(
    flagNames: string[],
    userContext: UserContext,
  ): Promise<Record<string, FeatureFlagEvaluation>>;

  /**
   * Check if request should be allowed based on feature flags
   */
  shouldAllowRequest(
    requiredFlags: string[],
    userContext: UserContext,
  ): Promise<boolean>;
}

/**
 * Feature Flag Configuration Schema for Admin UI
 */
export interface FeatureFlagSchema {
  flagName: string;
  displayName: string;
  description: string;
  category: "rollout" | "experiment" | "kill_switch" | "configuration";
  config: FeatureFlagConfig;
  constraints: {
    minRolloutPercentage: number;
    maxRolloutPercentage: number;
    allowedUserTiers: Array<"free" | "premium" | "enterprise">;
    requiresApproval: boolean;
  };
  history: Array<{
    timestamp: string;
    adminUserId: string;
    changes: Partial<FeatureFlagConfig>;
    reason: string;
  }>;
}
