import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { Redis, RedisOptions } from 'ioredis';

export interface CacheOptions {
  ttl?: number;
  correlationId?: string;
  tenantId?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
}

interface WindowIncrementResult {
  count: number;
  ttlSeconds: number;
}

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(private readonly configService: ConfigService) {
    const redisUrl = this.configService.get('REDIS_URL');
    if (!redisUrl) {
      throw new Error('REDIS_URL is not configured');
    }

    const options: RedisOptions = {
      enableAutoPipelining: true,
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    };

    this.client = new Redis(redisUrl, options);

    this.client.on('connect', () => this.logger.log('Redis connection established'));
    this.client.on('error', (err) => this.logger.error('Redis connection error', err as Error));
    this.client.on('close', () => this.logger.warn('Redis connection closed'));
  }

  getClient(): Redis {
    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch (error) {
      this.logger.error('Failed to close Redis connection cleanly', error as Error);
      this.client.disconnect();
    }
  }

  async set(key: string, value: any, options: CacheOptions | number = {}): Promise<void> {
    const payload = this.serialize(value);
    const cacheOptions: CacheOptions = typeof options === 'number' ? { ttl: options } : options;

    try {
      if (cacheOptions.ttl && cacheOptions.ttl > 0) {
        await this.client.set(key, payload, 'EX', cacheOptions.ttl);
      } else {
        await this.client.set(key, payload);
      }
    } catch (error) {
      this.logger.error(`Redis SET failed for key ${key}`, error as Error, { correlationId: cacheOptions.correlationId });
      throw error;
    }
  }

  async get<T = any>(key: string): Promise<T | null> {
    try {
      const result = await this.client.get(key);
      return this.deserialize<T>(result);
    } catch (error) {
      this.logger.error(`Redis GET failed for key ${key}`, error as Error);
      throw error;
    }
  }

  async del(key: string): Promise<number> {
    try {
      return await this.client.del(key);
    } catch (error) {
      this.logger.error(`Redis DEL failed for key ${key}`, error as Error);
      throw error;
    }
  }

  async getAndDelete<T = any>(key: string): Promise<T | null> {
    try {
      const result = await this.client.getdel(key);
      return this.deserialize<T>(result);
    } catch (error) {
      this.logger.error(`Redis GETDEL failed for key ${key}`, error as Error);
      throw error;
    }
  }

  async checkRateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
    correlationId?: string,
    blockSeconds?: number,
  ): Promise<RateLimitResult> {
    const counterKey = `throttle:${key}`;
    const blockKey = `${counterKey}:block`;

    try {
      const blockTtlMs = await this.client.pttl(blockKey);
      if (blockTtlMs > 0) {
        return {
          allowed: false,
          remaining: 0,
          resetTime: Date.now() + blockTtlMs,
        };
      }

      const { count, ttlSeconds } = await this.incrementWindowInternal(counterKey, windowSeconds);
      const remaining = Math.max(0, limit - count);

      if (count > limit) {
        const penaltySeconds = blockSeconds ?? windowSeconds;
        if (penaltySeconds > 0) {
          await this.client.set(blockKey, '1', 'EX', penaltySeconds);
        }

        return {
          allowed: false,
          remaining: 0,
          resetTime: Date.now() + penaltySeconds * 1000,
        };
      }

      return {
        allowed: true,
        remaining,
        resetTime: Date.now() + ttlSeconds * 1000,
      };
    } catch (error) {
      this.logger.error('Redis rate limit check failed; failing closed', error as Error, { key, correlationId });
      throw error;
    }
  }

  async incrementRateLimit(
    key: string,
    windowSeconds: number,
    correlationId?: string,
  ): Promise<number> {
    try {
      const { count } = await this.incrementWindowInternal(`throttle:${key}`, windowSeconds);
      return count;
    } catch (error) {
      this.logger.error('Redis rate limit increment failed', error as Error, { key, correlationId });
      return 1;
    }
  }

  async incrementWindow(key: string, windowSeconds: number): Promise<WindowIncrementResult> {
    try {
      return await this.incrementWindowInternal(key, windowSeconds);
    } catch (error) {
      this.logger.error('Redis window increment failed', error as Error, { key });
      return { count: 1, ttlSeconds: windowSeconds };
    }
  }

  async setSession(sessionId: string, data: any, ttlSeconds: number = 3600): Promise<void> {
    await this.set(`session:${sessionId}`, data, { ttl: ttlSeconds });
  }

  async getSession<T = any>(sessionId: string): Promise<T | null> {
    return this.get<T>(`session:${sessionId}`);
  }

  async storeOTP(key: string, otp: string, ttlSeconds: number = 600): Promise<void> {
    await this.set(`otp:${key}`, otp, { ttl: ttlSeconds });
  }

  async verifyOTP(key: string, providedOTP: string): Promise<boolean> {
    const redisKey = `otp:${key}`;
    const stored = await this.get<string>(redisKey);
    if (!stored) {
      return false;
    }

    if (stored === providedOTP) {
      await this.del(redisKey);
      return true;
    }

    return false;
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }

  private async incrementWindowInternal(key: string, windowSeconds: number): Promise<WindowIncrementResult> {
    const pipeline = this.client.multi();
    pipeline.incr(key);
    pipeline.expire(key, windowSeconds, 'NX');
    pipeline.ttl(key);

    const execResult = await pipeline.exec();

    if (!execResult) {
      throw new Error('Redis pipeline execution returned null');
    }

    const incrResult = Number(execResult[0]?.[1] ?? 0);
    const ttlRaw = execResult[2]?.[1];
    let ttlSeconds = typeof ttlRaw === 'number' ? ttlRaw : Number(ttlRaw ?? windowSeconds);

    if (!Number.isFinite(ttlSeconds) || ttlSeconds < 0) {
      await this.client.expire(key, windowSeconds);
      ttlSeconds = windowSeconds;
    }

    return {
      count: incrResult,
      ttlSeconds,
    };
  }

  private serialize(value: any): string {
    if (typeof value === 'string') {
      return value;
    }

    try {
      return JSON.stringify(value);
    } catch (error) {
      this.logger.warn('Failed to serialize value for Redis; falling back to string', error as Error);
      return String(value);
    }
  }

  private deserialize<T>(value: string | null): T | null {
    if (value === null || value === undefined) {
      return null;
    }

    try {
      return JSON.parse(value) as T;
    } catch {
      return value as unknown as T;
    }
  }
}
