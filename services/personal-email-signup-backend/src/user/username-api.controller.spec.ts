// filepath: src/user/username-api.controller.spec.ts
import { Test, TestingModule } from "@nestjs/testing";
import { ThrottlerGuard } from "@nestjs/throttler";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { UsernameApiController } from "./username-api.controller";
import { UsernameService } from "./username.service";
import { UsernameValidationService } from "./username-validation.service";
import { ReservedUsernamesService } from "./reserved-usernames.service";
import { MetricsService } from "../metrics/metrics.service";
import { trace } from "@opentelemetry/api";

// Mock OpenTelemetry
jest.mock("@opentelemetry/api", () => ({
  trace: {
    getTracer: jest.fn(() => ({
      startActiveSpan: jest.fn((name, fn) =>
        fn({
          setAttributes: jest.fn(),
          recordException: jest.fn(),
          setStatus: jest.fn(),
          end: jest.fn(),
        }),
      ),
    })),
  },
}));

describe("UsernameApiController", () => {
  let controller: UsernameApiController;
  let usernameService: jest.Mocked<UsernameService>;
  let validationService: jest.Mocked<UsernameValidationService>;
  let reservedService: jest.Mocked<ReservedUsernamesService>;
  let metricsService: jest.Mocked<MetricsService>;

  beforeEach(async () => {
    const mockUsernameService = {
      isUsernameAvailable: jest.fn(),
      getUserById: jest.fn(),
      updateUsername: jest.fn(),
    };

    const mockValidationService = {
      validateFormat: jest.fn(),
      validateForRegistration: jest.fn(),
      generateSuggestions: jest.fn(),
      isUsernameChangeAllowed: jest.fn(),
      sanitizeForLogging: jest.fn((value: string) => value),
    };

    const mockReservedService = {
      isReserved: jest.fn(),
    };

    const mockMetricsService = {
      incrementUsernameChecks: jest.fn(),
      incrementUsernameUpdates: jest.fn(),
      recordUsernameCheckLatency: jest.fn(),
      recordUsernameUpdateLatency: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsernameApiController],
      providers: [
        { provide: UsernameService, useValue: mockUsernameService },
        { provide: UsernameValidationService, useValue: mockValidationService },
        { provide: ReservedUsernamesService, useValue: mockReservedService },
        { provide: MetricsService, useValue: mockMetricsService },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<UsernameApiController>(UsernameApiController);
    usernameService = module.get(UsernameService);
    validationService = module.get(UsernameValidationService);
    reservedService = module.get(ReservedUsernamesService);
    metricsService = module.get(MetricsService);
  });

  describe("checkAvailability", () => {
    const mockRequest = {
      ip: "127.0.0.1",
      headers: { "user-agent": "test-agent" },
    };

    it("should return available for valid non-reserved username", async () => {
      const username = "john_doe";
      const canonical = "john_doe";

      validationService.validateFormat.mockReturnValue({
        isValid: true,
        canonical,
        errors: [],
        warnings: [],
      });

      reservedService.isReserved.mockReturnValue({
        isReserved: false,
      });

      usernameService.isUsernameAvailable.mockResolvedValue(true);

      const result = await controller.checkAvailability(username, mockRequest);

      expect(result.available).toBe(true);
      expect(result.canonical).toBe(canonical);
      expect(result.reason).toBeUndefined();
      expect(validationService.validateFormat).toHaveBeenCalledWith(username);
      expect(reservedService.isReserved).toHaveBeenCalledWith(canonical);
      expect(usernameService.isUsernameAvailable).toHaveBeenCalledWith(
        canonical,
      );
    });

    it("should return unavailable for invalid format", async () => {
      const username = "invalid@username";

      validationService.validateFormat.mockReturnValue({
        isValid: false,
        canonical: null,
        errors: ["Invalid characters"],
        warnings: [],
      });

      const result = await controller.checkAvailability(username, mockRequest);

      expect(result.available).toBe(false);
      expect(result.reason).toBe("invalid");
      expect(result.suggestions).toEqual([]);
      expect(reservedService.isReserved).not.toHaveBeenCalled();
      expect(usernameService.isUsernameAvailable).not.toHaveBeenCalled();
    });

    it("should return unavailable for reserved username", async () => {
      const username = "admin";
      const canonical = "admin";

      validationService.validateFormat.mockReturnValue({
        isValid: true,
        canonical,
        errors: [],
        warnings: [],
      });

      reservedService.isReserved.mockReturnValue({
        isReserved: true,
        reason: "Username is reserved for system functionality",
        category: "system",
      });

      validationService.generateSuggestions.mockReturnValue([
        "admin1",
        "admin_",
        "admin123",
      ]);

      const result = await controller.checkAvailability(username, mockRequest);

      expect(result.available).toBe(false);
      expect(result.reason).toBe("reserved");
      expect(result.suggestions).toEqual(["admin1", "admin_", "admin123"]);
      expect(usernameService.isUsernameAvailable).not.toHaveBeenCalled();
    });

    it("should return unavailable for taken username", async () => {
      const username = "john_doe";
      const canonical = "john_doe";

      validationService.validateFormat.mockReturnValue({
        isValid: true,
        canonical,
        errors: [],
        warnings: [],
      });

      reservedService.isReserved.mockReturnValue({
        isReserved: false,
      });

      usernameService.isUsernameAvailable.mockResolvedValue(false);
      validationService.generateSuggestions.mockReturnValue([
        "john_doe1",
        "john_doe_",
        "john_doe123",
      ]);

      const result = await controller.checkAvailability(username, mockRequest);

      expect(result.available).toBe(false);
      expect(result.reason).toBe("taken");
      expect(result.suggestions).toEqual([
        "john_doe1",
        "john_doe_",
        "john_doe123",
      ]);
    });

    it("should handle database errors gracefully", async () => {
      const username = "john_doe";
      const canonical = "john_doe";

      validationService.validateFormat.mockReturnValue({
        isValid: true,
        canonical,
        errors: [],
        warnings: [],
      });

      reservedService.isReserved.mockReturnValue({
        isReserved: false,
      });

      usernameService.isUsernameAvailable.mockRejectedValue(
        new Error("Database connection failed"),
      );

      const result = await controller.checkAvailability(username, mockRequest);

      expect(result.available).toBe(false);
      expect(result.reason).toBe("Temporarily unavailable");
      expect(result.suggestions).toEqual([]);
    });

    it("should record metrics for all outcomes", async () => {
      const username = "test_user";

      validationService.validateFormat.mockReturnValue({
        isValid: true,
        canonical: "test_user",
        errors: [],
        warnings: [],
      });

      reservedService.isReserved.mockReturnValue({ isReserved: false });
      usernameService.isUsernameAvailable.mockResolvedValue(true);

      await controller.checkAvailability(username, mockRequest);

      expect(metricsService.incrementUsernameChecks).toHaveBeenCalledWith(
        "available",
        mockRequest.ip,
      );
      expect(metricsService.recordUsernameCheckLatency).toHaveBeenCalled();
    });
  });

  describe("updateUsername", () => {
    const mockRequest = {
      user: { id: "f47ac10b-58cc-4372-a567-0e02b2c3d479" },
      ip: "127.0.0.1",
    };

    const mockUpdateDto = {
      username: "new_username",
    };

    it("should successfully update username", async () => {
      const canonical = "new_username";
      const currentUser = {
        id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        username: "old_username",
        username_canonical: "old_username",
        username_last_changed_at: undefined,
        username_change_count: 0,
      };

      validationService.validateForRegistration.mockReturnValue({
        isValid: true,
        canonical,
        errors: [],
        warnings: [],
      });

      reservedService.isReserved.mockReturnValue({
        isReserved: false,
      });

      usernameService.getUserById.mockResolvedValue(currentUser);

      validationService.isUsernameChangeAllowed.mockReturnValue({
        allowed: true,
      });

      usernameService.isUsernameAvailable.mockResolvedValue(true);

      const updateResult = {
        changed_at: new Date("2025-10-08T10:00:00Z"),
        next_change_allowed_at: new Date("2025-11-07T10:00:00Z"),
      };

      usernameService.updateUsername.mockResolvedValue(updateResult);
      validationService.sanitizeForLogging.mockReturnValue("us***[8]");

      const result = await controller.updateUsername(
        mockUpdateDto,
        mockRequest,
      );

      expect(result.success).toBe(true);
      expect(result.username).toBe("new_username");
      expect(result.message).toBe("Username updated successfully");
    });

    it("should reject invalid username format", async () => {
      validationService.validateForRegistration.mockReturnValue({
        isValid: false,
        canonical: null,
        errors: ["Username contains invalid characters"],
        warnings: [],
      });

      await expect(
        controller.updateUsername(mockUpdateDto, mockRequest),
      ).rejects.toThrow(BadRequestException);

      expect(usernameService.getUserById).not.toHaveBeenCalled();
    });

    it("should reject reserved usernames", async () => {
      const canonical = "admin";

      validationService.validateForRegistration.mockReturnValue({
        isValid: true,
        canonical,
        errors: [],
        warnings: [],
      });

      reservedService.isReserved.mockReturnValue({
        isReserved: true,
        reason: "Username is reserved for system functionality",
        category: "system",
      });

      await expect(
        controller.updateUsername(mockUpdateDto, mockRequest),
      ).rejects.toThrow(ConflictException);

      expect(usernameService.getUserById).not.toHaveBeenCalled();
    });

    it("should enforce rate limiting", async () => {
      const canonical = "new_username";
      const currentUser = {
        id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        username: "old_username",
        username_canonical: "old_username",
        username_last_changed_at: new Date(),
        username_change_count: 2,
      };

      validationService.validateForRegistration.mockReturnValue({
        isValid: true,
        canonical,
        errors: [],
        warnings: [],
      });

      reservedService.isReserved.mockReturnValue({
        isReserved: false,
      });

      usernameService.getUserById.mockResolvedValue(currentUser);

      validationService.isUsernameChangeAllowed.mockReturnValue({
        allowed: false,
        reason: "Must wait 30 days between username changes",
        nextAllowedAt: new Date("2025-11-07T10:00:00Z"),
      });

      await expect(
        controller.updateUsername(mockUpdateDto, mockRequest),
      ).rejects.toThrow(ConflictException);

      expect(usernameService.isUsernameAvailable).not.toHaveBeenCalled();
    });

    it("should reject taken usernames", async () => {
      const canonical = "taken_username";
      const currentUser = {
        id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        username: "old_username",
        username_canonical: "old_username",
        username_last_changed_at: undefined,
        username_change_count: 0,
      };

      validationService.validateForRegistration.mockReturnValue({
        isValid: true,
        canonical,
        errors: [],
        warnings: [],
      });

      reservedService.isReserved.mockReturnValue({
        isReserved: false,
      });

      usernameService.getUserById.mockResolvedValue(currentUser);

      validationService.isUsernameChangeAllowed.mockReturnValue({
        allowed: true,
      });

      usernameService.isUsernameAvailable.mockResolvedValue(false);
      validationService.generateSuggestions.mockReturnValue([
        "taken_username1",
        "taken_username_",
      ]);

      await expect(
        controller.updateUsername(mockUpdateDto, mockRequest),
      ).rejects.toThrow(ConflictException);
    });

    it("should require authentication", async () => {
      const unauthenticatedRequest = {
        user: null,
        ip: "127.0.0.1",
      };

      await expect(
        controller.updateUsername(mockUpdateDto, unauthenticatedRequest),
      ).rejects.toThrow(BadRequestException);
    });

    it("should record metrics for all outcomes", async () => {
      validationService.validateForRegistration.mockReturnValue({
        isValid: false,
        canonical: null,
        errors: ["Invalid format"],
        warnings: [],
      });

      await expect(
        controller.updateUsername(mockUpdateDto, mockRequest),
      ).rejects.toThrow();

      expect(metricsService.incrementUsernameUpdates).toHaveBeenCalledWith(
        "attempt",
        "123",
      );
      expect(metricsService.incrementUsernameUpdates).toHaveBeenCalledWith(
        "invalid_format",
        "123",
      );
    });
  });

  describe("Rate limiting and security", () => {
    it("should be protected by throttle guard", () => {
      const guards = Reflect.getMetadata("__guards__", UsernameApiController);
      expect(guards).toContain(ThrottlerGuard);
    });

    it("should handle concurrent requests safely", async () => {
      const username = "concurrent_test";
      const mockRequest = {
        ip: "127.0.0.1",
        headers: { "user-agent": "test-agent" },
      };

      validationService.validateFormat.mockReturnValue({
        isValid: true,
        canonical: username,
        errors: [],
        warnings: [],
      });

      reservedService.isReserved.mockReturnValue({
        isReserved: false,
      });

      usernameService.isUsernameAvailable.mockResolvedValue(true);

      // Simulate concurrent requests
      const requests = Array.from({ length: 10 }, () =>
        controller.checkAvailability(username, mockRequest),
      );

      const results = await Promise.all(requests);

      expect(results).toHaveLength(10);
      results.forEach((result) => {
        expect(result.available).toBe(true);
        expect(result.canonical).toBe(username);
      });
    });

    it("should sanitize usernames in logs", async () => {
      const username = "test_user";
      const mockRequest = {
        ip: "127.0.0.1",
        headers: { "user-agent": "test-agent" },
      };

      validationService.validateFormat.mockReturnValue({
        isValid: true,
        canonical: username,
        errors: [],
        warnings: [],
      });

      reservedService.isReserved.mockReturnValue({
        isReserved: false,
      });

      usernameService.isUsernameAvailable.mockResolvedValue(true);
      validationService.sanitizeForLogging.mockReturnValue("te***[9]");

      await controller.checkAvailability(username, mockRequest);

      expect(validationService.sanitizeForLogging).toHaveBeenCalledWith(
        username,
      );
    });
  });

  describe("Error handling", () => {
    it("should handle validation service errors", async () => {
      const username = "test_user";
      const mockRequest = {
        ip: "127.0.0.1",
        headers: { "user-agent": "test-agent" },
      };

      validationService.validateFormat.mockImplementation(() => {
        throw new Error("Validation service error");
      });

      const result = await controller.checkAvailability(username, mockRequest);

      expect(result.available).toBe(false);
      expect(result.reason).toBe("Temporarily unavailable");
    });

    it("should handle reserved service errors", async () => {
      const username = "test_user";
      const mockRequest = {
        ip: "127.0.0.1",
        headers: { "user-agent": "test-agent" },
      };

      validationService.validateFormat.mockReturnValue({
        isValid: true,
        canonical: username,
        errors: [],
        warnings: [],
      });

      reservedService.isReserved.mockImplementation(() => {
        throw new Error("Reserved service error");
      });

      const result = await controller.checkAvailability(username, mockRequest);

      expect(result.available).toBe(false);
      expect(result.reason).toBe("Temporarily unavailable");
    });

    it("should handle user service errors during updates", async () => {
      const mockRequest = {
        user: { id: "f47ac10b-58cc-4372-a567-0e02b2c3d479" },
        ip: "127.0.0.1",
      };

      const mockUpdateDto = {
        username: "new_username",
      };

      validationService.validateForRegistration.mockReturnValue({
        isValid: true,
        canonical: "new_username",
        errors: [],
        warnings: [],
      });

      reservedService.isReserved.mockReturnValue({
        isReserved: false,
      });

      usernameService.getUserById.mockRejectedValue(
        new Error("Database error"),
      );

      await expect(
        controller.updateUsername(mockUpdateDto, mockRequest),
      ).rejects.toThrow("Database error");

      expect(metricsService.incrementUsernameUpdates).toHaveBeenCalledWith(
        "error",
        "123",
      );
    });
  });
});
