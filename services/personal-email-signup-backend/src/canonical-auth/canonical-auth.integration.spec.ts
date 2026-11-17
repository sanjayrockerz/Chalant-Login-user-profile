jest.unmock("../config/config.service");

import { INestApplication, UnauthorizedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.module";
import { ConfigService } from "../config/config.service";
import { RedisService } from "../redis/redis.service";
import { CanonicalAuthModule } from "./canonical-auth.module";
import { CanonicalRecoveryService } from "./canonical-recovery.service";
import { Server } from "http";
import request from "supertest";
import { createHash, createHmac, randomBytes } from "crypto";
import { sign as signJwt, decode as decodeJwt } from "jsonwebtoken";

interface RegistrationBody {
  user: { subject: string };
}

interface TokenBody {
  access_token: string;
  refresh_token: string;
}

interface PrincipalBody {
  user: { email: string };
}

const databaseUrl = process.env.PHASE2A_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const introspectionSecret = "phase2a-community-auth-introspection-secret";
const introspectionService = "community-service";
const introspectionKeyId = "community-test-v1";
const introspectionPath = "/internal/v1/auth/token/validate";
const introspectionV2Path = "/internal/v2/auth/token/validate";

describeDatabase("canonical password authentication HTTP contract", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let recovery: CanonicalRecoveryService;
  let server: Server;
  const emails: string[] = [];
  const authSubjects: string[] = [];
  const recoveryTokenHashes: string[] = [];
  const recoveryRedisKeys: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL_AUTH = databaseUrl;
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6399";
    process.env.COOKIE_SECRET = "phase2a-test-cookie-secret";
    process.env.JWT_SECRET = "phase2a-test-signing-secret-change-me";
    process.env.AUTH_INTROSPECTION_CLIENTS_JSON = JSON.stringify({
      [introspectionService]: {
        protocolVersions: ["v1", "v2"],
        keys: { [introspectionKeyId]: introspectionSecret },
        audiences: ["community-api"],
        scopes: ["auth:token:validate"],
      },
    });
    process.env.NODE_ENV = "test";
    process.env.CANONICAL_RECOVERY_ENABLED = "true";
    const moduleRef = await Test.createTestingModule({
      imports: [CanonicalAuthModule],
    }).compile();
    expect(
      moduleRef.get(ConfigService).get("AUTH_INTROSPECTION_CLIENTS"),
    ).toHaveProperty(introspectionService);
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as unknown as Server;
    prisma = moduleRef.get(PrismaService);
    redis = moduleRef.get(RedisService);
    recovery = moduleRef.get(CanonicalRecoveryService);
  });

  afterEach(async () => {
    if (emails.length > 0) {
      await prisma.outboxEvent.deleteMany({
        where: { aggregateId: { in: authSubjects } },
      });
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
      emails.length = 0;
      authSubjects.length = 0;
    }
    if (recoveryTokenHashes.length > 0) {
      await prisma.passwordRecoveryConsumption.deleteMany({
        where: { tokenHash: { in: recoveryTokenHashes } },
      });
      recoveryTokenHashes.length = 0;
    }
    if (recoveryRedisKeys.length > 0) {
      await Promise.all(recoveryRedisKeys.map((key) => redis.del(key)));
      recoveryRedisKeys.length = 0;
    }
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  async function registerAndVerify(email: string, username: string) {
    emails.push(email);
    const registration = await request(server)
      .post("/auth/register")
      .send({
        email,
        username,
        password: "A sufficiently unique passphrase 2026!",
      })
      .expect(201);
    await prisma.user.update({
      where: { email },
      data: { isVerified: true },
    });
    const subject = (registration.body as RegistrationBody).user.subject;
    authSubjects.push(subject);
    return subject;
  }

  function signIntrospectionRequest(token: string) {
    const body = {
      token,
      audience: "community-api",
      scope: "auth:token:validate",
    };
    const timestamp = String(Math.floor(Date.now() / 1000));
    const canonical = JSON.stringify([
      Number(timestamp),
      introspectionService,
      "POST",
      introspectionPath,
      body.audience,
      body.scope,
      body.token,
    ]);
    return {
      body,
      headers: {
        "x-auth-service-id": introspectionService,
        "x-auth-key-id": introspectionKeyId,
        "x-auth-timestamp": timestamp,
        "x-auth-signature": createHmac("sha256", introspectionSecret)
          .update(canonical)
          .digest("hex"),
      },
    };
  }

  function signIntrospectionV2Request(
    token: string,
    nonce = randomBytes(32).toString("base64url"),
  ) {
    const body = {
      token,
      audience: "community-api",
      scope: "auth:token:validate",
    };
    const timestamp = String(Math.floor(Date.now() / 1000));
    const bodyDigest = createHash("sha256")
      .update(JSON.stringify(body))
      .digest("hex");
    const canonical = JSON.stringify([
      2,
      Number(timestamp),
      introspectionService,
      "POST",
      introspectionV2Path,
      "",
      nonce,
      bodyDigest,
      body.audience,
      body.scope,
    ]);
    return {
      body,
      headers: {
        "x-auth-service-id": introspectionService,
        "x-auth-key-id": introspectionKeyId,
        "x-auth-timestamp": timestamp,
        "x-auth-nonce": nonce,
        "x-auth-signature": createHmac("sha256", introspectionSecret)
          .update(canonical)
          .digest("hex"),
      },
    };
  }

  it("validates an Auth-issued token through the registered service-authenticated endpoint", async () => {
    const email = `phase2a-introspection-${Date.now()}@example.test`;
    const subject = await registerAndVerify(
      email,
      `phase2a_introspect_${Date.now()}`,
    );
    const login = await request(server)
      .post("/auth/login")
      .send({ email, password: "A sufficiently unique passphrase 2026!" })
      .expect(200);
    const signed = signIntrospectionRequest(
      (login.body as TokenBody).access_token,
    );

    const result = await request(server)
      .post(introspectionPath)
      .set(signed.headers)
      .send(signed.body)
      .expect(200);

    expect(result.body).toMatchObject({
      contractVersion: 1,
      subject,
      accountStatus: "ACTIVE",
      emailVerified: true,
      service: {
        id: introspectionService,
        audience: "community-api",
        scope: "auth:token:validate",
      },
    });
    expect(result.body).not.toHaveProperty("email");
    expect(result.body).not.toHaveProperty("username");
    expect(JSON.stringify(result.body)).not.toContain(
      (login.body as TokenBody).access_token,
    );

    await request(server)
      .post("/auth/logout")
      .send({ refresh_token: (login.body as TokenBody).refresh_token })
      .expect(204);
    await request(server)
      .post(introspectionPath)
      .set(signed.headers)
      .send(signed.body)
      .expect(401);
  });

  it("atomically rejects a concurrent replay of a correctly signed v2 request", async () => {
    const email = `phase2a-introspection-v2-${Date.now()}@example.test`;
    await registerAndVerify(email, `phase2a_v2_${Date.now()}`);
    const login = await request(server)
      .post("/auth/login")
      .send({ email, password: "A sufficiently unique passphrase 2026!" })
      .expect(200);
    const signed = signIntrospectionV2Request(
      (login.body as TokenBody).access_token,
    );

    const responses = await Promise.all(
      [0, 1].map(() =>
        request(server)
          .post(introspectionV2Path)
          .set(signed.headers)
          .send(signed.body),
      ),
    );
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 401]);
    expect(
      (
        responses.find(({ status }) => status === 200)?.body as {
          contractVersion?: number;
        }
      )?.contractVersion,
    ).toBe(2);
  });

  it("rejects invalid service signatures and an altered end-user token", async () => {
    const email = `phase2a-introspection-deny-${Date.now()}@example.test`;
    await registerAndVerify(email, `phase2a_introspect_deny_${Date.now()}`);
    const login = await request(server)
      .post("/auth/login")
      .send({ email, password: "A sufficiently unique passphrase 2026!" })
      .expect(200);
    const originalToken = (login.body as TokenBody).access_token;
    const altered = signIntrospectionRequest(`${originalToken.slice(0, -1)}x`);

    await request(server)
      .post(introspectionPath)
      .set({ ...altered.headers, "x-auth-signature": "0".repeat(64) })
      .send(altered.body)
      .expect(401);
    await request(server)
      .post(introspectionPath)
      .set(altered.headers)
      .send(altered.body)
      .expect(401);
  });

  it("rejects wrong issuer, audience, algorithm, and token type", async () => {
    const email = `phase2a-introspection-claims-${Date.now()}@example.test`;
    await registerAndVerify(email, `phase2a_introspect_claims_${Date.now()}`);
    const login = await request(server)
      .post("/auth/login")
      .send({ email, password: "A sufficiently unique passphrase 2026!" })
      .expect(200);
    const validToken = (login.body as TokenBody).access_token;
    const claims = decodeJwt(validToken) as Record<string, unknown>;
    const secret = "phase2a-test-signing-secret-change-me";
    const variants = [
      signJwt(
        { sub: claims.sub, sid: claims.sid, typ: "canonical-access" },
        secret,
        {
          issuer: "wrong-issuer",
          audience: "r3-api",
          expiresIn: "5m",
          algorithm: "HS256",
        },
      ),
      signJwt(
        { sub: claims.sub, sid: claims.sid, typ: "canonical-access" },
        secret,
        {
          issuer: "r3-canonical-identity",
          audience: "wrong-audience",
          expiresIn: "5m",
          algorithm: "HS256",
        },
      ),
      signJwt(
        { sub: claims.sub, sid: claims.sid, typ: "canonical-access" },
        secret,
        {
          issuer: "r3-canonical-identity",
          audience: "r3-api",
          expiresIn: "5m",
          algorithm: "HS512",
        },
      ),
      signJwt({ sub: claims.sub, sid: claims.sid, typ: "refresh" }, secret, {
        issuer: "r3-canonical-identity",
        audience: "r3-api",
        expiresIn: "5m",
        algorithm: "HS256",
      }),
    ];

    for (const token of variants) {
      const signed = signIntrospectionRequest(token);
      await request(server)
        .post(introspectionPath)
        .set(signed.headers)
        .send(signed.body)
        .expect(401);
    }
  });

  it("rejects current tokens for suspended and disabled accounts", async () => {
    for (const accountStatus of ["SUSPENDED", "DISABLED"] as const) {
      const suffix = `${accountStatus.toLowerCase()}-${Date.now()}`;
      const email = `phase2a-introspection-${suffix}@example.test`;
      const subject = await registerAndVerify(email, `phase2a_${suffix}`);
      const login = await request(server)
        .post("/auth/login")
        .send({ email, password: "A sufficiently unique passphrase 2026!" })
        .expect(200);
      await prisma.user.update({
        where: { id: subject },
        data: { accountStatus },
      });
      const signed = signIntrospectionRequest(
        (login.body as TokenBody).access_token,
      );
      await request(server)
        .post(introspectionPath)
        .set(signed.headers)
        .send(signed.body)
        .expect(401);
    }
  });

  it("registers a canonical credential without issuing a pre-verification session", async () => {
    const email = `phase2a-${Date.now()}@example.test`;
    const subject = await registerAndVerify(email, `phase2a_${Date.now()}`);
    expect(subject).toMatch(/[0-9a-f-]{36}/i);
    const stored = await prisma.user.findUnique({
      where: { email },
      include: { passwordCredential: true },
    });
    expect(stored?.passwordCredential?.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it("rejects malformed recovery DTOs before service execution", async () => {
    await request(server).post("/auth/recovery/request").send({}).expect(400);

    await request(server)
      .post("/auth/recovery/request")
      .send({ email: "person@example.test", unexpected: "field" })
      .expect(400);
  });

  it("rolls back token consumption with a failed password transaction and rejects replay after commit", async () => {
    const suffix = `${Date.now()}-${randomBytes(4).toString("hex")}`;
    const email = `phase2a-recovery-atomic-${suffix}@example.test`;
    emails.push(email);
    const user = await prisma.user.create({
      data: {
        email,
        username: `phase2a_recovery_${suffix}`,
        password: "old-password-hash",
        isVerified: true,
        passwordCredential: { create: { passwordHash: "old-password-hash" } },
      },
    });
    authSubjects.push(user.id);
    await prisma.identitySession.create({
      data: {
        userId: user.id,
        sessionHash: randomBytes(32).toString("hex"),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    recoveryTokenHashes.push(tokenHash);
    const redisKey = `canonical-recovery:password-reset-v1:${tokenHash}`;
    recoveryRedisKeys.push(redisKey);
    const tokenRecord = { purpose: "password-reset-v1", userId: user.id };
    await redis.set(redisKey, tokenRecord, 900);

    const originalTransaction = prisma.$transaction.bind(prisma) as (
      callback: (transaction: unknown) => Promise<void>,
    ) => Promise<void>;
    const prismaWithTransactionOverride = prisma as unknown as {
      $transaction: (
        callback: (transaction: unknown) => Promise<void>,
      ) => Promise<void>;
    };
    prismaWithTransactionOverride.$transaction = (callback) =>
      originalTransaction(async (transaction) => {
        await callback(transaction);
        throw new Error("forced transaction rollback");
      });
    await expect(
      recovery.resetPassword(rawToken, "Strong-password-123!"),
    ).rejects.toThrow("forced transaction rollback");
    prismaWithTransactionOverride.$transaction = originalTransaction;

    expect(
      await prisma.passwordRecoveryConsumption.count({ where: { tokenHash } }),
    ).toBe(0);
    expect(
      await prisma.outboxEvent.count({
        where: { aggregateId: user.id, eventType: "auth.lifecycle.v1" },
      }),
    ).toBe(0);
    expect(await redis.get(redisKey)).toEqual(tokenRecord);

    await recovery.resetPassword(rawToken, "Strong-password-123!");
    expect(
      await prisma.passwordRecoveryConsumption.count({ where: { tokenHash } }),
    ).toBe(1);
    const committedLifecycleEvents = await prisma.outboxEvent.findMany({
      where: { aggregateId: user.id, eventType: "auth.lifecycle.v1" },
    });
    expect(committedLifecycleEvents).toHaveLength(1);
    expect(committedLifecycleEvents[0]?.payload).toMatchObject({
      eventType: "auth.lifecycle.v1",
      version: 1,
      subject: user.id,
      action: "SESSION_REVOKED",
      scope: "SESSION",
    });
    expect(
      typeof (committedLifecycleEvents[0]?.payload as Record<string, unknown>)
        .occurredAt,
    ).toBe("string");
    expect(committedLifecycleEvents[0]?.id).toBe(
      (committedLifecycleEvents[0]?.payload as Record<string, unknown>).eventId,
    );

    // Model a crash after PostgreSQL commits but before Redis cleanup: restoring
    // the token record must still fail at the durable database unique key.
    await redis.set(redisKey, tokenRecord, 900);
    await expect(
      recovery.resetPassword(rawToken, "Another-strong-password-456!"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("allows only one concurrent HTTP redemption and revokes active sessions", async () => {
    const suffix = `${Date.now()}-${randomBytes(4).toString("hex")}`;
    const email = `phase2a-recovery-concurrent-${suffix}@example.test`;
    emails.push(email);
    const user = await prisma.user.create({
      data: {
        email,
        username: `phase2a_recover_${suffix}`,
        password: "old-password-hash",
        isVerified: true,
        passwordCredential: { create: { passwordHash: "old-password-hash" } },
      },
    });
    authSubjects.push(user.id);
    const session = await prisma.identitySession.create({
      data: {
        userId: user.id,
        sessionHash: randomBytes(32).toString("hex"),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    recoveryTokenHashes.push(tokenHash);
    const redisKey = `canonical-recovery:password-reset-v1:${tokenHash}`;
    recoveryRedisKeys.push(redisKey);
    await redis.set(
      redisKey,
      { purpose: "password-reset-v1", userId: user.id },
      900,
    );

    const results = await Promise.all([
      request(server)
        .post("/auth/recovery/reset")
        .send({ token: rawToken, password: "Strong-password-123!" }),
      request(server)
        .post("/auth/recovery/reset")
        .send({ token: rawToken, password: "Another-strong-password-456!" }),
    ]);
    expect(results.map(({ status }) => status).sort()).toEqual([204, 401]);
    expect(
      await prisma.passwordRecoveryConsumption.count({ where: { tokenHash } }),
    ).toBe(1);
    expect(
      await prisma.identitySession.count({
        where: { userId: user.id, revokedAt: { not: null } },
      }),
    ).toBe(1);
    const lifecycleEvents = await prisma.outboxEvent.findMany({
      where: { aggregateId: user.id, eventType: "auth.lifecycle.v1" },
    });
    expect(lifecycleEvents).toHaveLength(1);
    expect(lifecycleEvents[0]?.payload).toMatchObject({
      eventId: lifecycleEvents[0]?.id,
      eventType: "auth.lifecycle.v1",
      version: 1,
      subject: user.id,
      action: "SESSION_REVOKED",
      scope: "SESSION",
      sessionId: session.id,
    });
    expect(await redis.get(redisKey)).toBeNull();
  });

  it("rejects unknown registration and login properties before auth service execution", async () => {
    const email = `phase2a-strict-dto-${Date.now()}@example.test`;
    emails.push(email);
    await request(server)
      .post("/auth/register")
      .send({
        email,
        username: `phase2a_strict_${Date.now()}`,
        password: "A sufficiently unique passphrase 2026!",
        accountStatus: "ACTIVE",
      })
      .expect(400);

    await request(server)
      .post("/auth/login")
      .send({ email, password: "not-a-real-password", serviceRole: "admin" })
      .expect(400);
  });

  it("returns one public login error for unknown, unverified, and inactive accounts", async () => {
    const suffix = Date.now();
    const unverifiedEmail = `phase2a-enum-unverified-${suffix}@example.test`;
    emails.push(unverifiedEmail);
    await request(server)
      .post("/auth/register")
      .send({
        email: unverifiedEmail,
        username: `phase2a_enum_u_${suffix}`,
        password: "A sufficiently unique passphrase 2026!",
      })
      .expect(201);

    const inactiveEmail = `phase2a-enum-inactive-${suffix}@example.test`;
    const inactiveUserId = await registerAndVerify(
      inactiveEmail,
      `phase2a_enum_i_${suffix}`,
    );
    await prisma.user.update({
      where: { id: inactiveUserId },
      data: { accountStatus: "SUSPENDED" },
    });

    const password = "A sufficiently unique passphrase 2026!";
    const responses = await Promise.all(
      [
        { email: `missing-${suffix}@example.test`, password },
        { email: unverifiedEmail, password },
        { email: inactiveEmail, password },
      ].map(({ email: loginEmail, password: loginPassword }) =>
        request(server)
          .post("/auth/login")
          .send({ email: loginEmail, password: loginPassword }),
      ),
    );
    expect(responses.map(({ status }) => status)).toEqual([401, 401, 401]);
    expect(responses.map(({ text }) => text)).toEqual([
      responses[0].text,
      responses[0].text,
      responses[0].text,
    ]);
  });

  it("logs in, resolves the canonical principal, rotates refresh tokens, and revokes logout", async () => {
    const email = `phase2a-flow-${Date.now()}@example.test`;
    await registerAndVerify(email, `phase2a_flow_${Date.now()}`);
    const login = await request(server)
      .post("/auth/login")
      .send({ email, password: "A sufficiently unique passphrase 2026!" })
      .expect(200);
    const loginBody = login.body as TokenBody;
    expect(loginBody.access_token).toEqual(expect.any(String));
    expect(loginBody.refresh_token).toEqual(expect.any(String));

    await request(server)
      .get("/auth/me")
      .set("Authorization", `Bearer ${loginBody.access_token}`)
      .expect(200)
      .expect(({ body }) => {
        const principalBody = body as PrincipalBody;
        expect(principalBody.user.email).toBe(email);
      });

    const rotated = await request(server)
      .post("/auth/refresh")
      .send({ refresh_token: loginBody.refresh_token })
      .expect(200);
    const rotatedBody = rotated.body as TokenBody;
    expect(rotatedBody.refresh_token).not.toBe(loginBody.refresh_token);
    await request(server)
      .post("/auth/refresh")
      .send({ refresh_token: loginBody.refresh_token })
      .expect(401);

    await request(server)
      .post("/auth/logout")
      .send({ refresh_token: rotatedBody.refresh_token })
      .expect(204);
    await request(server)
      .post("/auth/refresh")
      .send({ refresh_token: rotatedBody.refresh_token })
      .expect(401);
  });

  it("keeps the old refresh session usable when successor persistence fails", async () => {
    const email = `phase2a-refresh-rollback-${Date.now()}@example.test`;
    const username = `phase2a_refresh_rollback_${Date.now()}`;
    const subject = await registerAndVerify(email, username);
    const login = await request(server)
      .post("/auth/login")
      .send({ email, password: "A sufficiently unique passphrase 2026!" })
      .expect(200);
    const refreshToken = (login.body as TokenBody).refresh_token;
    const triggerName = `fail_refresh_successor_${Date.now()}`;
    const functionName = `reject_refresh_successor_${Date.now()}`;

    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
      BEGIN
        IF NEW.user_id = '${subject}'::uuid AND NEW.revoked_at IS NULL THEN
          RAISE EXCEPTION 'injected refresh successor failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON identity_sessions
      FOR EACH ROW EXECUTE FUNCTION ${functionName}()
    `);

    try {
      await request(server)
        .post("/auth/refresh")
        .send({ refresh_token: refreshToken })
        .expect(500);

      const oldSession = await prisma.identitySession.findFirstOrThrow({
        where: { userId: subject, revokedAt: null },
        orderBy: { createdAt: "desc" },
      });
      expect(oldSession.revokedAt).toBeNull();
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS ${triggerName} ON identity_sessions`,
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS ${functionName}()`,
      );
    }

    const retry = await request(server)
      .post("/auth/refresh")
      .send({ refresh_token: refreshToken })
      .expect(200);
    expect((retry.body as TokenBody).refresh_token).not.toBe(refreshToken);
  });

  it("allows only one successor when two requests rotate the same refresh token concurrently", async () => {
    const email = `phase2a-refresh-race-${Date.now()}@example.test`;
    const subject = await registerAndVerify(
      email,
      `phase2a_refresh_race_${Date.now()}`,
    );
    const login = await request(server)
      .post("/auth/login")
      .send({ email, password: "A sufficiently unique passphrase 2026!" })
      .expect(200);
    const refreshToken = (login.body as TokenBody).refresh_token;

    const results = await Promise.all(
      [0, 1].map(() =>
        request(server)
          .post("/auth/refresh")
          .send({ refresh_token: refreshToken }),
      ),
    );
    expect(results.map((response) => response.status).sort()).toEqual([
      200, 401,
    ]);
    expect(
      await prisma.identitySession.count({
        where: { userId: subject, revokedAt: null },
      }),
    ).toBe(1);
    expect(
      await prisma.identitySession.count({ where: { userId: subject } }),
    ).toBe(2);
  });

  it("makes logout-all revoke a successor created by a concurrent refresh", async () => {
    const email = `phase2a-logout-refresh-race-${Date.now()}@example.test`;
    const subject = await registerAndVerify(
      email,
      `phase2a_logout_refresh_${Date.now()}`,
    );
    const login = await request(server)
      .post("/auth/login")
      .send({ email, password: "A sufficiently unique passphrase 2026!" })
      .expect(200);
    const loginBody = login.body as TokenBody;
    const triggerName = `delay_refresh_successor_${Date.now()}`;
    const functionName = `delay_refresh_successor_fn_${Date.now()}`;

    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
      BEGIN
        IF NEW.user_id = '${subject}'::uuid AND NEW.revoked_at IS NULL THEN
          PERFORM pg_sleep(1.5);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON identity_sessions
      FOR EACH ROW EXECUTE FUNCTION ${functionName}()
    `);

    try {
      const refresh = request(server)
        .post("/auth/refresh")
        .send({ refresh_token: loginBody.refresh_token })
        .then((response) => response);
      const sleepDeadline = Date.now() + 5_000;
      let triggerSleeping = false;
      while (Date.now() < sleepDeadline) {
        const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) AS count
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND usename = current_user
            AND wait_event = 'PgSleep'
        `;
        if (Number(rows[0]?.count ?? 0) > 0) {
          triggerSleeping = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(triggerSleeping).toBe(true);

      const revokeAll = request(server)
        .post("/auth/sessions/revoke-all")
        .set("Authorization", `Bearer ${loginBody.access_token}`);
      const [refreshResponse, revokeResponse] = await Promise.all([
        refresh,
        revokeAll,
      ]);
      expect(refreshResponse.status).toBe(200);
      expect(revokeResponse.status).toBe(204);
      expect(
        await prisma.identitySession.count({
          where: { userId: subject, revokedAt: null },
        }),
      ).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS ${triggerName} ON identity_sessions`,
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS ${functionName}()`,
      );
    }
  });

  it("rejects wrong credentials, duplicate registration, unverified login, and missing authentication", async () => {
    const email = `phase2a-deny-${Date.now()}@example.test`;
    emails.push(email);
    await request(server)
      .post("/auth/register")
      .send({
        email,
        username: `phase2a_deny_${Date.now()}`,
        password: "A sufficiently unique passphrase 2026!",
      })
      .expect(201);
    await request(server)
      .post("/auth/login")
      .send({ email, password: "wrong password" })
      .expect(401);
    await request(server)
      .post("/auth/login")
      .send({ email, password: "A sufficiently unique passphrase 2026!" })
      .expect(401);
    await request(server)
      .post("/auth/register")
      .send({
        email,
        username: `phase2a_duplicate_${Date.now()}`,
        password: "A sufficiently unique passphrase 2026!",
      })
      .expect(409);
    await request(server).get("/auth/me").expect(401);
  });
});
