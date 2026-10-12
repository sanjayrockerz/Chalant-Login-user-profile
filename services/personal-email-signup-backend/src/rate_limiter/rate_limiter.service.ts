import { Injectable } from "@nestjs/common";
import { RedisService } from "../redis/redis.service";

@Injectable()
export class RateLimiterService {
  constructor(private readonly redisService: RedisService) {}

  /**
   * Check and increment counters for a given dimension key. Returns remaining and ttl info.
   */
  async checkAndIncrement(
    dimension: string,
    id: string,
    limit: number,
    windowSeconds: number,
    scope?: string,
    blockSeconds?: number,
  ) {
    const namespacedScope = scope ? scope.replace(/\s+/g, "_") : "global";
    const key = `rl:${namespacedScope}:${dimension}:${id}`;
    const result = await this.redisService.checkRateLimit(
      key,
      limit,
      windowSeconds,
      undefined,
      blockSeconds,
    );
    const count = Math.max(0, limit - result.remaining);
    const retryAfter = Math.max(
      Math.ceil((result.resetTime - Date.now()) / 1000),
      0,
    );

    return {
      allowed: result.allowed,
      count,
      remaining: Math.max(0, result.remaining),
      retryAfter,
    };
  }

  async incrementWindowCounter(
    namespace: string,
    id: string,
    windowSeconds: number,
  ) {
    const key = `metric:${namespace}:${id}`;
    const { count, ttlSeconds } = await this.redisService.incrementWindow(
      key,
      windowSeconds,
    );
    return { count, ttl: ttlSeconds };
  }
}
