jest.mock("uuid", () => ({
  v4: jest.fn(() => "00000000-0000-4000-8000-000000000000"),
}));

import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { Server } from "http";
import { PrismaService } from "../../prisma/prisma.module";
import { CanonicalAuthModule } from "../canonical-auth/canonical-auth.module";
import { RedisService } from "../redis/redis.service";
import { ContactsModule } from "./contacts.module";
import { hashWithKey } from "../security/phone-hash/phone-hash.util";

const databaseUrl = process.env.PHASE4_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

interface PrivacyResponse {
  data_summary: { contacts_stored: number };
}

interface UploadResponse {
  metadata: { duplicates_skipped: number };
}

interface SuggestionsResponse {
  suggestions: Array<{ user_id: string }>;
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

  checkRateLimit(): Promise<{
    allowed: boolean;
    remaining: number;
    resetTime: number;
  }> {
    return Promise.resolve({
      allowed: true,
      remaining: 99,
      resetTime: Date.now() + 60_000,
    });
  }

  incrementWindow(): Promise<{ count: number; ttlSeconds: number }> {
    return Promise.resolve({ count: 1, ttlSeconds: 60 });
  }
}

describeDatabase("canonical contact discovery HTTP contract", () => {
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
    process.env.JWT_SECRET = "phase4-contact-test-signing-secret";
    process.env.NODE_ENV = "test";

    const moduleBuilder = Test.createTestingModule({
      imports: [CanonicalAuthModule, ContactsModule],
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
    const email = `phase4-contact-${label}-${Date.now()}@example.test`;
    emails.push(email);
    await request(server)
      .post("/auth/register")
      .send({
        email,
        username: `contact_${label}_${Date.now()}`,
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

  it("stores and deletes contact discovery data for the authenticated canonical user", async () => {
    const session = await createSession("owner");
    await request(server)
      .post("/contacts/upload")
      .set("Authorization", `Bearer ${session.access_token}`)
      .send({ phones: ["+14155552671"], client_batch_id: "synthetic-batch" })
      .expect(202);

    const privacy = await request(server)
      .get("/contacts/privacy")
      .set("Authorization", `Bearer ${session.access_token}`)
      .expect(200);
    const privacyBody = privacy.body as PrivacyResponse;
    expect(privacyBody.data_summary.contacts_stored).toBe(1);

    await request(server)
      .delete("/contacts")
      .set("Authorization", `Bearer ${session.access_token}`)
      .send({ confirm_deletion: true, opt_out_of_discovery: true })
      .expect(200);

    const remaining = await prisma.hashedContact.count({
      where: { user: { email: emails[0] } },
    });
    expect(remaining).toBe(0);
  });

  it("rejects unauthenticated contact access", async () => {
    await request(server).get("/contacts/privacy").expect(401);
  });

  it("filters opted-out candidates and suppresses duplicate uploads", async () => {
    const owner = await createSession("matching-owner");
    const candidateEmail = `phase4-contact-candidate-${Date.now()}@example.test`;
    emails.push(candidateEmail);
    await request(server)
      .post("/auth/register")
      .send({
        email: candidateEmail,
        username: `candidate_${Date.now()}`,
        password: "A sufficiently unique passphrase 2026!",
      })
      .expect(201);
    await prisma.user.update({
      where: { email: candidateEmail },
      data: {
        phone: "+14155552671",
        hashedPhone: hashWithKey(
          "+14155552671",
          process.env.CONTACT_HMAC_KEY ??
            (() => {
              throw new Error("CONTACT_HMAC_KEY is required for this suite");
            })(),
        ),
        allowContactDiscovery: true,
      },
    });

    const duplicate = await request(server)
      .post("/contacts/upload")
      .set("Authorization", `Bearer ${owner.access_token}`)
      .send({ phones: ["+14155552671", "+14155552671"] })
      .expect(202);
    const duplicateBody = duplicate.body as UploadResponse;
    expect(duplicateBody.metadata.duplicates_skipped).toBeGreaterThan(0);

    const suggestions = await request(server)
      .get("/contacts/suggestions")
      .set("Authorization", `Bearer ${owner.access_token}`)
      .expect(200);
    const suggestionsBody = suggestions.body as SuggestionsResponse;
    expect(suggestionsBody.suggestions.length).toBeGreaterThan(0);
    expect(suggestionsBody.suggestions[0]?.user_id).toEqual(expect.any(String));

    await prisma.user.update({
      where: { email: candidateEmail },
      data: { allowContactDiscovery: false },
    });
    const filtered = await request(server)
      .get("/contacts/suggestions")
      .set("Authorization", `Bearer ${owner.access_token}`)
      .expect(200);
    const filteredBody = filtered.body as SuggestionsResponse;
    expect(filteredBody.suggestions).toHaveLength(0);
  });
});
