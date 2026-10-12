import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PushTokenResponseDto, PushPlatform } from '../dto/push-token.dto';

/**
 * Redis caching service for push tokens
 * Provides high-performance caching with intelligent TTL management
 */
@Injectable()
export class PushTokenCacheService implements OnModuleInit {
  private readonly logger = new Logger(PushTokenCacheService.name);

  // Cache key patterns
  private readonly CACHE_KEYS = {
    USER_TOKENS: 'push:tokens:user:',           // push:tokens:user:{userId}
    TOKEN_DETAILS: 'push:token:',               // push:token:{tokenId}
    USER_ACTIVE_TOKENS: 'push:active:user:',    // push:active:user:{userId}
    PLATFORM_TOKENS: 'push:platform:',         // push:platform:{userId}:{platform}
    TOKEN_VALIDATION: 'push:validation:',       // push:validation:{tokenId}
    HEALTH_METRICS: 'push:health:',             // push:health:{tenantId}
    BULK_OPERATIONS: 'push:bulk:',              // push:bulk:{operationId}
  } as const;

  // Cache TTL configurations (in seconds)
  private readonly TTL_CONFIG = {
    TOKEN_DETAILS: 3600,        // 1 hour for individual token details
    USER_TOKENS: 1800,          // 30 minutes for user token lists
    ACTIVE_TOKENS: 900,         // 15 minutes for active token lists
    VALIDATION_RESULT: 7200,    // 2 hours for validation results
    HEALTH_METRICS: 300,        // 5 minutes for health metrics
    BULK_OPERATIONS: 600,       // 10 minutes for bulk operation results
    TEMPORARY_LOCK: 60,         // 1 minute for operation locks
  } as const;

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.redis.ping();
      this.logger.log('Redis connection established for push token caching');
    } catch (error) {
      this.logger.error('Failed to establish Redis connection', error.message);
    }
  }

  /**
   * Cache user's token list with automatic expiration
   */
  async cacheUserTokens(
    userId: string,
    tokens: PushTokenResponseDto[],
    filters?: { platform?: PushPlatform; active?: boolean },
    ttl: number = this.TTL_CONFIG.USER_TOKENS
  ): Promise<void> {
    try {
      const cacheKey = this.getUserTokensCacheKey(userId, filters);
      const cacheData = {
        tokens,
        cachedAt: new Date().toISOString(),
        filters: filters || {},
        count: tokens.length
      };

      await this.redis.setex(
        cacheKey,
        ttl,
        JSON.stringify(cacheData)
      );

      this.logger.debug({
        message: 'Cached user tokens',
        userId,
        tokenCount: tokens.length,
        cacheKey,
        ttl
      });

      // Also cache individual tokens for quick access
      await this.cacheMultipleTokens(tokens, this.TTL_CONFIG.TOKEN_DETAILS);

    } catch (error) {
      this.logger.warn({
        message: 'Failed to cache user tokens',
        userId,
        error: error.message
      });
    }
  }

  /**
   * Retrieve cached user tokens
   */
  async getCachedUserTokens(
    userId: string,
    filters?: { platform?: PushPlatform; active?: boolean }
  ): Promise<{ tokens: PushTokenResponseDto[]; cachedAt: string } | null> {
    try {
      const cacheKey = this.getUserTokensCacheKey(userId, filters);
      const cached = await this.redis.get(cacheKey);

      if (!cached) {
        this.logger.debug({
          message: 'User tokens cache miss',
          userId,
          cacheKey
        });
        return null;
      }

      const data = JSON.parse(cached);
      
      this.logger.debug({
        message: 'User tokens cache hit',
        userId,
        tokenCount: data.count,
        cachedAt: data.cachedAt
      });

      return {
        tokens: data.tokens,
        cachedAt: data.cachedAt
      };

    } catch (error) {
      this.logger.warn({
        message: 'Failed to retrieve cached user tokens',
        userId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Cache individual token details
   */
  async cacheToken(
    token: PushTokenResponseDto,
    ttl: number = this.TTL_CONFIG.TOKEN_DETAILS
  ): Promise<void> {
    try {
      const cacheKey = `${this.CACHE_KEYS.TOKEN_DETAILS}${token.id}`;
      const cacheData = {
        ...token,
        cachedAt: new Date().toISOString()
      };

      await this.redis.setex(
        cacheKey,
        ttl,
        JSON.stringify(cacheData)
      );

      this.logger.debug({
        message: 'Cached token details',
        tokenId: token.id,
        userId: token.userId,
        platform: token.platform,
        ttl
      });

    } catch (error) {
      this.logger.warn({
        message: 'Failed to cache token details',
        tokenId: token.id,
        error: error.message
      });
    }
  }

  /**
   * Retrieve cached token details
   */
  async getCachedToken(tokenId: string): Promise<PushTokenResponseDto | null> {
    try {
      const cacheKey = `${this.CACHE_KEYS.TOKEN_DETAILS}${tokenId}`;
      const cached = await this.redis.get(cacheKey);

      if (!cached) {
        this.logger.debug({
          message: 'Token cache miss',
          tokenId
        });
        return null;
      }

      const token = JSON.parse(cached);
      
      this.logger.debug({
        message: 'Token cache hit',
        tokenId,
        cachedAt: token.cachedAt
      });

      // Remove cache metadata before returning
      delete token.cachedAt;
      return token;

    } catch (error) {
      this.logger.warn({
        message: 'Failed to retrieve cached token',
        tokenId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Cache multiple tokens efficiently
   */
  async cacheMultipleTokens(
    tokens: PushTokenResponseDto[],
    ttl: number = this.TTL_CONFIG.TOKEN_DETAILS
  ): Promise<void> {
    if (tokens.length === 0) return;

    try {
      const pipeline = this.redis.pipeline();
      const cacheTime = new Date().toISOString();

      tokens.forEach(token => {
        const cacheKey = `${this.CACHE_KEYS.TOKEN_DETAILS}${token.id}`;
        const cacheData = {
          ...token,
          cachedAt: cacheTime
        };
        
        pipeline.setex(cacheKey, ttl, JSON.stringify(cacheData));
      });

      await pipeline.exec();

      this.logger.debug({
        message: 'Bulk cached token details',
        tokenCount: tokens.length,
        ttl
      });

    } catch (error) {
      this.logger.warn({
        message: 'Failed to bulk cache tokens',
        tokenCount: tokens.length,
        error: error.message
      });
    }
  }

  /**
   * Cache active tokens for a user (frequently accessed)
   */
  async cacheActiveTokens(
    userId: string,
    activeTokens: PushTokenResponseDto[],
    ttl: number = this.TTL_CONFIG.ACTIVE_TOKENS
  ): Promise<void> {
    try {
      const cacheKey = `${this.CACHE_KEYS.USER_ACTIVE_TOKENS}${userId}`;
      const cacheData = {
        tokens: activeTokens,
        cachedAt: new Date().toISOString(),
        count: activeTokens.length
      };

      await this.redis.setex(
        cacheKey,
        ttl,
        JSON.stringify(cacheData)
      );

      this.logger.debug({
        message: 'Cached active tokens',
        userId,
        activeTokenCount: activeTokens.length,
        ttl
      });

    } catch (error) {
      this.logger.warn({
        message: 'Failed to cache active tokens',
        userId,
        error: error.message
      });
    }
  }

  /**
   * Get cached active tokens for a user
   */
  async getCachedActiveTokens(userId: string): Promise<PushTokenResponseDto[] | null> {
    try {
      const cacheKey = `${this.CACHE_KEYS.USER_ACTIVE_TOKENS}${userId}`;
      const cached = await this.redis.get(cacheKey);

      if (!cached) {
        return null;
      }

      const data = JSON.parse(cached);
      
      this.logger.debug({
        message: 'Active tokens cache hit',
        userId,
        tokenCount: data.count,
        cachedAt: data.cachedAt
      });

      return data.tokens;

    } catch (error) {
      this.logger.warn({
        message: 'Failed to retrieve cached active tokens',
        userId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Cache token validation results
   */
  async cacheValidationResult(
    tokenId: string,
    validationResult: {
      result: string;
      validatedAt: string;
      responseCode?: number;
      message?: string;
    },
    ttl: number = this.TTL_CONFIG.VALIDATION_RESULT
  ): Promise<void> {
    try {
      const cacheKey = `${this.CACHE_KEYS.TOKEN_VALIDATION}${tokenId}`;
      
      await this.redis.setex(
        cacheKey,
        ttl,
        JSON.stringify(validationResult)
      );

      this.logger.debug({
        message: 'Cached validation result',
        tokenId,
        result: validationResult.result,
        ttl
      });

    } catch (error) {
      this.logger.warn({
        message: 'Failed to cache validation result',
        tokenId,
        error: error.message
      });
    }
  }

  /**
   * Get cached validation result
   */
  async getCachedValidationResult(tokenId: string): Promise<any | null> {
    try {
      const cacheKey = `${this.CACHE_KEYS.TOKEN_VALIDATION}${tokenId}`;
      const cached = await this.redis.get(cacheKey);

      if (!cached) {
        return null;
      }

      return JSON.parse(cached);

    } catch (error) {
      this.logger.warn({
        message: 'Failed to retrieve cached validation result',
        tokenId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Invalidate cache entries for a specific user
   */
  async invalidateUserCache(userId: string): Promise<void> {
    try {
      const patterns = [
        `${this.CACHE_KEYS.USER_TOKENS}${userId}*`,
        `${this.CACHE_KEYS.USER_ACTIVE_TOKENS}${userId}`,
        `${this.CACHE_KEYS.PLATFORM_TOKENS}${userId}*`
      ];

      for (const pattern of patterns) {
        const keys = await this.redis.keys(pattern);
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      }

      this.logger.debug({
        message: 'Invalidated user cache',
        userId,
        patterns
      });

    } catch (error) {
      this.logger.warn({
        message: 'Failed to invalidate user cache',
        userId,
        error: error.message
      });
    }
  }

  /**
   * Invalidate cache for a specific token
   */
  async invalidateTokenCache(tokenId: string, userId?: string): Promise<void> {
    try {
      const keysToDelete = [`${this.CACHE_KEYS.TOKEN_DETAILS}${tokenId}`];

      // If userId is provided, also invalidate user-related caches
      if (userId) {
        const userPatterns = [
          `${this.CACHE_KEYS.USER_TOKENS}${userId}*`,
          `${this.CACHE_KEYS.USER_ACTIVE_TOKENS}${userId}`,
          `${this.CACHE_KEYS.PLATFORM_TOKENS}${userId}*`
        ];

        for (const pattern of userPatterns) {
          const keys = await this.redis.keys(pattern);
          keysToDelete.push(...keys);
        }
      }

      if (keysToDelete.length > 0) {
        await this.redis.del(...keysToDelete);
      }

      this.logger.debug({
        message: 'Invalidated token cache',
        tokenId,
        userId,
        deletedKeys: keysToDelete.length
      });

    } catch (error) {
      this.logger.warn({
        message: 'Failed to invalidate token cache',
        tokenId,
        userId,
        error: error.message
      });
    }
  }

  /**
   * Set operation lock to prevent concurrent modifications
   */
  async acquireOperationLock(
    lockKey: string,
    ttl: number = this.TTL_CONFIG.TEMPORARY_LOCK
  ): Promise<boolean> {
    try {
      const fullKey = `lock:${lockKey}`;
      const result = await this.redis.set(fullKey, '1', 'EX', ttl, 'NX');
      
      const acquired = result === 'OK';
      
      if (acquired) {
        this.logger.debug({
          message: 'Acquired operation lock',
          lockKey: fullKey,
          ttl
        });
      }

      return acquired;

    } catch (error) {
      this.logger.warn({
        message: 'Failed to acquire operation lock',
        lockKey,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Release operation lock
   */
  async releaseOperationLock(lockKey: string): Promise<void> {
    try {
      const fullKey = `lock:${lockKey}`;
      await this.redis.del(fullKey);
      
      this.logger.debug({
        message: 'Released operation lock',
        lockKey: fullKey
      });

    } catch (error) {
      this.logger.warn({
        message: 'Failed to release operation lock',
        lockKey,
        error: error.message
      });
    }
  }

  /**
   * Get cache statistics for monitoring
   */
  async getCacheStats(): Promise<{
    totalKeys: number;
    memoryUsage: string;
    hitRate: number;
    keysByPattern: Record<string, number>;
  }> {
    try {
      const info = await this.redis.info('memory');
      const memoryUsage = this.extractMemoryUsage(info);
      
      // Count keys by pattern
      const keysByPattern: Record<string, number> = {};
      for (const [name, pattern] of Object.entries(this.CACHE_KEYS)) {
        const keys = await this.redis.keys(`${pattern}*`);
        keysByPattern[name] = keys.length;
      }

      const totalKeys = Object.values(keysByPattern).reduce((sum, count) => sum + count, 0);

      // Hit rate would be calculated from actual metrics in a real implementation
      const hitRate = 0.85; // Placeholder

      return {
        totalKeys,
        memoryUsage,
        hitRate,
        keysByPattern
      };

    } catch (error) {
      this.logger.error({
        message: 'Failed to get cache statistics',
        error: error.message
      });
      
      return {
        totalKeys: 0,
        memoryUsage: 'unknown',
        hitRate: 0,
        keysByPattern: {}
      };
    }
  }

  /**
   * Clear all push token related cache (for maintenance)
   */
  async clearAllPushTokenCache(): Promise<number> {
    try {
      const patterns = Object.values(this.CACHE_KEYS).map(pattern => `${pattern}*`);
      let deletedCount = 0;

      for (const pattern of patterns) {
        const keys = await this.redis.keys(pattern);
        if (keys.length > 0) {
          await this.redis.del(...keys);
          deletedCount += keys.length;
        }
      }

      this.logger.log({
        message: 'Cleared all push token cache',
        deletedKeys: deletedCount
      });

      return deletedCount;

    } catch (error) {
      this.logger.error({
        message: 'Failed to clear push token cache',
        error: error.message
      });
      return 0;
    }
  }

  /**
   * Private helper methods
   */

  private getUserTokensCacheKey(
    userId: string,
    filters?: { platform?: PushPlatform; active?: boolean }
  ): string {
    let key = `${this.CACHE_KEYS.USER_TOKENS}${userId}`;
    
    if (filters) {
      const filterParts: string[] = [];
      if (filters.platform) filterParts.push(`platform:${filters.platform}`);
      if (filters.active !== undefined) filterParts.push(`active:${filters.active}`);
      
      if (filterParts.length > 0) {
        key += `:${filterParts.join(':')}`;
      }
    }
    
    return key;
  }

  private extractMemoryUsage(info: string): string {
    const lines = info.split('\r\n');
    const memoryLine = lines.find(line => line.startsWith('used_memory_human:'));
    return memoryLine ? memoryLine.split(':')[1] : 'unknown';
  }
}