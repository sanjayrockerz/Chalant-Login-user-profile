import { AuthService } from "./auth.service";
import { UserService } from "../user/user.service";
import { EmailService } from "../email/email.service";
import { RedisService } from "../redis/redis.service";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "../config/config.service";
import { MetricsService } from "../metrics/metrics.service";
import { PasswordBreachService } from "../security/password-breach.service";
import { TermsService } from "./terms.service";
import { BadRequestException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

// Mock ioredis before importing auth.service
jest.mock("ioredis", () => {
  return {
    Redis: jest.fn(() => ({
      on: jest.fn().mockReturnThis(),
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
    })),
  };
});

describe("AuthService.register (identity validation)", () => {
  let service: AuthService;
  let userService: jest.Mocked<UserService>;
  let emailService: jest.Mocked<EmailService>;

  beforeEach(() => {
    const mockPrismaClient = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $connect: jest.fn(),
      $disconnect: jest.fn(),
    };

    userService = {
      createUser: jest
        .fn()
        .mockImplementation((data) =>
          Promise.resolve({
            id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
            ...data,
          }),
        ),
      saveVerificationToken: jest.fn().mockResolvedValue(undefined),
      findByEmail: jest.fn().mockResolvedValue(null),
    } as any;

    emailService = {
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
      sendEmail: jest.fn().mockResolvedValue(undefined),
    } as any;

    const redisService = {
      set: jest.fn().mockResolvedValue("OK"),
      get: jest.fn().mockResolvedValue(null),
      del: jest.fn().mockResolvedValue(0),
      getex: jest.fn().mockResolvedValue(null),
    } as any;

    const jwtService = {
      sign: jest.fn().mockReturnValue("test.jwt.token"),
      verify: jest.fn(),
    } as any;

    const configService = {
      get: (k: string) => {
        const config: any = {
          MIN_DECLARED_AGE: 16,
          PASSWORD_MIN_ENTROPY: 50,
        };
        return config[k];
      },
    } as any;

    const metricsService = {
      identityRegistrationsTotal: { inc: jest.fn() },
      underageDeniedTotal: { inc: jest.fn() },
      identityValidationLatency: { observe: jest.fn() },
      errorsTotal: { inc: jest.fn() },
    } as any;

    const passwordBreachService = {
      checkPassword: jest.fn().mockResolvedValue({ isBreached: false }),
    } as any;

    const termsService = {
      validateTermsAcceptance: jest.fn().mockReturnValue(true),
      validateRegistrationTerms: jest.fn().mockReturnValue({ valid: true }),
      getLatestVersion: jest.fn().mockReturnValue("1.0"),
    } as any;

    // Directly instantiate AuthService with all mocked dependencies
    service = new AuthService(
      mockPrismaClient as unknown as PrismaClient,
      jwtService,
      configService,
      passwordBreachService,
      termsService,
      userService,
      emailService,
      metricsService,
      redisService,
    );
  });

  it("rejects registration when declared_age < MIN_DECLARED_AGE", async () => {
    const dto: any = {
      username: "u1",
      email: "u1@example.com",
      password: "P@ssw0rd",
      declared_age: 15,
    };

    await expect(service.register(dto)).rejects.toThrow(BadRequestException);
    expect(userService.createUser).not.toHaveBeenCalled();
  });

  it("accepts registration when declared_age >= MIN_DECLARED_AGE and persists fields", async () => {
    const dto: any = {
      username: "u2",
      email: "u2@example.com",
      password: "P@ssw0rd",
      declared_age: 16,
      display_name: "User Two",
      profile_image_url: "https://img.example/x.jpg",
      pronouns: "they/them",
    };

    const result = await service.register(dto);

    expect(userService.createUser).toHaveBeenCalled();
    expect(emailService.sendVerificationEmail).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it("rejects when declared_age is non-integer (malformed)", async () => {
    const dto: any = {
      username: "u3",
      email: "u3@example.com",
      password: "P@ssw0rd",
      declared_age: "sixteen",
    };

    await expect(service.register(dto)).rejects.toThrow();
    expect(userService.createUser).not.toHaveBeenCalled();
  });

  it("rejects when profile_image_url is not a valid URL", async () => {
    const dto: any = {
      username: "u4",
      email: "u4@example.com",
      password: "P@ssw0rd",
      declared_age: 20,
      profile_image_url: "not-a-url",
    };

    await expect(service.register(dto)).rejects.toThrow();
    expect(userService.createUser).not.toHaveBeenCalled();
  });
});
