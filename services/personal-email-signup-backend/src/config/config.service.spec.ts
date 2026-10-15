jest.unmock("./config.service");

import { ConfigService } from "./config.service";

describe("ConfigService", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("accepts the Prisma DATABASE_URL_AUTH variable as the database URL", () => {
    delete process.env.DATABASE_URL;
    process.env.DATABASE_URL_AUTH = "postgresql://auth-db.example.test/app";
    process.env.REDIS_URL = "redis://127.0.0.1:6379";
    process.env.JWT_SECRET = "test-jwt-secret";
    process.env.COOKIE_SECRET = "test-cookie-secret";

    const config = new ConfigService();

    expect(config.get("DATABASE_URL")).toBe(
      "postgresql://auth-db.example.test/app",
    );
  });

  it("keeps supporting the legacy DATABASE_URL variable", () => {
    delete process.env.DATABASE_URL_AUTH;
    process.env.DATABASE_URL = "postgresql://legacy-db.example.test/app";
    process.env.REDIS_URL = "redis://127.0.0.1:6379";
    process.env.JWT_SECRET = "test-jwt-secret";
    process.env.COOKIE_SECRET = "test-cookie-secret";

    const config = new ConfigService();

    expect(config.get("DATABASE_URL")).toBe(
      "postgresql://legacy-db.example.test/app",
    );
  });
});
