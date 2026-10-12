// filepath: src/user/reserved-usernames.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ReservedUsernameCheck {
  isReserved: boolean;
  reason?: string;
  category?: 'system' | 'admin' | 'api' | 'security' | 'brand' | 'custom';
}

@Injectable()
export class ReservedUsernamesService {
  private readonly logger = new Logger(ReservedUsernamesService.name);
  
  // Centrally governed reserved usernames to prevent routing conflicts and impersonation
  private readonly SYSTEM_RESERVED = new Set([
    // Core system routes and functionality
    'admin', 'root', 'system', 'app', 'www', 'mail', 'email',
    'ftp', 'ssh', 'ssl', 'http', 'https', 'tcp', 'udp', 'dns',
    
    // Administrative and support
    'support', 'help', 'contact', 'info', 'about', 'terms', 'privacy',
    'legal', 'security', 'abuse', 'report', 'feedback', 'bug', 'bugs',
    'service', 'services',
    
    // Authentication and user management
    'auth', 'login', 'logout', 'signin', 'signout', 'signup', 'register',
    'account', 'profile', 'user', 'users', 'member', 'members',
    'password', 'reset', 'verify', 'verification', 'activate', 'deactivate',
    
    // API and technical endpoints
    'webhook', 'webhooks', 'callback', 'oauth', 'sso', 'saml',
    'graphql', 'rest', 'api', 'v1', 'v2', 'v3', 'v4', 'v5',
    'health', 'status', 'ping', 'metrics', 'monitoring', 'logs',
    
    // File and media handling
    'static', 'assets', 'images', 'img', 'css', 'js', 'javascript',
    'uploads', 'download', 'downloads', 'files', 'media', 'cdn',
    
    // Database and technical
    'db', 'database', 'cache', 'redis', 'postgres', 'mysql',
    'mongodb', 'elastic', 'search', 'index', 'backup', 'restore',
    
    // Security and compliance
    'security', 'audit', 'compliance', 'gdpr', 'ccpa', 'hipaa',
    'pci', 'soc', 'iso', 'encrypt', 'decrypt', 'keys', 'cert',
    
    // Business and brand protection
    'sales', 'marketing', 'business', 'enterprise', 'corporate',
    'company', 'brand', 'trademark', 'copyright', 'patent',
  ]);

  private readonly ADMIN_RESERVED = new Set([
    'administrator',
    'moderator',
    'mod',
    'staff',
    'team',
    'owner',
    'manager',
    'operator'
  ]);

  private readonly API_RESERVED = new Set([
    // Common API patterns that could conflict with routes
    'get', 'post', 'put', 'patch', 'delete', 'head', 'options',
    'create', 'read', 'update', 'delete', 'list', 'search',
    'find', 'filter', 'sort', 'order', 'limit', 'offset',
    'page', 'pages', 'next', 'prev', 'previous', 'first', 'last',
  ]);

  private readonly SECURITY_RESERVED = new Set([
    // Potential impersonation targets
    'null', 'undefined', 'none', 'empty', 'blank', 'default',
    'anonymous', 'guest', 'visitor', 'public', 'private',
    'test', 'testing', 'demo', 'example', 'sample', 'placeholder',
    'temp', 'temporary', 'tmp', 'draft', 'preview', 'staging',
    
    // Common attack vectors
    'script', 'iframe', 'embed', 'object', 'applet', 'form',
    'input', 'select', 'option', 'textarea', 'button', 'link',
    'eval', 'exec', 'system', 'shell', 'cmd', 'command',
  ]);

  private readonly BRAND_RESERVED = new Set([
    // Platform-specific brand protection (customize per application)
    'colleging', 'college', 'university', 'edu', 'education',
    'student', 'students', 'faculty', 'professor', 'teacher',
    'class', 'classes', 'course', 'courses', 'degree', 'grades',
    
    // Social media giants (prevent confusion)
    'facebook', 'instagram', 'twitter', 'tiktok', 'snapchat',
    'linkedin', 'youtube', 'google', 'apple', 'microsoft',
  ]);

  constructor(
    private readonly configService: ConfigService
  ) {}

  /**
   * Check if a username is reserved
   * Validates against multiple categories to prevent conflicts
   */
  isReserved(username: string): ReservedUsernameCheck {
    if (!username) {
      return { isReserved: false };
    }

    // Normalize to lowercase for case-insensitive comparison
    const normalizedUsername = username.toLowerCase();

    // Check admin reserved names first to provide precise categorization
    if (this.ADMIN_RESERVED.has(normalizedUsername)) {
      return {
        isReserved: true,
        reason: 'Username contains administrative terms',
        category: 'admin'
      };
    }

    // Check API reserved names
    if (this.API_RESERVED.has(normalizedUsername)) {
      return {
        isReserved: true,
        reason: 'Username conflicts with API endpoints',
        category: 'api'
      };
    }

    // Check system reserved names
    if (this.SYSTEM_RESERVED.has(normalizedUsername)) {
      return {
        isReserved: true,
        reason: 'Username is reserved for system functionality',
        category: 'system'
      };
    }

    // Check security reserved names
    if (this.SECURITY_RESERVED.has(normalizedUsername)) {
      return {
        isReserved: true,
        reason: 'Username is reserved for security reasons',
        category: 'security'
      };
    }

    // Check brand reserved names
    if (this.BRAND_RESERVED.has(normalizedUsername)) {
      return {
        isReserved: true,
        reason: 'Username is reserved for brand protection',
        category: 'brand'
      };
    }

    // Check custom reserved names from configuration
  const customReserved = this.getCustomReservedNames();
    if (customReserved.has(normalizedUsername)) {
      return {
        isReserved: true,
        reason: 'Username is reserved by custom policy',
        category: 'custom'
      };
    }

    // Check pattern-based reservations
    const patternCheck = this.checkReservedPatterns(normalizedUsername);
    if (patternCheck.isReserved) {
      return patternCheck;
    }

    return { isReserved: false };
  }

  /**
   * Get custom reserved names from configuration
   * Allows runtime configuration of additional reserved names
   */
  private getCustomReservedNames(): Set<string> {
    const customNames = this.configService.get<string[]>('CUSTOM_RESERVED_USERNAMES') || [];
    return new Set(customNames.map(name => name.toLowerCase()));
  }

  /**
   * Check pattern-based reservations
   * Identifies potentially problematic username patterns
   */
  private checkReservedPatterns(username: string): ReservedUsernameCheck {
    // Check for admin-like patterns
    if (username.includes('admin') || username.includes('mod') || username.includes('staff')) {
      return {
        isReserved: true,
        reason: 'Username contains administrative terms',
        category: 'admin'
      };
    }

    // Check for system-like patterns
    if (username.startsWith('sys') || username.startsWith('app') || username.startsWith('api')) {
      return {
        isReserved: true,
        reason: 'Username follows system naming pattern',
        category: 'system'
      };
    }

    // Check for test/demo patterns
    if (username.startsWith('test') || username.startsWith('demo') || username.startsWith('sample')) {
      return {
        isReserved: true,
        reason: 'Username follows test/demo pattern',
        category: 'security'
      };
    }

    // Check for numeric-only patterns that might conflict with IDs
    if (/^\d+$/.test(username) && username.length <= 6) {
      return {
        isReserved: true,
        reason: 'Short numeric usernames are reserved to prevent ID conflicts',
        category: 'system'
      };
    }

    return { isReserved: false };
  }

  /**
   * Get the total count of reserved usernames for monitoring
   * Useful for tracking the scope of reserved name lists
   */
  getReservedCount(): {
    system: number;
    api: number;
    security: number;
    brand: number;
    custom: number;
    total: number;
  } {
    const customCount = this.getCustomReservedNames().size;
    const adminCount = this.ADMIN_RESERVED.size;
    
    return {
      system: this.SYSTEM_RESERVED.size + adminCount,
      api: this.API_RESERVED.size,
      security: this.SECURITY_RESERVED.size,
      brand: this.BRAND_RESERVED.size,
      custom: customCount,
      total: this.SYSTEM_RESERVED.size + adminCount + this.API_RESERVED.size + 
             this.SECURITY_RESERVED.size + this.BRAND_RESERVED.size + customCount
    };
  }

  /**
   * Add a custom reserved username at runtime
   * For dynamic reservation based on business rules
   */
  addCustomReserved(username: string, reason?: string): boolean {
    try {
      const normalizedUsername = username.toLowerCase();
      const current = this.configService.get<string[]>('CUSTOM_RESERVED_USERNAMES') || [];
      
      if (!current.includes(normalizedUsername)) {
        current.push(normalizedUsername);
        // Note: This only affects the current instance
        // For persistent changes, update the configuration system
        this.logger.warn(`Added custom reserved username: ${normalizedUsername}`, { reason });
        return true;
      }
      
      return false; // Already reserved
    } catch (error) {
      this.logger.error('Failed to add custom reserved username', error);
      return false;
    }
  }

  /**
   * Check if a username is similar to reserved names
   * Detects potential typosquatting or confusion attempts
   */
  isSimilarToReserved(username: string): { similar: boolean; matches: string[] } {
    const normalizedUsername = username.toLowerCase();
    const matches: string[] = [];

    // Simple similarity check - look for reserved names as substrings
    const allReserved = [
      ...Array.from(this.SYSTEM_RESERVED),
      ...Array.from(this.ADMIN_RESERVED),
      ...Array.from(this.API_RESERVED),
      ...Array.from(this.SECURITY_RESERVED),
      ...Array.from(this.BRAND_RESERVED),
      ...Array.from(this.getCustomReservedNames())
    ];

    for (const reserved of allReserved) {
      // Check if username is identical or starts with reserved name
      if (
        normalizedUsername === reserved ||
        normalizedUsername.startsWith(reserved) ||
        reserved.startsWith(normalizedUsername)
      ) {
        matches.push(reserved);
      }

      // Check for character substitution (basic)
      if (this.isCharacterSubstitution(normalizedUsername, reserved)) {
        matches.push(reserved);
      }
    }

    return {
      similar: matches.length > 0,
      matches: Array.from(new Set(matches)) // Remove duplicates
    };
  }

  /**
   * Basic character substitution detection
   * Detects common character swaps used to bypass reserved name checks
   */
  private isCharacterSubstitution(username: string, reserved: string): boolean {
    // Common substitutions: 0->o, 1->i, 3->e, 5->s, etc.
    const substitutions: { [key: string]: string[] } = {
      'o': ['0'],
      'i': ['1', 'l'],
      'e': ['3'],
      's': ['5'],
      'a': ['@'],
      'g': ['9']
    };

    // Very basic implementation - could be enhanced with edit distance
    for (const [original, subs] of Object.entries(substitutions)) {
      for (const sub of subs) {
        if (username.replace(new RegExp(sub, 'g'), original) === reserved) {
          return true;
        }
      }
    }

    return false;
  }
}