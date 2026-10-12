import { Injectable, Logger } from '@nestjs/common';
import { Counter, Histogram, Gauge, register } from 'prom-client';
import { trace, context, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import { PushPlatform, PushTokenType } from '../dto/push-token.dto';

/**
 * Observability service for push token operations
 * Integrates with existing Prometheus and OpenTelemetry infrastructure
 */
@Injectable()
export class PushTokenObservabilityService {
  private readonly logger = new Logger(PushTokenObservabilityService.name);
  private readonly tracer = trace.getTracer('push-tokens-service');

  // Prometheus metrics
  private readonly tokensRegisteredCounter = new Counter({
    name: 'tokens_registered_total',
    help: 'Total number of push token registrations observed',
    labelNames: ['platform'] as const,
    registers: [register]
  });

  private readonly tokensRefreshedCounter = new Counter({
    name: 'tokens_refreshed_total',
    help: 'Total number of push token refresh operations',
    labelNames: ['platform'] as const,
    registers: [register]
  });

  private readonly tokensUnregisteredCounter = new Counter({
    name: 'tokens_unregistered_total',
    help: 'Total number of explicit push token un-registrations',
    labelNames: ['platform', 'reason'] as const,
    registers: [register]
  });

  private readonly tokensInvalidatedCounter = new Counter({
    name: 'tokens_invalidated_total',
    help: 'Total number of push tokens invalidated automatically',
    labelNames: ['platform', 'reason'] as const,
    registers: [register]
  });

  private readonly deliverySuccessCounter = new Counter({
    name: 'delivery_success_total',
    help: 'Total number of successful push notification deliveries',
    labelNames: ['platform'] as const,
    registers: [register]
  });

  private readonly deliveryFailureCounter = new Counter({
    name: 'delivery_failure_total',
    help: 'Total number of failed push notification deliveries by error code',
    labelNames: ['platform', 'error_code'] as const,
    registers: [register]
  });

  private readonly tokenRegistrationCounter = new Counter({
    name: 'push_token_registrations_total',
    help: 'Total number of push token registrations',
    labelNames: ['platform', 'token_type', 'tenant_id', 'status'] as const,
    registers: [register]
  });

  private readonly tokenOperationDuration = new Histogram({
    name: 'push_token_operation_duration_seconds',
    help: 'Duration of push token operations in seconds',
    labelNames: ['operation', 'platform', 'status'] as const,
    buckets: [0.001, 0.005, 0.015, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 1.0, 2.0, 5.0],
    registers: [register]
  });

  private readonly tokenRegistrationDuration = new Histogram({
    name: 'token_registration_duration_seconds',
    help: 'Latency distribution for token registration calls',
    labelNames: ['platform'] as const,
    buckets: [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2],
    registers: [register]
  });

  private readonly activeTokensGauge = new Gauge({
    name: 'push_tokens_active_total',
    help: 'Current number of active push tokens',
    labelNames: ['platform', 'tenant_id'] as const,
    registers: [register]
  });

  private readonly activeTokensCountGauge = new Gauge({
    name: 'active_tokens_count',
    help: 'Current number of active push tokens by platform',
    labelNames: ['platform'] as const,
    registers: [register]
  });

  private readonly failureRateGauge = new Gauge({
    name: 'failure_rate',
    help: 'Ratio of delivery failures to total attempts per platform',
    labelNames: ['platform'] as const,
    registers: [register]
  });

  private readonly tokenValidationCounter = new Counter({
    name: 'push_token_validations_total',
    help: 'Total number of token validations performed',
    labelNames: ['platform', 'validation_type', 'result'] as const,
    registers: [register]
  });

  private readonly tokenFailureCounter = new Counter({
    name: 'push_token_failures_total',
    help: 'Total number of token operation failures',
    labelNames: ['operation', 'platform', 'error_type'] as const,
    registers: [register]
  });

  private readonly cacheOperationCounter = new Counter({
    name: 'push_token_cache_operations_total',
    help: 'Total number of cache operations',
    labelNames: ['operation', 'result'] as const,
    registers: [register]
  });

  private readonly bulkOperationDuration = new Histogram({
    name: 'push_token_bulk_operation_duration_seconds',
    help: 'Duration of bulk token operations in seconds',
    labelNames: ['operation', 'token_count_bucket'] as const,
    buckets: [0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0],
    registers: [register]
  });

  private readonly deliveryCounter = new Counter({
    name: 'push_notification_deliveries_total',
    help: 'Total number of push notification delivery attempts',
    labelNames: ['platform', 'status'] as const,
    registers: [register]
  });

  private readonly deliveryLatencyHistogram = new Histogram({
    name: 'delivery_latency_seconds',
    help: 'Latency distribution for push notification delivery feedback',
    labelNames: ['platform'] as const,
    buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10],
    registers: [register]
  });

  private readonly platformSuccessCounts = new Map<PushPlatform, number>();
  private readonly platformFailureCounts = new Map<PushPlatform, number>();

  /**
   * Record token registration metrics and create trace span
   */
  async recordTokenRegistration(
    platform: PushPlatform,
    tokenType: PushTokenType,
    tenantId: string,
    isSuccess: boolean,
    duration: number,
    correlationId: string,
    userId?: string,
    isNewToken?: boolean,
    isRefresh?: boolean,
    errorType?: string
  ): Promise<void> {
    const span = this.tracer.startSpan('push_token_registration', {
      kind: SpanKind.SERVER,
      attributes: {
        'push.platform': platform,
        'push.token_type': tokenType,
        'push.tenant_id': tenantId,
        'push.user_id': userId || 'unknown',
        'push.is_new_token': isNewToken || false,
        'push.correlation_id': correlationId,
        'push.operation_success': isSuccess
      }
    });

    try {
      // Prometheus metrics
      this.tokenRegistrationCounter
        .labels(platform, tokenType, tenantId, isSuccess ? 'success' : 'failure')
        .inc();

      this.tokensRegisteredCounter.labels(platform).inc();

      if (isRefresh) {
        this.tokensRefreshedCounter.labels(platform).inc();
      }

      this.tokenOperationDuration
        .labels('registration', platform, isSuccess ? 'success' : 'failure')
        .observe(duration / 1000); // Convert to seconds

      this.tokenRegistrationDuration
        .labels(platform)
        .observe(duration / 1000);

      if (!isSuccess && errorType) {
        this.tokenFailureCounter
          .labels('registration', platform, errorType)
          .inc();

        span.setStatus({ code: SpanStatusCode.ERROR, message: errorType });
        span.setAttribute('error.type', errorType);
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }

      this.logger.debug({
        message: 'Recorded token registration metrics',
        platform,
        tokenType,
        tenantId,
        isSuccess,
        durationMs: duration,
        correlationId,
        isNewToken
      });

    } finally {
      span.end();
    }
  }

  /**
   * Record token validation metrics
   */
  async recordTokenValidation(
    platform: PushPlatform,
    validationType: 'registration' | 'periodic' | 'feedback' | 'delivery',
    result: 'valid' | 'invalid' | 'expired' | 'unregistered' | 'error',
    duration: number,
    correlationId: string,
    batchSize: number = 1
  ): Promise<void> {
    const span = this.tracer.startSpan('push_token_validation', {
      kind: SpanKind.INTERNAL,
      attributes: {
        'push.platform': platform,
        'push.validation_type': validationType,
        'push.validation_result': result,
        'push.batch_size': batchSize,
        'push.correlation_id': correlationId
      }
    });

    try {
      this.tokenValidationCounter
        .labels(platform, validationType, result)
        .inc(batchSize);

      this.tokenOperationDuration
        .labels('validation', platform, result === 'valid' ? 'success' : 'failure')
        .observe(duration / 1000);

      if (result === 'error') {
        this.tokenFailureCounter
          .labels('validation', platform, 'validation_error')
          .inc();

        span.setStatus({ code: SpanStatusCode.ERROR, message: 'Token validation failed' });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }

      this.logger.debug({
        message: 'Recorded token validation metrics',
        platform,
        validationType,
        result,
        batchSize,
        durationMs: duration,
        correlationId
      });

    } finally {
      span.end();
    }
  }

  /**
   * Record bulk operation metrics
   */
  async recordBulkOperation(
    operation: 'validate' | 'activate' | 'deactivate' | 'delete',
    tokenCount: number,
    successCount: number,
    failureCount: number,
    duration: number,
    correlationId: string
  ): Promise<void> {
    const span = this.tracer.startSpan('push_token_bulk_operation', {
      kind: SpanKind.SERVER,
      attributes: {
        'push.bulk_operation': operation,
        'push.token_count': tokenCount,
        'push.success_count': successCount,
        'push.failure_count': failureCount,
        'push.correlation_id': correlationId
      }
    });

    try {
      // Categorize token count into buckets for metrics
      const tokenCountBucket = this.getTokenCountBucket(tokenCount);

      this.bulkOperationDuration
        .labels(operation, tokenCountBucket)
        .observe(duration / 1000);

      if (failureCount > 0) {
        this.tokenFailureCounter
          .labels('bulk_operation', 'multi_platform', `${operation}_partial_failure`)
          .inc(failureCount);
      }

      span.setStatus({ 
        code: failureCount === 0 ? SpanStatusCode.OK : SpanStatusCode.ERROR,
        message: failureCount > 0 ? `${failureCount} failures in bulk operation` : undefined
      });

      this.logger.debug({
        message: 'Recorded bulk operation metrics',
        operation,
        tokenCount,
        successCount,
        failureCount,
        durationMs: duration,
        correlationId
      });

    } finally {
      span.end();
    }
  }

  /**
   * Update active token count gauge
   */
  async updateActiveTokenCount(
    platform: PushPlatform,
    tenantId: string,
    count: number
  ): Promise<void> {
    this.activeTokensGauge
      .labels(platform, tenantId)
      .set(count);

    this.activeTokensCountGauge
      .labels(platform)
      .set(count);

    this.logger.debug({
      message: 'Updated active token count',
      platform,
      tenantId,
      count
    });
  }

  recordTokenUnregistered(platform: PushPlatform, reason: string): void {
    this.tokensUnregisteredCounter.labels(platform, reason).inc();
  }

  recordTokenInvalidated(platform: PushPlatform, reason: string): void {
    this.tokensInvalidatedCounter.labels(platform, reason).inc();
  }

  recordDeliverySuccess(
    platform: PushPlatform,
    latencyMs: number,
    correlationId: string,
    notificationType?: string
  ): void {
    this.deliverySuccessCounter.labels(platform).inc();
    this.deliveryLatencyHistogram.labels(platform).observe(latencyMs / 1000);
    this.incrementSuccess(platform);

    this.logger.debug({
      message: 'Recorded delivery success',
      platform,
      latencyMs,
      notificationType,
      correlationId
    });
  }

  recordDeliveryFailure(
    platform: PushPlatform,
    errorCode: string,
    attemptNumber: number,
    correlationId: string,
    latencyMs?: number
  ): void {
    this.deliveryFailureCounter.labels(platform, errorCode).inc();
    if (latencyMs !== undefined) {
      this.deliveryLatencyHistogram.labels(platform).observe(latencyMs / 1000);
    }
    this.incrementFailure(platform);

    this.logger.debug({
      message: 'Recorded delivery failure',
      platform,
      errorCode,
      attemptNumber,
      latencyMs,
      correlationId
    });
  }

  /**
   * Record cache operation metrics
   */
  recordCacheOperation(
    operation: 'hit' | 'miss' | 'set' | 'invalidate' | 'error',
    cacheType: 'user_tokens' | 'token_details' | 'active_tokens' | 'validation'
  ): void {
    this.cacheOperationCounter
      .labels(`${cacheType}_${operation}`, operation === 'error' ? 'failure' : 'success')
      .inc();

    this.logger.debug({
      message: 'Recorded cache operation',
      operation,
      cacheType
    });
  }

  /**
   * Record notification delivery metrics
   */
  recordNotificationDelivery(
    platform: PushPlatform,
    status: 'sent' | 'queued' | 'delivered' | 'failed' | 'expired' | 'unregistered' | 'invalid' | 'throttled',
    correlationId: string,
    notificationId?: string,
    options?: {
      skipOutcomeMetrics?: boolean;
      errorCode?: string;
      latencyMs?: number;
      attemptNumber?: number;
    }
  ): void {
    const span = this.tracer.startSpan('push_notification_delivery', {
      kind: SpanKind.CLIENT,
      attributes: {
        'push.platform': platform,
        'push.delivery_status': status,
        'push.notification_id': notificationId || 'unknown',
        'push.correlation_id': correlationId
      }
    });

    try {
      this.deliveryCounter
        .labels(platform, status)
        .inc();

      if (!options?.skipOutcomeMetrics) {
        if (status === 'delivered') {
          this.recordDeliverySuccess(platform, options?.latencyMs ?? 0, correlationId);
        } else if (['failed', 'expired', 'unregistered', 'invalid', 'throttled'].includes(status)) {
          this.recordDeliveryFailure(
            platform,
            options?.errorCode ?? status,
            options?.attemptNumber ?? 0,
            correlationId,
            options?.latencyMs
          );
        }
      }

      span.setStatus({
        code: status === 'delivered' ? SpanStatusCode.OK : SpanStatusCode.ERROR,
        message: status !== 'delivered' ? `Delivery ${status}` : undefined
      });

      this.logger.debug({
        message: 'Recorded notification delivery',
        platform,
        status,
        notificationId,
        correlationId,
        errorCode: options?.errorCode,
        latencyMs: options?.latencyMs,
        attemptNumber: options?.attemptNumber
      });

    } finally {
      span.end();
    }
  }

  /**
   * Create a custom span for token operations
   */
  async withTokenOperationSpan<T>(
    operationName: string,
    operation: () => Promise<T>,
    attributes?: Record<string, string | number | boolean>
  ): Promise<T> {
    const span = this.tracer.startSpan(`push_token_${operationName}`, {
      kind: SpanKind.INTERNAL,
      attributes: {
        'push.operation': operationName,
        ...attributes
      }
    });

    return context.with(trace.setSpan(context.active(), span), async () => {
      try {
        const result = await operation();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setStatus({ 
          code: SpanStatusCode.ERROR, 
          message: error.message 
        });
        span.setAttribute('error.message', error.message);
        span.setAttribute('error.stack', error.stack || '');
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Log structured error for correlation and analysis
   */
  logError(
    operation: string,
    error: Error,
    correlationId: string,
    context?: Record<string, any>
  ): void {
    this.logger.error({
      message: `Push token ${operation} failed`,
      operation,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.constructor.name
      },
      correlationId,
      context: context || {},
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Get health metrics for monitoring dashboard
   */
  async getHealthMetrics(): Promise<{
    activeTokensByPlatform: Record<PushPlatform, number>;
    operationRates: Record<string, number>;
    errorRates: Record<string, number>;
    cacheHitRates: Record<string, number>;
  }> {
    try {
      // In a real implementation, these would query actual metrics
      // For now, we'll return sample data structure
      return {
        activeTokensByPlatform: {
          [PushPlatform.IOS]: 1250,
          [PushPlatform.ANDROID]: 2100
        },
        operationRates: {
          registration: 150,
          validation: 75,
          deletion: 25
        },
        errorRates: {
          registration: 0.02,
          validation: 0.05,
          bulk_operations: 0.01
        },
        cacheHitRates: {
          user_tokens: 0.85,
          token_details: 0.92,
          active_tokens: 0.78
        }
      };
    } catch (error) {
      this.logger.error({
        message: 'Failed to get health metrics',
        error: error.message
      });
      
      return {
        activeTokensByPlatform: {},
        operationRates: {},
        errorRates: {},
        cacheHitRates: {}
      } as any;
    }
  }

  /**
   * Private helper methods
   */

  private getTokenCountBucket(count: number): string {
    if (count <= 10) return 'small';
    if (count <= 100) return 'medium';
    if (count <= 1000) return 'large';
    return 'xlarge';
  }

  /**
   * Reset metrics (for testing or maintenance)
   */
  async resetMetrics(): Promise<void> {
    try {
      register.resetMetrics();
      this.logger.log('Push token metrics reset');
    } catch (error) {
      this.logger.error({
        message: 'Failed to reset metrics',
        error: error.message
      });
    }
  }

  private incrementSuccess(platform: PushPlatform): void {
    const current = this.platformSuccessCounts.get(platform) ?? 0;
    this.platformSuccessCounts.set(platform, current + 1);
    this.updateFailureRate(platform);
  }

  private incrementFailure(platform: PushPlatform): void {
    const current = this.platformFailureCounts.get(platform) ?? 0;
    this.platformFailureCounts.set(platform, current + 1);
    this.updateFailureRate(platform);
  }

  private updateFailureRate(platform: PushPlatform): void {
    const successes = this.platformSuccessCounts.get(platform) ?? 0;
    const failures = this.platformFailureCounts.get(platform) ?? 0;
    const total = successes + failures;
    const rate = total === 0 ? 0 : failures / total;

    this.failureRateGauge.labels(platform).set(rate);
  }
}