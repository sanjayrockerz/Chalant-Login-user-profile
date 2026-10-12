import { IdentityProvider, LegacyIdentitySource } from "@prisma/client";
import { randomUUID } from "crypto";
import { PrismaService } from "../../prisma/prisma.module";
import { PrismaIdentityRepository } from "./identity.repository";
import { IdentityService } from "./identity.service";
import { toCanonicalUserId } from "./identity.types";
import { IdentityConflictError } from "./identity.errors";

const databaseUrl = process.env.PHASE1_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("identity persistence contract", () => {
  let prisma: PrismaService;
  let repository: PrismaIdentityRepository;
  let service: IdentityService;
  const createdUserIds: string[] = [];

  beforeAll(() => {
    process.env.DATABASE_URL_AUTH = databaseUrl;
    prisma = new PrismaService();
    repository = new PrismaIdentityRepository(prisma);
    service = new IdentityService(repository);
  });

  afterEach(async () => {
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      createdUserIds.length = 0;
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("persists a user, separated password credential, and provider identity uniquely", async () => {
    const suffix = randomUUID();
    const principal = await service.createCanonicalUser({
      username: `phase1_${suffix.slice(0, 8)}`,
      email: `${suffix}@example.test`,
      passwordHash: "test-only-argon2id-hash",
    });
    createdUserIds.push(principal.subject);

    await service.linkProviderIdentity({
      targetUserId: principal.subject,
      identity: {
        provider: IdentityProvider.GOOGLE,
        issuer: "https://accounts.google.com",
        subject: suffix,
      },
      authorization: { actorUserId: principal.subject, reauthenticated: true },
    });

    const stored = await prisma.user.findUnique({
      where: { id: principal.subject },
      include: { passwordCredential: true, identityLinks: true },
    });
    expect(stored?.passwordCredential?.passwordHash).toBe(
      "test-only-argon2id-hash",
    );
    expect(stored?.identityLinks).toHaveLength(1);
  });

  it("rejects concurrent duplicate provider links and duplicate source-qualified mappings", async () => {
    const suffix = randomUUID();
    const principal = await service.createCanonicalUser({
      username: `phase1_${suffix.slice(0, 8)}`,
      email: `${suffix}@example.test`,
      passwordHash: "test-only-argon2id-hash",
    });
    createdUserIds.push(principal.subject);
    const identity = {
      provider: IdentityProvider.APPLE,
      issuer: "https://appleid.apple.com",
      subject: suffix,
    };
    const results = await Promise.allSettled([
      service.linkProviderIdentity({
        targetUserId: principal.subject,
        identity,
        authorization: {
          actorUserId: principal.subject,
          reauthenticated: true,
        },
      }),
      service.linkProviderIdentity({
        targetUserId: principal.subject,
        identity,
        authorization: {
          actorUserId: principal.subject,
          reauthenticated: true,
        },
      }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(2);

    await service.createLegacyMapping({
      targetUserId: toCanonicalUserId(principal.subject),
      source: LegacyIdentitySource.R1,
      originalId: suffix,
    });
    const other = await service.createCanonicalUser({
      username: `phase1_other_${suffix.slice(0, 8)}`,
      email: `other-${suffix}@example.test`,
      passwordHash: "test-only-argon2id-hash",
    });
    createdUserIds.push(other.subject);
    await expect(
      service.createLegacyMapping({
        targetUserId: other.subject,
        source: LegacyIdentitySource.R1,
        originalId: suffix,
      }),
    ).rejects.toBeInstanceOf(IdentityConflictError);
  });
});
