// filepath: src/config/feature-flags.config.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from './config.service';

export interface FeatureFlagConfig {
  // Terms enforcement flags
  requireTermsEnforceMode: 'off' | 'warn' | 'enforce';
  requireTermsCanaryTenants: string[];
  requireTermsCanaryPercentage: number;
  
  // Identity gating flags
  identityGatingEnabled: boolean;
  identityGatingCanaryTenants: string[];
  identityGatingCanaryPercentage: number;
  
  // Username rule enforcement flags
  usernameInstagramRulesEnabled: boolean;
  usernameNormalizationEnabled: boolean;
  usernameDenylistEnabled: boolean;
  usernameCanaryTenants: string[];
  usernameCanaryPercentage: number;
  
  // Password screening flags
  passwordScreeningEnabled: boolean;
  passwordBreachCheckEnabled: boolean;
  passwordScreeningCanaryTenants: string[];
  passwordScreeningCanaryPercentage: number;
  
  // Global canary controls
  globalCanaryEnabled: boolean;
  globalCanaryTenants: string[];
  globalCanaryPercentage: number;
  
  // Rollback triggers
  rollbackTriggers: {
    maxErrorRate: number;
    maxLatencyP95Ms: number;
    maxRateLimitViolations: number;
    maxSignupFailureRate: number;
  };
}

@Injectable()
export class FeatureFlagsService {
  private readonly logger = new Logger(FeatureFlagsService.name);
  private featureFlags: FeatureFlagConfig;
  
  constructor(private readonly configService: ConfigService) {
    this.featureFlags = this.loadFeatureFlags();
    this.logFeatureFlagStatus();
  }
  
  private loadFeatureFlags(): FeatureFlagConfig {
    return {
      // Terms enforcement configuration
      requireTermsEnforceMode: this.getEnvFlag('REQUIRE_TERMS_ENFORCE_MODE', 'off') as 'off' | 'warn' | 'enforce',
      requireTermsCanaryTenants: this.parseCanaryTenants('REQUIRE_TERMS_CANARY_TENANTS'),
      requireTermsCanaryPercentage: this.getEnvNumber('REQUIRE_TERMS_CANARY_PERCENTAGE', 0),
      
      // Identity gating configuration
      identityGatingEnabled: this.getEnvBoolean('IDENTITY_GATING_ENABLED', false),
      identityGatingCanaryTenants: this.parseCanaryTenants('IDENTITY_GATING_CANARY_TENANTS'),
      identityGatingCanaryPercentage: this.getEnvNumber('IDENTITY_GATING_CANARY_PERCENTAGE', 0),
      
      // Username rules configuration
      usernameInstagramRulesEnabled: this.getEnvBoolean('USERNAME_INSTAGRAM_RULES_ENABLED', false),
      usernameNormalizationEnabled: this.getEnvBoolean('REQUIRE_USERNAME_NORMALIZATION', true),
      usernameDenylistEnabled: this.getEnvBoolean('REQUIRE_USERNAME_DENYLIST', true),
      usernameCanaryTenants: this.parseCanaryTenants('USERNAME_RULES_CANARY_TENANTS'),
      usernameCanaryPercentage: this.getEnvNumber('USERNAME_RULES_CANARY_PERCENTAGE', 0),
      
      // Password screening configuration
      passwordScreeningEnabled: this.getEnvBoolean('PASSWORD_SCREENING_ENABLED', false),
      passwordBreachCheckEnabled: this.getEnvBoolean('PASSWORD_BREACH_CHECK_ENABLED', false),
      passwordScreeningCanaryTenants: this.parseCanaryTenants('PASSWORD_SCREENING_CANARY_TENANTS'),
      passwordScreeningCanaryPercentage: this.getEnvNumber('PASSWORD_SCREENING_CANARY_PERCENTAGE', 0),
      
      // Global canary controls
      globalCanaryEnabled: this.getEnvBoolean('GLOBAL_CANARY_ENABLED', false),
      globalCanaryTenants: this.parseCanaryTenants('GLOBAL_CANARY_TENANTS'),
      globalCanaryPercentage: this.getEnvNumber('GLOBAL_CANARY_PERCENTAGE', 0),
      
      // Rollback trigger thresholds
      rollbackTriggers: {
        maxErrorRate: this.getEnvNumber('ROLLBACK_MAX_ERROR_RATE', 0.05), // 5% error rate
        maxLatencyP95Ms: this.getEnvNumber('ROLLBACK_MAX_LATENCY_P95_MS', 2000), // 2 second P95
        maxRateLimitViolations: this.getEnvNumber('ROLLBACK_MAX_RATE_LIMIT_VIOLATIONS', 100), // 100 violations/min
        maxSignupFailureRate: this.getEnvNumber('ROLLBACK_MAX_SIGNUP_FAILURE_RATE', 0.15), // 15% signup failure
      }
    };
  }
  
  /**
   * Check if terms enforcement is enabled for a given tenant/user
   */
  isTermsEnforcementEnabled(tenantId?: string, userId?: string): boolean {
    const mode = this.featureFlags.requireTermsEnforceMode;
    
    if (mode === 'off') return false;
    if (mode === 'enforce') {
      return this.isInCanary('terms', tenantId, userId);
    }
    // 'warn' mode - log but don't enforce
    return false;
  }
  
  /**
   * Check if terms enforcement should warn for a given tenant/user
   */
  shouldWarnTermsEnforcement(tenantId?: string, userId?: string): boolean {
    const mode = this.featureFlags.requireTermsEnforceMode;
    return mode === 'warn' && this.isInCanary('terms', tenantId, userId);
  }
  
  /**
   * Check if identity gating is enabled for a given tenant/user
   */
  isIdentityGatingEnabled(tenantId?: string, userId?: string): boolean {
    return this.featureFlags.identityGatingEnabled && 
           this.isInCanary('identity', tenantId, userId);
  }
  
  /**
   * Check if Instagram-style username rules are enabled for a given tenant/user
   */
  isUsernameInstagramRulesEnabled(tenantId?: string, userId?: string): boolean {
    return this.featureFlags.usernameInstagramRulesEnabled && 
           this.isInCanary('username', tenantId, userId);
  }
  
  /**
   * Check if username normalization is enabled for a given tenant/user
   */
  isUsernameNormalizationEnabled(tenantId?: string, userId?: string): boolean {
    return this.featureFlags.usernameNormalizationEnabled && 
           this.isInCanary('username', tenantId, userId);
  }
  
  /**
   * Check if username denylist is enabled for a given tenant/user
   */
  isUsernameDenylistEnabled(tenantId?: string, userId?: string): boolean {
    return this.featureFlags.usernameDenylistEnabled && 
           this.isInCanary('username', tenantId, userId);
  }
  
  /**
   * Check if password screening is enabled for a given tenant/user
   */
  isPasswordScreeningEnabled(tenantId?: string, userId?: string): boolean {
    return this.featureFlags.passwordScreeningEnabled && 
           this.isInCanary('password', tenantId, userId);
  }
  
  /**
   * Check if password breach checking is enabled for a given tenant/user
   */
  isPasswordBreachCheckEnabled(tenantId?: string, userId?: string): boolean {
    return this.featureFlags.passwordBreachCheckEnabled && 
           this.isInCanary('password', tenantId, userId);
  }
  
  /**
   * Get rollback trigger thresholds
   */
  getRollbackTriggers() {
    return this.featureFlags.rollbackTriggers;
  }
  
  /**
   * Get all feature flag status for monitoring/debugging
   */
  getFeatureFlagStatus(): FeatureFlagConfig {
    return { ...this.featureFlags };
  }
  
  /**
   * Reload feature flags from environment (for runtime updates)
   */
  reloadFeatureFlags(): void {
    const oldFlags = { ...this.featureFlags };
    this.featureFlags = this.loadFeatureFlags();
    
    this.logger.log('Feature flags reloaded', {
      oldFlags: this.sanitizeForLogging(oldFlags),
      newFlags: this.sanitizeForLogging(this.featureFlags),
      timestamp: new Date().toISOString()
    });
  }
  
  /**
   * Check if a tenant/user is in a specific canary group
   */
  private isInCanary(feature: 'terms' | 'identity' | 'username' | 'password', tenantId?: string, userId?: string): boolean {
    // Global canary check first
    if (this.featureFlags.globalCanaryEnabled) {
      if (this.isInGlobalCanary(tenantId, userId)) {
        return true;
      }
    }
    
    // Feature-specific canary checks
    let canaryTenants: string[];
    let canaryPercentage: number;
    
    switch (feature) {
      case 'terms':
        canaryTenants = this.featureFlags.requireTermsCanaryTenants;
        canaryPercentage = this.featureFlags.requireTermsCanaryPercentage;
        break;
      case 'identity':
        canaryTenants = this.featureFlags.identityGatingCanaryTenants;
        canaryPercentage = this.featureFlags.identityGatingCanaryPercentage;
        break;
      case 'username':
        canaryTenants = this.featureFlags.usernameCanaryTenants;
        canaryPercentage = this.featureFlags.usernameCanaryPercentage;
        break;
      case 'password':
        canaryTenants = this.featureFlags.passwordScreeningCanaryTenants;
        canaryPercentage = this.featureFlags.passwordScreeningCanaryPercentage;
        break;
    }
    
    // Explicit tenant inclusion
    if (tenantId && canaryTenants.includes(tenantId)) {
      return true;
    }
    
    // Percentage-based inclusion
    if (canaryPercentage > 0) {
      const identifier = tenantId || userId || 'default';
      return this.hashBasedPercentage(identifier, feature) < canaryPercentage;
    }
    
    return false;
  }
  
  /**
   * Check if tenant/user is in global canary
   */
  private isInGlobalCanary(tenantId?: string, userId?: string): boolean {
    if (tenantId && this.featureFlags.globalCanaryTenants.includes(tenantId)) {
      return true;
    }
    
    if (this.featureFlags.globalCanaryPercentage > 0) {
      const identifier = tenantId || userId || 'default';
      return this.hashBasedPercentage(identifier, 'global') < this.featureFlags.globalCanaryPercentage;
    }
    
    return false;
  }
  
  /**
   * Generate stable hash-based percentage for consistent canary assignment
   */
  private hashBasedPercentage(identifier: string, feature: string): number {
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(`${identifier}:${feature}`).digest('hex');
    const num = parseInt(hash.substring(0, 8), 16);
    return (num % 10000) / 100; // 0-100 percentage
  }
  
  /**
   * Parse comma-separated canary tenant list from environment
   */
  private parseCanaryTenants(envVar: string): string[] {
    const value = process.env[envVar] || '';
    return value.split(',').map(t => t.trim()).filter(Boolean);
  }
  
  /**
   * Get environment variable as boolean
   */
  private getEnvBoolean(key: string, defaultValue: boolean): boolean {
    const value = process.env[key];
    if (value === undefined) return defaultValue;
    return value.toLowerCase() === 'true';
  }
  
  /**
   * Get environment variable as number
   */
  private getEnvNumber(key: string, defaultValue: number): number {
    const value = process.env[key];
    if (value === undefined) return defaultValue;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue : parsed;
  }
  
  /**
   * Get environment variable as string
   */
  private getEnvFlag(key: string, defaultValue: string): string {
    return process.env[key] || defaultValue;
  }
  
  /**
   * Log current feature flag status (sanitized for security)
   */
  private logFeatureFlagStatus(): void {
    this.logger.log('Feature flags initialized', {
      flags: this.sanitizeForLogging(this.featureFlags),
      environment: process.env.NODE_ENV,
      timestamp: new Date().toISOString()
    });
  }
  
  /**
   * Sanitize feature flags for logging (remove sensitive data)
   */
  private sanitizeForLogging(flags: FeatureFlagConfig): any {
    return {
      requireTermsEnforceMode: flags.requireTermsEnforceMode,
      identityGatingEnabled: flags.identityGatingEnabled,
      usernameInstagramRulesEnabled: flags.usernameInstagramRulesEnabled,
      usernameNormalizationEnabled: flags.usernameNormalizationEnabled,
      usernameDenylistEnabled: flags.usernameDenylistEnabled,
      passwordScreeningEnabled: flags.passwordScreeningEnabled,
      passwordBreachCheckEnabled: flags.passwordBreachCheckEnabled,
      globalCanaryEnabled: flags.globalCanaryEnabled,
      canaryPercentages: {
        terms: flags.requireTermsCanaryPercentage,
        identity: flags.identityGatingCanaryPercentage,
        username: flags.usernameCanaryPercentage,
        password: flags.passwordScreeningCanaryPercentage,
        global: flags.globalCanaryPercentage
      },
      rollbackTriggers: flags.rollbackTriggers,
      // Exclude tenant lists for privacy
      tenantListsConfigured: {
        terms: flags.requireTermsCanaryTenants.length > 0,
        identity: flags.identityGatingCanaryTenants.length > 0,
        username: flags.usernameCanaryTenants.length > 0,
        password: flags.passwordScreeningCanaryTenants.length > 0,
        global: flags.globalCanaryTenants.length > 0
      }
    };
  }
}