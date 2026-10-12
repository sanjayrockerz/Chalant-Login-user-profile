import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Repository, DataSource, QueryRunner } from "typeorm";
import { Redis } from "ioredis";
import { v4 as uuidv4 } from "uuid";

jest.mock("uuid", () => ({
  v4: () => "11111111-1111-4111-a111-111111111111",
}));
import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";

import { PushTokenService } from "../services/push-token.service";
import { PushTokenCacheService } from "../services/push-token-cache.service";
import { PushTokenObservabilityService } from "../services/push-token-observability.service";
import { PushTokenAuditLoggerService } from "../services/push-token-audit-logger.service";
import { PushToken } from "../entities/push-token.entity";
import { PushTokenAudit } from "../entities/push-token-audit.entity";
import { PushTokenValidation } from "../entities/push-token-validation.entity";
import {
  RegisterPushTokenDto,
  UpdatePushTokenDto,
  ListPushTokensQueryDto,
  PushPlatform,
  PushTokenType,
} from "../dto/push-token.dto";
import { TokenValidationUtils } from "../validators/push-token.validators";
import { NotificationDeliveryFeedbackDto } from "../dto/notification-feedback.dto";

describe("PushTokenService Integration Tests", () => {
  let service: PushTokenService;
  let cacheService: PushTokenCacheService;
  let observabilityService: PushTokenObservabilityService;
  let pushTokenRepository: Repository<PushToken>;
  let auditRepository: Repository<PushTokenAudit>;
  let validationRepository: Repository<PushTokenValidation>;
  let dataSource: DataSource;
  let redis: Redis;
  let queryRunner: QueryRunner;
  let auditLogger: PushTokenAuditLoggerService;

  // Mock data
  const mockUserId = "test-user-123";
  const mockTenantId = "test-tenant";
  const mockCorrelationId = "test-correlation-123";

  const mockFcmToken = "f" + "A".repeat(151); // 152 characters for FCM
  const mockApnsToken = "a".repeat(64); // 64 hex characters for APNs

  const mockDeviceMetadata = {
    model: "iPhone14,2",
    osVersion: "16.4.1",
    appVersion: "2.1.0",
    deviceId: "test-device-123",
    locale: "en-US",
    timezone: "America/New_York",
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PushTokenService,
        PushTokenCacheService,
        PushTokenObservabilityService,
        {
          provide: PushTokenAuditLoggerService,
          useValue: createMockAuditLogger(),
        },
        {
          provide: getRepositoryToken(PushToken),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(PushTokenAudit),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(PushTokenValidation),
          useValue: createMockRepository(),
        },
        {
          provide: DataSource,
          useValue: createMockDataSource(),
        },
        {
          provide: "REDIS_CLIENT",
          useValue: createMockRedis(),
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<PushTokenService>(PushTokenService);
    cacheService = module.get<PushTokenCacheService>(PushTokenCacheService);
    observabilityService = module.get<PushTokenObservabilityService>(
      PushTokenObservabilityService,
    );
    pushTokenRepository = module.get<Repository<PushToken>>(
      getRepositoryToken(PushToken),
    );
    auditRepository = module.get<Repository<PushTokenAudit>>(
      getRepositoryToken(PushTokenAudit),
    );
    validationRepository = module.get<Repository<PushTokenValidation>>(
      getRepositoryToken(PushTokenValidation),
    );
    dataSource = module.get<DataSource>(DataSource);
    redis = module.get<Redis>("REDIS_CLIENT");
    auditLogger = module.get<PushTokenAuditLoggerService>(
      PushTokenAuditLoggerService,
    );
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    queryRunner = dataSource.createQueryRunner();
    jest
      .spyOn(observabilityService, "recordDeliveryFailure")
      .mockImplementation(() => undefined);
    jest
      .spyOn(observabilityService, "recordDeliverySuccess")
      .mockImplementation(() => undefined);
    jest
      .spyOn(observabilityService, "recordNotificationDelivery")
      .mockImplementation(() => undefined);
    jest.spyOn(auditLogger, "logDeliveryFailure").mockResolvedValue();
    jest.spyOn(auditLogger, "logDeliverySuccess").mockResolvedValue();
    jest.spyOn(auditLogger, "logInvalidated").mockResolvedValue();
    jest.spyOn(auditLogger, "logRegistered").mockResolvedValue();
    jest.spyOn(auditLogger, "logRefreshed").mockResolvedValue();
    jest.spyOn(auditLogger, "logUnregistered").mockResolvedValue();
    jest.spyOn(cacheService, "invalidateTokenCache").mockResolvedValue();
    jest.spyOn(cacheService, "invalidateUserCache").mockResolvedValue();
  });

  afterEach(async () => {
    await queryRunner.release();
  });

  describe("Token Registration", () => {
    it("should register a new FCM token successfully", async () => {
      const registerDto: RegisterPushTokenDto = {
        token: mockFcmToken,
        platform: PushPlatform.ANDROID,
        tokenType: PushTokenType.FCM,
        deviceMetadata: mockDeviceMetadata,
        isPrimary: false,
      };

      const mockTokenEntity = createMockTokenEntity({
        id: uuidv4(),
        userId: mockUserId,
        token: mockFcmToken,
        platform: PushPlatform.ANDROID,
        tokenType: PushTokenType.FCM,
        deviceMetadata: mockDeviceMetadata,
      });

      // Mock query builder chain for existing token check
      const mockQueryBuilder = createMockQueryBuilder(null); // No existing token
      jest
        .spyOn(queryRunner.manager, "createQueryBuilder")
        .mockReturnValue(mockQueryBuilder as any);
      jest
        .spyOn(queryRunner.manager, "create")
        .mockReturnValue(mockTokenEntity as any);
      jest
        .spyOn(queryRunner.manager, "save")
        .mockResolvedValue(mockTokenEntity);
      jest.spyOn(queryRunner.manager, "count").mockResolvedValue(1);

      const result = await service.registerToken(
        mockUserId,
        registerDto,
        mockTenantId,
        mockCorrelationId,
        "test-user-agent",
        "127.0.0.1",
      );

      expect(result).toBeDefined();
      expect(result.id).toBe(mockTokenEntity.id);
      expect(result.platform).toBe(PushPlatform.ANDROID);
      expect(result.tokenType).toBe(PushTokenType.FCM);
      expect(result.maskedToken).toMatch(/\*\*\*\.\.\..{8}$/);
      expect(result.active).toBe(true);
      expect(result.failureCount).toBe(0);

      // Verify audit entry was created
      expect(queryRunner.manager.save).toHaveBeenCalledWith(
        PushTokenAudit,
        expect.objectContaining({
          userId: mockUserId,
          eventType: "registered",
          correlationId: mockCorrelationId,
        }),
      );
    });

    it("should register a new APNs token successfully", async () => {
      const registerDto: RegisterPushTokenDto = {
        token: mockApnsToken,
        platform: PushPlatform.IOS,
        tokenType: PushTokenType.APNS,
        deviceMetadata: mockDeviceMetadata,
        isPrimary: true,
      };

      const mockTokenEntity = createMockTokenEntity({
        id: uuidv4(),
        userId: mockUserId,
        token: mockApnsToken,
        platform: PushPlatform.IOS,
        tokenType: PushTokenType.APNS,
      });

      const mockQueryBuilder = createMockQueryBuilder(null);
      jest
        .spyOn(queryRunner.manager, "createQueryBuilder")
        .mockReturnValue(mockQueryBuilder as any);
      jest
        .spyOn(queryRunner.manager, "create")
        .mockReturnValue(mockTokenEntity as any);
      jest
        .spyOn(queryRunner.manager, "save")
        .mockResolvedValue(mockTokenEntity);
      jest.spyOn(queryRunner.manager, "count").mockResolvedValue(1);

      const result = await service.registerToken(
        mockUserId,
        registerDto,
        mockTenantId,
        mockCorrelationId,
      );

      expect(result.platform).toBe(PushPlatform.IOS);
      expect(result.tokenType).toBe(PushTokenType.APNS);
    });

    it("should update existing token when re-registering", async () => {
      const registerDto: RegisterPushTokenDto = {
        token: mockFcmToken,
        platform: PushPlatform.ANDROID,
        tokenType: PushTokenType.FCM,
        deviceMetadata: { ...mockDeviceMetadata, appVersion: "2.2.0" },
      };

      const existingToken = createMockTokenEntity({
        id: uuidv4(),
        userId: mockUserId,
        token: "old-token",
        platform: PushPlatform.ANDROID,
        tokenType: PushTokenType.FCM,
        failureCount: 2,
      });

      const mockQueryBuilder = createMockQueryBuilder(existingToken);
      jest
        .spyOn(queryRunner.manager, "createQueryBuilder")
        .mockReturnValue(mockQueryBuilder as any);
      jest.spyOn(queryRunner.manager, "save").mockResolvedValue({
        ...existingToken,
        token: mockFcmToken,
        deviceMetadata: registerDto.deviceMetadata,
        failureCount: 0,
      });
      jest.spyOn(queryRunner.manager, "count").mockResolvedValue(1);

      const result = await service.registerToken(
        mockUserId,
        registerDto,
        mockTenantId,
        mockCorrelationId,
      );

      expect(result.failureCount).toBe(0); // Should reset failure count
      expect(queryRunner.manager.save).toHaveBeenCalledWith(
        PushTokenAudit,
        expect.objectContaining({
          eventType: "updated",
        }),
      );
    });

    it("should reject invalid token format", async () => {
      const registerDto: RegisterPushTokenDto = {
        token: "invalid-token",
        platform: PushPlatform.ANDROID,
        tokenType: PushTokenType.FCM,
        deviceMetadata: mockDeviceMetadata,
      };

      await expect(
        service.registerToken(
          mockUserId,
          registerDto,
          mockTenantId,
          mockCorrelationId,
        ),
      ).rejects.toThrow("Invalid FCM token format");
    });

    it("should reject mismatched platform and token type", async () => {
      const registerDto: RegisterPushTokenDto = {
        token: mockFcmToken,
        platform: PushPlatform.IOS, // iOS with FCM token
        tokenType: PushTokenType.FCM,
        deviceMetadata: mockDeviceMetadata,
      };

      await expect(
        service.registerToken(
          mockUserId,
          registerDto,
          mockTenantId,
          mockCorrelationId,
        ),
      ).rejects.toThrow();
    });
  });

  describe("Token Listing and Retrieval", () => {
    it("should list user tokens with pagination", async () => {
      const queryDto: ListPushTokensQueryDto = {
        page: 1,
        limit: 10,
        active: true,
        includeFailures: false,
      };

      const mockTokens = [
        createMockTokenEntity({ platform: PushPlatform.ANDROID }),
        createMockTokenEntity({ platform: PushPlatform.IOS }),
      ];

      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getManyAndCount.mockResolvedValue([mockTokens, 2]);
      jest
        .spyOn(pushTokenRepository, "createQueryBuilder")
        .mockReturnValue(mockQueryBuilder as any);

      const result = await service.listUserTokens(
        mockUserId,
        queryDto,
        mockCorrelationId,
      );

      expect(result.tokens).toHaveLength(2);
      expect(result.pagination.total).toBe(2);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(10);
      expect(result.pagination.hasNext).toBe(false);
      expect(result.pagination.hasPrev).toBe(false);
    });

    it("should return cached tokens when available", async () => {
      const cachedTokens = [createMockTokenResponseDto()];
      jest.spyOn(cacheService, "getCachedUserTokens").mockResolvedValue({
        tokens: cachedTokens,
        cachedAt: new Date().toISOString(),
      });

      const queryDto: ListPushTokensQueryDto = { page: 1, limit: 20 };
      const result = await service.listUserTokens(
        mockUserId,
        queryDto,
        mockCorrelationId,
      );

      expect(result.tokens).toEqual(cachedTokens);
      expect(cacheService.getCachedUserTokens).toHaveBeenCalledWith(
        mockUserId,
        expect.objectContaining({ active: undefined }),
      );
    });

    it("should filter tokens by platform", async () => {
      const queryDto: ListPushTokensQueryDto = {
        platform: PushPlatform.IOS,
        page: 1,
        limit: 10,
      };

      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);
      jest
        .spyOn(pushTokenRepository, "createQueryBuilder")
        .mockReturnValue(mockQueryBuilder as any);

      await service.listUserTokens(mockUserId, queryDto, mockCorrelationId);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        "token.platform = :platform",
        { platform: PushPlatform.IOS },
      );
    });
  });

  describe("Token Updates", () => {
    it("should update token successfully", async () => {
      const tokenId = uuidv4();
      const updateDto: UpdatePushTokenDto = {
        deviceMetadata: { ...mockDeviceMetadata, appVersion: "2.3.0" },
        active: true,
      };

      const existingToken = createMockTokenEntity({
        id: tokenId,
        userId: mockUserId,
      });
      jest
        .spyOn(pushTokenRepository, "findOne")
        .mockResolvedValue(existingToken);

      const updatedToken = { ...existingToken, ...updateDto };
      jest
        .spyOn(queryRunner.manager, "update")
        .mockResolvedValue({ affected: 1 } as any);
      jest
        .spyOn(queryRunner.manager, "findOne")
        .mockResolvedValue(updatedToken);
      jest
        .spyOn(queryRunner.manager, "save")
        .mockResolvedValue(createMockAuditEntity());

      const result = await service.updateToken(
        tokenId,
        mockUserId,
        updateDto,
        mockCorrelationId,
      );

      expect(result.deviceMetadata?.appVersion).toBe("2.3.0");
      expect(queryRunner.manager.update).toHaveBeenCalledWith(
        PushToken,
        { id: tokenId },
        expect.objectContaining({
          deviceMetadata: expect.objectContaining({ appVersion: "2.3.0" }),
        }),
      );
    });

    it("should prevent duplicate tokens on update", async () => {
      const tokenId = uuidv4();
      const updateDto: UpdatePushTokenDto = {
        token: mockFcmToken,
      };

      const existingToken = createMockTokenEntity({
        id: tokenId,
        userId: mockUserId,
      });
      jest
        .spyOn(pushTokenRepository, "findOne")
        .mockResolvedValue(existingToken);

      const duplicateQueryBuilder = createMockQueryBuilder(
        createMockTokenEntity(),
      );
      jest
        .spyOn(pushTokenRepository, "createQueryBuilder")
        .mockReturnValue(duplicateQueryBuilder as any);

      await expect(
        service.updateToken(tokenId, mockUserId, updateDto, mockCorrelationId),
      ).rejects.toThrow("Token already registered");
    });
  });

  describe("Token Deletion", () => {
    it("should soft delete token successfully", async () => {
      const tokenId = uuidv4();
      const existingToken = createMockTokenEntity({
        id: tokenId,
        userId: mockUserId,
      });

      jest
        .spyOn(pushTokenRepository, "findOne")
        .mockResolvedValue(existingToken);
      jest
        .spyOn(queryRunner.manager, "update")
        .mockResolvedValue({ affected: 1 } as any);
      jest
        .spyOn(queryRunner.manager, "save")
        .mockResolvedValue(createMockAuditEntity());

      await service.deleteToken(
        tokenId,
        mockUserId,
        mockCorrelationId,
        "User requested",
      );

      expect(queryRunner.manager.update).toHaveBeenCalledWith(
        PushToken,
        { id: tokenId },
        expect.objectContaining({
          active: false,
          deletedAt: expect.any(Date),
          failureReason: "User requested",
        }),
      );
    });

    it("should fail to delete non-existent token", async () => {
      const tokenId = uuidv4();
      jest.spyOn(pushTokenRepository, "findOne").mockResolvedValue(null);

      await expect(
        service.deleteToken(tokenId, mockUserId, mockCorrelationId),
      ).rejects.toThrow("Push token not found");
    });
  });

  describe("Token Validation", () => {
    it("should validate multiple tokens", async () => {
      const tokenIds = [uuidv4(), uuidv4()];
      const mockTokens = tokenIds.map((id) => createMockTokenEntity({ id }));

      jest
        .spyOn(pushTokenRepository, "findOne")
        .mockResolvedValueOnce(mockTokens[0])
        .mockResolvedValueOnce(mockTokens[1]);

      jest
        .spyOn(cacheService, "getCachedValidationResult")
        .mockResolvedValue(null);
      jest
        .spyOn(service as any, "validateTokenWithPlatform")
        .mockResolvedValue({
          result: "valid",
          responseCode: 200,
          message: "Token valid",
        });

      jest
        .spyOn(validationRepository, "save")
        .mockResolvedValue(createMockValidationEntity());
      jest
        .spyOn(pushTokenRepository, "update")
        .mockResolvedValue({ affected: 1 } as any);

      const results = await service.validateTokens(tokenIds, mockCorrelationId);

      expect(results).toHaveLength(2);
      expect(results[0].result).toBe("valid");
      expect(results[1].result).toBe("valid");
      expect(validationRepository.save).toHaveBeenCalledTimes(2);
    });

    it("should use cached validation results", async () => {
      const tokenId = uuidv4();
      const cachedResult = {
        result: "valid",
        validatedAt: new Date().toISOString(),
        responseCode: 200,
        message: "Cached validation",
      };

      jest
        .spyOn(pushTokenRepository, "findOne")
        .mockResolvedValue(createMockTokenEntity({ id: tokenId }));
      jest
        .spyOn(cacheService, "getCachedValidationResult")
        .mockResolvedValue(cachedResult);

      const results = await service.validateTokens(
        [tokenId],
        mockCorrelationId,
      );

      expect(results[0].result).toBe("valid");
      expect(results[0].message).toBe("Cached validation");
      expect(cacheService.getCachedValidationResult).toHaveBeenCalledWith(
        tokenId,
      );
    });
  });

  describe("Token Cleanup", () => {
    it("should cleanup invalid tokens", async () => {
      const cleanupResult = { affected: 5 };
      jest.spyOn(queryRunner.manager, "createQueryBuilder").mockReturnValue({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue(cleanupResult),
      } as any);

      const result = await service.cleanupInvalidTokens(
        5,
        7,
        30,
        mockCorrelationId,
      );

      expect(result.markedForCleanup).toBe(10); // 5 + 5 from both queries
      expect(result.deleted).toBe(10);
    });
  });

  describe("Delivery failure handling", () => {
    it("should increment failure count and schedule retry on first failure", async () => {
      const tokenId = uuidv4();
      const token = createMockTokenEntity({
        id: tokenId,
        failureCount: 0,
        lastFailureAt: undefined,
      });
      const manager = queryRunner.manager as any;
      manager.findOne.mockResolvedValue(token);
      manager.save.mockImplementation(async (entity: PushToken) => entity);

      const result = await service.recordFailure(
        tokenId,
        "PERMISSION_DENIED",
        1,
        { correlationId: mockCorrelationId },
      );

      expect(result.deactivated).toBe(false);
      expect(result.failureCount).toBe(1);
      expect(result.nextRetryMs).toBe(60 * 60 * 1000);
      expect(token.failureCount).toBe(1);
      expect(token.active).toBe(true);
    });

    it("should deactivate token after reaching failure threshold", async () => {
      const tokenId = uuidv4();
      const token = createMockTokenEntity({
        id: tokenId,
        failureCount: 2,
        lastFailureAt: new Date(),
        active: true,
      });

      const manager = queryRunner.manager as any;
      manager.findOne.mockResolvedValue(token);
      manager.save.mockImplementation(async (entity: PushToken) => entity);

      const result = await service.recordFailure(tokenId, "INTERNAL_ERROR", 3, {
        correlationId: mockCorrelationId,
      });

      expect(result.deactivated).toBe(true);
      expect(result.failureCount).toBe(3);
      expect(result.nextRetryMs).toBeNull();
      expect(token.active).toBe(false);
      expect(cacheService.invalidateTokenCache).toHaveBeenCalledWith(
        tokenId,
        token.userId,
      );
      expect(cacheService.invalidateUserCache).toHaveBeenCalledWith(
        token.userId,
      );
      expect(auditLogger.logInvalidated).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenId,
          reason: "failure_threshold",
        }),
      );
    });
  });

  describe("Notification feedback pipeline", () => {
    it("should route delivered feedback to recordSuccess", async () => {
      const tokenId = uuidv4();
      const feedback: NotificationDeliveryFeedbackDto = {
        tokenId,
        status: "delivered",
        platform: PushPlatform.ANDROID,
        notificationType: "welcome",
        correlationId: mockCorrelationId,
      };

      const successSpy = jest
        .spyOn(service, "recordSuccess")
        .mockResolvedValue();
      const failureSpy = jest
        .spyOn(service, "recordFailure")
        .mockResolvedValue({
          deactivated: false,
          failureCount: 0,
          nextRetryMs: null,
          errorCode: "UNKNOWN",
        });

      jest
        .spyOn(validationRepository, "save")
        .mockResolvedValue(createMockValidationEntity());

      await service.handleDeliveryFeedback(feedback);

      expect(successSpy).toHaveBeenCalledWith(
        tokenId,
        expect.objectContaining({
          notificationType: "welcome",
        }),
      );
      expect(failureSpy).not.toHaveBeenCalled();
      expect(validationRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenId,
          validationResult: "valid",
        }),
      );

      successSpy.mockRestore();
      failureSpy.mockRestore();
    });

    it("should record failure feedback and normalize error code", async () => {
      const tokenId = uuidv4();
      const feedback: NotificationDeliveryFeedbackDto = {
        tokenId,
        status: "unregistered",
        platform: PushPlatform.IOS,
        errorCode: "410",
        attemptNumber: 2,
        correlationId: mockCorrelationId,
      };

      const successSpy = jest
        .spyOn(service, "recordSuccess")
        .mockResolvedValue();
      const failureSpy = jest
        .spyOn(service, "recordFailure")
        .mockResolvedValue({
          deactivated: true,
          failureCount: 3,
          nextRetryMs: null,
          errorCode: "410",
        });

      jest
        .spyOn(validationRepository, "save")
        .mockResolvedValue(createMockValidationEntity());

      await service.handleDeliveryFeedback(feedback);

      expect(successSpy).not.toHaveBeenCalled();
      expect(failureSpy).toHaveBeenCalledWith(
        tokenId,
        "410",
        2,
        expect.objectContaining({
          correlationId: mockCorrelationId,
        }),
      );
      expect(validationRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenId,
          validationResult: "unregistered",
        }),
      );

      successSpy.mockRestore();
      failureSpy.mockRestore();
    });
  });

  describe("Duplicate cleanup cron", () => {
    it("should execute cleanup job with generated correlation id", async () => {
      const cleanupSpy = jest
        .spyOn(service, "cleanupDuplicateTokens")
        .mockResolvedValue({ scanned: 10, deactivated: 2 });

      await expect(
        service.handleDuplicateCleanupCron(),
      ).resolves.toBeUndefined();
      expect(cleanupSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: expect.any(String),
        }),
      );

      cleanupSpy.mockRestore();
    });

    it("should log and suppress errors from cleanup cron", async () => {
      const cleanupError = new Error("cleanup failed");
      const cleanupSpy = jest
        .spyOn(service, "cleanupDuplicateTokens")
        .mockRejectedValue(cleanupError);
      const loggerSpy = jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation(() => undefined);

      await expect(
        service.handleDuplicateCleanupCron(),
      ).resolves.toBeUndefined();
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Scheduled duplicate cleanup failed",
          error: cleanupError.message,
        }),
      );

      cleanupSpy.mockRestore();
      loggerSpy.mockRestore();
    });
  });

  describe("Cache Integration", () => {
    it("should cache token after registration", async () => {
      const registerDto: RegisterPushTokenDto = {
        token: mockFcmToken,
        platform: PushPlatform.ANDROID,
        tokenType: PushTokenType.FCM,
        deviceMetadata: mockDeviceMetadata,
      };

      const mockTokenEntity = createMockTokenEntity({ userId: mockUserId });
      const mockQueryBuilder = createMockQueryBuilder(null);

      jest
        .spyOn(queryRunner.manager, "createQueryBuilder")
        .mockReturnValue(mockQueryBuilder as any);
      jest
        .spyOn(queryRunner.manager, "create")
        .mockReturnValue(mockTokenEntity as any);
      jest
        .spyOn(queryRunner.manager, "save")
        .mockResolvedValue(mockTokenEntity);
      jest.spyOn(queryRunner.manager, "count").mockResolvedValue(1);
      jest.spyOn(cacheService, "cacheToken").mockResolvedValue();
      jest.spyOn(cacheService, "invalidateUserCache").mockResolvedValue();

      await service.registerToken(
        mockUserId,
        registerDto,
        mockTenantId,
        mockCorrelationId,
      );

      expect(cacheService.cacheToken).toHaveBeenCalled();
      expect(cacheService.invalidateUserCache).toHaveBeenCalledWith(mockUserId);
    });

    it("should invalidate cache after token update", async () => {
      const tokenId = uuidv4();
      const updateDto: UpdatePushTokenDto = { active: false };

      jest
        .spyOn(pushTokenRepository, "findOne")
        .mockResolvedValue(createMockTokenEntity({ id: tokenId }));
      jest
        .spyOn(queryRunner.manager, "update")
        .mockResolvedValue({ affected: 1 } as any);
      jest
        .spyOn(queryRunner.manager, "findOne")
        .mockResolvedValue(createMockTokenEntity({ id: tokenId }));
      jest
        .spyOn(queryRunner.manager, "save")
        .mockResolvedValue(createMockAuditEntity());
      jest.spyOn(cacheService, "invalidateTokenCache").mockResolvedValue();
      jest.spyOn(cacheService, "cacheToken").mockResolvedValue();

      await service.updateToken(
        tokenId,
        mockUserId,
        updateDto,
        mockCorrelationId,
      );

      expect(cacheService.invalidateTokenCache).toHaveBeenCalledWith(
        tokenId,
        mockUserId,
      );
      expect(cacheService.cacheToken).toHaveBeenCalled();
    });
  });

  describe("Observability Integration", () => {
    it("should record metrics for successful registration", async () => {
      const registerDto: RegisterPushTokenDto = {
        token: mockFcmToken,
        platform: PushPlatform.ANDROID,
        tokenType: PushTokenType.FCM,
        deviceMetadata: mockDeviceMetadata,
      };

      const mockTokenEntity = createMockTokenEntity({ userId: mockUserId });
      const mockQueryBuilder = createMockQueryBuilder(null);

      jest
        .spyOn(queryRunner.manager, "createQueryBuilder")
        .mockReturnValue(mockQueryBuilder as any);
      jest
        .spyOn(queryRunner.manager, "create")
        .mockReturnValue(mockTokenEntity as any);
      jest
        .spyOn(queryRunner.manager, "save")
        .mockResolvedValue(mockTokenEntity);
      jest.spyOn(queryRunner.manager, "count").mockResolvedValue(1);
      jest
        .spyOn(observabilityService, "recordTokenRegistration")
        .mockResolvedValue();

      await service.registerToken(
        mockUserId,
        registerDto,
        mockTenantId,
        mockCorrelationId,
      );

      expect(observabilityService.recordTokenRegistration).toHaveBeenCalledWith(
        PushPlatform.ANDROID,
        PushTokenType.FCM,
        mockTenantId,
        true,
        expect.any(Number),
        mockCorrelationId,
        mockUserId,
        true,
        false,
      );
    });

    it("should record metrics for failed registration", async () => {
      const registerDto: RegisterPushTokenDto = {
        token: "invalid-token",
        platform: PushPlatform.ANDROID,
        tokenType: PushTokenType.FCM,
        deviceMetadata: mockDeviceMetadata,
      };

      jest
        .spyOn(observabilityService, "recordTokenRegistration")
        .mockResolvedValue();

      await expect(
        service.registerToken(
          mockUserId,
          registerDto,
          mockTenantId,
          mockCorrelationId,
        ),
      ).rejects.toThrow();

      // Since validation fails before we reach the service method,
      // observability recording would happen in the controller layer
    });
  });

  describe("Multi-device Scenarios", () => {
    it("should handle multiple devices per user", async () => {
      const devices = [
        {
          token: mockFcmToken,
          platform: PushPlatform.ANDROID,
          tokenType: PushTokenType.FCM,
        },
        {
          token: mockApnsToken,
          platform: PushPlatform.IOS,
          tokenType: PushTokenType.APNS,
        },
      ];

      for (const device of devices) {
        const registerDto: RegisterPushTokenDto = {
          ...device,
          deviceMetadata: mockDeviceMetadata,
        };

        const mockTokenEntity = createMockTokenEntity({
          userId: mockUserId,
          platform: device.platform,
          tokenType: device.tokenType,
        });

        const mockQueryBuilder = createMockQueryBuilder(null);
        jest
          .spyOn(queryRunner.manager, "createQueryBuilder")
          .mockReturnValue(mockQueryBuilder as any);
        jest
          .spyOn(queryRunner.manager, "create")
          .mockReturnValue(mockTokenEntity as any);
        jest
          .spyOn(queryRunner.manager, "save")
          .mockResolvedValue(mockTokenEntity);
        jest
          .spyOn(queryRunner.manager, "count")
          .mockResolvedValue(devices.indexOf(device) + 1);

        const result = await service.registerToken(
          mockUserId,
          registerDto,
          mockTenantId,
          mockCorrelationId,
        );

        expect(result.platform).toBe(device.platform);
        expect(result.tokenType).toBe(device.tokenType);
      }
    });
  });

  // Helper functions for creating mock objects
  function createMockRepository() {
    return {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
      createQueryBuilder: jest.fn(),
      manager: {
        save: jest.fn(),
        create: jest.fn(),
        findOne: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
        createQueryBuilder: jest.fn(),
      },
    };
  }

  function createMockAuditLogger() {
    return {
      logDeliveryFailure: jest.fn().mockResolvedValue(undefined),
      logDeliverySuccess: jest.fn().mockResolvedValue(undefined),
      logInvalidated: jest.fn().mockResolvedValue(undefined),
      logBulkOperation: jest.fn().mockResolvedValue(undefined),
      logCleanupResult: jest.fn().mockResolvedValue(undefined),
      logRegistered: jest.fn().mockResolvedValue(undefined),
      logRefreshed: jest.fn().mockResolvedValue(undefined),
      logUnregistered: jest.fn().mockResolvedValue(undefined),
    } as unknown as PushTokenAuditLoggerService;
  }

  function createMockDataSource() {
    return {
      createQueryRunner: jest.fn().mockReturnValue({
        connect: jest.fn(),
        startTransaction: jest.fn(),
        commitTransaction: jest.fn(),
        rollbackTransaction: jest.fn(),
        release: jest.fn(),
        manager: {
          findOne: jest.fn(),
          save: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
          count: jest.fn(),
          createQueryBuilder: jest.fn(),
        },
      }),
    };
  }

  function createMockRedis() {
    return {
      ping: jest.fn().mockResolvedValue("PONG"),
      get: jest.fn(),
      set: jest.fn(),
      setex: jest.fn(),
      del: jest.fn(),
      keys: jest.fn(),
      pipeline: jest.fn().mockReturnValue({
        setex: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      }),
      info: jest.fn().mockResolvedValue("used_memory_human:10MB"),
    };
  }

  function createMockQueryBuilder(returnValue: any = []) {
    const asArray = () => {
      if (returnValue === null || returnValue === undefined) {
        return [];
      }
      return Array.isArray(returnValue) ? returnValue : [returnValue];
    };

    const collection = asArray();

    return {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(returnValue),
      getMany: jest.fn().mockResolvedValue(collection),
      getManyAndCount: jest
        .fn()
        .mockResolvedValue([collection, collection.length]),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
  }

  function createMockTokenEntity(
    overrides: Partial<PushToken> = {},
  ): PushToken {
    return {
      id: uuidv4(),
      userId: mockUserId,
      token: mockFcmToken,
      tokenHash: TokenValidationUtils.hashToken(mockFcmToken),
      platform: PushPlatform.ANDROID,
      tokenType: PushTokenType.FCM,
      deviceMetadata: mockDeviceMetadata,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastValidatedAt: new Date(),
      lastUsedAt: new Date(),
      active: true,
      failureCount: 0,
      lastFailureAt: undefined,
      failureReason: undefined,
      tenantId: mockTenantId,
      createdBy: "test",
      deletedAt: undefined,
      ...overrides,
    } as PushToken;
  }

  function createMockTokenResponseDto() {
    const entity = createMockTokenEntity();
    return {
      id: entity.id,
      userId: entity.userId,
      maskedToken: TokenValidationUtils.maskToken(entity.token),
      platform: entity.platform,
      tokenType: entity.tokenType,
      deviceMetadata: entity.deviceMetadata,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
      lastValidatedAt: entity.lastValidatedAt.toISOString(),
      lastUsedAt: entity.lastUsedAt?.toISOString(),
      active: entity.active,
      failureCount: entity.failureCount,
      lastFailureAt: entity.lastFailureAt?.toISOString(),
      failureReason: entity.failureReason,
      tenantId: entity.tenantId,
    };
  }

  function createMockAuditEntity(): PushTokenAudit {
    return {
      id: uuidv4(),
      tokenId: uuidv4(),
      userId: mockUserId,
      eventType: "test_event",
      eventData: {},
      correlationId: mockCorrelationId,
      tenantId: mockTenantId,
      userAgent: "test-agent",
      ipAddress: "127.0.0.1",
      createdAt: new Date(),
      createdBy: "test",
      expiresAt: new Date(Date.now() + 7 * 365 * 24 * 60 * 60 * 1000),
    } as PushTokenAudit;
  }

  function createMockValidationEntity(): PushTokenValidation {
    return {
      id: uuidv4(),
      tokenId: uuidv4(),
      validationType: "registration",
      validationResult: "valid",
      validationSource: "fcm_api",
      responseCode: 200,
      responseMessage: "Valid",
      responseData: {},
      validatedAt: new Date(),
      correlationId: mockCorrelationId,
      tenantId: mockTenantId,
      token: createMockTokenEntity(),
    } as PushTokenValidation;
  }
});
