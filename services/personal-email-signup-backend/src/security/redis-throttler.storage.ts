import { Injectable, Logger } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class RedisThrottlerStorageService implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorageService.name);

  constructor(private readonly redisService: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const counterKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `${counterKey}:block`;

    try {
      const client = this.redisService.getClient();
      const activeBlockTtl = await client.pttl(blockKey);

      if (activeBlockTtl > 0) {
        return {
          totalHits: limit + 1,
          timeToExpire: Math.ceil(activeBlockTtl / 1000),
          isBlocked: true,
          timeToBlockExpire: Math.ceil(activeBlockTtl / 1000),
        };
      }

      const pipeline = client.multi();
      pipeline.incr(counterKey);
      pipeline.pexpire(counterKey, ttl, 'NX');
      pipeline.pttl(counterKey);

      const execResult = await pipeline.exec();
      if (!execResult) {
        throw new Error('Redis throttler pipeline returned null response');
      }

      const totalHits = Number(execResult[0]?.[1] ?? 0);
      const ttlRaw = execResult[2]?.[1];
      let ttlMs = typeof ttlRaw === 'number' ? ttlRaw : Number(ttlRaw ?? ttl);

      if (!Number.isFinite(ttlMs) || ttlMs < 0) {
        await client.pexpire(counterKey, ttl);
        ttlMs = ttl;
      }

      let isBlocked = false;
      let blockMs = 0;

      if (limit > 0 && totalHits > limit) {
        isBlocked = true;
        blockMs = blockDuration > 0 ? blockDuration : ttl;
        if (blockMs > 0) {
          await client.psetex(blockKey, blockMs, '1');
        }
      }

      return {
        totalHits,
        timeToExpire: Math.ceil(ttlMs / 1000),
        isBlocked,
        timeToBlockExpire: isBlocked ? Math.ceil(blockMs / 1000) : 0,
      };
    } catch (error) {
      this.logger.error('Redis throttler storage failure; failing closed', error as Error, {
        key,
        throttlerName,
      });

      return {
        totalHits: limit + 1,
        timeToExpire: Math.ceil(ttl / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(ttl / 1000),
      };
    }
  }
}
