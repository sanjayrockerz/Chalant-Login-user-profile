jest.unmock("../config/config.service");

import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.module";
import { ConfigService } from "../config/config.service";
import { CanonicalAuthModule } from "./canonical-auth.module";
import { Server } from "http";
import request from "supertest";
import { createHmac } from "crypto";
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

describeDatabase("canonical password authentication HTTP contract", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  const emails: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL_AUTH = databaseUrl;
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6399";
    process.env.COOKIE_SECRET = "phase2a-test-cookie-secret";
    process.env.JWT_SECRET = "phase2a-test-signing-secret-change-me";
    process.env.AUTH_INTROSPECTION_CLIENTS_JSON = JSON.stringify({
      [introspectionService]: {
        keys: { [introspectionKeyId]: introspectionSecret },
        audiences: ["community-api"],
        scopes: ["auth:token:validate"],
      },
    });
    process.env.NODE_ENV = "test";
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
  });

  afterEach(async () => {
    if (emails.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
      emails.length = 0;
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
    return (registration.body as RegistrationBody).user.subject;
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
