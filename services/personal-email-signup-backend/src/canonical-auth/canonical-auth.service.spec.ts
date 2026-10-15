import { UserAccountStatus } from "@prisma/client";
import { CanonicalAuthService } from "./canonical-auth.service";

describe("CanonicalAuthService email verification", () => {
  const user = {
    id: "00000000-0000-4000-8000-000000000001",
    username: "new_user",
    email: "new@example.test",
    isVerified: false,
    accountStatus: UserAccountStatus.ACTIVE,
  };

  function createService() {
    const config = {
      get: jest.fn((key: string) => {
        const values: Record<string, unknown> = {
          EMAIL_VERIFICATION_TOKEN_TTL_SECONDS: 86400,
          EMAIL_DELIVERY_ENABLED: false,
          JWT_SECRET: "test-secret",
        };
        return values[key];
      }),
    };
    const prisma = {
      $transaction: jest.fn((callback: (tx: any) => unknown) =>
        callback({
          user: { create: jest.fn().mockResolvedValue(user) },
        }),
      ),
      user: {
        update: jest.fn().mockResolvedValue({
          ...user,
          isVerified: true,
        }),
      },
    };
    const redis = {
      set: jest.fn().mockResolvedValue(undefined),
      getAndDelete: jest.fn().mockResolvedValue(user.id),
    };
    const passwordPolicy = {
      evaluate: jest.fn().mockResolvedValue({
        compliant: true,
        hash: "$2b$10$test-hash",
        violations: [],
      }),
    };
    const email = { sendVerificationEmail: jest.fn() };

    return {
      service: new CanonicalAuthService(
        prisma as any,
        {} as any,
        config as any,
        passwordPolicy as any,
        email as any,
        redis as any,
      ),
      config,
      prisma,
      redis,
      email,
    };
  }

  it("stores a one-time verification token without issuing a session", async () => {
    const { service, redis, email } = createService();

    const result = await service.register({
      email: user.email,
      username: user.username,
      password: "A sufficiently strong password 2026!",
    });

    expect(result.status).toBe("verification_required");
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^canonical:email-verification:[a-f0-9]{64}$/),
      user.id,
      86400,
    );
    expect(email.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("atomically consumes the token and marks the canonical user verified", async () => {
    const { service, prisma, redis } = createService();

    const result = await service.verifyEmail("opaque-verification-token");

    expect(redis.getAndDelete).toHaveBeenCalledWith(
      expect.stringMatching(/^canonical:email-verification:[a-f0-9]{64}$/),
    );
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: user.id },
        data: { isVerified: true },
      }),
    );
    expect(result.status).toBe("verified");
  });
});
