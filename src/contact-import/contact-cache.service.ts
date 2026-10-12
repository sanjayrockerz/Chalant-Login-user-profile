import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * Redis Cache Layer for Contact Discovery System
 * 
 * Provides high-performance caching, deduplication tracking, and ephemeral storage
 * for contact discovery operations with automatic TTL management and memory optimization.
 * 
 * Features:
 * - Fast hash lookups for contact matching
 * - Bloom filter-based deduplication
 * - Rate limiting and throttling
 * - Batch processing support
 * - Memory-efficient storage patterns
 * - Automatic cleanup and expiration
 */

interface RedisClient {
  // Basic operations
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<string>;
  setex(key: string, seconds: number, value: string): Promise<string>;
  del(...keys: string[]): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
  
  // Set operations
  sadd(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  sismember(key: string, member: string): Promise<number>;
  scard(key: string): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  
  // Hash operations
  hset(key: string, field: string, value: string): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  hmset(key: string, ...args: (string | number)[]): Promise<string>;
  hmget(key: string, ...fields: string[]): Promise<(string | null)[]>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
  
  // Sorted set operations
  zadd(key: string, score: number, member: string): Promise<number>;
  zrange(key: string, start: number, stop: number): Promise<string[]>;
  zrangebyscore(key: string, min: number | string, max: number | string): Promise<string[]>;
  zrem(key: string, ...members: string[]): Promise<number>;
  zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number>;
  
  // Bit operations for Bloom filter
  setbit(key: string, offset: number, value: number): Promise<number>;
  getbit(key: string, offset: number): Promise<number>;
  
  // Pipeline for batch operations
  pipeline(): any;
  
  // Lua script execution
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<any>;
}

interface CacheMetrics {
  hitRate: number;
  missRate: number;
  totalOperations: number;
  avgResponseTime: number;
  memoryUsage: number;
  keyCount: number;
}

interface BloomFilterConfig {
  expectedElements: number;
  falsePositiveRate: number;
  bitArraySize: number;
  hashFunctions: number;
}

@Injectable()
export class ContactCacheService {
  private readonly logger = new Logger(ContactCacheService.name);
  
  // Cache configuration
  private readonly DEFAULT_TTL = 90 * 24 * 60 * 60; // 90 days
  private readonly MATCH_CACHE_TTL = 30 * 24 * 60 * 60; // 30 days
  private readonly DEDUP_CACHE_TTL = 7 * 24 * 60 * 60; // 7 days
  private readonly BATCH_CACHE_TTL = 24 * 60 * 60; // 24 hours
  
  // Bloom filter configuration
  private readonly BLOOM_FILTER_CONFIG: BloomFilterConfig = {
    expectedElements: 1000000, // 1M contacts
    falsePositiveRate: 0.01, // 1% false positive rate
    bitArraySize: 0, // Calculated dynamically
    hashFunctions: 0, // Calculated dynamically
  };
  
  // Performance tracking
  private metrics = {
    hits: 0,
    misses: 0,
    totalOperations: 0,
    totalResponseTime: 0,
  };

  constructor(
    private readonly redis: RedisClient,
    private readonly config: ConfigService,
  ) {
    this.initializeBloomFilter();
  }

  // =============================================================================
  // CONTACT HASH CACHING
  // =============================================================================

  /**
   * Store contact hash with user mapping
   */
  async storeContactHash(
    userId: string,
    hashedIdentifier: string,
    identifierType: 'phone' | 'email',
    batchId?: string,
  ): Promise<void> {
    const startTime = Date.now();
    
    try {
      const pipe = this.redis.pipeline();
      
      // Primary hash storage: hash -> user mapping
      const hashKey = this.getContactHashKey(hashedIdentifier, identifierType);
      const hashData = {
        userId,
        identifierType,
        uploadedAt: new Date().toISOString(),
        batchId: batchId || '',
      };
      
      pipe.setex(hashKey, this.DEFAULT_TTL, JSON.stringify(hashData));
      
      // User's contact list: user -> set of hashes
      const userHashesKey = this.getUserHashesKey(userId);
      pipe.sadd(userHashesKey, `${identifierType}:${hashedIdentifier}`);
      pipe.expire(userHashesKey, this.DEFAULT_TTL);
      
      // Type-specific storage for faster queries
      const typeKey = this.getTypeHashesKey(identifierType);
      pipe.zadd(typeKey, Date.now(), hashedIdentifier);
      pipe.expire(typeKey, this.DEFAULT_TTL);
      
      // Batch tracking if provided
      if (batchId) {
        const batchKey = this.getBatchHashesKey(batchId);
        pipe.sadd(batchKey, `${identifierType}:${hashedIdentifier}`);
        pipe.expire(batchKey, this.BATCH_CACHE_TTL);
      }
      
      await pipe.exec();
      
      this.updateMetrics(startTime, true);
    } catch (error) {
      this.updateMetrics(startTime, false);
      this.logger.error('Failed to store contact hash', {
        userId: this.anonymizeUserId(userId),
        identifierType,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Lookup contact hash to find matching user
   */
  async lookupContactHash(
    hashedIdentifier: string,
    identifierType: 'phone' | 'email',
  ): Promise<{ userId: string; uploadedAt: Date; batchId?: string } | null> {
    const startTime = Date.now();
    
    try {
      const hashKey = this.getContactHashKey(hashedIdentifier, identifierType);
      const data = await this.redis.get(hashKey);
      
      if (!data) {
        this.updateMetrics(startTime, false);
        return null;
      }
      
      const parsed = JSON.parse(data);
      this.updateMetrics(startTime, true);
      
      return {
        userId: parsed.userId,
        uploadedAt: new Date(parsed.uploadedAt),
        batchId: parsed.batchId || undefined,
      };
    } catch (error) {
      this.updateMetrics(startTime, false);
      this.logger.error('Failed to lookup contact hash', {
        identifierType,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Get all contact hashes for a user
   */
  async getUserContactHashes(userId: string): Promise<string[]> {
    const startTime = Date.now();
    
    try {
      const userHashesKey = this.getUserHashesKey(userId);
      const hashes = await this.redis.smembers(userHashesKey);
      
      this.updateMetrics(startTime, hashes.length > 0);
      return hashes;
    } catch (error) {
      this.updateMetrics(startTime, false);
      this.logger.error('Failed to get user contact hashes', {
        userId: this.anonymizeUserId(userId),
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Delete all contact hashes for a user
   */
  async deleteUserContactHashes(userId: string): Promise<number> {
    const startTime = Date.now();
    
    try {
      const userHashesKey = this.getUserHashesKey(userId);
      const hashes = await this.redis.smembers(userHashesKey);
      
      if (hashes.length === 0) {
        this.updateMetrics(startTime, true);
        return 0;
      }
      
      const pipe = this.redis.pipeline();
      
      // Delete individual hash keys
      for (const hashEntry of hashes) {
        const [type, hash] = hashEntry.split(':');
        const hashKey = this.getContactHashKey(hash, type as 'phone' | 'email');
        pipe.del(hashKey);
      }
      
      // Delete user's hash set
      pipe.del(userHashesKey);
      
      const results = await pipe.exec();
      const deletedCount = results.filter(result => result[1] > 0).length;
      
      this.updateMetrics(startTime, true);
      return deletedCount;
    } catch (error) {
      this.updateMetrics(startTime, false);
      this.logger.error('Failed to delete user contact hashes', {
        userId: this.anonymizeUserId(userId),
        error: error.message,
      });
      throw error;
    }
  }

  // =============================================================================
  // DEDUPLICATION TRACKING
  // =============================================================================

  /**
   * Initialize Bloom filter for deduplication
   */
  private initializeBloomFilter(): void {
    const { expectedElements, falsePositiveRate } = this.BLOOM_FILTER_CONFIG;
    
    // Calculate optimal bit array size
    const bitArraySize = Math.ceil(
      (-expectedElements * Math.log(falsePositiveRate)) / (Math.log(2) ** 2)
    );
    
    // Calculate optimal number of hash functions
    const hashFunctions = Math.ceil((bitArraySize / expectedElements) * Math.log(2));
    
    this.BLOOM_FILTER_CONFIG.bitArraySize = bitArraySize;
    this.BLOOM_FILTER_CONFIG.hashFunctions = hashFunctions;
    
    this.logger.log('Bloom filter initialized', {
      expectedElements,
      falsePositiveRate,
      bitArraySize,
      hashFunctions,
    });
  }

  /**
   * Check if contact hash was already processed (using Bloom filter)
   */
  async isContactDuplicate(
    userId: string,
    hashedIdentifier: string,
    identifierType: 'phone' | 'email',
  ): Promise<boolean> {
    const startTime = Date.now();
    
    try {
      // First check exact deduplication cache
      const dedupKey = this.getDedupKey(userId, hashedIdentifier, identifierType);
      const exists = await this.redis.exists(dedupKey);
      
      if (exists) {
        this.updateMetrics(startTime, true);
        return true;
      }
      
      // Check Bloom filter for potential duplicate
      const bloomKey = this.getBloomFilterKey(userId);
      const contactSignature = this.getContactSignature(hashedIdentifier, identifierType);
      const isDuplicate = await this.checkBloomFilter(bloomKey, contactSignature);
      
      this.updateMetrics(startTime, true);
      return isDuplicate;
    } catch (error) {
      this.updateMetrics(startTime, false);
      this.logger.error('Failed to check contact duplicate', {
        userId: this.anonymizeUserId(userId),
        identifierType,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Mark contact as processed for deduplication
   */
  async markContactProcessed(
    userId: string,
    hashedIdentifier: string,
    identifierType: 'phone' | 'email',
  ): Promise<void> {
    const startTime = Date.now();
    
    try {
      const pipe = this.redis.pipeline();
      
      // Mark in exact deduplication cache
      const dedupKey = this.getDedupKey(userId, hashedIdentifier, identifierType);
      const dedupData = {
        processedAt: new Date().toISOString(),
        count: 1,
      };
      pipe.setex(dedupKey, this.DEDUP_CACHE_TTL, JSON.stringify(dedupData));
      
      // Add to Bloom filter
      const bloomKey = this.getBloomFilterKey(userId);
      const contactSignature = this.getContactSignature(hashedIdentifier, identifierType);
      await this.addToBloomFilter(bloomKey, contactSignature);
      
      await pipe.exec();
      this.updateMetrics(startTime, true);
    } catch (error) {
      this.updateMetrics(startTime, false);
      this.logger.error('Failed to mark contact as processed', {
        userId: this.anonymizeUserId(userId),
        identifierType,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Batch deduplication check
   */
  async batchCheckDuplicates(
    userId: string,
    contacts: Array<{ hash: string; type: 'phone' | 'email' }>,
  ): Promise<Array<{ hash: string; type: 'phone' | 'email'; isDuplicate: boolean }>> {
    const startTime = Date.now();
    
    try {
      const results = [];
      const pipe = this.redis.pipeline();
      
      // Check all contacts in batch
      for (const contact of contacts) {
        const dedupKey = this.getDedupKey(userId, contact.hash, contact.type);
        pipe.exists(dedupKey);
      }
      
      const existsResults = await pipe.exec();
      
      for (let i = 0; i < contacts.length; i++) {
        const contact = contacts[i];
        const exists = existsResults[i][1] === 1;
        
        results.push({
          hash: contact.hash,
          type: contact.type,
          isDuplicate: exists,
        });
      }
      
      this.updateMetrics(startTime, true);
      return results;
    } catch (error) {
      this.updateMetrics(startTime, false);
      this.logger.error('Failed batch duplicate check', {
        userId: this.anonymizeUserId(userId),
        contactCount: contacts.length,
        error: error.message,
      });
      throw error;
    }
  }

  // =============================================================================
  // MATCH RESULT CACHING
  // =============================================================================

  /**
   * Cache match results for fast retrieval
   */
  async cacheMatchResult(
    requesterId: string,
    matchedUserId: string,
    matchType: 'exact' | 'mutual' | 'one_sided',
    matchStrength: number,
    identifierType: 'phone' | 'email',
  ): Promise<void> {
    const startTime = Date.now();
    
    try {
      const matchKey = this.getMatchKey(requesterId, matchedUserId, identifierType);
      const matchData = {
        matchType,
        matchStrength,
        identifierType,
        createdAt: new Date().toISOString(),
      };
      
      await this.redis.setex(matchKey, this.MATCH_CACHE_TTL, JSON.stringify(matchData));
      
      // Add to user's matches set for quick retrieval
      const userMatchesKey = this.getUserMatchesKey(requesterId);
      await this.redis.sadd(userMatchesKey, `${matchedUserId}:${identifierType}`);
      await this.redis.expire(userMatchesKey, this.MATCH_CACHE_TTL);
      
      this.updateMetrics(startTime, true);
    } catch (error) {
      this.updateMetrics(startTime, false);
      this.logger.error('Failed to cache match result', {
        requesterId: this.anonymizeUserId(requesterId),
        matchedUserId: this.anonymizeUserId(matchedUserId),
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get cached match results for a user
   */
  async getCachedMatches(userId: string): Promise<Array<{
    matchedUserId: string;
    matchType: string;
    matchStrength: number;
    identifierType: string;
    createdAt: Date;
  }>> {
    const startTime = Date.now();
    
    try {
      const userMatchesKey = this.getUserMatchesKey(userId);
      const matchEntries = await this.redis.smembers(userMatchesKey);
      
      if (matchEntries.length === 0) {
        this.updateMetrics(startTime, false);
        return [];
      }
      
      const pipe = this.redis.pipeline();
      
      for (const entry of matchEntries) {
        const [matchedUserId, identifierType] = entry.split(':');
        const matchKey = this.getMatchKey(userId, matchedUserId, identifierType as 'phone' | 'email');
        pipe.get(matchKey);
      }
      
      const results = await pipe.exec();
      const matches = [];
      
      for (let i = 0; i < matchEntries.length; i++) {
        const [matchedUserId, identifierType] = matchEntries[i].split(':');
        const matchData = results[i][1];
        
        if (matchData) {
          const parsed = JSON.parse(matchData);
          matches.push({
            matchedUserId,
            matchType: parsed.matchType,
            matchStrength: parsed.matchStrength,
            identifierType: parsed.identifierType,
            createdAt: new Date(parsed.createdAt),
          });
        }
      }
      
      this.updateMetrics(startTime, matches.length > 0);
      return matches;
    } catch (error) {
      this.updateMetrics(startTime, false);
      this.logger.error('Failed to get cached matches', {
        userId: this.anonymizeUserId(userId),
        error: error.message,
      });
      return [];
    }
  }

  // =============================================================================
  // BATCH PROCESSING SUPPORT
  // =============================================================================

  /**
   * Store batch processing status
   */
  async storeBatchStatus(
    batchId: string,
    status: 'pending' | 'processing' | 'completed' | 'failed',
    metadata: Record<string, any>,
  ): Promise<void> {
    const batchKey = this.getBatchStatusKey(batchId);
    const batchData = {
      status,
      metadata,
      updatedAt: new Date().toISOString(),
    };
    
    await this.redis.setex(batchKey, this.BATCH_CACHE_TTL, JSON.stringify(batchData));
  }

  /**
   * Get batch processing status
   */
  async getBatchStatus(batchId: string): Promise<{
    status: string;
    metadata: Record<string, any>;
    updatedAt: Date;
  } | null> {
    const batchKey = this.getBatchStatusKey(batchId);
    const data = await this.redis.get(batchKey);
    
    if (!data) return null;
    
    const parsed = JSON.parse(data);
    return {
      status: parsed.status,
      metadata: parsed.metadata,
      updatedAt: new Date(parsed.updatedAt),
    };
  }

  // =============================================================================
  // BLOOM FILTER IMPLEMENTATION
  // =============================================================================

  /**
   * Add item to Bloom filter
   */
  private async addToBloomFilter(bloomKey: string, item: string): Promise<void> {
    const { bitArraySize, hashFunctions } = this.BLOOM_FILTER_CONFIG;
    const pipe = this.redis.pipeline();
    
    for (let i = 0; i < hashFunctions; i++) {
      const hash = this.hashForBloomFilter(item, i);
      const bitPosition = hash % bitArraySize;
      pipe.setbit(bloomKey, bitPosition, 1);
    }
    
    pipe.expire(bloomKey, this.DEDUP_CACHE_TTL);
    await pipe.exec();
  }

  /**
   * Check if item might be in Bloom filter
   */
  private async checkBloomFilter(bloomKey: string, item: string): Promise<boolean> {
    const { bitArraySize, hashFunctions } = this.BLOOM_FILTER_CONFIG;
    const pipe = this.redis.pipeline();
    
    for (let i = 0; i < hashFunctions; i++) {
      const hash = this.hashForBloomFilter(item, i);
      const bitPosition = hash % bitArraySize;
      pipe.getbit(bloomKey, bitPosition);
    }
    
    const results = await pipe.exec();
    
    // All bits must be set for potential membership
    return results.every(result => result[1] === 1);
  }

  /**
   * Generate hash for Bloom filter
   */
  private hashForBloomFilter(item: string, seed: number): number {
    const hash = crypto.createHash('sha256');
    hash.update(item + seed.toString());
    const digest = hash.digest('hex');
    return parseInt(digest.substring(0, 8), 16);
  }

  // =============================================================================
  // CLEANUP AND MAINTENANCE
  // =============================================================================

  /**
   * Cleanup expired cache entries
   */
  async cleanupExpiredEntries(): Promise<{ deletedKeys: number; errors: number }> {
    let deletedKeys = 0;
    let errors = 0;
    
    try {
      // Get all expired contact hash keys
      const contactKeys = await this.redis.eval(`
        local keys = redis.call('KEYS', 'contact:hash:*')
        local expired = {}
        for i=1,#keys do
          local ttl = redis.call('TTL', keys[i])
          if ttl == -2 then
            table.insert(expired, keys[i])
          end
        end
        return expired
      `, 0);
      
      if (contactKeys && contactKeys.length > 0) {
        deletedKeys += await this.redis.del(...contactKeys);
      }
      
      // Get all expired match keys
      const matchKeys = await this.redis.eval(`
        local keys = redis.call('KEYS', 'match:*')
        local expired = {}
        for i=1,#keys do
          local ttl = redis.call('TTL', keys[i])
          if ttl == -2 then
            table.insert(expired, keys[i])
          end
        end
        return expired
      `, 0);
      
      if (matchKeys && matchKeys.length > 0) {
        deletedKeys += await this.redis.del(...matchKeys);
      }
      
    } catch (error) {
      errors++;
      this.logger.error('Error during cache cleanup', { error: error.message });
    }
    
    this.logger.log('Cache cleanup completed', { deletedKeys, errors });
    return { deletedKeys, errors };
  }

  /**
   * Get cache metrics and statistics
   */
  async getCacheMetrics(): Promise<CacheMetrics> {
    const totalOps = this.metrics.totalOperations || 1;
    
    return {
      hitRate: this.metrics.hits / totalOps,
      missRate: this.metrics.misses / totalOps,
      totalOperations: totalOps,
      avgResponseTime: this.metrics.totalResponseTime / totalOps,
      memoryUsage: 0, // Would need Redis INFO command
      keyCount: 0, // Would need Redis DBSIZE command
    };
  }

  // =============================================================================
  // UTILITY METHODS
  // =============================================================================

  private getContactHashKey(hash: string, type: string): string {
    return `contact:hash:${type}:${hash}`;
  }

  private getUserHashesKey(userId: string): string {
    return `user:hashes:${userId}`;
  }

  private getTypeHashesKey(type: string): string {
    return `type:hashes:${type}`;
  }

  private getBatchHashesKey(batchId: string): string {
    return `batch:hashes:${batchId}`;
  }

  private getDedupKey(userId: string, hash: string, type: string): string {
    return `dedup:${userId}:${type}:${hash.substring(0, 16)}`;
  }

  private getBloomFilterKey(userId: string): string {
    return `bloom:${userId}`;
  }

  private getContactSignature(hash: string, type: string): string {
    return `${type}:${hash}`;
  }

  private getMatchKey(requesterId: string, matchedId: string, type: string): string {
    return `match:${requesterId}:${matchedId}:${type}`;
  }

  private getUserMatchesKey(userId: string): string {
    return `user:matches:${userId}`;
  }

  private getBatchStatusKey(batchId: string): string {
    return `batch:status:${batchId}`;
  }

  private anonymizeUserId(userId: string): string {
    return userId.substring(0, 8) + '...[REDACTED]';
  }

  private updateMetrics(startTime: number, success: boolean): void {
    const responseTime = Date.now() - startTime;
    this.metrics.totalOperations++;
    this.metrics.totalResponseTime += responseTime;
    
    if (success) {
      this.metrics.hits++;
    } else {
      this.metrics.misses++;
    }
  }
}