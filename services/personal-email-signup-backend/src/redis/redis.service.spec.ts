import { RedisService } from "./redis.service";

describe("RedisService rate limiting", () => {
  it("fails closed when Redis is unavailable", async () => {
    const service = {
      client: {
        pttl: jest.fn().mockRejectedValue(new Error("redis unavailable")),
      },
      logger: { error: jest.fn() },
    } as unknown as RedisService;

    await expect(
      RedisService.prototype.checkRateLimit.call(service, "login:user", 5, 60),
    ).rejects.toThrow("redis unavailable");
  });
});
