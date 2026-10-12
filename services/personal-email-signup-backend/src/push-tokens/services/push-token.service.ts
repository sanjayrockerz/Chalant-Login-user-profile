import { Injectable, Logger, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryRunner, DataSource } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { 
  RegisterPushTokenDto, 
  UpdatePushTokenDto, 
  ListPushTokensQueryDto, 
  PushTokenResponseDto,
  PaginatedPushTokensResponseDto,
  BulkTokenOperationDto,
  BulkOperationResultDto,
  TokenValidationResultDto,
  PushPlatform,
  PushTokenType
} from '../dto/push-token.dto';
import { NotificationDeliveryFeedbackDto, DeliveryStatus } from '../dto/notification-feedback.dto';
import { TokenValidationUtils } from '../validators/push-token.validators';
import { PushToken } from '../entities/push-token.entity';
import { PushTokenAudit } from '../entities/push-token-audit.entity';
import { PushTokenValidation } from '../entities/push-token-validation.entity';
import { PushTokenCacheService } from './push-token-cache.service';
import { PushTokenObservabilityService } from './push-token-observability.service';
import { PushTokenAuditLoggerService } from './push-token-audit-logger.service';

@Injectable()
export class PushTokenService {
  private readonly logger = new Logger(PushTokenService.name);
  private readonly hardFailureCodes = new Set(['UNREGISTERED', 'INVALID_ARGUMENT', '410']);
  private readonly transientFailureCodes = new Set(['429', 'RESOURCE_EXHAUSTED', 'UNAVAILABLE', 'DEADLINE_EXCEEDED', 'TIMEOUT', '503']);
  private readonly failureStatuses = new Set<DeliveryStatus>(['failed', 'expired', 'unregistered', 'invalid', 'throttled']);
  private readonly tokenRefreshGraceMs = 60 * 60 * 1000; // 1 hour grace window
  private readonly failureThreshold = 3;
  private readonly failureWindowMs = 7 * 24 * 60 * 60 * 1000; // 7 days
  
  constructor(
    @InjectRepository(PushToken)
    private readonly pushTokenRepository: Repository<PushToken>,
    @InjectRepository(PushTokenAudit)
    private readonly auditRepository: Repository<PushTokenAudit>,
    @InjectRepository(PushTokenValidation)
    private readonly validationRepository: Repository<PushTokenValidation>,
    private readonly dataSource: DataSource,
    private readonly cacheService: PushTokenCacheService,
    private readonly observabilityService: PushTokenObservabilityService,
    private readonly auditLogger: PushTokenAuditLoggerService,
  ) {}

  /**
   * Register a new push token or update existing one
   */
  async registerToken(
    userId: string,
    registerDto: RegisterPushTokenDto,
    tenantId: string = 'default',
    correlationId: string,
    userAgent?: string,
    ipAddress?: string
  ): Promise<PushTokenResponseDto> {
    const startTime = Date.now();
    
    this.logger.log({
      message: 'Starting token registration',
      userId,
      platform: registerDto.platform,
      tokenType: registerDto.tokenType,
      correlationId,
      tenantId
    });

    // Validate token format for platform
    const validationResult = TokenValidationUtils.validateTokenForPlatform(
      registerDto.token,
      registerDto.platform,
      registerDto.tokenType
    );

    if (!validationResult.isValid) {
      this.logger.warn({
        message: 'Invalid token format during registration',
        userId,
        platform: registerDto.platform,
        error: validationResult.error,
        correlationId
      });
      
      throw new BadRequestException(validationResult.error);
    }

    // Hash token for duplicate detection
    const tokenHash = TokenValidationUtils.hashToken(registerDto.token);
    const maskedToken = TokenValidationUtils.maskToken(registerDto.token);
    
    // Normalize device metadata
    const normalizedMetadata = TokenValidationUtils.normalizeDeviceMetadata(
      registerDto.deviceMetadata
    );

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Check for existing token with same hash using query builder for better control
      let existingToken = await queryRunner.manager
        .createQueryBuilder(PushToken, 'token')
        .where('token.userId = :userId', { userId })
        .andWhere('token.tokenHash = :tokenHash', { tokenHash })
        .andWhere('token.platform = :platform', { platform: registerDto.platform })
        .andWhere('token.active = :active', { active: true })
        .andWhere('token.deletedAt IS NULL')
        .getOne();

      let isNewToken = false;
      let isExistingTokenUpdated = false;
      let tokenEntity: PushToken;
      let refreshedFromTokenId: string | undefined;
      const registrationMoment = new Date();

      if (existingToken) {
        // Update existing token
        existingToken.token = registerDto.token; // Update in case of token refresh
        existingToken.deviceMetadata = normalizedMetadata;
        existingToken.updatedAt = registrationMoment;
        existingToken.lastValidatedAt = registrationMoment;
        existingToken.failureCount = 0; // Reset failure count on re-registration
        existingToken.lastFailureAt = undefined;
        existingToken.failureReason = undefined;

        tokenEntity = await queryRunner.manager.save(existingToken);
        isExistingTokenUpdated = true;

        this.logger.log({
          message: 'Updated existing token',
          tokenId: tokenEntity.id,
          userId,
          correlationId
        });
      } else {
        // Create new token
        const newToken = queryRunner.manager.create(PushToken, {
          userId,
          token: registerDto.token,
          tokenHash,
          platform: registerDto.platform,
          tokenType: registerDto.tokenType,
          deviceMetadata: normalizedMetadata,
          tenantId,
          active: true,
          failureCount: 0,
          createdAt: registrationMoment,
          updatedAt: registrationMoment,
          lastValidatedAt: registrationMoment,
        });

        tokenEntity = await queryRunner.manager.save(newToken);
        isNewToken = true;

        this.logger.log({
          message: 'Created new token',
          tokenId: tokenEntity.id,
          userId,
          correlationId
        });

        const existingActives = await queryRunner.manager
          .createQueryBuilder(PushToken, 'token')
          .where('token.userId = :userId', { userId })
          .andWhere('token.platform = :platform', { platform: registerDto.platform })
          .andWhere('token.id != :tokenId', { tokenId: tokenEntity.id })
          .andWhere('token.active = :active', { active: true })
          .andWhere('token.deletedAt IS NULL')
          .orderBy('token.updatedAt', 'DESC')
          .getMany();

        if (existingActives.length > 0) {
          const graceBoundary = new Date(Date.now() - this.tokenRefreshGraceMs);
          const deviceId = this.extractDeviceId(normalizedMetadata);
          const matchingDevice = deviceId
            ? existingActives.find(token => this.extractDeviceId(token.deviceMetadata) === deviceId)
            : undefined;

          const candidate = matchingDevice ?? existingActives[0];

          if (candidate && candidate.updatedAt > graceBoundary) {
            refreshedFromTokenId = candidate.id;
          }
        }
      }

        // If this is marked as primary, deactivate other primary tokens
        if (registerDto.isPrimary) {
          await queryRunner.manager
            .createQueryBuilder()
            .update(PushToken)
            .set({ updatedAt: new Date() })
            .where('userId = :userId', { userId })
            .andWhere('platform = :platform', { platform: registerDto.platform })
            .andWhere('active = :active', { active: true })
            .andWhere('deletedAt IS NULL')
            .andWhere('id != :tokenId', { tokenId: tokenEntity.id })
            .execute();
        }      // Create audit entry
      await queryRunner.manager.save(PushTokenAudit, {
        tokenId: tokenEntity.id,
        userId,
        eventType: isNewToken ? 'registered' : 'updated',
        eventData: {
          platform: registerDto.platform,
          tokenType: registerDto.tokenType,
          deviceMetadata: normalizedMetadata,
          isPrimary: registerDto.isPrimary,
          isNewToken,
          isExistingTokenUpdated
        },
        correlationId,
        tenantId,
        userAgent,
        ipAddress,
        createdBy: 'api_registration'
      });

        // Get total device count for user
        const deviceCount = await queryRunner.manager.count(PushToken, {
          where: {
            userId,
            active: true,
            deletedAt: undefined
          }
        });

      await queryRunner.commitTransaction();

      // Cache the new/updated token
      const responseDto = this.mapToResponseDto(tokenEntity);
      await this.cacheService.cacheToken(responseDto);
      
      // Invalidate user cache to ensure fresh data on next request
      await this.cacheService.invalidateUserCache(userId);

      await this.auditLogger.logRegistered({
        tokenId: tokenEntity.id,
        userId,
        platform: registerDto.platform,
        tokenType: registerDto.tokenType,
        tenantId,
        correlationId,
        hasDeviceMetadata: Boolean(normalizedMetadata && Object.keys(normalizedMetadata).length),
        isNewToken,
      });

      if (refreshedFromTokenId) {
        await this.auditLogger.logRefreshed({
          userId,
          platform: registerDto.platform,
          tenantId,
          oldTokenId: refreshedFromTokenId,
          newTokenId: tokenEntity.id,
          correlationId,
        });
      }

      const processingTime = Date.now() - startTime;
      const isRefresh = Boolean(refreshedFromTokenId);
      
      this.logger.log({
        message: 'Token registration completed',
        tokenId: tokenEntity.id,
        userId,
        isNewToken,
        isExistingTokenUpdated,
        deviceCount,
        processingTimeMs: processingTime,
        correlationId
      });

      // Record observability metrics
      await this.observabilityService.recordTokenRegistration(
        registerDto.platform,
        registerDto.tokenType,
        tenantId,
        true, // success
        processingTime,
        correlationId,
        userId,
        isNewToken,
        isRefresh
      );

      return {
        id: tokenEntity.id,
        userId: tokenEntity.userId,
        maskedToken,
        platform: tokenEntity.platform,
        tokenType: tokenEntity.tokenType,
        deviceMetadata: tokenEntity.deviceMetadata,
        createdAt: tokenEntity.createdAt.toISOString(),
        updatedAt: tokenEntity.updatedAt.toISOString(),
        lastValidatedAt: tokenEntity.lastValidatedAt.toISOString(),
        lastUsedAt: tokenEntity.lastUsedAt?.toISOString(),
        active: tokenEntity.active,
        failureCount: tokenEntity.failureCount,
        lastFailureAt: tokenEntity.lastFailureAt?.toISOString(),
        failureReason: tokenEntity.failureReason,
        tenantId: tokenEntity.tenantId
      };

    } catch (error) {
      await queryRunner.rollbackTransaction();
      
      const processingTime = Date.now() - startTime;
      
      this.logger.error({
        message: 'Token registration failed',
        userId,
        error: error.message,
        correlationId
      });

      // Record failure metrics
      await this.observabilityService.recordTokenRegistration(
        registerDto.platform,
        registerDto.tokenType,
        tenantId,
        false, // failure
        processingTime,
        correlationId,
        userId,
        false,
        false,
        error.constructor.name
      );
      
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Update an existing push token
   */
  async updateToken(
    tokenId: string,
    userId: string,
    updateDto: UpdatePushTokenDto,
    correlationId: string,
    userAgent?: string,
    ipAddress?: string
  ): Promise<PushTokenResponseDto> {
    this.logger.log({
      message: 'Starting token update',
      tokenId,
      userId,
      correlationId
    });

    const existingToken = await this.pushTokenRepository.findOne({
      where: {
        id: tokenId,
        userId,
        active: true,
        deletedAt: undefined
      }
    });

    if (!existingToken) {
      throw new NotFoundException('Push token not found or not accessible');
    }

    // Validate new token format if provided
    if (updateDto.token) {
      const validationResult = TokenValidationUtils.validateTokenForPlatform(
        updateDto.token,
        existingToken.platform,
        existingToken.tokenType
      );

      if (!validationResult.isValid) {
        throw new BadRequestException(validationResult.error);
      }

        // Check for duplicate token
        const tokenHash = TokenValidationUtils.hashToken(updateDto.token);
        const duplicateToken = await this.pushTokenRepository
          .createQueryBuilder('token')
          .where('token.userId = :userId', { userId })
          .andWhere('token.tokenHash = :tokenHash', { tokenHash })
          .andWhere('token.platform = :platform', { platform: existingToken.platform })
          .andWhere('token.active = :active', { active: true })
          .andWhere('token.deletedAt IS NULL')
          .andWhere('token.id != :tokenId', { tokenId })
          .getOne();      if (duplicateToken) {
        throw new ConflictException('Token already registered for this user and platform');
      }
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Update token fields
      const updatedFields: Partial<PushToken> = {
        updatedAt: new Date()
      };

      if (updateDto.token) {
        updatedFields.token = updateDto.token;
        updatedFields.tokenHash = TokenValidationUtils.hashToken(updateDto.token);
        updatedFields.lastValidatedAt = new Date();
        updatedFields.failureCount = 0; // Reset on token update
        updatedFields.lastFailureAt = null;
        updatedFields.failureReason = null;
      }

      if (updateDto.deviceMetadata !== undefined) {
        updatedFields.deviceMetadata = TokenValidationUtils.normalizeDeviceMetadata(
          updateDto.deviceMetadata
        );
      }

      if (updateDto.active !== undefined) {
        updatedFields.active = updateDto.active;
      }

      await queryRunner.manager.update(PushToken, { id: tokenId }, updatedFields);

      // Create audit entry
      await queryRunner.manager.save(PushTokenAudit, {
        tokenId,
        userId,
        eventType: 'updated',
        eventData: {
          updatedFields: Object.keys(updatedFields),
          tokenUpdated: !!updateDto.token,
          metadataUpdated: updateDto.deviceMetadata !== undefined,
          activeChanged: updateDto.active !== undefined
        },
        correlationId,
        tenantId: existingToken.tenantId,
        userAgent,
        ipAddress,
        createdBy: 'api_update'
      });

      const updatedToken = await queryRunner.manager.findOne(PushToken, {
        where: { id: tokenId }
      });

      await queryRunner.commitTransaction();

      // Invalidate cache for this token and user
      await this.cacheService.invalidateTokenCache(tokenId, userId);

      this.logger.log({
        message: 'Token updated successfully',
        tokenId,
        userId,
        correlationId
      });

      const responseDto = this.mapToResponseDto(updatedToken);
      
      // Cache the updated token
      await this.cacheService.cacheToken(responseDto);
      
      return responseDto;

    } catch (error) {
      await queryRunner.rollbackTransaction();
      
      this.logger.error({
        message: 'Token update failed',
        tokenId,
        userId,
        error: error.message,
        correlationId
      });
      
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * List push tokens for a user with filtering and pagination
   */
  async listUserTokens(
    userId: string,
    queryDto: ListPushTokensQueryDto,
    correlationId: string
  ): Promise<PaginatedPushTokensResponseDto> {
    this.logger.log({
      message: 'Listing user tokens',
      userId,
      filters: queryDto,
      correlationId
    });

    // Try to get from cache first (only for simple queries)
    const isSimpleQuery = !queryDto.page || queryDto.page === 1;
    if (isSimpleQuery) {
      const cachedResult = await this.cacheService.getCachedUserTokens(userId, {
        platform: queryDto.platform,
        active: queryDto.active
      });

      if (cachedResult) {
        this.logger.debug({
          message: 'Returning cached user tokens',
          userId,
          tokenCount: cachedResult.tokens.length,
          cachedAt: cachedResult.cachedAt,
          correlationId
        });

        // Apply pagination to cached results
        const page = queryDto.page ?? 1;
        const limit = queryDto.limit ?? 20;
        const offset = (page - 1) * limit;
        const paginatedTokens = cachedResult.tokens.slice(offset, offset + limit);
        const total = cachedResult.tokens.length;
        const totalPages = Math.ceil(total / limit);

        return {
          tokens: paginatedTokens,
          pagination: {
            page,
            limit,
            total,
            totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1
          }
        };
      }
    }

    // Fallback to database query
    const queryBuilder = this.pushTokenRepository.createQueryBuilder('token')
      .where('token.userId = :userId', { userId })
      .andWhere('token.deletedAt IS NULL');

    // Apply filters
    if (queryDto.platform) {
      queryBuilder.andWhere('token.platform = :platform', { platform: queryDto.platform });
    }

    if (queryDto.active !== undefined) {
      queryBuilder.andWhere('token.active = :active', { active: queryDto.active });
    }

    if (!queryDto.includeFailures) {
      queryBuilder.andWhere('token.failureCount < :maxFailures', { maxFailures: 3 });
    }

    // Pagination with defaults
    const page = queryDto.page ?? 1;
    const limit = queryDto.limit ?? 20;
    const offset = (page - 1) * limit;
    
    queryBuilder
      .orderBy('token.createdAt', 'DESC')
      .offset(offset)
      .limit(limit);

    const [tokens, total] = await queryBuilder.getManyAndCount();

    const tokenDtos = tokens.map(token => this.mapToResponseDto(token));

    // Cache the results for future requests (only for first page)
    if (page === 1 && tokenDtos.length > 0) {
      await this.cacheService.cacheUserTokens(userId, tokenDtos, {
        platform: queryDto.platform,
        active: queryDto.active
      });
    }

    const totalPages = Math.ceil(total / limit);

    return {
      tokens: tokenDtos,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    };
  }

  async findActiveTokensForUser(userId: string): Promise<PushToken[]> {
    return this.pushTokenRepository.createQueryBuilder('token')
      .where('token.userId = :userId', { userId })
      .andWhere('token.active = :active', { active: true })
      .andWhere('token.deletedAt IS NULL')
      .orderBy('token.updatedAt', 'DESC')
      .getMany();
  }

  async getActiveTokenById(tokenId: string): Promise<PushToken | null> {
    const token = await this.pushTokenRepository.findOne({
      where: {
        id: tokenId,
        active: true,
        deletedAt: undefined
      }
    });

    return token ?? null;
  }

  /**
   * Delete/unregister a push token
   */
  async deleteToken(
    tokenId: string,
    userId: string,
    correlationId: string,
    reason?: string
  ): Promise<void> {
    this.logger.log({
      message: 'Starting token deletion',
      tokenId,
      userId,
      reason,
      correlationId
    });

    const token = await this.pushTokenRepository.findOne({
      where: {
        id: tokenId,
        userId,
        active: true,
        deletedAt: undefined
      }
    });

    if (!token) {
      throw new NotFoundException('Push token not found or not accessible');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Soft delete the token
      await queryRunner.manager.update(PushToken, { id: tokenId }, {
        active: false,
        deletedAt: new Date(),
        updatedAt: new Date(),
        failureReason: reason || 'User requested deletion'
      });

      // Create audit entry
      await queryRunner.manager.save(PushTokenAudit, {
        tokenId,
        userId,
        eventType: 'deleted',
        eventData: {
          reason: reason || 'User requested deletion',
          deletionMethod: 'api_request'
        },
        correlationId,
        tenantId: token.tenantId,
        createdBy: 'api_deletion'
      });

      await queryRunner.commitTransaction();

      // Invalidate cache for this token and user
      await this.cacheService.invalidateTokenCache(tokenId, userId);

      this.logger.log({
        message: 'Token deleted successfully',
        tokenId,
        userId,
        correlationId
      });

      await this.auditLogger.logUnregistered({
        userId,
        platform: token.platform,
        tenantId: token.tenantId,
        correlationId,
        reason: reason || 'user_logout',
        unregisteredCount: 1,
      });

      this.observabilityService.recordTokenUnregistered(token.platform, reason || 'user_logout');

    } catch (error) {
      await queryRunner.rollbackTransaction();
      
      this.logger.error({
        message: 'Token deletion failed',
        tokenId,
        userId,
        error: error.message,
        correlationId
      });
      
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Validate tokens against platform APIs (FCM/APNs)
   */
  async validateTokens(
    tokenIds: string[],
    correlationId: string,
    validationType: 'registration' | 'periodic' | 'feedback' = 'periodic'
  ): Promise<TokenValidationResultDto[]> {
    const startTime = Date.now();
    
    this.logger.log({
      message: 'Starting token validation',
      tokenCount: tokenIds.length,
      validationType,
      correlationId
    });

    return this.observabilityService.withTokenOperationSpan(
      'validate_tokens',
      async () => {
        const results: TokenValidationResultDto[] = [];
        const platformCounts: Record<PushPlatform, number> = {
          [PushPlatform.IOS]: 0,
          [PushPlatform.ANDROID]: 0
        };

        for (const tokenId of tokenIds) {
          try {
            const token = await this.pushTokenRepository.findOne({
              where: { id: tokenId, active: true, deletedAt: undefined }
            });

            if (!token) {
              results.push({
                tokenId,
                result: 'invalid',
                message: 'Token not found',
                validatedAt: new Date().toISOString()
              });
              continue;
            }

            // Track platform for metrics
            platformCounts[token.platform]++;

            // Check cache first
            const cachedValidation = await this.cacheService.getCachedValidationResult(tokenId);
            if (cachedValidation) {
              this.observabilityService.recordCacheOperation('hit', 'validation');
              results.push({
                tokenId,
                result: cachedValidation.result,
                responseCode: cachedValidation.responseCode,
                message: cachedValidation.message,
                validatedAt: cachedValidation.validatedAt
              });
              continue;
            }

            this.observabilityService.recordCacheOperation('miss', 'validation');

            // Simulate platform validation (in real implementation, call FCM/APNs APIs)
            const validationResult = await this.validateTokenWithPlatform(token);

            // Update token based on validation result
            if (validationResult.result === 'invalid' || validationResult.result === 'expired') {
              await this.markTokenAsInvalid(token.id, validationResult.message || 'Validation failed', correlationId);
            } else if (validationResult.result === 'valid') {
              await this.markTokenAsValid(token.id, correlationId);
            }

            // Cache validation result
            await this.cacheService.cacheValidationResult(tokenId, {
              result: validationResult.result,
              validatedAt: new Date().toISOString(),
              responseCode: validationResult.responseCode,
              message: validationResult.message
            });

            // Save validation record
            await this.validationRepository.save({
              tokenId: token.id,
              validationType,
              validationResult: validationResult.result,
              validationSource: token.tokenType === PushTokenType.FCM ? 'fcm_api' : 'apns_api',
              responseCode: validationResult.responseCode,
              responseMessage: validationResult.message,
              correlationId,
              tenantId: token.tenantId
            });

            results.push({
              tokenId,
              result: validationResult.result,
              responseCode: validationResult.responseCode,
              message: validationResult.message,
              validatedAt: new Date().toISOString()
            });

          } catch (error) {
            this.observabilityService.logError('token_validation', error, correlationId, { tokenId });

            results.push({
              tokenId,
              result: 'error',
              message: error.message,
              validatedAt: new Date().toISOString()
            });
          }
        }

        const processingTime = Date.now() - startTime;

        // Record metrics for each platform
        for (const [platform, count] of Object.entries(platformCounts)) {
          if (count > 0) {
            const platformResults = results.filter((_, index) => index < count);
            const validCount = platformResults.filter(r => r.result === 'valid').length;
            const invalidCount = platformResults.filter(r => r.result === 'invalid').length;
            const errorCount = platformResults.filter(r => r.result === 'error').length;

            await this.observabilityService.recordTokenValidation(
              platform as PushPlatform,
              validationType,
              validCount > invalidCount ? 'valid' : (errorCount > 0 ? 'error' : 'invalid'),
              processingTime / count, // Average time per token
              correlationId,
              count
            );
          }
        }

        this.logger.log({
          message: 'Token validation completed',
          totalTokens: tokenIds.length,
          validTokens: results.filter(r => r.result === 'valid').length,
          invalidTokens: results.filter(r => r.result === 'invalid').length,
          processingTimeMs: processingTime,
          correlationId
        });

        return results;
      },
      {
        'push.validation_type': validationType,
        'push.token_count': tokenIds.length,
        'push.correlation_id': correlationId
      }
    );
  }

  async recordSuccess(
    tokenId: string,
    options?: { correlationId?: string; notificationType?: string; latencyMs?: number }
  ): Promise<void> {
    const correlationId = options?.correlationId ?? randomUUID();
    const token = await this.pushTokenRepository.findOne({
      where: { id: tokenId, deletedAt: undefined }
    });

    if (!token) {
      this.logger.warn({
        message: 'Attempted to record success for missing token',
        tokenId,
        correlationId
      });
      return;
    }

    const now = new Date();
    await this.pushTokenRepository.update(tokenId, {
      failureCount: 0,
      lastFailureAt: null,
      failureReason: null,
      lastValidatedAt: now,
      updatedAt: now,
      active: true
    });

  await this.cacheService.invalidateTokenCache(tokenId, token.userId);
  await this.cacheService.invalidateUserCache(token.userId);
    await this.cacheService.invalidateUserCache(token.userId);

    this.observabilityService.recordDeliverySuccess(
      token.platform,
      options?.latencyMs ?? 0,
      correlationId,
      options?.notificationType
    );

    await this.auditLogger.logDeliverySuccess({
      tokenId,
      platform: token.platform,
      correlationId,
      notificationType: options?.notificationType,
      tenantId: token.tenantId,
    });
  }

  async recordFailure(
    tokenId: string,
    errorCode: string,
    attemptNumber: number = 1,
    options?: { correlationId?: string; latencyMs?: number }
  ): Promise<{ deactivated: boolean; failureCount: number; nextRetryMs: number | null; errorCode: string }> {
    const correlationId = options?.correlationId ?? randomUUID();
    const normalizedCode = this.normalizeErrorCode(errorCode);
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let deactivatedReason: 'hard_error' | 'failure_threshold' | undefined;

    try {
      const token = await queryRunner.manager.findOne(PushToken, {
        where: { id: tokenId }
      });

      if (!token) {
        this.logger.warn({
          message: 'Attempted to record failure for missing token',
          tokenId,
          errorCode: normalizedCode,
          correlationId
        });
        await queryRunner.rollbackTransaction();
        return { deactivated: false, failureCount: 0, nextRetryMs: null, errorCode: normalizedCode };
      }

      const now = new Date();
      const isTransient = this.isTransientFailure(normalizedCode);
      const isHard = this.isHardFailure(normalizedCode);

      token.updatedAt = now;

      if (!isTransient) {
        if (token.lastFailureAt && now.getTime() - token.lastFailureAt.getTime() > this.failureWindowMs) {
          token.failureCount = 0;
        }

        token.failureCount = (token.failureCount || 0) + 1;
        token.lastFailureAt = now;
        token.failureReason = normalizedCode;
      }

      if (isHard) {
        token.active = false;
        deactivatedReason = 'hard_error';
      } else if (!isTransient && token.failureCount >= this.failureThreshold) {
        token.active = false;
        deactivatedReason = 'failure_threshold';
      }

      await queryRunner.manager.save(token);
      await queryRunner.commitTransaction();

  await this.cacheService.invalidateTokenCache(tokenId, token.userId);

      const nextRetryMs = !token.active || isTransient ? null : this.getRetryDelayMs(token.failureCount);

      this.observabilityService.recordDeliveryFailure(
        token.platform,
        normalizedCode,
        attemptNumber,
        correlationId,
        options?.latencyMs
      );

      await this.auditLogger.logDeliveryFailure({
        tokenId,
        platform: token.platform,
        correlationId,
        errorCode: normalizedCode,
        attemptNumber,
        tenantId: token.tenantId,
      });

      if (deactivatedReason) {
        await this.auditLogger.logInvalidated({
          tokenId,
          userId: token.userId,
          platform: token.platform,
          tenantId: token.tenantId,
          correlationId,
          reason: deactivatedReason,
          errorCode: normalizedCode,
        });

        this.observabilityService.recordTokenInvalidated(token.platform, deactivatedReason);
        await this.cacheService.invalidateTokenCache(tokenId, token.userId);
        await this.cacheService.invalidateUserCache(token.userId);
      }

      return {
        deactivated: Boolean(deactivatedReason),
        failureCount: token.failureCount,
        nextRetryMs,
        errorCode: normalizedCode,
      };

    } catch (error) {
      await queryRunner.rollbackTransaction();

      this.logger.error({
        message: 'Failed to record delivery failure',
        tokenId,
        error: (error as Error).message,
        correlationId
      });

      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async handleDeliveryFeedback(feedback: NotificationDeliveryFeedbackDto): Promise<void> {
    if (!feedback.tokenId) {
      this.logger.warn({
        message: 'Received delivery feedback without token ID',
      });
      return;
    }

    const correlationId = feedback.correlationId ?? randomUUID();
    const attemptNumber = feedback.attemptNumber && feedback.attemptNumber > 0
      ? feedback.attemptNumber
      : 1;
    const status = feedback.status.toLowerCase() as DeliveryStatus;

    this.logger.log({
      message: 'Processing notification delivery feedback',
      tokenId: feedback.tokenId,
      status,
      attemptNumber,
      correlationId
    });

    let platform = feedback.platform;
    let tenantId = feedback.tenantId;

    if (!platform || !tenantId) {
      try {
        const token = await this.pushTokenRepository.findOne({ where: { id: feedback.tokenId } });
        if (token) {
          platform = platform ?? token.platform;
          tenantId = tenantId ?? token.tenantId;
        }
      } catch (error) {
        this.logger.warn({
          message: 'Failed to resolve token metadata for delivery feedback',
          tokenId: feedback.tokenId,
          correlationId,
          error: (error as Error).message
        });
      }
    }

    if (platform) {
      this.observabilityService.recordNotificationDelivery(
        platform,
        status,
        correlationId,
        feedback.notificationId,
        {
          skipOutcomeMetrics: true,
          errorCode: feedback.errorCode,
          latencyMs: feedback.latencyMs,
          attemptNumber
        }
      );
    }

    if (status === 'sent' || status === 'queued') {
      this.logger.debug({
        message: 'Received non-terminal delivery status, awaiting final outcome',
        tokenId: feedback.tokenId,
        status,
        correlationId
      });
      return;
    }

    try {
      await this.validationRepository.save({
        tokenId: feedback.tokenId,
        validationType: 'delivery',
        validationResult: this.mapFeedbackStatusToValidationResult(status),
        validationSource: 'delivery_feedback',
        responseCode: feedback.providerResponseCode,
        responseMessage: feedback.errorCode,
        responseData: {
          notificationId: feedback.notificationId,
          provider: feedback.provider,
          metadata: feedback.metadata,
          status,
          attemptNumber
        },
        validatedAt: new Date(),
        correlationId,
        tenantId: tenantId ?? 'default'
      });
    } catch (error) {
      this.logger.warn({
        message: 'Failed to persist delivery feedback validation record',
        tokenId: feedback.tokenId,
        correlationId,
        error: (error as Error).message
      });
    }

    if (status === 'delivered') {
      await this.recordSuccess(feedback.tokenId, {
        correlationId,
        notificationType: feedback.notificationType,
        latencyMs: feedback.latencyMs
      });
      return;
    }

    if (this.failureStatuses.has(status)) {
      const failureCode = feedback.errorCode
        ? this.normalizeErrorCode(feedback.errorCode)
        : this.normalizeErrorCode(status);

      await this.recordFailure(feedback.tokenId, failureCode, attemptNumber, {
        correlationId,
        latencyMs: feedback.latencyMs
      });
      return;
    }

    this.logger.debug({
      message: 'Received non-terminal notification feedback status',
      tokenId: feedback.tokenId,
      status,
      correlationId
    });
  }

  async cleanupDuplicateTokens(options?: {
    correlationId?: string;
    gracePeriodMs?: number;
    batchSize?: number;
  }): Promise<{ scanned: number; deactivated: number }> {
    const correlationId = options?.correlationId ?? randomUUID();
    const gracePeriodMs = options?.gracePeriodMs ?? this.tokenRefreshGraceMs;
    const batchSize = options?.batchSize ?? 1000;
    const graceBoundary = new Date(Date.now() - gracePeriodMs);

    this.logger.log({
      message: 'Starting duplicate token cleanup run',
      correlationId,
      gracePeriodMinutes: gracePeriodMs / (60 * 1000),
      batchSize
    });

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

  const tokensToDeactivate: PushToken[] = [];
  const userIdsToInvalidate = new Set<string>();
  const platformTenantTouched = new Map<PushPlatform, Set<string>>();
    let scanned = 0;

    try {
      const duplicateGroups = await this.pushTokenRepository
        .createQueryBuilder('token')
        .select('token.userId', 'userId')
        .addSelect('token.platform', 'platform')
        .addSelect('COUNT(*)', 'count')
        .where('token.active = :active', { active: true })
        .andWhere('token.deletedAt IS NULL')
        .groupBy('token.userId')
        .addGroupBy('token.platform')
        .having('COUNT(*) > 1')
        .limit(batchSize)
        .getRawMany();

      for (const group of duplicateGroups) {
        scanned += Number(group.count);

        const activeTokens = await queryRunner.manager
          .createQueryBuilder(PushToken, 'token')
          .where('token.userId = :userId', { userId: group.userId })
          .andWhere('token.platform = :platform', { platform: group.platform })
          .andWhere('token.active = :active', { active: true })
          .andWhere('token.deletedAt IS NULL')
          .orderBy('token.updatedAt', 'DESC')
          .getMany();

        const groupedByDevice = new Map<string, PushToken[]>();

        for (const token of activeTokens) {
          const key = this.extractDeviceId(token.deviceMetadata) ?? '__no_device__';
          if (!groupedByDevice.has(key)) {
            groupedByDevice.set(key, []);
          }
          groupedByDevice.get(key)!.push(token);
        }

        for (const tokenGroup of groupedByDevice.values()) {
          tokenGroup.forEach((token, index) => {
            if (index === 0) {
              return;
            }

            if (token.updatedAt < graceBoundary) {
              tokensToDeactivate.push(token);
              userIdsToInvalidate.add(token.userId);
              if (!platformTenantTouched.has(token.platform)) {
                platformTenantTouched.set(token.platform, new Set());
              }
              platformTenantTouched.get(token.platform)!.add(token.tenantId);
            }
          });
        }
      }

      if (tokensToDeactivate.length === 0) {
        await queryRunner.commitTransaction();
        return { scanned, deactivated: 0 };
      }

      const now = new Date();
      const ids = tokensToDeactivate.map(token => token.id);

      await queryRunner.manager
        .createQueryBuilder()
        .update(PushToken)
        .set({
          active: false,
          updatedAt: now,
          failureReason: 'cleanup_job:duplicate_refresh',
          lastFailureAt: now
        })
        .where('id IN (:...ids)', { ids })
        .execute();

      await queryRunner.commitTransaction();

      for (const token of tokensToDeactivate) {
        await this.cacheService.invalidateTokenCache(token.id, token.userId);
        await this.auditLogger.logInvalidated({
          tokenId: token.id,
          userId: token.userId,
          platform: token.platform,
          tenantId: token.tenantId,
          correlationId,
          reason: 'cleanup_job',
          errorCode: 'DUPLICATE_REFRESH',
        });

        this.observabilityService.recordTokenInvalidated(token.platform, 'cleanup_job');
      }

      for (const userId of userIdsToInvalidate) {
        await this.cacheService.invalidateUserCache(userId);
      }

      this.logger.log({
        message: 'Duplicate token cleanup run completed',
        correlationId,
        deactivated: tokensToDeactivate.length,
        scanned
      });

      for (const [platform, tenantIds] of platformTenantTouched.entries()) {
        for (const tenantId of tenantIds) {
          const activeCount = await this.pushTokenRepository.count({
            where: {
              platform,
              tenantId,
              active: true,
              deletedAt: undefined
            }
          });

          await this.observabilityService.updateActiveTokenCount(platform, tenantId, activeCount);
        }
      }

      return { scanned, deactivated: tokensToDeactivate.length };

    } catch (error) {
      await queryRunner.rollbackTransaction();

      this.logger.error({
        message: 'Duplicate token cleanup run failed',
        error: (error as Error).message,
        correlationId
      });

      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  @Cron('0 * * * *', { name: 'push-token-duplicate-cleanup', timeZone: 'UTC' })
  async handleDuplicateCleanupCron(): Promise<void> {
    try {
      await this.cleanupDuplicateTokens({ correlationId: randomUUID() });
    } catch (error) {
      this.logger.error({
        message: 'Scheduled duplicate cleanup failed',
        error: (error as Error).message
      });
    }
  }

  /**
   * Cleanup invalid or stale tokens
   */
  async cleanupInvalidTokens(
    maxFailureCount: number = 5,
    failureWindowDays: number = 7,
    inactivityDays: number = 30,
    correlationId: string
  ): Promise<{ markedForCleanup: number; deleted: number }> {
    this.logger.log({
      message: 'Starting token cleanup',
      maxFailureCount,
      failureWindowDays,
      inactivityDays,
      correlationId
    });

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Mark tokens with excessive failures for cleanup
      const failureCleanupResult = await queryRunner.manager
        .createQueryBuilder()
        .update(PushToken)
        .set({
          active: false,
          deletedAt: new Date(),
          failureReason: 'Exceeded failure threshold',
          updatedAt: new Date()
        })
        .where('active = true')
        .andWhere('failureCount >= :maxFailureCount', { maxFailureCount })
        .andWhere('lastFailureAt > :failureWindow', {
          failureWindow: new Date(Date.now() - failureWindowDays * 24 * 60 * 60 * 1000)
        })
        .execute();

      // Mark inactive tokens for cleanup
      const inactivityCleanupResult = await queryRunner.manager
        .createQueryBuilder()
        .update(PushToken)
        .set({
          active: false,
          deletedAt: new Date(),
          failureReason: 'Token inactive for extended period',
          updatedAt: new Date()
        })
        .where('active = true')
        .andWhere('lastUsedAt < :inactivityThreshold', {
          inactivityThreshold: new Date(Date.now() - inactivityDays * 24 * 60 * 60 * 1000)
        })
        .execute();

      const totalMarkedForCleanup = (failureCleanupResult.affected || 0) + (inactivityCleanupResult.affected || 0);

      await queryRunner.commitTransaction();

      this.logger.log({
        message: 'Token cleanup completed',
        markedForCleanup: totalMarkedForCleanup,
        failureCleanup: failureCleanupResult.affected || 0,
        inactivityCleanup: inactivityCleanupResult.affected || 0,
        correlationId
      });

      return {
        markedForCleanup: totalMarkedForCleanup,
        deleted: totalMarkedForCleanup // In this implementation, soft delete = cleanup
      };

    } catch (error) {
      await queryRunner.rollbackTransaction();
      
      this.logger.error({
        message: 'Token cleanup failed',
        error: error.message,
        correlationId
      });
      
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Private helper methods
   */
  
  private async validateTokenWithPlatform(token: PushToken): Promise<{
    result: 'valid' | 'invalid' | 'expired' | 'unregistered';
    responseCode?: number;
    message?: string;
  }> {
    // In a real implementation, this would call FCM or APNs APIs
    // For now, simulate validation based on token format and age
    
    const isFormatValid = token.tokenType === PushTokenType.FCM 
      ? TokenValidationUtils.isValidFcmToken(token.token)
      : TokenValidationUtils.isValidApnsToken(token.token);

    if (!isFormatValid) {
      return {
        result: 'invalid',
        responseCode: 400,
        message: 'Invalid token format'
      };
    }

    // Simulate some tokens being expired (older than 60 days)
    const tokenAge = Date.now() - token.createdAt.getTime();
    const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000;
    
    if (tokenAge > sixtyDaysMs && Math.random() < 0.1) { // 10% chance of expiry for old tokens
      return {
        result: 'expired',
        responseCode: 410,
        message: 'Token expired'
      };
    }

    return {
      result: 'valid',
      responseCode: 200,
      message: 'Token valid'
    };
  }

  private async markTokenAsInvalid(tokenId: string, reason: string, correlationId: string): Promise<void> {
    await this.pushTokenRepository.update(tokenId, {
      failureCount: () => 'failure_count + 1',
      lastFailureAt: new Date(),
      failureReason: reason,
      updatedAt: new Date()
    });

    // Create audit entry
    await this.auditRepository.save({
      tokenId,
      userId: '', // Would need to fetch from token
      eventType: 'validation_failed',
      eventData: { reason },
      correlationId,
      createdBy: 'system_validation'
    });
  }

  private async markTokenAsValid(tokenId: string, correlationId: string): Promise<void> {
    await this.pushTokenRepository.update(tokenId, {
      lastValidatedAt: new Date(),
      failureCount: 0,
      lastFailureAt: null,
      failureReason: null,
      updatedAt: new Date()
    });
  }

  private extractDeviceId(metadata?: Record<string, any> | null): string | undefined {
    if (!metadata || typeof metadata !== 'object') {
      return undefined;
    }

    const candidate = metadata.deviceId ?? metadata.device_id ?? metadata.deviceID;
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }

    return undefined;
  }

  private normalizeErrorCode(errorCode: string): string {
    return (errorCode || 'UNKNOWN').toString().trim().toUpperCase();
  }

  private isHardFailure(errorCode: string): boolean {
    return this.hardFailureCodes.has(this.normalizeErrorCode(errorCode));
  }

  private isTransientFailure(errorCode: string): boolean {
    return this.transientFailureCodes.has(this.normalizeErrorCode(errorCode));
  }

  private mapFeedbackStatusToValidationResult(status: DeliveryStatus): 'valid' | 'invalid' | 'expired' | 'unregistered' {
    switch (status) {
      case 'delivered':
        return 'valid';
      case 'expired':
        return 'expired';
      case 'unregistered':
        return 'unregistered';
      default:
        return 'invalid';
    }
  }

  private getRetryDelayMs(failureCount: number): number | null {
    if (failureCount <= 0) {
      return null;
    }

    if (failureCount === 1) {
      return 60 * 60 * 1000; // 1 hour
    }

    if (failureCount === 2) {
      return 6 * 60 * 60 * 1000; // 6 hours
    }

    return null; // Stop retrying on 3rd failure
  }

  private mapToResponseDto(token: PushToken): PushTokenResponseDto {
    return {
      id: token.id,
      userId: token.userId,
      maskedToken: TokenValidationUtils.maskToken(token.token),
      platform: token.platform,
      tokenType: token.tokenType,
      deviceMetadata: token.deviceMetadata,
      createdAt: token.createdAt.toISOString(),
      updatedAt: token.updatedAt.toISOString(),
      lastValidatedAt: token.lastValidatedAt.toISOString(),
      lastUsedAt: token.lastUsedAt?.toISOString(),
      active: token.active,
      failureCount: token.failureCount,
      lastFailureAt: token.lastFailureAt?.toISOString(),
      failureReason: token.failureReason,
      tenantId: token.tenantId
    };
  }
}