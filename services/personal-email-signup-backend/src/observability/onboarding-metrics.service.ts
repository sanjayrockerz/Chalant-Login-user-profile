// filepath: src/observability/onboarding-metrics.service.ts
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { trace, Span } from "@opentelemetry/api";
import { randomUUID } from "crypto";

// Simplified metrics interfaces that match common patterns
export interface MetricLabels {
  endpoint?: string;
  method?: string;
  status_code?: string;
  error_type?: string;
  rate_limit_dimension?: string;
  validation_field?: string;
  audit_event_type?: string;
  tenant_id?: string;
  user_authenticated?: string;
  operation_type?: string;
}

export interface RequestMetrics {
  start_time: number;
  endpoint: string;
  method: string;
  span: Span;
  correlation_id: string;
  labels: MetricLabels;
}

export interface MetricsSummary {
  requests_total: number;
  requests_duration_avg: number;
  rate_limit_violations: number;
  validation_errors: number;
  audit_events: number;
  active_requests: number;
  error_rate: number;
}

@Injectable()
export class OnboardingMetricsService {
  private readonly logger = new Logger(OnboardingMetricsService.name);
  private readonly tracer = trace.getTracer("onboarding-metrics");

  // In-memory metrics storage (in production, use proper metrics backend)
  private readonly metrics = {
    requests_total: new Map<string, number>(),
    requests_duration: new Map<string, number[]>(),
    rate_limit_violations: new Map<string, number>(),
    validation_errors: new Map<string, number>(),
    audit_events: new Map<string, number>(),
    errors: new Map<string, number>(),
    username_checks: new Map<string, number>(),
    username_updates: new Map<string, number>(),
    registrations: new Map<string, number>(),
    legal_acceptances: new Map<string, number>(),
  };

  // Active request tracking
  private readonly activeRequests = new Map<string, RequestMetrics>();

  constructor(private readonly configService: ConfigService) {
    // Start periodic metrics logging
    setInterval(() => this.logMetricsSummary(), 60000); // Every minute

    // Start periodic cleanup of stale requests
    setInterval(() => this.cleanupStaleRequests(), 60000);
  }

  /**
   * Start request tracking with OpenTelemetry span
   */
  startRequest(
    endpoint: string,
    method: string,
    correlationId?: string,
  ): RequestMetrics {
    const requestId = correlationId || randomUUID();
    const span = this.tracer.startSpan(`onboarding.${endpoint}`, {
      attributes: {
        "http.method": method,
        "http.route": endpoint,
        "correlation.id": requestId,
        "service.name": "onboarding-service",
      },
    });

    const request: RequestMetrics = {
      start_time: Date.now(),
      endpoint,
      method,
      span,
      correlation_id: requestId,
      labels: { endpoint, method },
    };

    this.activeRequests.set(requestId, request);

    return request;
  }

  /**
   * Complete request tracking with metrics emission
   */
  completeRequest(
    requestId: string,
    statusCode: number,
    responseSize?: number,
    additionalLabels?: MetricLabels,
  ): void {
    const request = this.activeRequests.get(requestId);
    if (!request) {
      this.logger.warn("Attempted to complete unknown request", {
        request_id: requestId,
      });
      return;
    }

    const duration = Date.now() - request.start_time;
    const labels: MetricLabels = {
      ...request.labels,
      status_code: statusCode.toString(),
      ...additionalLabels,
    };

    // Increment request counter
    this.incrementCounter("requests_total", labels);

    // Record duration
    this.recordDuration("requests_duration", labels, duration);

    // Complete OpenTelemetry span
    request.span.setAttributes({
      "http.status_code": statusCode,
      "http.response_size": responseSize || 0,
      "duration.ms": duration,
    });

    if (statusCode >= 400) {
      request.span.setStatus({ code: 2, message: `HTTP ${statusCode}` });
      this.incrementCounter("errors", {
        ...labels,
        error_type: `http_${statusCode}`,
      });
    }

    request.span.end();

    // Clean up
    this.activeRequests.delete(requestId);
  }

  /**
   * Record rate limit violation
   */
  recordRateLimitViolation(
    dimension: "ip" | "user" | "device",
    endpoint: string,
    tenantId?: string,
  ): void {
    const labels: MetricLabels = {
      endpoint,
      rate_limit_dimension: dimension,
      tenant_id: tenantId,
    };

    this.incrementCounter("rate_limit_violations", labels);

    this.logger.warn("Rate limit violation recorded", {
      dimension,
      endpoint,
      tenant_id: tenantId,
    });
  }

  /**
   * Record validation error
   */
  recordValidationError(
    field: string,
    errorType: string,
    endpoint: string,
    duration?: number,
  ): void {
    const labels: MetricLabels = {
      endpoint,
      validation_field: field,
      error_type: errorType,
    };

    this.incrementCounter("validation_errors", labels);

    if (duration) {
      this.recordDuration("validation_duration", labels, duration);
    }
  }

  /**
   * Record audit event emission
   */
  recordAuditEvent(
    eventType: string,
    outcome: "success" | "failure",
    tenantId?: string,
  ): void {
    const labels: MetricLabels = {
      audit_event_type: eventType,
      tenant_id: tenantId,
    };

    if (outcome === "success") {
      this.incrementCounter("audit_events", labels);
    } else {
      this.incrementCounter("audit_errors", labels);
    }
  }

  /**
   * Record username availability check
   */
  recordUsernameCheck(
    available: boolean,
    rateLimited: boolean,
    suggestionsProvided: boolean,
    tenantId?: string,
  ): void {
    const labels: MetricLabels = {
      endpoint: "username-check",
      tenant_id: tenantId,
      operation_type: available ? "available" : "unavailable",
    };

    this.incrementCounter("username_checks", labels);

    if (rateLimited) {
      this.recordRateLimitViolation("user", "username-check", tenantId);
    }
  }

  /**
   * Record username update attempt
   */
  recordUsernameUpdate(
    success: boolean,
    operationType: "create" | "update",
    tenantId?: string,
  ): void {
    const labels: MetricLabels = {
      endpoint: "username-update",
      operation_type: operationType,
      tenant_id: tenantId,
    };

    this.incrementCounter("username_updates", labels);

    if (!success) {
      this.incrementCounter("errors", {
        ...labels,
        error_type: "username_update_failed",
      });
    }
  }

  /**
   * Record user registration attempt
   */
  recordRegistration(
    success: boolean,
    method: string,
    tenantId?: string,
  ): void {
    const labels: MetricLabels = {
      endpoint: "registration",
      operation_type: method,
      tenant_id: tenantId,
    };

    this.incrementCounter("registrations", labels);

    if (!success) {
      this.incrementCounter("errors", {
        ...labels,
        error_type: "registration_failed",
      });
    }
  }

  /**
   * Record legal policy acceptance
   */
  recordLegalAcceptance(
    policyType: string,
    success: boolean,
    tenantId?: string,
  ): void {
    const labels: MetricLabels = {
      endpoint: "legal-acceptance",
      operation_type: policyType,
      tenant_id: tenantId,
    };

    this.incrementCounter("legal_acceptances", labels);

    if (!success) {
      this.incrementCounter("errors", {
        ...labels,
        error_type: "legal_acceptance_failed",
      });
    }
  }

  /**
   * Get current request by correlation ID
   */
  getRequest(correlationId: string): RequestMetrics | undefined {
    return this.activeRequests.get(correlationId);
  }

  /**
   * Add attributes to existing request span
   */
  addRequestAttributes(
    correlationId: string,
    attributes: Record<string, string | number | boolean>,
  ): void {
    const request = this.activeRequests.get(correlationId);
    if (request) {
      request.span.setAttributes(attributes);
    }
  }

  /**
   * Create child span for operation within request
   */
  startOperation(
    correlationId: string,
    operationName: string,
    attributes?: Record<string, string | number | boolean>,
  ): Span {
    const span = this.tracer.startSpan(operationName, {
      attributes: {
        "correlation.id": correlationId,
        ...attributes,
      },
    });

    return span;
  }

  /**
   * Get metrics summary for health checks and monitoring
   */
  getMetricsSummary(): MetricsSummary {
    const totalRequests = this.sumCounters("requests_total");
    const totalErrors = this.sumCounters("errors");
    const avgDuration = this.calculateAverageDuration("requests_duration");

    return {
      requests_total: totalRequests,
      requests_duration_avg: avgDuration,
      rate_limit_violations: this.sumCounters("rate_limit_violations"),
      validation_errors: this.sumCounters("validation_errors"),
      audit_events: this.sumCounters("audit_events"),
      active_requests: this.activeRequests.size,
      error_rate: totalRequests > 0 ? totalErrors / totalRequests : 0,
    };
  }

  /**
   * Export metrics in Prometheus format
   */
  exportPrometheusMetrics(): string {
    const lines: string[] = [];
    const timestamp = Date.now();

    // Helper to format metric name
    const formatMetric = (
      name: string,
      labels: MetricLabels,
      value: number,
    ) => {
      const labelStr = Object.entries(labels)
        .filter(([_, v]) => v !== undefined)
        .map(([k, v]) => `${k}="${v}"`)
        .join(",");

      return `onboarding_${name}{${labelStr}} ${value} ${timestamp}`;
    };

    // Export counters
    for (const [metricName, counters] of Object.entries(this.metrics)) {
      if (metricName.includes("duration")) continue; // Skip duration maps

      lines.push(
        `# HELP onboarding_${metricName} Onboarding service ${metricName.replace("_", " ")}`,
      );
      lines.push(`# TYPE onboarding_${metricName} counter`);

      for (const [labelsKey, value] of (
        counters as Map<string, number>
      ).entries()) {
        try {
          const labels = JSON.parse(labelsKey);
          lines.push(formatMetric(metricName, labels, value));
        } catch {
          lines.push(formatMetric(metricName, {}, value));
        }
      }
    }

    // Export gauge for active requests
    lines.push(
      "# HELP onboarding_active_requests Number of currently active requests",
    );
    lines.push("# TYPE onboarding_active_requests gauge");
    lines.push(
      `onboarding_active_requests ${this.activeRequests.size} ${timestamp}`,
    );

    return lines.join("\n");
  }

  private incrementCounter(metric: string, labels: MetricLabels): void {
    const counters = this.metrics[metric as keyof typeof this.metrics] as Map<
      string,
      number
    >;
    if (!counters) return;

    const key = JSON.stringify(labels);
    const current = counters.get(key) || 0;
    counters.set(key, current + 1);
  }

  private recordDuration(
    metric: string,
    labels: MetricLabels,
    duration: number,
  ): void {
    const durations = this.metrics[metric as keyof typeof this.metrics] as Map<
      string,
      number[]
    >;
    if (!durations) return;

    const key = JSON.stringify(labels);
    const current = durations.get(key) || [];
    current.push(duration);

    // Keep only last 1000 measurements to prevent memory growth
    if (current.length > 1000) {
      current.splice(0, current.length - 1000);
    }

    durations.set(key, current);
  }

  private sumCounters(metric: string): number {
    const counters = this.metrics[metric as keyof typeof this.metrics] as Map<
      string,
      number
    >;
    if (!counters) return 0;

    let total = 0;
    for (const value of counters.values()) {
      total += value;
    }
    return total;
  }

  private calculateAverageDuration(metric: string): number {
    const durations = this.metrics[metric as keyof typeof this.metrics] as Map<
      string,
      number[]
    >;
    if (!durations) return 0;

    let totalDuration = 0;
    let totalCount = 0;

    for (const durationArray of durations.values()) {
      for (const duration of durationArray) {
        totalDuration += duration;
        totalCount++;
      }
    }

    return totalCount > 0 ? totalDuration / totalCount : 0;
  }

  private logMetricsSummary(): void {
    const summary = this.getMetricsSummary();

    this.logger.log("Metrics summary", {
      metrics: summary,
      timestamp: new Date().toISOString(),
    });
  }

  private cleanupStaleRequests(): void {
    const now = Date.now();
    const staleThreshold = 5 * 60 * 1000; // 5 minutes

    for (const [id, request] of this.activeRequests.entries()) {
      if (now - request.start_time > staleThreshold) {
        this.logger.warn("Cleaning up stale request", {
          request_id: id,
          age_ms: now - request.start_time,
        });

        // Mark span as timeout
        request.span.setStatus({ code: 2, message: "Request timeout" });
        request.span.end();

        this.activeRequests.delete(id);
      }
    }
  }
}
