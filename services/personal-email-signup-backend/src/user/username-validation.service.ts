// filepath: src/user/username-validation.service.ts
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface UsernameValidationResult {
  isValid: boolean;
  canonical: string | null;
  errors: string[];
  warnings: string[];
}

export interface UsernameAvailabilityResult {
  available: boolean;
  canonical: string | null;
  reason?: 'reserved' | 'taken' | 'invalid' | 'rate_limited';
  suggestions?: string[];
}

@Injectable()
export class UsernameValidationService {
  private readonly logger = new Logger(UsernameValidationService.name);
  
  // Instagram-style username rules
  private readonly USERNAME_MIN_LENGTH = 1;
  private readonly USERNAME_MAX_LENGTH = 30;
  private readonly USERNAME_PATTERN = /^[a-zA-Z0-9_.]{1,30}$/;
  private readonly CANONICAL_PATTERN = /^[a-z0-9_.]{1,30}$/;

  constructor(
    private readonly configService: ConfigService
  ) {}

  /**
   * Validate username format according to Instagram-style rules
   * Rules: 1-30 characters, letters (a-z), digits (0-9), underscores (_), periods (.) only
   */
  validateFormat(username: string): UsernameValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for null/undefined
    if (!username) {
      errors.push('Username is required');
      return {
        isValid: false,
        canonical: null,
        errors,
        warnings
      };
    }

    // Check length constraints
    if (username.length < this.USERNAME_MIN_LENGTH) {
      errors.push(`Username must be at least ${this.USERNAME_MIN_LENGTH} character long`);
    }

    if (username.length > this.USERNAME_MAX_LENGTH) {
      errors.push(`Username must be no more than ${this.USERNAME_MAX_LENGTH} characters long`);
    }

    // Check character constraints
    if (!this.USERNAME_PATTERN.test(username)) {
      errors.push('Username can only contain letters (a-z), digits (0-9), underscores (_), and periods (.)');
    }

    // Check for spaces (common mistake)
    if (username.includes(' ')) {
      errors.push('Username cannot contain spaces');
    }

    // Check for consecutive periods/underscores (Instagram rule)
    if (username.includes('..') || username.includes('__')) {
      warnings.push('Consecutive periods or underscores may cause confusion');
    }

    // Check for starting/ending with period or underscore
    if (username.startsWith('.') || username.startsWith('_')) {
      warnings.push('Username starting with period or underscore may be harder to remember');
    }

    if (username.endsWith('.') || username.endsWith('_')) {
      warnings.push('Username ending with period or underscore may be harder to remember');
    }

    // Generate canonical form (lowercase)
    const canonical = this.normalizeUsername(username);

    // Validate canonical form
    if (canonical && !this.CANONICAL_PATTERN.test(canonical)) {
      errors.push('Username normalization failed - invalid canonical form');
    }

    return {
      isValid: errors.length === 0,
      canonical: errors.length === 0 ? canonical : null,
      errors,
      warnings
    };
  }

  /**
   * Normalize username to canonical form for case-insensitive comparisons
   * Converts to lowercase for stable storage and lookups
   */
  normalizeUsername(username: string): string {
    if (!username) {
      return '';
    }

    // Convert to lowercase for case-insensitive storage
    let canonical = username.toLowerCase();

    // Future: Add Unicode NFKC normalization if expanding beyond ASCII
    // canonical = canonical.normalize('NFKC');

    // Future: Add confusable character detection for Unicode security
    // if (this.hasConfusableCharacters(canonical)) {
    //   throw new BadRequestException('Username contains confusable characters');
    // }

    return canonical;
  }

  /**
   * Validate username for registration/update with comprehensive checks
   */
  validateForRegistration(username: string): UsernameValidationResult {
    // Start with format validation
    const formatResult = this.validateFormat(username);
    
    if (!formatResult.isValid) {
      return formatResult;
    }

    // Additional checks for registration
    const additionalWarnings: string[] = [];

    // Check for numeric-only usernames (discouraged but not forbidden)
    if (/^\d+$/.test(username)) {
      additionalWarnings.push('numeric-only usernames may be harder for others to remember');
    }

    // Check for single character usernames (valid but discouraged)
    if (username.length === 1) {
      additionalWarnings.push('single character usernames are valid but may be harder to remember');
    }

    return {
      ...formatResult,
      warnings: [...formatResult.warnings, ...additionalWarnings]
    };
  }

  /**
   * Generate username suggestions based on a desired username
   * Used when the preferred username is not available
   */
  generateSuggestions(desiredUsername: string, count: number = 3): string[] {
    const suggestions: string[] = [];
    const canonical = this.normalizeUsername(desiredUsername);
    
    if (!canonical || !this.validateFormat(canonical).isValid) {
      return suggestions;
    }

    // Strategy 1: Add numbers
    for (let i = 1; i <= count && suggestions.length < count; i++) {
      const suggestion = `${canonical}${i}`;
      if (suggestion.length <= this.USERNAME_MAX_LENGTH) {
        suggestions.push(suggestion);
      }
    }

    // Strategy 2: Add underscores
    if (suggestions.length < count) {
      const suggestion = `${canonical}_`;
      if (suggestion.length <= this.USERNAME_MAX_LENGTH) {
        suggestions.push(suggestion);
      }
    }

    // Strategy 3: Add random numbers
    if (suggestions.length < count) {
      const randomNum = Math.floor(Math.random() * 1000);
      const suggestion = `${canonical}${randomNum}`;
      if (suggestion.length <= this.USERNAME_MAX_LENGTH) {
        suggestions.push(suggestion);
      }
    }

    return suggestions.slice(0, count);
  }

  /**
   * Check if username change is allowed based on rate limiting rules
   */
  isUsernameChangeAllowed(
    lastChangedAt: Date | null, 
    changeCount: number,
    userId: string
  ): { allowed: boolean; reason?: string; nextAllowedAt?: Date } {
    const now = new Date();
    
    // Get configuration
    const maxChangesPerMonth = this.configService.get<number>('USERNAME_MAX_CHANGES_PER_MONTH') || 3;
    const minDaysBetweenChanges = this.configService.get<number>('USERNAME_MIN_DAYS_BETWEEN_CHANGES') || 30;

    // Check if user has exceeded monthly change limit
    if (changeCount >= maxChangesPerMonth) {
      return {
        allowed: false,
        reason: `Maximum ${maxChangesPerMonth} username changes per month exceeded`
      };
    }

    // Check minimum time between changes
    if (lastChangedAt) {
      const daysSinceLastChange = (now.getTime() - lastChangedAt.getTime()) / (1000 * 60 * 60 * 24);
      
      if (daysSinceLastChange < minDaysBetweenChanges) {
        const nextAllowedAt = new Date(lastChangedAt.getTime() + (minDaysBetweenChanges * 24 * 60 * 60 * 1000));
        return {
          allowed: false,
          reason: `Must wait ${minDaysBetweenChanges} days between username changes`,
          nextAllowedAt
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Sanitize username for logging (PII-safe)
   * Returns a truncated, partially masked version for audit logs
   */
  sanitizeForLogging(username: string): string {
    if (!username || username.length <= 2) {
      return '***';
    }

    // Show first 2 characters + asterisks + length
    return `${username.substring(0, 2)}***[${username.length}]`;
  }

  /**
   * Future: Detect confusable characters for Unicode security
   * This would be implemented when expanding beyond ASCII
   */
  private hasConfusableCharacters(username: string): boolean {
    // Placeholder for future Unicode confusable detection
    // Would use UTS #39 confusable character mappings
    // For now, we only allow ASCII so this always returns false
    return false;
  }

  /**
   * Future: Apply Unicode normalization
   * This would be implemented when expanding beyond ASCII
   */
  private applyUnicodeNormalization(username: string): string {
    // Apply NFKC normalization for Unicode strings
    // For now, we only handle ASCII
    return username.normalize('NFKC');
  }
}