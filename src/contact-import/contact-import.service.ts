import * as crypto from 'crypto';
import {
  ContactImportDto,
  ContactDiscoveryPreferencesDto,
  DiscoveryResultDto,
  ContactNormalizationResult,
  ContactPrivacyPrefs,
  DiscoveryToken,
} from './dto/contact-import.dto';

// Mock interfaces for external dependencies
interface Logger {
  log(message: string, ...args: any[]): void;
  warn(message: string, context?: any): void;
  error(message: string, context?: any): void;
}

interface ConfigService {
  get<T>(key: string): T;
}

interface RedisService {
  getClient(): any;
}

interface PrismaService {
  discoveryToken: any;
  contactPrivacyPrefs: any;
}

interface AuditLoggerService {
  log(action: string, data: any): Promise<void>;
}

interface RateLimiterService {
  checkLimit(key: string, limit: number, windowMs: number): Promise<void>;
}

@Injectable()
export class ContactImportService {
  private readonly logger = new Logger(ContactImportService.name);
  private readonly redis;
  
  // Retention periods in seconds
  private readonly CONTACT_HASH_TTL = 90 * 24 * 60 * 60; // 90 days
  private readonly DISCOVERY_TOKEN_TTL = 30 * 24 * 60 * 60; // 30 days
  private readonly PENDING_TOKEN_TTL = 7 * 24 * 60 * 60; // 7 days
  
  // Hashing configuration
  private readonly ARGON2_CONFIG = {
    type: argon2.argon2id,
    memoryCost: 65536, // 64MB
    timeCost: 3,
    parallelism: 4,
  };

  constructor(
    private readonly config: ConfigService,
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
    private readonly auditLogger: AuditLoggerService,
    private readonly rateLimiter: RateLimiterService,
  ) {
    this.redis = this.redisService.getClient();
  }

  /**
   * Import contacts and perform friend discovery
   */
  async importContacts(
    userId: string,
    contactImport: ContactImportDto,
  ): Promise<DiscoveryResultDto> {
    // Rate limiting
    await this.rateLimiter.checkLimit(
      `contact_import:${userId}`,
      10, // 10 imports per hour
      3600,
    );

    // Validate user has opted into discovery
    const preferences = await this.getDiscoveryPreferences(userId);
    if (!preferences.allowDiscovery) {
      throw new ForbiddenException('Contact discovery is disabled');
    }

    // Normalize and validate contacts
    const normalizedContacts = await this.normalizeContacts(
      contactImport.contacts,
    );

    if (normalizedContacts.length === 0) {
      throw new BadRequestException('No valid contacts provided');
    }

    // Generate hashes for contacts
    const contactHashes = await this.generateContactHashes(
      userId,
      normalizedContacts,
    );

    // Store hashes and perform discovery
    const discoveryResults = await this.performDiscovery(
      userId,
      contactHashes,
      preferences,
    );

    // Audit log the import (without PII)
    await this.auditLogger.log('contact_import', {
      userId,
      contactCount: normalizedContacts.length,
      phoneCount: normalizedContacts.filter(c => c.type === 'phone').length,
      emailCount: normalizedContacts.filter(c => c.type === 'email').length,
      discoveredCount: discoveryResults.discoveries.length,
      timestamp: new Date(),
    });

    return discoveryResults;
  }

  /**
   * Normalize contact identifiers
   */
  private async normalizeContacts(
    contacts: Array<{ type: 'phone' | 'email'; value: string }>,
  ): Promise<ContactNormalizationResult[]> {
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
        this.logger.warn(`Failed to normalize contact: ${contact.type}`, {
          error: error.message,
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
   * Generate cryptographic hashes for contacts
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
   * Hash a contact using Argon2id with multiple salts
   */
  private async hashContact(
    contact: string,
    platform: string,
    userId: string,
  ): Promise<string> {
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

    // Hash with Argon2id
    const hash = await argon2.hash(contact, {
      ...this.ARGON2_CONFIG,
      salt: combinedSalt,
    });

    return hash;
  }

  /**
   * Get platform-specific salt
   */
  private getPlatformSalt(platform: string): string {
    const salts = {
      phone: this.config.get<string>('CONTACT_SALT_PHONE'),
      email: this.config.get<string>('CONTACT_SALT_EMAIL'),
    };
    
    return salts[platform] || 'default_platform_salt';
  }

  /**
   * Get user-specific salt
   */
  private getUserSalt(userId: string): string {
    // Use HMAC to generate deterministic but unique salt per user
    const secret = this.config.get<string>('CONTACT_USER_SALT_SECRET');
    return crypto.createHmac('sha256', secret).update(userId).digest('hex');
  }

  /**
   * Get monthly rotating salt
   */
  private getMonthlySalt(): string {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${now.getMonth()}`;
    const secret = this.config.get<string>('CONTACT_MONTHLY_SALT_SECRET');
    return crypto.createHmac('sha256', secret).update(monthKey).digest('hex');
  }

  /**
   * Perform friend discovery with privacy protection
   */
  private async performDiscovery(
    userId: string,
    contactHashes: Array<{ type: string; hash: string; normalized: string }>,
    preferences: any,
  ): Promise<DiscoveryResultDto> {
    const discoveries: any[] = [];
    
    // Store user's hashes in Redis with TTL
    await this.storeContactHashes(userId, contactHashes);
    
    // Find mutual discoveries
    for (const contactHash of contactHashes) {
      const discovery = await this.findMutualDiscovery(
        userId,
        contactHash,
        preferences,
      );
      
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
   * Store contact hashes in Redis with TTL
   */
  private async storeContactHashes(
    userId: string,
    contactHashes: Array<{ type: string; hash: string; normalized: string }>,
  ): Promise<void> {
    const pipe = this.redis.pipeline();
    
    for (const { type, hash } of contactHashes) {
      const key = `contact:${type}:${hash}`;
      const value = JSON.stringify({
        userId,
        type,
        createdAt: new Date().toISOString(),
      });
      
      // Store with TTL
      pipe.setex(key, this.CONTACT_HASH_TTL, value);
      
      // Add to user's hash set for cleanup
      pipe.sadd(`user_hashes:${userId}`, key);
      pipe.expire(`user_hashes:${userId}`, this.CONTACT_HASH_TTL);
    }
    
    await pipe.exec();
  }

  /**
   * Find mutual discovery between users
   */
  private async findMutualDiscovery(
    requesterId: string,
    contactHash: { type: string; hash: string },
    requesterPrefs: any,
  ): Promise<any | null> {
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
      const mutualExists = await this.verifyMutualContact(
        requesterId,
        targetUserId,
        contactHash.type,
      );
      
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
    await this.prisma.discoveryToken.create({
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
    
    // Audit log the discovery (anonymized)
    await this.auditLogger.log('mutual_discovery', {
      tokenId,
      platform,
      requesterHash: requesterId.substring(0, 8),
      targetHash: targetId.substring(0, 8),
      timestamp: new Date(),
    });
    
    return tokenId;
  }

  /**
   * Get user's discovery preferences
   */
  async getDiscoveryPreferences(userId: string): Promise<any> {
    const prefs = await this.prisma.contactPrivacyPrefs.findUnique({
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
  ): Promise<any> {
    const updated = await this.prisma.contactPrivacyPrefs.upsert({
      where: { userId },
      create: {
        userId,
        ...preferences,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      update: {
        ...preferences,
        updatedAt: new Date(),
      },
    });
    
    // Audit log preference change
    await this.auditLogger.log('privacy_preferences_updated', {
      userId: userId.substring(0, 8),
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
      await this.prisma.discoveryToken.deleteMany({
        where: {
          OR: [
            { requesterId: userId },
            { targetId: userId },
          ],
        },
      });
      
      // Delete privacy preferences
      await this.prisma.contactPrivacyPrefs.delete({
        where: { userId },
      });
      
      // Audit log the deletion
      await this.auditLogger.log('user_contact_data_deleted', {
        userId: userId.substring(0, 8),
        deletedHashCount: userHashKeys.length,
        timestamp: new Date(),
      });
      
    } catch (error) {
      this.logger.error('Failed to delete user contact data', {
        userId: userId.substring(0, 8),
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get user's discovery history
   */
  async getDiscoveryHistory(userId: string): Promise<any[]> {
    const tokens = await this.prisma.discoveryToken.findMany({
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
    
    return tokens.map(token => ({
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
      const deletedTokens = await this.prisma.discoveryToken.deleteMany({
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
      
      this.logger.log(`Cleaned up ${cleaned} expired contact discovery records`);
      
    } catch (error) {
      this.logger.error('Error during contact data cleanup', {
        error: error.message,
      });
    }
    
    return { cleaned };
  }
}