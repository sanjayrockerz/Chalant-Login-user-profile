// filepath: src/user/username-api.controller.ts
import { 
  Controller, 
  Get, 
  Patch, 
  Param, 
  Body, 
  Request, 
  UseGuards, 
  HttpCode, 
  HttpStatus, 
  BadRequestException,
  ConflictException,
  Logger,
  Optional
} from '@nestjs/common';
import { 
  ApiTags, 
  ApiOperation, 
  ApiParam, 
  ApiResponse,
  ApiBearerAuth 
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { UsernameService } from './username.service';
import { UsernameValidationService } from './username-validation.service';
import { ReservedUsernamesService } from './reserved-usernames.service';
import { MetricsService } from '../metrics/metrics.service';
import { randomUUID } from 'crypto';
import { trace } from '@opentelemetry/api';
import { OnboardingMetricsService } from '../observability/onboarding-metrics.service';
import { OnboardingAuditService } from '../audit/onboarding-audit.service';

export class UpdateUsernameDto {
  username: string;
}

export interface UsernameAvailabilityResponse {
  available: boolean;
  canonical?: string;
  reason?: string;
  suggestions?: string[];
  rate_limit_info?: {
    remaining: number;
    reset_time: string;
  };
}

export interface UsernameUpdateResponse {
  success: boolean;
  username: string;
  canonical: string;
  changed_at: string;
  next_change_allowed_at?: string;
}

@ApiTags('Username Management')
@Controller('api/users/username')
@UseGuards(ThrottlerGuard)
export class UsernameApiController {
  private readonly logger = new Logger(UsernameApiController.name);
  private readonly tracer = trace.getTracer('username-controller');

  constructor(
    private readonly usernameService: UsernameService,
    private readonly validationService: UsernameValidationService,
    private readonly reservedService: ReservedUsernamesService,
    @Optional() private readonly metricsService?: MetricsService,
    @Optional() private readonly onboardingMetrics?: OnboardingMetricsService,
    @Optional() private readonly onboardingAudit?: OnboardingAuditService
  ) {}

  @Get('availability/:username')
  @ApiOperation({ 
    summary: 'Check username availability',
    description: 'Check if a username is available for registration. Rate limited to prevent enumeration attacks.'
  })
  @ApiParam({ 
    name: 'username', 
    description: 'Username to check (1-30 characters, alphanumeric + underscore/period only)',
    example: 'john_doe123'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Username availability result',
    schema: {
      type: 'object',
      properties: {
        available: { type: 'boolean' },
        canonical: { type: 'string', description: 'Normalized lowercase username' },
        reason: { type: 'string', enum: ['reserved', 'taken', 'invalid'] },
        suggestions: { type: 'array', items: { type: 'string' } }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Invalid username format' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 requests per minute
  @HttpCode(HttpStatus.OK)
  async checkAvailability(
    @Param('username') username: string,
    @Request() req: any
  ): Promise<UsernameAvailabilityResponse> {
    const start = Date.now();
    const existingCorrelationId = req.headers?.['x-correlation-id'];
    const baseCorrelationId = typeof existingCorrelationId === 'string' && existingCorrelationId.length > 0
      ? existingCorrelationId
      : randomUUID();
    const endpointName = 'username-check';
    const clientIp = req.ip || req.connection?.remoteAddress;
    const userAgent = req.headers?.['user-agent'];
    const tenantId = req.headers?.['x-tenant-id'];
    const requestTracking = this.onboardingMetrics?.startRequest(endpointName, 'GET', baseCorrelationId);
    const correlationId = requestTracking?.correlation_id ?? baseCorrelationId;
    let availabilityResult: boolean | null = null;
    let outcomeTag: 'available' | 'taken' | 'invalid_format' | 'reserved' | 'error' = 'error';
    let suggestionsProvided = false;

    return await this.tracer.startActiveSpan('username.availability.check', async (span) => {
      try {
        span.setAttributes({
          'user.username.length': username?.length || 0,
          'request.correlation_id': correlationId,
          'request.client_ip': clientIp,
          'request.user_agent': userAgent
        });
        if (tenantId) {
          span.setAttribute('tenant.id', tenantId);
        }

        this.onboardingMetrics?.addRequestAttributes(correlationId, {
          'request.client_ip': clientIp ?? 'unknown',
          'request.user_agent': userAgent || 'unknown'
        });

        // Step 1: Format validation (fail fast)
        const formatValidation = this.validationService.validateFormat(username);
        if (!formatValidation.isValid || !formatValidation.canonical) {
          availabilityResult = false;
          outcomeTag = 'invalid_format';
          suggestionsProvided = false;

          span.setAttributes({
            'validation.result': 'invalid_format',
            'validation.errors': formatValidation.errors.join(', ')
          });

          this.metricsService?.incrementUsernameChecks('invalid_format', clientIp);
          this.onboardingMetrics?.recordValidationError('username', 'invalid_format', endpointName, Date.now() - start);
          this.onboardingMetrics?.recordUsernameCheck(false, false, false, tenantId);
          await this.emitUsernameCheckAudit({
            outcome: 'denied',
            correlationId,
            req,
            tenantId,
            usernameLength: username?.length || 0,
            availability: false,
            suggestionsProvided: false
          });

          return {
            available: false,
            reason: 'invalid',
            suggestions: []
          };
        }

        const canonical = formatValidation.canonical;

        // Step 2: Reserved names check (before DB query to reduce enumeration value)
        const reservedCheck = this.reservedService.isReserved(canonical);
        if (reservedCheck.isReserved) {
          availabilityResult = false;
          outcomeTag = 'reserved';
          suggestionsProvided = true;

          span.setAttributes({
            'validation.result': 'reserved',
            'reserved.category': reservedCheck.category || 'unknown'
          });

          this.metricsService?.incrementUsernameChecks('reserved', clientIp);
          this.onboardingMetrics?.recordValidationError('username', 'reserved', endpointName, Date.now() - start);
          this.onboardingMetrics?.recordUsernameCheck(false, false, true, tenantId);
          await this.emitUsernameCheckAudit({
            outcome: 'denied',
            correlationId,
            req,
            tenantId,
            usernameLength: username?.length || 0,
            availability: false,
            suggestionsProvided: true,
            metadata: {
              reserved_category: reservedCheck.category
            }
          });

          return {
            available: false,
            reason: 'reserved',
            suggestions: this.validationService.generateSuggestions(canonical, 3)
          };
        }

        // Step 3: Database uniqueness check
        const isAvailable = await this.usernameService.isUsernameAvailable(canonical);
        availabilityResult = isAvailable;
        outcomeTag = isAvailable ? 'available' : 'taken';
        suggestionsProvided = !isAvailable;

        span.setAttributes({
          'validation.result': isAvailable ? 'available' : 'taken',
          'username.canonical': this.validationService.sanitizeForLogging(canonical)
        });

        this.metricsService?.incrementUsernameChecks(outcomeTag, clientIp);
        this.onboardingMetrics?.recordUsernameCheck(isAvailable, false, !isAvailable, tenantId);
        await this.emitUsernameCheckAudit({
          outcome: 'success',
          correlationId,
          req,
          tenantId,
          usernameLength: username?.length || 0,
          availability: isAvailable,
          suggestionsProvided: !isAvailable,
          metadata: {
            username_canonical: canonical
          }
        });

        const response: UsernameAvailabilityResponse = {
          available: isAvailable,
          canonical
        };

        if (!isAvailable) {
          response.reason = 'taken';
          response.suggestions = this.validationService.generateSuggestions(canonical, 3);
        }

        return response;

      } catch (error) {
        availabilityResult = false;
        outcomeTag = 'error';
        suggestionsProvided = false;

        span.recordException(error as Error);
        span.setStatus({ code: 2, message: 'Availability check failed' });

        this.logger.error('Username availability check failed', {
          error: (error as Error).message,
          correlation_id: correlationId,
          username_length: username?.length
        });

        this.metricsService?.incrementUsernameChecks('error', clientIp);
        this.onboardingMetrics?.recordUsernameCheck(false, false, false, tenantId);
        await this.emitUsernameCheckAudit({
          outcome: 'failure',
          correlationId,
          req,
          tenantId,
          usernameLength: username?.length || 0,
          availability: false,
          suggestionsProvided: false,
          metadata: {
            error: (error as Error).message || 'unknown_error'
          }
        });

        return {
          available: false,
          reason: 'Temporarily unavailable',
          suggestions: []
        };
      } finally {
        const duration = Date.now() - start;

        this.onboardingMetrics?.addRequestAttributes(correlationId, {
          'username.available': availabilityResult === null ? 'unknown' : availabilityResult ? 'true' : 'false',
          'username.outcome': outcomeTag,
          'username.suggestions_provided': suggestionsProvided ? 'true' : 'false',
          'duration.ms': duration
        });
        this.onboardingMetrics?.completeRequest(correlationId, HttpStatus.OK, undefined, {
          endpoint: endpointName,
          operation_type: outcomeTag,
          tenant_id: tenantId,
          error_type: outcomeTag === 'error' ? 'internal' : undefined
        });
        this.metricsService?.recordUsernameCheckLatency('availability', duration);

        span.end();
      }
    });
  }

  @Patch()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update username',
    description: 'Update the current user\'s username with validation and conflict checking'
  })
  @ApiResponse({
    status: 200,
    description: 'Username updated successfully'
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid username format or validation failed'
  })
  @ApiResponse({
    status: 401,
    description: 'Authentication required'
  })
  @ApiResponse({
    status: 409,
    description: 'Username already taken or reserved'
  })
  async updateUsername(
    @Body() updateDto: { username: string },
    @Request() req: any
  ): Promise<{ success: boolean; username?: string; message?: string }> {
    const correlationId = randomUUID();
    const start = Date.now();
    const metricsUserId = this.getMetricsUserId(req);

    return this.tracer.startActiveSpan('username-update', async (span) => {
      try {
        span.setAttributes({
          'username.operation': 'update',
          'correlation.id': correlationId
        });

        const userId = req.user?.id;
        if (!userId) {
          this.metricsService?.incrementUsernameUpdates('attempt', metricsUserId);
          throw new BadRequestException('Authentication required');
        }

        this.metricsService?.incrementUsernameUpdates('attempt', metricsUserId);

        // Validate the new username
        const validation = this.validationService.validateForRegistration(updateDto.username);
        if (!validation.isValid || !validation.canonical) {
          this.metricsService?.incrementUsernameUpdates('invalid_format', metricsUserId);

          await this.emitAuditEvent({
            event: 'users.username.update',
            outcome: 'validation_failed',
            correlation_id: correlationId,
            metadata: {
              user_id: userId,
              validation_errors: validation.errors,
              username_length: updateDto.username?.length
            }
          });

          throw new BadRequestException({
            message: 'Username validation failed',
            errors: validation.errors,
            warnings: validation.warnings
          });
        }

        const canonical = validation.canonical;

        // Check if reserved
        const reservedCheck = this.reservedService.isReserved(canonical);
        if (reservedCheck.isReserved) {
          this.metricsService?.incrementUsernameUpdates('reserved', metricsUserId);

          await this.emitAuditEvent({
            event: 'users.username.update',
            outcome: 'reserved_username',
            correlation_id: correlationId,
            metadata: {
              user_id: userId,
              username_canonical: canonical,
              reserved_category: reservedCheck.category
            }
          });

          throw new ConflictException({
            message: 'Username is reserved',
            reason: 'reserved',
            category: reservedCheck.category
          });
        }

        // Load current user context for rate limiting and audit trails
        const currentUser = await this.usernameService.getUserById(userId);

        const rateLimitCheck = this.validationService.isUsernameChangeAllowed(
          currentUser?.usernameUpdatedAt ?? null,
          currentUser?.usernameChangeCount ?? 0,
          userId
        );
        if (!rateLimitCheck.allowed) {
          this.metricsService?.incrementUsernameUpdates('rate_limited', metricsUserId);

          await this.emitAuditEvent({
            event: 'users.username.update',
            outcome: 'rate_limited',
            correlation_id: correlationId,
            metadata: {
              user_id: userId,
              username_canonical: canonical,
              reason: rateLimitCheck.reason,
              next_allowed_at: rateLimitCheck.nextAllowedAt?.toISOString()
            }
          });

          throw new ConflictException({
            message: rateLimitCheck.reason || 'Username change temporarily disabled',
            reason: 'rate_limited',
            nextAllowedAt: rateLimitCheck.nextAllowedAt
          });
        }

        // Check availability
        const isAvailable = await this.usernameService.isUsernameAvailable(canonical);
        if (!isAvailable) {
          this.metricsService?.incrementUsernameUpdates('taken', metricsUserId);

          await this.emitAuditEvent({
            event: 'users.username.update',
            outcome: 'username_taken',
            correlation_id: correlationId,
            metadata: {
              user_id: userId,
              username_canonical: canonical
            }
          });

          throw new ConflictException({
            message: 'Username is already taken',
            reason: 'taken',
            suggestions: this.validationService.generateSuggestions(canonical, 3)
          });
        }

        // Update the username
        const updateResult = await this.usernameService.updateUsername(userId, updateDto.username, canonical, correlationId);

        this.metricsService?.incrementUsernameUpdates('success', metricsUserId);

        await this.emitAuditEvent({
          event: 'users.username.update',
          outcome: 'success',
          correlation_id: correlationId,
          metadata: {
            user_id: userId,
            username_canonical: canonical
          }
        });

        return {
          success: true,
          username: canonical,
          message: 'Username updated successfully'
        };

      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: 2, message: 'Username update failed' });
        
        if (!(error instanceof BadRequestException) && !(error instanceof ConflictException)) {
          this.metricsService?.incrementUsernameUpdates('error', metricsUserId);
        }

        this.logger.error('Username update failed', {
          error: error.message,
          correlation_id: correlationId,
          user_id: req.user?.id
        });

        throw error;
      } finally {
        const duration = Date.now() - start;
        this.metricsService?.recordUsernameUpdateLatency(duration);
        span.end();
      }
    });
  }

  private getMetricsUserId(req: any): string {
    if (req?.user?.metrics_id) {
      return req.user.metrics_id;
    }

    if (req?.user?.metricsId) {
      return req.user.metricsId;
    }

    if (req?.user?.id) {
      // TODO: replace placeholder with hashed actor identifier once available from auth context
      return '123';
    }

    return 'anonymous';
  }

  /**
   * Emit audit event for username operations
   * PII-safe logging with correlation tracking
   */
  private async emitAuditEvent(event: {
    event: string;
    outcome: string;
    correlation_id: string;
    metadata: any;
  }): Promise<void> {
    try {
      // TODO: Replace with actual audit emitter implementation
      this.logger.log(`Audit event: ${event.event} - ${event.outcome}`, {
        correlationId: event.correlation_id,
        metadata: event.metadata
      });
    } catch (error) {
      // Audit failures should not break the main flow
      this.logger.warn('Failed to emit audit event', { 
        error: error.message,
        event: event.event,
        correlation_id: event.correlation_id
      });
    }
  }

  private async emitUsernameCheckAudit(params: {
    outcome: 'success' | 'failure' | 'denied';
    correlationId: string;
    req: any;
    tenantId?: string;
    usernameLength?: number;
    availability: boolean;
    suggestionsProvided: boolean;
    metadata?: Record<string, any>;
    rateLimitHit?: boolean;
  }): Promise<void> {
    try {
      if (this.onboardingAudit) {
        const auditRequest = {
          headers: params.req?.headers || {},
          method: params.req?.method || 'GET',
          connection: params.req?.connection,
          socket: params.req?.socket,
          ip: params.req?.ip,
          user: params.req?.user
        };

        await this.onboardingAudit.emitUsernameEvent('users.username.check', params.outcome, {
          correlationId: params.correlationId,
          tenantId: params.tenantId,
          request: auditRequest,
          usernameLength: params.usernameLength,
          availabilityResult: params.availability,
          suggestionsProvided: params.suggestionsProvided,
          rateLimitHit: params.rateLimitHit ?? false
        });

        this.onboardingMetrics?.recordAuditEvent(
          'users.username.check',
          params.outcome === 'success' ? 'success' : 'failure',
          params.tenantId
        );
      } else {
        this.logger.log(`Audit event: users.username.check - ${params.outcome}`, {
          correlationId: params.correlationId,
          metadata: {
            tenantId: params.tenantId,
            usernameLength: params.usernameLength,
            availabilityResult: params.availability,
            suggestionsProvided: params.suggestionsProvided,
            ...params.metadata
          }
        });
      }
    } catch (error) {
      this.logger.warn('Failed to emit audit event', {
        error: (error as Error).message,
        event: 'users.username.check',
        correlation_id: params.correlationId
      });
    }
  }
}
