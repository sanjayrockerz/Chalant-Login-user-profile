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
      get: jest.fn().mockResolvedValue(user.id),
      del: jest.fn().mockResolvedValue(1),
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
        {
          runAccountMutation: jest.fn(({ commit }: { commit: (tx: any) => unknown }) =>
            commit({
              user: {
                findUnique: jest.fn().mockResolvedValue({ id: user.id, isVerified: false }),
                update: prisma.user.update,
                findUniqueOrThrow: jest.fn().mockResolvedValue({ ...user, isVerified: true }),
              },
            }),
          ),
        } as any,
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

    expect(redis.get).toHaveBeenCalledWith(
      expect.stringMatching(/^canonical:email-verification:[a-f0-9]{64}$/),
    );
    expect(redis.del).toHaveBeenCalledWith(
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

describe("CanonicalAuthService Chat-scoped access tokens", () => {
  const subject = "00000000-0000-4000-8000-000000000031";
  const sessionId = "00000000-0000-4000-8000-000000000032";
  const expiry = Math.floor(Date.now() / 1000) + 240;

  function createChatTokenService(verify = jest.fn().mockReturnValue({
    sub: subject,
    sid: sessionId,
    jti: "d3b9c5d0-e835-4721-a34a-1b4e4e744836",
    typ: "chat-access",
    exp: expiry,
  })) {
    const jwt = { verify, sign: jest.fn().mockReturnValue("chat-scoped.jwt") };
    const prisma = {
      identitySession: {
        findUnique: jest.fn().mockResolvedValue({
          userId: subject,
          expiresAt: new Date((expiry + 100) * 1000),
          revokedAt: null,
        }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: subject,
          username: "canonical_user",
          email: "canonical@example.test",
          isVerified: true,
          accountStatus: UserAccountStatus.ACTIVE,
        }),
      },
    };
    const config = { get: jest.fn(() => "test-signing-secret") };
    const service = new CanonicalAuthService(
      prisma as any,
      jwt as any,
      config as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, jwt, prisma };
  }

  it("issues a short-lived token with a distinct Chat audience and unique jti", async () => {
    const { service, jwt, prisma } = createChatTokenService();
    const issued = await service.issueChatAccessToken(subject, sessionId);

    expect(prisma.identitySession.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: sessionId } }),
    );
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ sub: subject, sid: sessionId, typ: "chat-access", jti: expect.any(String) }),
      expect.objectContaining({ issuer: "r3-canonical-identity", audience: "chat-backend", algorithm: "HS256" }),
    );
    expect(issued).toEqual({ access_token: "chat-scoped.jwt", expires_in: 300 });
  });

  it("validates only Chat audience tokens against the canonical live session", async () => {
    const { service, jwt } = createChatTokenService();
    await expect(service.authenticateChatAccessTokenContext("chat.jwt")).resolves.toMatchObject({
      principal: { subject }, sessionId, tokenId: "d3b9c5d0-e835-4721-a34a-1b4e4e744836", accessTokenExpiresAt: expiry,
    });
    expect(jwt.verify).toHaveBeenCalledWith("chat.jwt", {
      issuer: "r3-canonical-identity", audience: "chat-backend", algorithms: ["HS256"],
    });
  });

  it("rejects a revoked session and malformed Chat token identity", async () => {
    const revoked = createChatTokenService();
    revoked.prisma.identitySession.findUnique.mockResolvedValue({
      userId: subject, expiresAt: new Date((expiry + 100) * 1000), revokedAt: new Date(),
    });
    await expect(revoked.service.authenticateChatAccessTokenContext("revoked.jwt")).rejects.toBeInstanceOf(UnauthorizedException);

    const malformed = createChatTokenService(jest.fn().mockReturnValue({
      sub: subject, sid: sessionId, typ: "canonical-access", exp: expiry,
    }));
    await expect(malformed.service.authenticateChatAccessTokenContext("wrong-type.jwt")).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe("CanonicalAuthService refresh rotation", () => {
  it("persists the successor session inside the transaction that consumes the old one", async () => {
    const user = {
      id: "00000000-0000-4000-8000-000000000021",
      username: "refresh_user",
      email: "refresh@example.test",
      isVerified: true,
      accountStatus: UserAccountStatus.ACTIVE,
    };
    const sessionUpdate = jest.fn().mockRejectedValue(new Error("database unavailable"));
    const rootSessionCreate = jest.fn().mockResolvedValue({ id: "unexpected" });
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: user.id }]),
      identitySession: {
        updateMany: sessionUpdate,
      },
      user: { findUnique: jest.fn().mockResolvedValue(user) },
    };
    const prisma = {
      identitySession: {
        findUnique: jest.fn().mockResolvedValue({
          id: "00000000-0000-4000-8000-000000000022",
          userId: user.id,
          expiresAt: new Date(Date.now() + 60_000),
          revokedAt: null,
        }),
        create: rootSessionCreate,
      },
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    const jwt = { sign: jest.fn().mockReturnValue("access-token") };
    const config = { get: jest.fn().mockReturnValue("test-signing-secret") };
    const service = new CanonicalAuthService(
      prisma as any,
      jwt as any,
      config as any,
      {} as any,
      {} as any,
      {} as any,
      {
        runAccountMutation: jest.fn(({ commit }: { commit: (tx: any) => unknown }) =>
          commit(transaction),
        ),
      } as any,
    );

    await expect(service.refresh("old-refresh-token")).rejects.toThrow(
      "database unavailable",
    );

    expect(sessionUpdate).toHaveBeenCalledTimes(1);
    expect(rootSessionCreate).not.toHaveBeenCalled();
  });
});
