import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { IdentityProvider } from "@prisma/client";
import request from "supertest";
import { Server } from "http";
import { PrismaService } from "../../prisma/prisma.module";
import { ConfigService } from "../config/config.service";
import { RedisService } from "../redis/redis.service";
import { CanonicalAuthModule } from "./canonical-auth.module";
import { GOOGLE_OIDC_CLIENT, GoogleOidcClient } from "./google-oidc.types";

const databaseUrl = process.env.PHASE2B_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

interface GoogleAuthorizationBody {
  authorization_url: string;
}

interface GoogleSessionBody {
  user: { subject: string };
}

class MemoryRedis {
  private readonly values = new Map<string, unknown>();
  set(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }
  getAndDelete<T>(key: string): Promise<T | null> {
    const value = this.values.get(key) as T | undefined;
    this.values.delete(key);
    return Promise.resolve(value ?? null);
  }
}

describeDatabase("Google canonical authentication", () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let provider: jest.Mocked<GoogleOidcClient>;
  let stateCounter = 0;
  let currentNonce = "";
  const emails: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL_AUTH = databaseUrl;
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL =
      process.env.USE_REAL_REDIS === "true"
        ? (process.env.REDIS_URL ?? "redis://127.0.0.1:6379")
        : "redis://127.0.0.1:6399";
    process.env.COOKIE_SECRET = "phase2b-test-cookie-secret";
    process.env.JWT_SECRET = "phase2b-test-signing-secret-change-me";
    process.env.NODE_ENV = "test";
    process.env.GOOGLE_OIDC_ENABLED = "true";
    process.env.GOOGLE_CLIENT_ID = "google-client-test";
    process.env.GOOGLE_CLIENT_SECRET = "google-client-secret-test";
    process.env.GOOGLE_REDIRECT_URI =
      "http://127.0.0.1:3000/auth/google/callback";

    provider = {
      generateAuthUrl: jest.fn((options) => {
        currentNonce = options.nonce;
        return `https://google.test/auth?state=${options.state}`;
      }),
      getToken: jest.fn((options: { code: string; codeVerifier: string }) => {
        void options;
        return Promise.resolve({ tokens: { id_token: "synthetic-id-token" } });
      }),
      verifyIdToken: jest.fn(
        (options: { idToken: string; audience: string }) => {
          void options;
          return Promise.resolve({
            getPayload: () => ({
              iss: "https://accounts.google.com",
              sub: "google-sub-1",
              aud: "google-client-test",
              nonce: currentNonce,
              email: "google-user@example.test",
              email_verified: true,
              exp: Math.floor(Date.now() / 1000) + 300,
            }),
          });
        },
      ),
    };

    const configValues: Record<string, unknown> = {
      GOOGLE_OIDC_ENABLED: true,
      GOOGLE_CLIENT_ID: "google-client-test",
      GOOGLE_CLIENT_SECRET: "google-client-secret-test",
      GOOGLE_REDIRECT_URI: "http://127.0.0.1:3000/auth/google/callback",
      GOOGLE_OIDC_STATE_TTL_SECONDS: 600,
      JWT_SECRET: "phase2b-test-signing-secret-change-me",
      REDIS_URL: process.env.REDIS_URL,
    };
    const testConfig = {
      get: jest.fn((key: string) => configValues[key]),
      getAll: jest.fn(() => configValues),
    };
    const moduleBuilder = Test.createTestingModule({
      imports: [CanonicalAuthModule],
    })
      .overrideProvider(ConfigService)
      .useValue(testConfig)
      .overrideProvider(GOOGLE_OIDC_CLIENT)
      .useValue(provider);
    if (process.env.USE_REAL_REDIS !== "true") {
      moduleBuilder.overrideProvider(RedisService).useValue(new MemoryRedis());
    }
    const moduleRef = await moduleBuilder.compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as unknown as Server;
    prisma = moduleRef.get(PrismaService);
  });

  afterEach(async () => {
    if (emails.length) {
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
      emails.length = 0;
    }
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  async function startAndCallback(
    subject = "google-sub-1",
    email = "google-user@example.test",
  ) {
    provider.verifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({
        iss: "https://accounts.google.com",
        sub: subject,
        aud: "google-client-test",
        nonce: currentNonce,
        email,
        email_verified: true,
        exp: Math.floor(Date.now() / 1000) + 300,
      }),
    });
    const started = await request(server).get("/auth/google");
    expect(started.status).toBe(200);
    const authorization = started.body as GoogleAuthorizationBody;
    const state = new URL(authorization.authorization_url).searchParams.get(
      "state",
    );
    expect(state).toEqual(expect.any(String));
    const result = await request(server)
      .get("/auth/google/callback")
      .query({ code: `code-${++stateCounter}`, state })
      .expect(200);
    return result.body as {
      access_token: string;
      refresh_token: string;
      user: { subject: string };
    };
  }

  it("creates a passwordless canonical Google user and accepts its canonical session", async () => {
    emails.push("google-user@example.test");
    const tokens = await startAndCallback();
    const stored = await prisma.user.findUnique({
      where: { email: "google-user@example.test" },
      include: { passwordCredential: true, identityLinks: true },
    });
    expect(tokens.user.subject).toBe(stored?.id);
    expect(stored?.password).toBeNull();
    expect(stored?.passwordCredential).toBeNull();
    expect(stored?.identityLinks).toHaveLength(1);
    expect(stored?.identityLinks[0].provider).toBe(IdentityProvider.GOOGLE);
    await request(server)
      .get("/auth/me")
      .set("Authorization", `Bearer ${tokens.access_token}`)
      .expect(200);
  });

  it("reuses the provider identity and rejects callback replay", async () => {
    emails.push("google-returning@example.test");
    const first = await startAndCallback(
      "google-sub-returning",
      "google-returning@example.test",
    );
    const secondStart = await request(server).get("/auth/google").expect(200);
    const secondAuthorization = secondStart.body as GoogleAuthorizationBody;
    const state = new URL(
      secondAuthorization.authorization_url,
    ).searchParams.get("state");
    provider.verifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({
        iss: "https://accounts.google.com",
        sub: "google-sub-returning",
        aud: "google-client-test",
        nonce: currentNonce,
        email: "google-returning@example.test",
        email_verified: true,
        exp: Math.floor(Date.now() / 1000) + 300,
      }),
    });
    const second = await request(server)
      .get("/auth/google/callback")
      .query({ code: "second", state })
      .expect(200);
    const secondSession = second.body as GoogleSessionBody;
    expect(secondSession.user.subject).toBe(first.user.subject);
    await request(server)
      .get("/auth/google/callback")
      .query({ code: "replay", state })
      .expect(401);
    expect(
      await prisma.user.count({
        where: { email: "google-returning@example.test" },
      }),
    ).toBe(1);
  });

  it("does not auto-link a Google identity to an existing password account", async () => {
    const email = "existing-password@example.test";
    emails.push(email);
    await prisma.user.create({
      data: {
        email,
        username: `existing_${Date.now()}`,
        password: "legacy-hash",
        isVerified: true,
      },
    });
    await startAndCallback("google-sub-existing", email).catch(
      (error: unknown) => error,
    );
    const started = await request(server).get("/auth/google").expect(200);
    const authorization = started.body as GoogleAuthorizationBody;
    const state = new URL(authorization.authorization_url).searchParams.get(
      "state",
    );
    provider.verifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({
        iss: "https://accounts.google.com",
        sub: "google-sub-existing",
        aud: "google-client-test",
        nonce: currentNonce,
        email,
        email_verified: true,
        exp: Math.floor(Date.now() / 1000) + 300,
      }),
    });
    await request(server)
      .get("/auth/google/callback")
      .query({ code: "collision", state })
      .expect(409);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });

  it("rejects unsolicited state and incorrectly issued Google identities", async () => {
    await request(server)
      .get("/auth/google/callback")
      .query({ code: "code", state: "unknown-state" })
      .expect(401);

    const started = await request(server).get("/auth/google").expect(200);
    const authorization = started.body as GoogleAuthorizationBody;
    const state = new URL(authorization.authorization_url).searchParams.get(
      "state",
    );
    provider.verifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({
        iss: "https://untrusted.example",
        sub: "untrusted-sub",
        aud: "google-client-test",
        nonce: currentNonce,
        email: "untrusted@example.test",
        email_verified: true,
        exp: Math.floor(Date.now() / 1000) + 300,
      }),
    });
    await request(server)
      .get("/auth/google/callback")
      .query({ code: "bad-issuer", state })
      .expect(401);
  });

  it("links Google only from a recent canonical session and exposes safe methods", async () => {
    const email = `link-${Date.now()}@example.test`;
    emails.push(email);
    const registration = await request(server)
      .post("/auth/register")
      .send({
        email,
        username: `link_${Date.now()}`,
        password: "A sufficiently unique passphrase 2026!",
      })
      .expect(201);
    const subject = (registration.body as { user: { subject: string } }).user
      .subject;
    await prisma.user.update({
      where: { id: subject },
      data: { isVerified: true },
    });
    const login = await request(server)
      .post("/auth/login")
      .send({
        email,
        password: "A sufficiently unique passphrase 2026!",
      })
      .expect(200);
    const access = (login.body as { access_token: string }).access_token;
    const linking = await request(server)
      .get("/auth/google/link")
      .set("Authorization", `Bearer ${access}`)
      .expect(200);
    const state = new URL(
      (linking.body as GoogleAuthorizationBody).authorization_url,
    ).searchParams.get("state");
    provider.verifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({
        iss: "https://accounts.google.com",
        sub: `link-sub-${Date.now()}`,
        aud: "google-client-test",
        nonce: currentNonce,
        email: "different@example.test",
        email_verified: true,
        exp: Math.floor(Date.now() / 1000) + 300,
      }),
    });
    await request(server)
      .get("/auth/google/callback")
      .query({ code: "link-code", state })
      .expect(200)
      .expect(({ body }) =>
        expect(body).toEqual({ status: "linked", provider: "GOOGLE" }),
      );
    const methods = await request(server)
      .get("/auth/security/methods")
      .set("Authorization", `Bearer ${access}`)
      .expect(200);
    expect(methods.body).toEqual({ password: true, providers: ["GOOGLE"] });
    await request(server)
      .delete("/auth/security/providers/GOOGLE")
      .set("Authorization", `Bearer ${access}`)
      .expect(204);
    await request(server)
      .delete("/auth/security/providers/GOOGLE")
      .set("Authorization", `Bearer ${access}`)
      .expect(409);
  });
});
