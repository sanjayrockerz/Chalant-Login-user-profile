import * as crypto from 'crypto';

// DTOs and interfaces
export interface ContactDto {
  type: 'phone' | 'email';
  value: string;
}

export interface ContactImportDto {
  contacts: ContactDto[];
}

export interface ContactDiscoveryPreferencesDto {
  allowDiscovery: boolean;
  discoveryMode: 'mutual-only' | 'one-sided' | 'disabled';
  allowSuggestions: boolean;
  phoneDiscovery?: boolean;
  emailDiscovery?: boolean;
}

export interface ContactNormalizationResult {
  type: 'phone' | 'email';
  normalized: string;
  original: string;
}

export interface DiscoveryResult {
  userId: string;
  platform: string;
  discoveryToken: string;
  mutual: boolean;
  timestamp: Date;
}

export interface DiscoveryResultDto {
  discoveries: DiscoveryResult[];
  importedCount: number;
  discoveredCount: number;
  timestamp: Date;
}

export interface ContactPrivacyPrefs {
  userId: string;
  allowDiscovery: boolean;
  discoveryMode: 'mutual-only' | 'one-sided' | 'disabled';
  allowSuggestions: boolean;
  phoneDiscovery: boolean;
  emailDiscovery: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DiscoveryToken {
  id: string;
  requesterId: string;
  targetId: string;
  contactHash: string;
  platform: string;
  status: 'pending' | 'matched' | 'expired';
  createdAt: Date;
  expiresAt: Date;
}

// Custom exceptions
class BadRequestException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestException';
  }
}

class ForbiddenException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenException';
  }
}

// Simple PBKDF2-based hasher (replacement for Argon2id)
class SecureHasher {
  static async hash(input: string, salt: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      crypto.pbkdf2(input, salt, 100000, 64, 'sha512', (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey.toString('hex'));
      });
    });
  }
}

// Mock interfaces for external dependencies
interface RedisClient {
  setex(key: string, ttl: number, value: string): Promise<string>;
  get(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  sadd(key: string, ...members: string[]): Promise<number>;
  expire(key: string, ttl: number): Promise<number>;
  pipeline(): any;
  keys(pattern: string): Promise<string[]>;
  ttl(key: string): Promise<number>;
  dbsize(): Promise<number>;
}

interface DatabaseService {
  discoveryToken: {
    create(data: { data: any }): Promise<DiscoveryToken>;
    deleteMany(where: { where: any }): Promise<{ count: number }>;
    findMany(options: any): Promise<DiscoveryToken[]>;
    count(options?: any): Promise<number>;
  };
  contactPrivacyPrefs: {
    findUnique(options: { where: any }): Promise<ContactPrivacyPrefs | null>;
    upsert(options: any): Promise<ContactPrivacyPrefs>;
    delete(options: { where: any }): Promise<ContactPrivacyPrefs>;
  };
}

/**
 * Secure Contact Import Service
 * 
 * Implements privacy-first contact discovery using cryptographic hashing
 * with mutual consent, automatic data expiration, and comprehensive PII protection.
 */
export class ContactImportService {
  // Configuration constants
  private readonly CONTACT_HASH_TTL = 90 * 24 * 60 * 60; // 90 days
  private readonly DISCOVERY_TOKEN_TTL = 30 * 24 * 60 * 60; // 30 days
  private readonly PENDING_TOKEN_TTL = 7 * 24 * 60 * 60; // 7 days
  
  // Environment-specific salts (should be loaded from secure config)
  private readonly PLATFORM_SALTS = {
    phone: process.env.CONTACT_SALT_PHONE || 'default_phone_salt_change_in_production',
    email: process.env.CONTACT_SALT_EMAIL || 'default_email_salt_change_in_production',
  };
  
  private readonly USER_SALT_SECRET = process.env.CONTACT_USER_SALT_SECRET || 'change_this_in_production';
  private readonly MONTHLY_SALT_SECRET = process.env.CONTACT_MONTHLY_SALT_SECRET || 'change_this_in_production';

  constructor(
    private readonly redis: RedisClient,
    private readonly database: DatabaseService,
    private readonly logger: (level: string, message: string, context?: any) => void = console.log,
  ) {}

  /**
   * Import contacts and perform secure friend discovery
   */
  async importContacts(
    userId: string,
    contactImport: ContactImportDto,
  ): Promise<DiscoveryResultDto> {
    // Validate user has opted into discovery
    const preferences = await this.getDiscoveryPreferences(userId);
    if (!preferences.allowDiscovery) {
      throw new ForbiddenException('Contact discovery is disabled');
    }

    // Normalize and validate contacts
    const normalizedContacts = await this.normalizeContacts(contactImport.contacts);

    if (normalizedContacts.length === 0) {
      throw new BadRequestException('No valid contacts provided');
    }

    // Generate secure hashes for contacts
    const contactHashes = await this.generateContactHashes(userId, normalizedContacts);

    // Store hashes and perform discovery
    const discoveryResults = await this.performDiscovery(userId, contactHashes, preferences);

    // Log the import (without PII)
    this.logger('info', 'Contact import completed', {
      userId: this.anonymizeUserId(userId),
      contactCount: normalizedContacts.length,
      phoneCount: normalizedContacts.filter(c => c.type === 'phone').length,
      emailCount: normalizedContacts.filter(c => c.type === 'email').length,
      discoveredCount: discoveryResults.discoveries.length,
      timestamp: new Date(),
    });

    return discoveryResults;
  }

  /**
   * Normalize contact identifiers to standard format
   */
  private async normalizeContacts(contacts: ContactDto[]): Promise<ContactNormalizationResult[]> {
    const normalized: ContactNormalizationResult[] = [];
    const seen = new Set<string>();

    for (const contact of contacts) {
      try {
        let normalizedValue: string;

        if (contact.type === 'phone') {
          normalizedValue = this.normalizePhoneNumber(contact.value);
        } else if (contact.type === 'email') {
          normalizedValue = this.normalizeEmail(contact.value);
        } else {
          continue; // Skip invalid types
        }

        // Deduplicate
        const key = `${contact.type}:${normalizedValue}`;
        if (seen.has(key)) continue;
        seen.add(key);

        normalized.push({
          type: contact.type,
          normalized: normalizedValue,
          original: contact.value,
        });
      } catch (error) {
        this.logger('warn', 'Failed to normalize contact', {
          type: contact.type,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // Continue processing other contacts
      }
    }

    return normalized;
  }

  /**
   * Normalize phone number to E.164 format
   */
  private normalizePhoneNumber(phone: string): string {
    // Remove all non-digit characters
    const digits = phone.replace(/\D/g, '');
    
    if (digits.length < 10) {
      throw new Error('Phone number too short');
    }
    
    if (digits.length > 15) {
      throw new Error('Phone number too long');
    }
    
    // Add country code if missing (assume US +1 for 10-digit numbers)
    if (digits.length === 10) {
      return `+1${digits}`;
    }
    
    // If starts with country code, format properly
    if (digits.length === 11 && digits.startsWith('1')) {
      return `+${digits}`;
    }
    
    // For other lengths, assume country code is included
    return `+${digits}`;
  }

  /**
   * Normalize email address
   */
  private normalizeEmail(email: string): string {
    const trimmed = email.trim().toLowerCase();
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) {
      throw new Error('Invalid email format');
    }
    
    return trimmed;
  }

  /**
   * Generate cryptographic hashes for contacts using secure multi-salt strategy
   */
  private async generateContactHashes(
    userId: string,
    contacts: ContactNormalizationResult[],
  ): Promise<Array<{ type: string; hash: string; normalized: string }>> {
    const hashes: Array<{ type: string; hash: string; normalized: string }> = [];
    
    for (const contact of contacts) {
      const hash = await this.hashContact(contact.normalized, contact.type, userId);
      hashes.push({
        type: contact.type,
        hash,
        normalized: contact.normalized,
      });
    }
    
    return hashes;
  }

  /**
   * Hash a contact using PBKDF2 with multiple salts for security
   */
  private async hashContact(contact: string, platform: string, userId: string): Promise<string> {
    // Generate salt components
    const platformSalt = this.getPlatformSalt(platform);
    const userSalt = this.getUserSalt(userId);
    const monthlySalt = this.getMonthlySalt();
    
    // Combine salts
    const combinedSalt = Buffer.concat([
      Buffer.from(platformSalt, 'utf8'),
      Buffer.from(userSalt, 'utf8'),
      Buffer.from(monthlySalt, 'utf8'),
    ]);

    // Hash with PBKDF2 (Argon2id replacement)
    const hash = await SecureHasher.hash(contact, combinedSalt);
    return hash;
  }

  /**
   * Get platform-specific salt
   */
  private getPlatformSalt(platform: string): string {
    if (platform === 'phone') return this.PLATFORM_SALTS.phone;
    if (platform === 'email') return this.PLATFORM_SALTS.email;
    return 'default_platform_salt';
  }

  /**
   * Get user-specific salt using HMAC
   */
  private getUserSalt(userId: string): string {
    return crypto.createHmac('sha256', this.USER_SALT_SECRET).update(userId).digest('hex');
  }

  /**
   * Get monthly rotating salt
   */
  private getMonthlySalt(): string {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${now.getMonth()}`;
    return crypto.createHmac('sha256', this.MONTHLY_SALT_SECRET).update(monthKey).digest('hex');
  }

  /**
   * Perform friend discovery with privacy protection
   */
  private async performDiscovery(
    userId: string,
    contactHashes: Array<{ type: string; hash: string; normalized: string }>,
    preferences: ContactPrivacyPrefs,
  ): Promise<DiscoveryResultDto> {
    const discoveries: DiscoveryResult[] = [];
    
    // Store user's hashes in Redis with TTL
    await this.storeContactHashes(userId, contactHashes);
    
    // Find mutual discoveries
    for (const contactHash of contactHashes) {
      const discovery = await this.findMutualDiscovery(userId, contactHash, preferences);
      
      if (discovery) {
        discoveries.push(discovery);
      }
    }

    return {
      discoveries,
      importedCount: contactHashes.length,
      discoveredCount: discoveries.length,
      timestamp: new Date(),
    };
  }

  /**
   * Store contact hashes in Redis with automatic expiration
   */
  private async storeContactHashes(
    userId: string,
    contactHashes: Array<{ type: string; hash: string; normalized: string }>,
  ): Promise<void> {
    for (const { type, hash } of contactHashes) {
      const key = `contact:${type}:${hash}`;
      const value = JSON.stringify({
        userId,
        type,
        createdAt: new Date().toISOString(),
      });
      
      // Store with TTL
      await this.redis.setex(key, this.CONTACT_HASH_TTL, value);
      
      // Add to user's hash set for cleanup
      await this.redis.sadd(`user_hashes:${userId}`, key);
      await this.redis.expire(`user_hashes:${userId}`, this.CONTACT_HASH_TTL);
    }
  }

  /**
   * Find mutual discovery between users
   */
  private async findMutualDiscovery(
    requesterId: string,
    contactHash: { type: string; hash: string },
    requesterPrefs: ContactPrivacyPrefs,
  ): Promise<DiscoveryResult | null> {
    const key = `contact:${contactHash.type}:${contactHash.hash}`;
    const existingData = await this.redis.get(key);
    
    if (!existingData) {
      return null; // No match found
    }
    
    const existing = JSON.parse(existingData);
    const targetUserId = existing.userId;
    
    if (targetUserId === requesterId) {
      return null; // Don't match with self
    }
    
    // Check target user's preferences
    const targetPrefs = await this.getDiscoveryPreferences(targetUserId);
    
    if (!targetPrefs.allowDiscovery) {
      return null; // Target user has disabled discovery
    }
    
    // Check if discovery should be mutual-only
    const requireMutual = requesterPrefs.discoveryMode === 'mutual-only' ||
                         targetPrefs.discoveryMode === 'mutual-only';
    
    if (requireMutual) {
      // Verify mutual contact existence
      const mutualExists = await this.verifyMutualContact(requesterId, targetUserId, contactHash.type);
      
      if (!mutualExists) {
        return null; // Not mutual
      }
    }
    
    // Create discovery token
    const discoveryToken = await this.createDiscoveryToken(
      requesterId,
      targetUserId,
      contactHash.hash,
      contactHash.type,
    );
    
    return {
      userId: targetUserId,
      platform: contactHash.type,
      discoveryToken,
      mutual: true,
      timestamp: new Date(),
    };
  }

  /**
   * Verify mutual contact exists
   */
  private async verifyMutualContact(
    user1Id: string,
    user2Id: string,
    platform: string,
  ): Promise<boolean> {
    // Check if user2 has user1's contact hash
    const user1Hashes = await this.redis.smembers(`user_hashes:${user1Id}`);
    
    for (const hashKey of user1Hashes) {
      if (!hashKey.includes(platform)) continue;
      
      const hashData = await this.redis.get(hashKey);
      if (!hashData) continue;
      
      const data = JSON.parse(hashData);
      if (data.userId === user2Id) {
        return true; // Mutual contact confirmed
      }
    }
    
    return false;
  }

  /**
   * Create bidirectional discovery token
   */
  private async createDiscoveryToken(
    requesterId: string,
    targetId: string,
    contactHash: string,
    platform: string,
  ): Promise<string> {
    const tokenId = crypto.randomUUID();
    
    // Create discovery token in database
    await this.database.discoveryToken.create({
      data: {
        id: tokenId,
        requesterId,
        targetId,
        contactHash: contactHash.substring(0, 8), // Only store partial hash
        platform,
        status: 'matched',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + this.DISCOVERY_TOKEN_TTL * 1000),
      },
    });
    
    // Log the discovery (anonymized)
    this.logger('info', 'Mutual discovery created', {
      tokenId,
      platform,
      requesterHash: this.anonymizeUserId(requesterId),
      targetHash: this.anonymizeUserId(targetId),
      timestamp: new Date(),
    });
    
    return tokenId;
  }

  /**
   * Get user's discovery preferences
   */
  async getDiscoveryPreferences(userId: string): Promise<ContactPrivacyPrefs> {
    const prefs = await this.database.contactPrivacyPrefs.findUnique({
      where: { userId },
    });
    
    // Default to most private settings
    return prefs || {
      userId,
      allowDiscovery: false,
      discoveryMode: 'mutual-only',
      allowSuggestions: false,
      phoneDiscovery: false,
      emailDiscovery: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * Update discovery preferences
   */
  async updateDiscoveryPreferences(
    userId: string,
    preferences: ContactDiscoveryPreferencesDto,
  ): Promise<ContactPrivacyPrefs> {
    const updated = await this.database.contactPrivacyPrefs.upsert({
      where: { userId },
      create: {
        userId,
        ...preferences,
        phoneDiscovery: preferences.phoneDiscovery ?? false,
        emailDiscovery: preferences.emailDiscovery ?? false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      update: {
        ...preferences,
        phoneDiscovery: preferences.phoneDiscovery ?? false,
        emailDiscovery: preferences.emailDiscovery ?? false,
        updatedAt: new Date(),
      },
    });
    
    // Log preference change
    this.logger('info', 'Privacy preferences updated', {
      userId: this.anonymizeUserId(userId),
      allowDiscovery: preferences.allowDiscovery,
      discoveryMode: preferences.discoveryMode,
      timestamp: new Date(),
    });
    
    return updated;
  }

  /**
   * Delete all user contact data
   */
  async deleteUserContactData(userId: string): Promise<void> {
    try {
      // Get all user's hash keys
      const userHashKeys = await this.redis.smembers(`user_hashes:${userId}`);
      
      // Delete all contact hashes
      if (userHashKeys.length > 0) {
        await this.redis.del(...userHashKeys);
      }
      
      // Delete user hash set
      await this.redis.del(`user_hashes:${userId}`);
      
      // Delete discovery tokens
      await this.database.discoveryToken.deleteMany({
        where: {
          OR: [
            { requesterId: userId },
            { targetId: userId },
          ],
        },
      });
      
      // Delete privacy preferences
      await this.database.contactPrivacyPrefs.delete({
        where: { userId },
      });
      
      // Log deletion
      this.logger('info', 'User contact data deleted', {
        userId: this.anonymizeUserId(userId),
        deletedHashCount: userHashKeys.length,
        timestamp: new Date(),
      });
      
    } catch (error) {
      this.logger('error', 'Failed to delete user contact data', {
        userId: this.anonymizeUserId(userId),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get user's discovery history
   */
  async getDiscoveryHistory(userId: string): Promise<any[]> {
    const tokens = await this.database.discoveryToken.findMany({
      where: {
        OR: [
          { requesterId: userId },
          { targetId: userId },
        ],
        status: 'matched',
      },
      orderBy: { createdAt: 'desc' },
      take: 50, // Limit to recent discoveries
    });
    
    return tokens.map((token: DiscoveryToken) => ({
      id: token.id,
      platform: token.platform,
      discoveredAt: token.createdAt,
      isRequester: token.requesterId === userId,
      // Note: We don't return the other user's ID for privacy
    }));
  }

  /**
   * Cleanup expired data (called by cron job)
   */
  async cleanupExpiredData(): Promise<{ cleaned: number }> {
    let cleaned = 0;
    
    try {
      // Cleanup expired discovery tokens
      const deletedTokens = await this.database.discoveryToken.deleteMany({
        where: {
          expiresAt: {
            lt: new Date(),
          },
        },
      });
      
      cleaned += deletedTokens.count;
      
      // Redis cleanup is handled by TTL, but we can cleanup tracking sets
      const expiredSets = await this.redis.keys('user_hashes:*');
      for (const setKey of expiredSets) {
        const ttl = await this.redis.ttl(setKey);
        if (ttl === -1) {
          // Set TTL if missing
          await this.redis.expire(setKey, this.CONTACT_HASH_TTL);
        }
      }
      
      this.logger('info', `Cleaned up ${cleaned} expired contact discovery records`);
      
    } catch (error) {
      this.logger('error', 'Error during contact data cleanup', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
    
    return { cleaned };
  }

  /**
   * Anonymize user ID for logging (first 8 characters + redaction)
   */
  private anonymizeUserId(userId: string): string {
    return userId.substring(0, 8) + '...[REDACTED]';
  }
}