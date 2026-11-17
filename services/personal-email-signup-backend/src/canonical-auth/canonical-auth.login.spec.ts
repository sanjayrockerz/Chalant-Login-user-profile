import { UnauthorizedException } from "@nestjs/common";
import { UserAccountStatus } from "@prisma/client";
import { CanonicalAuthService } from "./canonical-auth.service";

describe("CanonicalAuthService password login", () => {
  const user: {
    id: string;
    username: string;
    email: string;
    password: null;
    passwordCredential: { passwordHash: string };
    isVerified: boolean;
    accountStatus: UserAccountStatus;
  } = {
    id: "00000000-0000-4000-8000-000000000031",
    username: "canonical_user",
    email: "canonical@example.test",
    password: null,
    passwordCredential: { passwordHash: "" },
    isVerified: true,
    accountStatus: UserAccountStatus.ACTIVE,
  };

  function createService(
    overrides: {
      user?: Partial<typeof user> | null;
      jwtSecret?: string;
    } = {},
  ) {
    const passwordHash =
      "$2a$04$JXLKo9asKjR2mVzUiGQRbOzDaJZvwBIre5NmARZUTQKC1N7lt1IJO";
    const identitySession = {
      create: jest.fn(
        (args: {
          data: { userId: string; sessionHash: string; expiresAt: Date };
          select: { id: true };
        }) => ({ id: args.data.userId }),
      ),
    };
    const transaction = {
      $queryRaw: jest.fn(),
      user: {
        findUnique: jest.fn().mockResolvedValue({
          accountStatus: UserAccountStatus.ACTIVE,
          isVerified: true,
        }),
      },
      identitySession,
    };
    const prisma = {
      $transaction: jest.fn(
        async (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
      user: {
        findUnique: jest.fn().mockResolvedValue(
          overrides.user === null
            ? null
            : {
                ...user,
                ...overrides.user,
                passwordCredential: {
                  passwordHash,
                  ...overrides.user?.passwordCredential,
                },
              },
        ),
      },
      identitySession,
    };
    const jwt = { sign: jest.fn().mockReturnValue("signed-access-token") };
    const config = {
      get: jest.fn((key: string) =>
        key === "JWT_SECRET"
          ? (overrides.jwtSecret ?? "test-signing-secret")
          : undefined,
      ),
    };
    const service = new CanonicalAuthService(
      prisma as never,
      jwt as never,
      config as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, prisma, jwt };
  }

  it("normalizes email and creates a canonical session for a verified active user", async () => {
    const { service, prisma, jwt } = createService();

    const result = await service.login({
      email: "  CANONICAL@example.test ",
      password: "Correct horse battery staple!",
    });

    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "canonical@example.test" } }),
    );
    const session = prisma.identitySession.create.mock.calls[0]?.[0];
    expect(session?.data.userId).toBe(user.id);
    expect(session?.data.sessionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ sub: user.id, typ: "canonical-access" }),
      expect.objectContaining({
        algorithm: "HS256",
        issuer: "r3-canonical-identity",
      }),
    );
    expect(result).toMatchObject({
      access_token: "signed-access-token",
      expires_in: 900,
      user: { subject: user.id, email: user.email, emailVerified: true },
    });
    expect(result.user).not.toHaveProperty("password");
  });

  it("uses the same credential error for an unknown email and a wrong password", async () => {
    const missing = createService({ user: null });
    await expect(
      missing.service.login({
        email: "canonical@example.test",
        password: "wrong",
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const existing = createService();
    await expect(
      existing.service.login({
        email: "canonical@example.test",
        password: "wrong",
      }),
    ).rejects.toThrow("Invalid credentials");
    expect(existing.prisma.identitySession.create).not.toHaveBeenCalled();
  });

  it.each([
    ["suspended", { accountStatus: UserAccountStatus.SUSPENDED }],
    ["unverified", { isVerified: false }],
  ])(
    "rejects a correct password when the account is %s",
    async (_label, override) => {
      const { service, prisma } = createService({ user: override });

      await expect(
        service.login({
          email: "canonical@example.test",
          password: "Correct horse battery staple!",
        }),
      ).rejects.toThrow("Invalid credentials");
      expect(prisma.identitySession.create).not.toHaveBeenCalled();
    },
  );
});
