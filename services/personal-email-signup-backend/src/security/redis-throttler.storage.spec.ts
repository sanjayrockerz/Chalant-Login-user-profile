import { RedisThrottlerStorageService } from './redis-throttler.storage';

describe('RedisThrottlerStorageService', () => {
  it('fails closed when Redis is unavailable', async () => {
    const storage = new RedisThrottlerStorageService({
      getClient: () => ({
        pttl: jest.fn().mockRejectedValue(new Error('Redis unavailable')),
      }),
    } as never);

    const result = await storage.increment('key', 60_000, 5, 0, 'auth');

    expect(result.isBlocked).toBe(true);
    expect(result.totalHits).toBe(6);
  });
});
