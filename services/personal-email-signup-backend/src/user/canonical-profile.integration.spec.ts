import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { OnboardingStatus } from "@prisma/client";
import request from "supertest";
import { Server } from "http";
import { PrismaService } from "../../prisma/prisma.module";
import { CanonicalAuthModule } from "../canonical-auth/canonical-auth.module";
import { ProfileController } from "./profile.controller";
import { CanonicalProfileService } from "./canonical-profile.service";
import { UserService } from "./user.service";
import { MetricsService } from "../metrics/metrics.service";
import { HtmlSanitizerService } from "../security/html-sanitizer.service";
import { RedisService } from "../redis/redis.service";

const databaseUrl = process.env.PHASE3_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

interface ProfileResponse {
  id: string;
  email: string;
  displayName: string | null;
  onboarding: { status: string; completedAt: string | null };
  password?: unknown;
}

interface OnboardingResponse {
  status: string;
  completedAt: string | null;
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

describeDatabase("canonical profile and onboarding HTTP contract", () => {
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
    process.env.JWT_SECRET = "phase3-test-signing-secret-change-me";
    process.env.NODE_ENV = "test";

    const moduleBuilder = Test.createTestingModule({
      imports: [CanonicalAuthModule],
      controllers: [ProfileController],
      providers: [
        CanonicalProfileService,
        { provide: UserService, useValue: { updateUser: jest.fn() } },
        {
          provide: MetricsService,
          useValue: {
            incrementPronounsSet: jest.fn(),
            incrementProfileImageSet: jest.fn(),
          },
        },
        {
          provide: HtmlSanitizerService,
          useValue: { sanitizeToText: (value: string) => value },
        },
      ],
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
    if (app) await app.close();
  });

  async function createSession(label: string) {
    const email = `phase3-${label}-${Date.now()}@example.test`;
    const username = `phase3_${label}_${Date.now()}`;
    emails.push(email);
    await request(server)
      .post("/auth/register")
      .send({
        email,
        username,
        password: "A sufficiently unique passphrase 2026!",
      })
      .expect(201);
    await prisma.user.update({ where: { email }, data: { isVerified: true } });
    const login = await request(server)
      .post("/auth/login")
      .send({ email, password: "A sufficiently unique passphrase 2026!" })
      .expect(200);
    return login.body as { access_token: string; user: { subject: string } };
  }

  it("retrieves and updates only the authenticated canonical profile", async () => {
    const session = await createSession("owner");
    await request(server)
      .get("/profile/me")
      .set("Authorization", `Bearer ${session.access_token}`)
      .expect(200)
      .expect((response) => {
        const body = response.body as ProfileResponse;
        expect(body.id).toBe(session.user.subject);
        expect(body.email).toContain("phase3-owner");
        expect(body.onboarding.status).toBe(OnboardingStatus.NOT_STARTED);
        expect(body.password).toBeUndefined();
      });

    await request(server)
      .patch("/profile/me")
      .set("Authorization", `Bearer ${session.access_token}`)
      .send({ displayName: "Canonical Owner", pronouns: "they/them" })
      .expect(200)
      .expect((response) => {
        const body = response.body as ProfileResponse;
        expect(body.displayName).toBe("Canonical Owner");
      });

    await request(server)
      .patch("/profile/me")
      .set("Authorization", `Bearer ${session.access_token}`)
      .send({ userId: "another-user", password: "must-not-be-accepted" })
      .expect(400);
  });

  it("rejects unauthenticated access and duplicate usernames", async () => {
    await request(server).get("/profile/me").expect(401);
    const first = await createSession("first");
    const second = await createSession("second");
    await request(server)
      .patch("/profile/me")
      .set("Authorization", `Bearer ${first.access_token}`)
      .send({ username: "shared_profile_name" })
      .expect(200);
    await request(server)
      .patch("/profile/me")
      .set("Authorization", `Bearer ${second.access_token}`)
      .send({ username: "shared_profile_name" })
      .expect(409);
  });

  it("persists onboarding progress and completion across retrieval", async () => {
    const session = await createSession("onboarding");
    await request(server)
      .patch("/profile/onboarding")
      .set("Authorization", `Bearer ${session.access_token}`)
      .send({ status: OnboardingStatus.COMPLETE })
      .expect(400);
    await request(server)
      .patch("/profile/onboarding")
      .set("Authorization", `Bearer ${session.access_token}`)
      .send({ status: OnboardingStatus.IN_PROGRESS })
      .expect(200)
      .expect((response) => {
        const body = response.body as OnboardingResponse;
        expect(body.status).toBe(OnboardingStatus.IN_PROGRESS);
      });
    await request(server)
      .patch("/profile/onboarding")
      .set("Authorization", `Bearer ${session.access_token}`)
      .send({ status: OnboardingStatus.COMPLETE })
      .expect(200)
      .expect((response) => {
        const body = response.body as OnboardingResponse;
        expect(body.status).toBe(OnboardingStatus.COMPLETE);
        expect(body.completedAt).toEqual(expect.any(String));
      });
    await request(server)
      .get("/profile/onboarding")
      .set("Authorization", `Bearer ${session.access_token}`)
      .expect(200)
      .expect((response) => {
        const body = response.body as OnboardingResponse;
        expect(body.status).toBe(OnboardingStatus.COMPLETE);
      });
  });
});
