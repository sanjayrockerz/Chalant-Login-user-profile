import { config } from "dotenv";
import { join } from "path";
import { Test } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { RedisModule } from "../src/redis/redis.module";
import { PrismaModule } from "../prisma/prisma.module";

// Load test environment variables
config({ path: join(__dirname, "..", ".env.test") });

// Mock ConfigService to avoid validation errors in tests
jest.mock("../src/config/config.service", () => {
  const mockConfig = {
    NODE_ENV: "test",
    DATABASE_URL_AUTH: "postgresql://test:test@localhost:5432/test_auth",
    DATABASE_URL_RATE_LIMIT:
      "postgresql://test:test@localhost:5432/test_rate_limit",
    POSTGRES_HOST: "localhost",
    POSTGRES_PORT: 5432,
    POSTGRES_USER: "test",
    POSTGRES_PASSWORD: "test",
    POSTGRES_DB: "test",
    MONGO_URI: "mongodb://localhost:27017/test-db",
    RABBITMQ_URL: "amqp://localhost",
    EMAIL_USER: "test@example.com",
    EMAIL_PASS: "test_password",
    JWT_SECRET: "test_jwt_secret_key_for_testing_only_123456789abcdef",
    REDIS_HOST: "localhost",
    REDIS_PORT: 6379,
    BASE_URL: "http://localhost:3000",
    HOST: "0.0.0.0",
    PORT: 3000,
    CORS_ORIGINS: "http://localhost:3000,http://localhost:3001",
    THROTTLE_TTL: 60,
    THROTTLE_LIMIT: 100,
    REDIS_URL: process.env.REDIS_URL || "redis://127.0.0.1:6379",
    DATABASE_URL:
      process.env.DATABASE_URL_AUTH ||
      process.env.DATABASE_URL ||
      "postgresql://test:test@127.0.0.1:5432/test",
    COOKIE_SECRET: "test-cookie-secret",
    EMAIL_DELIVERY_ENABLED: false,
    EMAIL_VERIFICATION_TOKEN_TTL_SECONDS: 86400,
    RATE_LIMIT_GLOBAL_LIMIT: 1000,
    RATE_LIMIT_GLOBAL_TTL: 60,
    RATE_LIMIT_GLOBAL_BLOCK_SECONDS: 120,
    RATE_LIMIT_IP_LIMIT: 60,
    RATE_LIMIT_IP_TTL: 3600,
    RATE_LIMIT_IP_BLOCK_SECONDS: 300,
    RATE_LIMIT_DEVICE_LIMIT: 20,
    RATE_LIMIT_DEVICE_TTL: 3600,
    RATE_LIMIT_DEVICE_BLOCK_SECONDS: 300,
    RATE_LIMIT_USER_LIMIT: 100,
    RATE_LIMIT_USER_TTL: 3600,
    RATE_LIMIT_USER_BLOCK_SECONDS: 300,
  };

  return {
    ConfigService: jest.fn().mockImplementation(() => ({
      get: jest.fn((key: string) => {
        if (key === "ACTIVE_POLICY_VERSION") {
          return process.env.ACTIVE_POLICY_VERSION || "v2025-10-07-1";
        }
        if (key === "CONTACT_HASH_MODE") {
          return process.env.CONTACT_HASH_MODE || "sha256-v1";
        }
        if (key === "CONTACT_HMAC_KEY") {
          return process.env.CONTACT_HMAC_KEY;
        }
        if (key === "REDIS_URL") {
          return process.env.REDIS_URL || mockConfig.REDIS_URL;
        }
        if (key === "DATABASE_URL") {
          return (
            process.env.DATABASE_URL_AUTH ||
            process.env.DATABASE_URL ||
            mockConfig.DATABASE_URL
          );
        }
        return mockConfig[key as keyof typeof mockConfig];
      }),
      getAll: jest.fn(() => mockConfig),
    })),
  };
});

// Mock external dependencies for testing
if (process.env.USE_REAL_EMAIL !== "true") {
  jest.mock("nodemailer", () => ({
    createTransport: jest.fn(() => ({
      sendMail: jest.fn().mockResolvedValue({ messageId: "test-message-id" }),
      verify: jest.fn().mockResolvedValue(true),
    })),
    createTestAccount: jest.fn(),
  }));
}

// Mock Redis for tests that don't specifically test Redis
if (process.env.USE_REAL_REDIS !== "true") {
  jest.mock("ioredis", () => {
    const mockRedis = {
      on: jest.fn().mockReturnThis(),
      set: jest.fn().mockResolvedValue("OK"),
      get: jest.fn().mockResolvedValue(null),
      del: jest.fn().mockResolvedValue(1),
      getdel: jest.fn().mockResolvedValue(null),
      setex: jest.fn().mockResolvedValue("OK"),
      exists: jest.fn().mockResolvedValue(0),
      ping: jest.fn().mockResolvedValue("PONG"),
      quit: jest.fn().mockResolvedValue("OK"),
      disconnect: jest.fn(),
    };
    const MockRedis = jest.fn(() => mockRedis);
    return { Redis: MockRedis, default: MockRedis };
  });
}

// Mock Winston logger
jest.mock("winston", () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
  format: {
    combine: jest.fn(),
    timestamp: jest.fn(),
    json: jest.fn(),
    printf: jest.fn(),
    colorize: jest.fn(),
  },
  transports: {
    Console: jest.fn(),
    File: jest.fn(),
    DailyRotateFile: jest.fn(),
  },
}));

// Global test timeout
jest.setTimeout(30000);

// Setup environment variables for testing
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-key";
process.env.DATABASE_URL_AUTH =
  "postgresql://test:test@localhost:5432/test_auth";
process.env.DATABASE_URL_RATE_LIMIT =
  "postgresql://test:test@localhost:5432/test_rate_limit";
process.env.REDIS_HOST = "localhost";
process.env.REDIS_PORT = "6379";
process.env.EMAIL_HOST = "smtp.test.com";
process.env.EMAIL_PORT = "587";
process.env.EMAIL_USER = "test@test.com";
process.env.EMAIL_PASS = "test-password";

// Global beforeEach and afterEach
beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Helper function to create test module with common providers
export const createTestModule = async (
  providers: any[] = [],
  imports: any[] = [],
) => {
  return Test.createTestingModule({
    imports: [...imports],
    providers: [...providers],
  }).compile();
};
