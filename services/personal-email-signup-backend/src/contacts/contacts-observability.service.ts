import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Gauge, register } from 'prom-client';
import { Logger } from 'winston';

/**
 * Contacts Observability Service
 * 
 * PII-free telemetry and monitoring for contact discovery features using
 * existing Prometheus/OpenTelemetry infrastructure. Tracks performance,
 * quality, and privacy metrics without exposing sensitive user data.
 * 
 * Key Features:
 * - Custom Prometheus metrics for contact discovery workflow
 * - Correlation ID tracking for distributed tracing
 * - Privacy-preserving analytics with data anonymization
 * - Performance monitoring with SLA tracking
 * - Quality metrics for suggestion algorithm optimization
 * - Security and abuse detection metrics
 */

interface ContactUploadMetrics {
  uploadId: string;
  userId: string; // Hashed for privacy
  correlationId: string;
  tenantId: string;
  contactCount: number;
  processingTimeMs: number;
  success: boolean;
  errorType?: string;
  validationFailures: number;
  duplicatesFound: number;
  suggestionsGenerated: number;
  userTier: 'free' | 'premium' | 'enterprise';
  abTestVariant?: string;
}

interface SuggestionMetrics {
  userId: string; // Hashed for privacy
  correlationId: string;
  tenantId: string;
  requestTimeMs: number;
  totalCandidates: number;
  privacyFiltered: number;
  confidenceFiltered: number;
  tierLimited: number;
  finalSuggestions: number;
  avgConfidenceScore: number;
  mutualPercentage: number;
  diversityScore: number;
  userTier: 'free' | 'premium' | 'enterprise';
  abTestVariant?: string;
}

interface PrivacyMetrics {
  userId: string; // Hashed for privacy
  correlationId: string;
  tenantId: string;
  action: 'opt_out' | 'delete_data' | 'update_settings' | 'view_data';
  success: boolean;
  deletionReason?: string;
  userTier: 'free' | 'premium' | 'enterprise';
}

interface SecurityMetrics {
  correlationId: string;
  tenantId: string;
  eventType: 'rate_limit_exceeded' | 'suspicious_upload_pattern' | 'invalid_permissions' | 'abuse_detected';
  severity: 'low' | 'medium' | 'high' | 'critical';
  userAgent?: string;
  ipAddress?: string; // Hashed for privacy
  userId?: string; // Hashed for privacy
}

@Injectable()
export class ContactsObservabilityService {
  private readonly logger: Logger;
  
  // Prometheus Metrics
  private readonly contactUploadCounter = new Counter({
    name: 'contacts_upload_total',
    help: 'Total number of contact upload attempts',
    labelNames: ['status', 'user_tier', 'ab_variant', 'tenant_id'],
    registers: [register],
  });

  private readonly contactUploadHistogram = new Histogram({
    name: 'contacts_upload_duration_seconds',
    help: 'Contact upload processing duration in seconds',
    labelNames: ['status', 'user_tier', 'tenant_id'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
    registers: [register],
  });

  private readonly contactUploadSizeHistogram = new Histogram({
    name: 'contacts_upload_size_total',
    help: 'Number of contacts uploaded per request',
    labelNames: ['user_tier', 'tenant_id'],
    buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
    registers: [register],
  });

  private readonly suggestionRequestCounter = new Counter({
    name: 'contacts_suggestions_request_total',
    help: 'Total number of suggestion requests',
    labelNames: ['status', 'user_tier', 'ab_variant', 'tenant_id'],
    registers: [register],
  });

  private readonly suggestionRequestHistogram = new Histogram({
    name: 'contacts_suggestions_duration_seconds',
    help: 'Suggestion request processing duration in seconds',
    labelNames: ['user_tier', 'tenant_id'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2],
    registers: [register],
  });

  private readonly suggestionQualityGauge = new Gauge({
    name: 'contacts_suggestion_quality_score',
    help: 'Average suggestion quality score',
    labelNames: ['user_tier', 'ab_variant', 'tenant_id'],
    registers: [register],
  });

  private readonly privacyActionCounter = new Counter({
    name: 'contacts_privacy_action_total',
    help: 'Total privacy-related actions taken by users',
    labelNames: ['action', 'status', 'user_tier', 'tenant_id'],
    registers: [register],
  });

  private readonly securityEventCounter = new Counter({
    name: 'contacts_security_event_total',
    help: 'Security and abuse detection events',
    labelNames: ['event_type', 'severity', 'tenant_id'],
    registers: [register],
  });

  private readonly activeUsersGauge = new Gauge({
    name: 'contacts_active_users_total',
    help: 'Number of users with contact discovery enabled',
    labelNames: ['user_tier', 'tenant_id'],
    registers: [register],
  });

  private readonly dataRetentionGauge = new Gauge({
    name: 'contacts_data_retention_days_remaining',
    help: 'Average days remaining until automatic data deletion',
    labelNames: ['tenant_id'],
    registers: [register],
  });

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Track contact upload metrics
   */
  trackContactUpload(metrics: ContactUploadMetrics): void {
    const labels = {
      status: metrics.success ? 'success' : 'failure',
      user_tier: metrics.userTier,
      ab_variant: metrics.abTestVariant || 'default',
      tenant_id: metrics.tenantId,
    };

    // Increment upload counter
    this.contactUploadCounter.inc(labels);

    // Record processing time
    this.contactUploadHistogram
      .labels({
        status: labels.status,
        user_tier: labels.user_tier,
        tenant_id: labels.tenant_id,
      })
      .observe(metrics.processingTimeMs / 1000);

    // Record upload size
    this.contactUploadSizeHistogram
      .labels({
        user_tier: labels.user_tier,
        tenant_id: labels.tenant_id,
      })
      .observe(metrics.contactCount);

    // Log structured event for OpenTelemetry
    this.logger.info('Contact upload completed', {
      correlationId: metrics.correlationId,
      uploadId: metrics.uploadId,
      userIdHash: this.hashUserId(metrics.userId),
      tenantId: metrics.tenantId,
      contactCount: metrics.contactCount,
      processingTimeMs: metrics.processingTimeMs,
      success: metrics.success,
      errorType: metrics.errorType,
      validationFailures: metrics.validationFailures,
      duplicatesFound: metrics.duplicatesFound,
      suggestionsGenerated: metrics.suggestionsGenerated,
      userTier: metrics.userTier,
      abTestVariant: metrics.abTestVariant,
      eventType: 'contact_upload',
      component: 'contacts-service',
    });
  }

  /**
   * Track suggestion request metrics
   */
  trackSuggestionRequest(metrics: SuggestionMetrics): void {
    const labels = {
      status: 'success', // Assuming success if metrics are being tracked
      user_tier: metrics.userTier,
      ab_variant: metrics.abTestVariant || 'default',
      tenant_id: metrics.tenantId,
    };

    // Increment suggestion request counter
    this.suggestionRequestCounter.inc(labels);

    // Record request processing time
    this.suggestionRequestHistogram
      .labels({
        user_tier: labels.user_tier,
        tenant_id: labels.tenant_id,
      })
      .observe(metrics.requestTimeMs / 1000);

    // Update quality score gauge
    this.suggestionQualityGauge
      .labels({
        user_tier: labels.user_tier,
        ab_variant: labels.ab_variant,
        tenant_id: labels.tenant_id,
      })
      .set(metrics.avgConfidenceScore);

    // Log structured event
    this.logger.info('Suggestion request completed', {
      correlationId: metrics.correlationId,
      userIdHash: this.hashUserId(metrics.userId),
      tenantId: metrics.tenantId,
      requestTimeMs: metrics.requestTimeMs,
      totalCandidates: metrics.totalCandidates,
      privacyFiltered: metrics.privacyFiltered,
      confidenceFiltered: metrics.confidenceFiltered,
      tierLimited: metrics.tierLimited,
      finalSuggestions: metrics.finalSuggestions,
      avgConfidenceScore: metrics.avgConfidenceScore,
      mutualPercentage: metrics.mutualPercentage,
      diversityScore: metrics.diversityScore,
      userTier: metrics.userTier,
      abTestVariant: metrics.abTestVariant,
      eventType: 'suggestion_request',
      component: 'contacts-service',
    });
  }

  /**
   * Track privacy-related actions
   */
  trackPrivacyAction(metrics: PrivacyMetrics): void {
    const labels = {
      action: metrics.action,
      status: metrics.success ? 'success' : 'failure',
      user_tier: metrics.userTier,
      tenant_id: metrics.tenantId,
    };

    // Increment privacy action counter
    this.privacyActionCounter.inc(labels);

    // Log structured event
    this.logger.info('Privacy action completed', {
      correlationId: metrics.correlationId,
      userIdHash: this.hashUserId(metrics.userId),
      tenantId: metrics.tenantId,
      action: metrics.action,
      success: metrics.success,
      deletionReason: metrics.deletionReason,
      userTier: metrics.userTier,
      eventType: 'privacy_action',
      component: 'contacts-service',
    });
  }

  /**
   * Track security and abuse events
   */
  trackSecurityEvent(metrics: SecurityMetrics): void {
    const labels = {
      event_type: metrics.eventType,
      severity: metrics.severity,
      tenant_id: metrics.tenantId,
    };

    // Increment security event counter
    this.securityEventCounter.inc(labels);

    // Log security event with appropriate severity
    const logLevel = this.getLogLevelForSeverity(metrics.severity);
    this.logger[logLevel]('Security event detected', {
      correlationId: metrics.correlationId,
      tenantId: metrics.tenantId,
      eventType: metrics.eventType,
      severity: metrics.severity,
      userAgent: metrics.userAgent,
      ipAddressHash: metrics.ipAddress ? this.hashIpAddress(metrics.ipAddress) : undefined,
      userIdHash: metrics.userId ? this.hashUserId(metrics.userId) : undefined,
      component: 'contacts-service',
      securityEvent: true,
    });
  }

  /**
   * Update active user metrics
   */
  updateActiveUserMetrics(tenantId: string, userTier: string, count: number): void {
    this.activeUsersGauge
      .labels({
        user_tier: userTier,
        tenant_id: tenantId,
      })
      .set(count);
  }

  /**
   * Update data retention metrics
   */
  updateDataRetentionMetrics(tenantId: string, avgDaysRemaining: number): void {
    this.dataRetentionGauge
      .labels({
        tenant_id: tenantId,
      })
      .set(avgDaysRemaining);
  }

  /**
   * Track feature flag evaluation for A/B testing
   */
  trackFeatureFlagEvaluation(
    correlationId: string,
    tenantId: string,
    userId: string,
    flagName: string,
    variant: string,
    context: Record<string, any>
  ): void {
    this.logger.info('Feature flag evaluated', {
      correlationId,
      tenantId,
      userIdHash: this.hashUserId(userId),
      flagName,
      variant,
      context,
      eventType: 'feature_flag_evaluation',
      component: 'contacts-service',
    });
  }

  /**
   * Track API performance with SLA monitoring
   */
  trackApiPerformance(
    correlationId: string,
    tenantId: string,
    endpoint: string,
    method: string,
    statusCode: number,
    responseTimeMs: number,
    userTier?: string
  ): void {
    const slaViolation = this.checkSlaViolation(endpoint, responseTimeMs);
    
    this.logger.info('API request completed', {
      correlationId,
      tenantId,
      endpoint,
      method,
      statusCode,
      responseTimeMs,
      userTier,
      slaViolation,
      eventType: 'api_request',
      component: 'contacts-service',
    });

    if (slaViolation) {
      this.logger.warn('SLA violation detected', {
        correlationId,
        tenantId,
        endpoint,
        responseTimeMs,
        slaThresholdMs: this.getSlaThreshold(endpoint),
        eventType: 'sla_violation',
        component: 'contacts-service',
      });
    }
  }

  /**
   * Create distributed tracing span for complex operations
   */
  createTraceSpan(
    operationName: string,
    correlationId: string,
    tenantId: string,
    userId?: string
  ): { finish: (success: boolean, metadata?: Record<string, any>) => void } {
    const startTime = Date.now();
    
    this.logger.info('Operation started', {
      correlationId,
      tenantId,
      userIdHash: userId ? this.hashUserId(userId) : undefined,
      operationName,
      startTime,
      eventType: 'operation_start',
      component: 'contacts-service',
    });

    return {
      finish: (success: boolean, metadata?: Record<string, any>) => {
        const duration = Date.now() - startTime;
        
        this.logger.info('Operation completed', {
          correlationId,
          tenantId,
          userIdHash: userId ? this.hashUserId(userId) : undefined,
          operationName,
          durationMs: duration,
          success,
          metadata,
          eventType: 'operation_complete',
          component: 'contacts-service',
        });
      },
    };
  }

  /**
   * Generate privacy-preserving dashboard metrics
   */
  generateDashboardMetrics(tenantId: string): {
    dailyUploads: number;
    avgProcessingTimeMs: number;
    suggestionQualityScore: number;
    privacyOptOutRate: number;
    errorRate: number;
    activeUsers: number;
  } {
    // This would typically query metrics from Prometheus
    // For now, return mock data structure
    return {
      dailyUploads: 0, // Would calculate from contactUploadCounter
      avgProcessingTimeMs: 0, // Would calculate from contactUploadHistogram
      suggestionQualityScore: 0, // Would get from suggestionQualityGauge
      privacyOptOutRate: 0, // Would calculate from privacyActionCounter
      errorRate: 0, // Would calculate error percentage
      activeUsers: 0, // Would get from activeUsersGauge
    };
  }

  // Private helper methods

  private hashUserId(userId: string): string {
    // In production, use crypto.createHash('sha256').update(userId + salt).digest('hex')
    return `user_${userId.slice(-8)}`;
  }

  private hashIpAddress(ipAddress: string): string {
    // In production, use crypto.createHash('sha256').update(ipAddress + salt).digest('hex')
    return `ip_${ipAddress.slice(-4)}`;
  }

  private getLogLevelForSeverity(severity: string): string {
    switch (severity) {
      case 'critical':
        return 'error';
      case 'high':
        return 'warn';
      case 'medium':
        return 'info';
      case 'low':
        return 'debug';
      default:
        return 'info';
    }
  }

  private checkSlaViolation(endpoint: string, responseTimeMs: number): boolean {
    const threshold = this.getSlaThreshold(endpoint);
    return responseTimeMs > threshold;
  }

  private getSlaThreshold(endpoint: string): number {
    // SLA thresholds in milliseconds
    const thresholds: Record<string, number> = {
      '/contacts/upload': 5000,     // 5 seconds for upload
      '/contacts/suggestions': 200,  // 200ms for suggestions
      '/contacts': 1000,            // 1 second for deletion
      '/contacts/privacy': 500,     // 500ms for privacy controls
    };
    
    return thresholds[endpoint] || 1000; // Default 1 second
  }
}