import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { Server } from "http";
import { PrismaService } from "../../prisma/prisma.module";
import { CanonicalAuthModule } from "../canonical-auth/canonical-auth.module";
import { RedisService } from "../redis/redis.service";
import { CanonicalPolicyModule } from "./canonical-policy.module";

const databaseUrl = process.env.PHASE4_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

interface PolicyAcceptanceResponse {
  ok: boolean;
  policyVersion: string;
  acceptedAt: string;
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

describeDatabase("canonical policy acceptance HTTP contract", () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const emails: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL_AUTH = databaseUrl;
    process.env.DATABASE_URL = databaseUrl;
    const useRealRedis = process.env.USE_REAL_REDIS === "true";
    process.env.REDIS_URL = useRealRedis
      ? (process.env.REDIS_URL ?? "redis://127.0.0.1:6379")
      : "redis://127.0.0.1:6399";
    process.env.JWT_SECRET = "phase4-policy-test-signing-secret";
    process.env.NODE_ENV = "test";
    process.env.ACTIVE_POLICY_VERSION = "v-test-1";

    const moduleBuilder = Test.createTestingModule({
      imports: [CanonicalAuthModule, CanonicalPolicyModule],
    });
    if (!useRealRedis) {
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
    await app?.close();
  });

  async function createSession(label: string) {
    const email = `phase4-policy-${label}-${Date.now()}@example.test`;
    emails.push(email);
    await request(server)
      .post("/auth/register")
      .send({
        email,
        username: `policy_${label}_${Date.now()}`,
        password: "A sufficiently unique passphrase 2026!",
      })
      .expect(201);
    await prisma.user.update({ where: { email }, data: { isVerified: true } });
    const login = await request(server)
      .post("/auth/login")
      .send({ email, password: "A sufficiently unique passphrase 2026!" })
      .expect(200);
    return login.body as { access_token: string };
  }

  it("records idempotent canonical policy acceptance for the authenticated user", async () => {
    const session = await createSession("owner");
    const first = await request(server)
      .patch("/profile/policy/accept")
      .set("Authorization", `Bearer ${session.access_token}`)
      .send({ policyVersion: "v-test-1" })
      .expect(200);

    const firstBody = first.body as PolicyAcceptanceResponse;
    expect(firstBody.ok).toBe(true);
    expect(firstBody.policyVersion).toBe("v-test-1");
    expect(firstBody.acceptedAt).toEqual(expect.any(String));

    const second = await request(server)
      .patch("/profile/policy/accept")
      .set("Authorization", `Bearer ${session.access_token}`)
      .send({ policyVersion: "v-test-1" })
      .expect(200);
    const secondBody = second.body as PolicyAcceptanceResponse;
    expect(secondBody.acceptedAt).toBe(firstBody.acceptedAt);

    const rows = await prisma.policyAcceptance.findMany({
      where: { user: { email: emails[0] } },
    });
    expect(rows).toHaveLength(1);
  });

  it("rejects unauthenticated and unknown-version acceptance", async () => {
    await request(server)
      .patch("/profile/policy/accept")
      .send({ policyVersion: "v-test-1" })
      .expect(401);

    const session = await createSession("invalid");
    await request(server)
      .patch("/profile/policy/accept")
      .set("Authorization", `Bearer ${session.access_token}`)
      .send({ policyVersion: "not-active" })
      .expect(400);

    await request(server)
      .patch("/profile/policy/accept")
      .set("Authorization", `Bearer ${session.access_token}`)
      .send({ policyVersion: "v-test-1", userId: "another-user" })
      .expect(400);
  });

  it("keeps concurrent acceptance idempotent and preserves one history row", async () => {
    const session = await createSession("concurrent");
    const responses = await Promise.all(
      Array.from({ length: 3 }, () =>
        request(server)
          .patch("/profile/policy/accept")
          .set("Authorization", `Bearer ${session.access_token}`)
          .send({ policyVersion: "v-test-1" })
          .expect(200),
      ),
    );
    expect(responses).toHaveLength(3);
    const rows = await prisma.policyAcceptance.findMany({
      where: { user: { email: emails[0] } },
    });
    expect(rows).toHaveLength(1);
  });
});
