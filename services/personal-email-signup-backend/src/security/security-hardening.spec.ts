import { BadRequestException } from '@nestjs/common';
import { UsernameController } from '../user/username.controller';
import { ProfileController } from '../user/profile.controller';
import { HtmlSanitizerService } from './html-sanitizer.service';
import { RateLimiterService } from '../rate_limiter/rate_limiter.service';

jest.mock('../events/audit-emitter', () => ({
  emitAudit: jest.fn().mockResolvedValue(undefined),
  buildAuditEvent: jest.fn(() => ({})),
}));
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-correlation-id'),
}));

describe('Security Hardening', () => {
  describe('Injection defenses', () => {
    it('rejects SQL injection payloads in username availability checks', async () => {
      const controller = new UsernameController(
        {
          findByNormalizedUsername: jest.fn().mockResolvedValue(null),
          findByUsername: jest.fn().mockResolvedValue(null),
        } as any,
        {
          get: jest.fn((key: string) => {
            if (key === 'REQUIRE_USERNAME_NORMALIZATION') {
              return true;
            }
            if (key === 'REQUIRE_USERNAME_DENYLIST') {
              return true;
            }
            return undefined;
          }),
        } as any,
        {
          requestLatencySeconds: { observe: jest.fn() },
          incrementUsernameChecks: jest.fn(),
        } as any,
        { trackUsernameEnumeration: jest.fn().mockResolvedValue(undefined) } as any,
      );

      const request = { ip: '203.0.113.1', headers: {} } as any;
      await expect(controller.available("' OR 1=1 --", request)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('XSS defenses', () => {
    it('sanitizes script content out of pronoun updates', async () => {
      const userService = {
        updateUser: jest.fn().mockResolvedValue({}),
      };
      const metricsService = {
        incrementPronounsSet: jest.fn(),
        observeRequestLatency: jest.fn(),
      };
      const sanitizer = new HtmlSanitizerService();

      const controller = new ProfileController(
        userService as any,
        metricsService as any,
        sanitizer,
      );

      const req = {
        user: { id: 'user-123' },
        headers: { 'x-correlation-id': 'corr-1' },
      } as any;

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as any;

      await controller.setPronouns(req, res, { pronouns: "<script>alert('x')</script>they/them" });

      expect(userService.updateUser).toHaveBeenCalledTimes(1);
      const updateArgs = userService.updateUser.mock.calls[0][1];
      expect(updateArgs.pronouns).toMatch(/they\/them/);
      expect(updateArgs.pronouns).not.toContain('<');
      expect(updateArgs.pronouns).not.toContain('>');
    });
  });

  describe('Rate-limit stress tests', () => {
    it('blocks requests that exceed configured thresholds', async () => {
      class RedisStub {
        private counts = new Map<string, number>();

        async checkRateLimit(key: string, limit: number, windowSeconds: number) {
          const count = (this.counts.get(key) ?? 0) + 1;
          this.counts.set(key, count);
          return {
            allowed: count <= limit,
            remaining: Math.max(limit - count, 0),
            resetTime: Date.now() + windowSeconds * 1000,
          };
        }

        async incrementWindow() {
          return { count: 1, ttlSeconds: 60 };
        }
      }

      const redisStub = new RedisStub();
      const service = new RateLimiterService(redisStub as unknown as any);

      const limit = 3;
      const windowSeconds = 60;
      const results: Array<{ allowed: boolean }> = [];

      for (let i = 0; i < 5; i += 1) {
        const result = await service.checkAndIncrement('ip', 'client', limit, windowSeconds);
        results.push(result);
      }

      const blocked = results.filter((result) => !result.allowed);
      expect(blocked.length).toBeGreaterThan(0);
    });
  });

  describe('IDOR protections', () => {
    it('denies profile updates when user context is missing', async () => {
      const controller = new ProfileController(
        { updateUser: jest.fn() } as any,
        {
          incrementPronounsSet: jest.fn(),
          observeRequestLatency: jest.fn(),
        } as any,
        new HtmlSanitizerService(),
      );

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as any;

      await controller.setPronouns({ headers: {} } as any, res, { pronouns: 'they/them' });

      expect(res.status).toHaveBeenCalledWith(401);
    });
  });
});
