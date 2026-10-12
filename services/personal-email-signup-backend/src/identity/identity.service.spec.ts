import {
  IdentityProvider,
  LegacyIdentitySource,
  UserAccountStatus,
} from "@prisma/client";
import {
  IdentityConflictError,
  IdentityNotFoundError,
  IdentityValidationError,
  UnauthorizedIdentityLinkError,
} from "./identity.errors";
import { IdentityService } from "./identity.service";
import {
  IdentityRepositoryPort,
  IdentityUserRecord,
} from "./identity.repository";
import {
  CanonicalUserId,
  ProviderIdentityKey,
  toCanonicalUserId,
} from "./identity.types";

const USER_ID = toCanonicalUserId("11111111-1111-4111-8111-111111111111");
const OTHER_USER_ID = toCanonicalUserId("22222222-2222-4222-8222-222222222222");

function user(id: CanonicalUserId = USER_ID): IdentityUserRecord {
  return {
    id,
    username: id === USER_ID ? "alice" : "bob",
    email: id === USER_ID ? "alice@example.test" : "bob@example.test",
    isVerified: true,
    accountStatus: UserAccountStatus.ACTIVE,
  };
}

class FakeIdentityRepository implements IdentityRepositoryPort {
  readonly linked: ProviderIdentityKey[] = [];
  readonly mappings = new Map<string, CanonicalUserId>();
  createUserConflict = false;
  users = new Map<string, IdentityUserRecord>([
    [USER_ID, user()],
    [OTHER_USER_ID, user(OTHER_USER_ID)],
  ]);

  createUser(
    username: string,
    email: string,
    passwordHash: string,
  ): Promise<IdentityUserRecord> {
    void passwordHash;
    if (this.createUserConflict) throw new IdentityConflictError("conflict");
    const created = user(
      toCanonicalUserId("33333333-3333-4333-8333-333333333333"),
    );
    const persisted = { ...created, username, email };
    this.users.set(created.id, persisted);
    return Promise.resolve(persisted);
  }

  createProviderUser(
    username: string,
    email: string,
    identity: ProviderIdentityKey,
    displayName?: string,
  ): Promise<IdentityUserRecord> {
    this.linked.push(identity);
    void displayName;
    const created = user(
      toCanonicalUserId("33333333-3333-4333-8333-333333333333"),
    );
    const persisted = { ...created, username, email };
    this.users.set(created.id, persisted);
    return Promise.resolve(persisted);
  }

  setDisplayNameIfMissing(
    _userId: CanonicalUserId,
    _displayName: string,
  ): Promise<void> {
    void _userId;
    void _displayName;
    return Promise.resolve();
  }

  findUserById(userId: CanonicalUserId): Promise<IdentityUserRecord | null> {
    return Promise.resolve(this.users.get(userId) ?? null);
  }

  findByProviderIdentity(
    identity: ProviderIdentityKey,
  ): Promise<IdentityUserRecord | null> {
    void identity;
    return Promise.resolve(null);
  }

  linkProviderIdentity(
    _userId: CanonicalUserId,
    identity: ProviderIdentityKey,
  ): Promise<void> {
    this.linked.push(identity);
    return Promise.resolve();
  }

  findLegacyMapping(
    source: LegacyIdentitySource,
    originalId: string,
  ): Promise<CanonicalUserId | null> {
    return Promise.resolve(
      this.mappings.get(`${source}:${originalId}`) ?? null,
    );
  }

  createLegacyMapping(
    userId: CanonicalUserId,
    source: LegacyIdentitySource,
    originalId: string,
  ): Promise<void> {
    this.mappings.set(`${source}:${originalId}`, userId);
    return Promise.resolve();
  }
}

describe("IdentityService", () => {
  it("creates a canonical principal without exposing credentials", async () => {
    const repository = new FakeIdentityRepository();
    const service = new IdentityService(repository);

    const principal = await service.createCanonicalUser({
      username: "new-user",
      email: "NEW@EXAMPLE.TEST",
      passwordHash: "argon2id-hash",
    });

    expect(principal).toMatchObject({
      accountStatus: UserAccountStatus.ACTIVE,
      email: "new@example.test",
      username: "new-user",
      emailVerified: true,
    });
    expect(typeof principal.subject).toBe("string");
    expect(principal).not.toHaveProperty("passwordHash");
    expect(principal).not.toHaveProperty("sessionHash");
  });

  it("rejects malformed canonical IDs and missing users", async () => {
    const service = new IdentityService(new FakeIdentityRepository());

    await expect(
      service.getCanonicalPrincipal("not-a-uuid"),
    ).rejects.toBeInstanceOf(IdentityValidationError);
    await expect(
      service.getCanonicalPrincipal("44444444-4444-4444-8444-444444444444"),
    ).rejects.toBeInstanceOf(IdentityNotFoundError);
  });

  it("requires fresh authorization for provider linking", async () => {
    const service = new IdentityService(new FakeIdentityRepository());
    const identity = {
      provider: IdentityProvider.GOOGLE,
      issuer: "https://accounts.google.com",
      subject: "sub-1",
    };

    await expect(
      service.linkProviderIdentity({
        targetUserId: USER_ID,
        identity,
        authorization: { actorUserId: OTHER_USER_ID, reauthenticated: true },
      }),
    ).rejects.toBeInstanceOf(UnauthorizedIdentityLinkError);

    await expect(
      service.linkProviderIdentity({
        targetUserId: USER_ID,
        identity,
        authorization: { actorUserId: USER_ID, reauthenticated: true },
      }),
    ).resolves.toBeUndefined();
  });

  it("does not infer legacy identity from an unqualified ID", async () => {
    const repository = new FakeIdentityRepository();
    const service = new IdentityService(repository);
    await service.createLegacyMapping({
      targetUserId: USER_ID,
      source: LegacyIdentitySource.R1,
      originalId: "42",
    });

    expect(await service.findLegacyMapping(LegacyIdentitySource.R1, "42")).toBe(
      USER_ID,
    );
    expect(
      await service.findLegacyMapping(LegacyIdentitySource.R2, "42"),
    ).toBeNull();
  });

  it("preserves repository conflicts instead of silently merging users", async () => {
    const repository = new FakeIdentityRepository();
    repository.createUserConflict = true;
    const service = new IdentityService(repository);

    await expect(
      service.createCanonicalUser({
        username: "alice",
        email: "alice@example.test",
        passwordHash: "hash",
      }),
    ).rejects.toBeInstanceOf(IdentityConflictError);
  });
});
