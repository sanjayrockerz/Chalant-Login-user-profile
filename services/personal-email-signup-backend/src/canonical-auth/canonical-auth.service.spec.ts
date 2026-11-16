import {
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
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
    const createProvisioningEvent = jest.fn().mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000002",
    });
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
          outboxEvent: { create: createProvisioningEvent },
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
      createProvisioningEvent,
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

  it("stores Chat profile provisioning intent in the user creation transaction", async () => {
    const { service, prisma, createProvisioningEvent } = createService();

    await service.register({
      email: user.email,
      username: user.username,
      password: "A sufficiently strong password 2026!",
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(createProvisioningEvent).toHaveBeenCalledWith({
      data: {
        eventType: "chat.profile.provision.v1",
        aggregateId: user.id,
        payload: { authUserId: user.id },
      },
    });
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

describe("CanonicalAuthService canonical access token validation", () => {
  const subject = "00000000-0000-4000-8000-000000000011";
  const sessionId = "00000000-0000-4000-8000-000000000012";
  const expiry = Math.floor(Date.now() / 1000) + 300;

  function createValidationService(
    overrides: {
      verify?: jest.Mock;
      findSession?: jest.Mock;
      findUser?: jest.Mock;
    } = {},
  ) {
    const jwt = {
      verify:
        overrides.verify ??
        jest.fn().mockReturnValue({
          sub: subject,
          sid: sessionId,
          typ: "canonical-access",
          exp: expiry,
        }),
    };
    const prisma = {
      identitySession: {
        findUnique:
          overrides.findSession ??
          jest.fn().mockResolvedValue({
            userId: subject,
            expiresAt: new Date((expiry + 300) * 1000),
            revokedAt: null,
          }),
      },
      user: {
        findUnique:
          overrides.findUser ??
          jest.fn().mockResolvedValue({
            id: subject,
            username: "canonical_user",
            email: "canonical@example.test",
            isVerified: true,
            accountStatus: UserAccountStatus.ACTIVE,
          }),
      },
    };
    const service = new CanonicalAuthService(
      prisma as any,
      jwt as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, jwt, prisma };
  }

  it("pins verification to the canonical HS256 issuer and audience and returns expiry", async () => {
    const { service, jwt } = createValidationService();

    const context = await service.authenticateAccessTokenContext("signed.jwt");

    expect(jwt.verify).toHaveBeenCalledWith("signed.jwt", {
      issuer: "r3-canonical-identity",
      audience: "r3-api",
      algorithms: ["HS256"],
    });
    expect(context).toMatchObject({
      principal: { subject },
      sessionId,
      accessTokenExpiresAt: expiry,
    });
  });

  it("rejects tokens without a numeric expiry", async () => {
    const { service } = createValidationService({
      verify: jest.fn().mockReturnValue({
        sub: subject,
        sid: sessionId,
        typ: "canonical-access",
      }),
    });

    await expect(
      service.authenticateAccessTokenContext("missing-exp.jwt"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects revoked sessions", async () => {
    const { service } = createValidationService({
      findSession: jest.fn().mockResolvedValue({
        userId: subject,
        expiresAt: new Date((expiry + 300) * 1000),
        revokedAt: new Date(),
      }),
    });

    await expect(
      service.authenticateAccessTokenContext("revoked.jwt"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("fails closed as temporarily unavailable when session authority cannot be reached", async () => {
    const { service } = createValidationService({
      findSession: jest.fn().mockRejectedValue(new Error("database offline")),
    });

    await expect(
      service.authenticateAccessTokenContext("valid.jwt"),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
