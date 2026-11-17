import { Logger, ServiceUnavailableException } from "@nestjs/common";
import { CanonicalRecoveryService } from "./canonical-recovery.service";

describe("CanonicalRecoveryService", () => {
  it("fails closed while recovery delivery is disabled", async () => {
    const service = new CanonicalRecoveryService(
      {} as never,
      {} as never,
      {} as never,
      { get: () => false } as never,
      {} as never,
    );

    await expect(
      service.requestReset("person@example.com"),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  function dependencies() {
    const configValues: Record<string, unknown> = {
      CANONICAL_RECOVERY_ENABLED: true,
      RECOVERY_RATE_LIMIT: 3,
      RECOVERY_RATE_WINDOW_SECONDS: 3600,
      RECOVERY_TOKEN_TTL_SECONDS: 900,
    };
    const claimEval = jest.fn().mockResolvedValue(1);
    const redis = {
      checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(1),
      get: jest.fn().mockResolvedValue({
        purpose: "password-reset-v1",
        userId: "user-1",
      }),
      getClient: jest.fn(() => ({
        set: jest.fn().mockResolvedValue("OK"),
        eval: claimEval,
      })),
    };
    const email = {
      sendPasswordReset: jest.fn().mockResolvedValue({ accepted: true }),
    };
    const policy = {
      evaluate: jest
        .fn()
        .mockResolvedValue({ compliant: true, hash: "new-hash" }),
    };
    const config = { get: jest.fn((key: string) => configValues[key]) };
    return { claimEval, config, email, policy, redis };
  }

  it("does not enumerate provider-only accounts", async () => {
    const deps = dependencies();
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "user-1",
          email: "person@example.com",
          isVerified: true,
          accountStatus: "ACTIVE",
          passwordCredential: null,
        }),
      },
    };
    const service = new CanonicalRecoveryService(
      prisma as never,
      deps.redis as never,
      deps.email as never,
      deps.config as never,
      deps.policy as never,
    );

    await expect(service.requestReset("person@example.com")).resolves.toEqual({
      message:
        "If the account is eligible, recovery instructions will be sent.",
    });
    expect(deps.email.sendPasswordReset).not.toHaveBeenCalled();
    expect(deps.redis.set).not.toHaveBeenCalled();
  });

  it("issues a reset credential only for an eligible password account", async () => {
    const deps = dependencies();
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "user-1",
          email: "person@example.com",
          isVerified: true,
          accountStatus: "ACTIVE",
          passwordCredential: { userId: "user-1" },
        }),
      },
    };
    const service = new CanonicalRecoveryService(
      prisma as never,
      deps.redis as never,
      deps.email as never,
      deps.config as never,
      deps.policy as never,
    );

    await expect(service.requestReset("person@example.com")).resolves.toEqual({
      message:
        "If the account is eligible, recovery instructions will be sent.",
    });
    expect(deps.redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^canonical-recovery:password-reset-v1:/),
      { purpose: "password-reset-v1", userId: "user-1" },
      900,
    );
    expect(deps.email.sendPasswordReset).toHaveBeenCalledWith(
      "person@example.com",
      expect.any(String),
    );
  });

  it("atomically consumes the credential and revokes active sessions", async () => {
    const deps = dependencies();
    const transaction = {
      passwordRecoveryConsumption: {
        create: jest.fn().mockResolvedValue(undefined),
      },
      user: { update: jest.fn().mockResolvedValue(undefined) },
      identitySession: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "user-1",
          email: "person@example.com",
          username: "person",
          isVerified: true,
          accountStatus: "ACTIVE",
        }),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback(transaction),
      ),
    };
    const service = new CanonicalRecoveryService(
      prisma as never,
      deps.redis as never,
      deps.email as never,
      deps.config as never,
      deps.policy as never,
    );

    await expect(
      service.resetPassword("a".repeat(43), "Strong-password-123!"),
    ).resolves.toBeUndefined();
    expect(deps.redis.get).toHaveBeenCalledWith(
      expect.stringMatching(/^canonical-recovery:password-reset-v1:/),
    );
    expect(deps.redis.del).toHaveBeenCalledWith(
      expect.stringMatching(/^canonical-recovery:password-reset-v1:/),
    );
    expect(transaction.user.update).toHaveBeenCalled();
    const consumptionCall = transaction.passwordRecoveryConsumption.create.mock
      .calls[0] as unknown as [{ data: { tokenHash: string } }];
    expect(consumptionCall[0].data.tokenHash).toEqual(expect.any(String));
    expect(transaction.identitySession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1", revokedAt: null } }),
    );
  });

  it("keeps the recovery token retryable when the password transaction fails", async () => {
    const deps = dependencies();
    const transaction = {
      passwordRecoveryConsumption: {
        create: jest.fn().mockResolvedValue(undefined),
      },
      user: { update: jest.fn().mockResolvedValue(undefined) },
      identitySession: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "user-1",
          email: "person@example.com",
          username: "person",
          isVerified: true,
          accountStatus: "ACTIVE",
        }),
      },
      $transaction: jest
        .fn()
        .mockRejectedValueOnce(new Error("temporary database failure"))
        .mockImplementationOnce((callback: (tx: unknown) => unknown) =>
          callback(transaction),
        ),
    };
    const service = new CanonicalRecoveryService(
      prisma as never,
      deps.redis as never,
      deps.email as never,
      deps.config as never,
      deps.policy as never,
    );

    await expect(
      service.resetPassword("a".repeat(43), "Strong-password-123!"),
    ).rejects.toThrow("temporary database failure");
    expect(deps.redis.del).not.toHaveBeenCalled();
    await expect(
      service.resetPassword("a".repeat(43), "Strong-password-123!"),
    ).resolves.toBeUndefined();
    expect(deps.redis.del).toHaveBeenCalledTimes(1);
  });

  it("releases its claim when the account lookup fails before the transaction", async () => {
    const deps = dependencies();
    const prisma = {
      user: {
        findUnique: jest.fn().mockRejectedValue(new Error("database offline")),
      },
    };
    const service = new CanonicalRecoveryService(
      prisma as never,
      deps.redis as never,
      deps.email as never,
      deps.config as never,
      deps.policy as never,
    );

    await expect(
      service.resetPassword("c".repeat(43), "Strong-password-123!"),
    ).rejects.toThrow("database offline");
    expect(deps.claimEval).toHaveBeenCalledTimes(1);
  });

  it("returns success and logs when Redis cleanup fails after the DB commit", async () => {
    const deps = dependencies();
    deps.redis.del.mockRejectedValue(new Error("Redis unavailable"));
    deps.claimEval.mockRejectedValue(new Error("Redis claim release failed"));
    const transaction = {
      passwordRecoveryConsumption: {
        create: jest.fn().mockResolvedValue(undefined),
      },
      user: { update: jest.fn().mockResolvedValue(undefined) },
      identitySession: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "user-1",
          email: "person@example.com",
          username: "person",
          isVerified: true,
          accountStatus: "ACTIVE",
        }),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback(transaction),
      ),
    };
    const cleanupLog = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    const service = new CanonicalRecoveryService(
      prisma as never,
      deps.redis as never,
      deps.email as never,
      deps.config as never,
      deps.policy as never,
    );

    await expect(
      service.resetPassword("b".repeat(43), "Strong-password-123!"),
    ).resolves.toBeUndefined();
    expect(transaction.passwordRecoveryConsumption.create).toHaveBeenCalled();
    expect(deps.redis.del).toHaveBeenCalledTimes(1);
    expect(cleanupLog).toHaveBeenCalledWith(
      expect.stringContaining("durable replay marker remains authoritative"),
      expect.any(String),
    );
  });
});
