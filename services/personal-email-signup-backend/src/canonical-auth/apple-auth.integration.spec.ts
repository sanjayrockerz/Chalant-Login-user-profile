import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { IdentityProvider } from "@prisma/client";
import request from "supertest";
import { Server } from "http";
import { PrismaService } from "../../prisma/prisma.module";
import { ConfigService } from "../config/config.service";
import { RedisService } from "../redis/redis.service";
import { CanonicalAuthModule } from "./canonical-auth.module";
import { APPLE_OIDC_CLIENT, AppleOidcClient } from "./apple-oidc.types";

const databaseUrl = process.env.PHASE2C_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

interface AppleAuthorizationBody {
  authorization_url: string;
}
interface AppleSessionBody {
  access_token: string;
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

describeDatabase("Apple canonical authentication", () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let provider: jest.Mocked<AppleOidcClient>;
  let currentNonce = "";
  let claims = {
    iss: "https://appleid.apple.com",
    sub: "apple-sub-1",
    aud: "com.example.web",
    exp: Math.floor(Date.now() / 1000) + 300,
    email: "apple-user@privaterelay.appleid.com",
    email_verified: true,
    nonce: "",
  };
  const emails: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL_AUTH = databaseUrl;
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL =
      process.env.USE_REAL_REDIS === "true"
        ? (process.env.REDIS_URL ?? "redis://127.0.0.1:6379")
        : "redis://127.0.0.1:6399";
    process.env.COOKIE_SECRET = "phase2c-test-cookie-secret";
    process.env.JWT_SECRET = "phase2c-test-signing-secret-change-me";
    process.env.NODE_ENV = "test";

    provider = {
      generateAuthUrl: jest.fn((options) => {
        currentNonce = options.nonce;
        return `https://apple.test/auth?state=${options.state}`;
      }),
      createClientSecret: jest.fn(() => "synthetic-client-secret"),
      exchangeCode: jest.fn((code: string) => {
        void code;
        return Promise.resolve({ id_token: "token-endpoint-id-token" });
      }),
      verifyIdToken: jest.fn((idToken: string) => {
        void idToken;
        return Promise.resolve({ ...claims, nonce: currentNonce });
      }),
    };
    const configValues: Record<string, unknown> = {
      APPLE_OIDC_ENABLED: true,
      APPLE_CLIENT_ID: "com.example.web",
      APPLE_TEAM_ID: "TEAM123456",
      APPLE_KEY_ID: "KEY1234567",
      APPLE_PRIVATE_KEY: "synthetic-private-key",
      APPLE_REDIRECT_URI: "https://auth.example.test/auth/apple/callback",
      APPLE_OIDC_STATE_TTL_SECONDS: 600,
      JWT_SECRET: "phase2c-test-signing-secret-change-me",
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
      .overrideProvider(APPLE_OIDC_CLIENT)
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

  async function begin(): Promise<string> {
    const started = await request(server).get("/auth/apple").expect(200);
    const body = started.body as AppleAuthorizationBody;
    const state = new URL(body.authorization_url).searchParams.get("state");
    if (!state) throw new Error("Apple authorization state was not returned");
    return state;
  }

  async function callback(
    state: string,
    user?: string,
  ): Promise<AppleSessionBody> {
    const result = await request(server)
      .post("/auth/apple/callback")
      .type("form")
      .send({
        code: "synthetic-code",
        state,
        id_token: "front-channel-id-token",
        user,
      })
      .expect(200);
    return result.body as AppleSessionBody;
  }

  it("creates a passwordless private-relay user, captures first name, and authenticates /auth/me", async () => {
    emails.push(claims.email);
    const state = await begin();
    const tokens = await callback(
      state,
      JSON.stringify({ name: { firstName: "Ada", lastName: "Apple" } }),
    );
    const stored = await prisma.user.findUnique({
      where: { email: claims.email },
      include: { passwordCredential: true, identityLinks: true },
    });
    expect(stored?.password).toBeNull();
    expect(stored?.passwordCredential).toBeNull();
    expect(stored?.displayName).toBe("Ada Apple");
    expect(stored?.identityLinks[0].provider).toBe(IdentityProvider.APPLE);
    await request(server)
      .get("/auth/me")
      .set("Authorization", `Bearer ${tokens.access_token}`)
      .expect(200);
  });

  it("reuses an Apple subject, does not overwrite the name, and consumes state once", async () => {
    emails.push("apple-returning@privaterelay.appleid.com");
    claims = {
      ...claims,
      sub: "apple-returning",
      email: "apple-returning@privaterelay.appleid.com",
    };
    const first = await callback(
      await begin(),
      JSON.stringify({ name: { firstName: "First" } }),
    );
    const secondState = await begin();
    const second = await callback(
      secondState,
      JSON.stringify({ name: { firstName: "Changed" } }),
    );
    expect(second.user.subject).toBe(first.user.subject);
    await request(server)
      .post("/auth/apple/callback")
      .type("form")
      .send({ code: "replay", state: secondState })
      .expect(401);
    const stored = await prisma.user.findUnique({
      where: { email: claims.email },
    });
    expect(stored?.displayName).toBe("First");
  });

  it("rejects an issuer mismatch and does not auto-link an existing password account", async () => {
    claims = {
      ...claims,
      sub: "apple-collision",
      email: "apple-collision@example.test",
    };
    emails.push(claims.email);
    await prisma.user.create({
      data: {
        email: claims.email,
        username: `existing_${Date.now()}`,
        password: "legacy-hash",
        isVerified: true,
      },
    });
    const state = await begin();
    provider.verifyIdToken.mockResolvedValueOnce({
      ...claims,
      iss: "https://untrusted.example",
      nonce: currentNonce,
    });
    await request(server)
      .post("/auth/apple/callback")
      .type("form")
      .send({ code: "bad", state })
      .expect(401);
    const collisionState = await begin();
    await request(server)
      .post("/auth/apple/callback")
      .type("form")
      .send({ code: "collision", state: collisionState })
      .expect(409);
    expect(await prisma.user.count({ where: { email: claims.email } })).toBe(1);
  });

  it("rejects cancellation, malformed form data, and a missing first-login email", async () => {
    await request(server)
      .post("/auth/apple/callback")
      .type("form")
      .send({ error: "user_cancelled_authorize" })
      .expect(401);
    const state = await begin();
    claims = {
      ...claims,
      sub: "apple-no-email",
      email: undefined as unknown as string,
    };
    await request(server)
      .post("/auth/apple/callback")
      .type("form")
      .send({ code: "no-email", state })
      .expect(401);
  });
});
