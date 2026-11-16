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

  it("rejects malformed introspection configuration without exposing secret values", () => {
    process.env.DATABASE_URL_AUTH = "postgresql://auth-db.example.test/app";
    process.env.REDIS_URL = "redis://127.0.0.1:6379";
    process.env.JWT_SECRET = "test-jwt-secret";
    process.env.COOKIE_SECRET = "test-cookie-secret";
    process.env.AUTH_INTROSPECTION_CLIENTS_JSON = JSON.stringify({
      "community-service": {
        protocolVersions: ["v1"],
        keys: { "community-v1": "raw-short-secret-value" },
        audiences: ["community-api"],
        scopes: ["auth:token:validate"],
      },
    });

    expect(() => new ConfigService()).toThrow(/AUTH_INTROSPECTION_CLIENTS/);
    try {
      new ConfigService();
    } catch (error) {
      expect(String(error)).not.toContain("raw-short-secret-value");
    }
  });

  it("requires callers to explicitly opt into each introspection protocol", () => {
    process.env.DATABASE_URL_AUTH = "postgresql://auth-db.example.test/app";
    process.env.REDIS_URL = "redis://127.0.0.1:6379";
    process.env.JWT_SECRET = "test-jwt-secret";
    process.env.COOKIE_SECRET = "test-cookie-secret";
    process.env.AUTH_INTROSPECTION_CLIENTS_JSON = JSON.stringify({
      "community-service": {
        keys: {
          "community-v2": "a-secret-long-enough-for-tests-0123456789",
        },
        audiences: ["community-api"],
        scopes: ["auth:token:validate"],
      },
    });

    expect(() => new ConfigService()).toThrow(/AUTH_INTROSPECTION_CLIENTS/);
  });

  it("requires TLS for Redis connections in production", () => {
    process.env.DATABASE_URL_AUTH = "postgresql://auth-db.example.test/app";
    process.env.REDIS_URL = "redis://redis.example.test:6379";
    process.env.JWT_SECRET = "test-jwt-secret";
    process.env.COOKIE_SECRET = "test-cookie-secret";
    process.env.NODE_ENV = "production";

    expect(() => new ConfigService()).toThrow(/REDIS_URL/);

    process.env.REDIS_URL = "rediss://redis.example.test:6379";
    expect(() => new ConfigService()).not.toThrow();
  });
});
