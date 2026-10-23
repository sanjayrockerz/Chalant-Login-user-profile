process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
process.env.DATABASE_URL_AUTH = process.env.DATABASE_URL;
process.env.REDIS_URL = "redis://127.0.0.1:6379";
process.env.JWT_SECRET = "test-jwt-secret";
process.env.COOKIE_SECRET = "test-cookie-secret";

import request from "supertest";
import { register } from "prom-client";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.module";
import { RedisService } from "./redis/redis.service";
import { AppModule } from "./app.module";
import { ConfigService } from "./config/config.service";
import { ChatProfileOutboxWorker } from "./canonical-auth/chat-profile-outbox.worker";

describe("AppModule", () => {
  afterEach(() => {
    register.clear();
  });

  it("compiles the authoritative runtime module graph", async () => {
    const config = {
      get: (key: string) => {
        const values: Record<string, unknown> = {
          DATABASE_URL: process.env.DATABASE_URL,
          REDIS_URL: process.env.REDIS_URL,
          JWT_SECRET: process.env.JWT_SECRET,
          COOKIE_SECRET: process.env.COOKIE_SECRET,
          CONTACT_HASH_MODE: "sha256-v1",
          ACTIVE_POLICY_VERSION: "test-policy",
        };
        return values[key] ?? undefined;
      },
      getAll: () => ({}),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ConfigService)
      .useValue(config)
      .compile();

    await moduleRef.close();
  });

  it("starts the registered Chat provisioning outbox worker with the app", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ConfigService)
      .useValue({
        get: (key: string) =>
          ({
            DATABASE_URL: process.env.DATABASE_URL,
            REDIS_URL: process.env.REDIS_URL,
            JWT_SECRET: process.env.JWT_SECRET,
            COOKIE_SECRET: process.env.COOKIE_SECRET,
            CONTACT_HASH_MODE: "sha256-v1",
            ACTIVE_POLICY_VERSION: "test-policy",
            CHAT_PROFILE_PROVISIONING_URL:
              "https://chat.example.test/api/v1/internal/v1/chat-profile-provisioning",
            CHAT_PROFILE_PROVISIONING_HMAC_SECRET:
              "a-secret-that-is-long-enough-for-testing",
          })[key],
        getAll: () => ({}),
      })
      .overrideProvider(PrismaService)
      .useValue({ $connect: jest.fn(), $disconnect: jest.fn() })
      .overrideProvider(RedisService)
      .useValue({})
      .compile();

    const worker = moduleRef.get(ChatProfileOutboxWorker);
    const deliverOne = jest
      .spyOn(worker, "deliverOne")
      .mockResolvedValue(undefined);
    const app = moduleRef.createNestApplication();

    await app.init();
    expect(deliverOne).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("protects canonical account routes through the real HTTP graph", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ConfigService)
      .useValue({
        get: (key: string) =>
          ({
            DATABASE_URL: process.env.DATABASE_URL,
            REDIS_URL: process.env.REDIS_URL,
            JWT_SECRET: process.env.JWT_SECRET,
            COOKIE_SECRET: process.env.COOKIE_SECRET,
            CONTACT_HASH_MODE: "sha256-v1",
            ACTIVE_POLICY_VERSION: "test-policy",
          })[key],
        getAll: () => ({}),
      })
      .overrideProvider(PrismaService)
      .useValue({ $connect: jest.fn(), $disconnect: jest.fn() })
      .overrideProvider(RedisService)
      .useValue({})
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    for (const route of [
      "/auth/me",
      "/profile/me",
      "/contacts/privacy",
      "/profile/policy/accept",
      "/auth/terms/status",
    ]) {
      const method = route.endsWith("accept")
        ? "patch"
        : route.endsWith("status")
          ? "post"
          : "get";
      await request(app.getHttpServer())
        [method](route)
        .expect((response) => {
          if (response.status !== 401) {
            throw new Error(`${route} returned ${response.status}`);
          }
        });
    }

    await app.close();
  });
});
