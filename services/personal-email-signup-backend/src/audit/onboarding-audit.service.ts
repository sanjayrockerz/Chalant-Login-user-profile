// filepath: src/audit/onboarding-audit.service.ts
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "crypto";
import { trace } from "@opentelemetry/api";

export interface AuditEvent {
  event_type: string;
  outcome: "success" | "failure" | "partial" | "denied";
  correlation_id: string;
  tenant_id?: string;
  timestamp: string;
  user_context: UserContext;
  request_context: RequestContext;
  event_data: EventData;
  compliance: ComplianceMetadata;
}

export interface UserContext {
  user_id?: string;
  session_id?: string;
  authentication_method?: string;
  user_agent_hash?: string;
  is_authenticated: boolean;
}

export interface RequestContext {
  ip_hash: string;
  device_fingerprint_hash?: string;
  endpoint: string;
  method: string;
  user_agent_family?: string;
  referrer_domain?: string;
  geolocation?: {
    country?: string;
    region?: string;
  };
}

export interface EventData {
  [key: string]: any;
  // Specific fields will be documented per event type
}

export interface ComplianceMetadata {
  retention_period_days: number;
  data_classification: "public" | "internal" | "confidential" | "restricted";
  regulatory_basis?: string[];
  pii_redacted: boolean;
  anonymization_level: "none" | "partial" | "full";
}

export interface AuditSchema {
  event_type: string;
  description: string;
  required_fields: string[];
  optional_fields: string[];
  compliance: ComplianceMetadata;
}

@Injectable()
export class OnboardingAuditService {
  private readonly logger = new Logger(OnboardingAuditService.name);
  private readonly tracer = trace.getTracer("onboarding-audit");

  // Audit event schemas for validation and compliance
  private readonly auditSchemas: Record<string, AuditSchema> = {
    "legal.accept": {
      event_type: "legal.accept",
      description: "User accepts legal terms (ToS, Privacy Policy, etc.)",
      required_fields: ["policy_type", "policy_version", "acceptance_method"],
      optional_fields: ["marketing_consent", "previous_policy_version"],
      compliance: {
        retention_period_days: 2555, // 7 years for legal compliance
        data_classification: "confidential",
        regulatory_basis: ["GDPR", "CCPA", "SOX"],
        pii_redacted: true,
        anonymization_level: "partial",
      },
    },
    "identity.capture": {
      event_type: "identity.capture",
      description: "User provides identity information during onboarding",
      required_fields: ["capture_method", "fields_captured"],
      optional_fields: ["verification_method", "confidence_score"],
      compliance: {
        retention_period_days: 2555,
        data_classification: "restricted",
        regulatory_basis: ["GDPR", "CCPA", "KYC"],
        pii_redacted: true,
        anonymization_level: "full",
      },
    },
    "users.username.check": {
      event_type: "users.username.check",
      description: "Username availability check request",
      required_fields: ["username_length", "availability_result"],
      optional_fields: ["suggestions_provided", "rate_limit_hit"],
      compliance: {
        retention_period_days: 90,
        data_classification: "internal",
        regulatory_basis: ["security_monitoring"],
        pii_redacted: true,
        anonymization_level: "partial",
      },
    },
    "users.username.set": {
      event_type: "users.username.set",
      description: "Username creation or update attempt",
      required_fields: ["operation_type", "validation_result"],
      optional_fields: ["previous_username_hash", "change_reason"],
      compliance: {
        retention_period_days: 1095, // 3 years
        data_classification: "confidential",
        regulatory_basis: ["GDPR", "audit_trail"],
        pii_redacted: true,
        anonymization_level: "partial",
      },
    },
    "pronouns.set": {
      event_type: "pronouns.set",
      description: "User sets or updates pronouns",
      required_fields: ["pronouns_type", "source"],
      optional_fields: ["previous_pronouns", "custom_pronouns"],
      compliance: {
        retention_period_days: 1095,
        data_classification: "confidential",
        regulatory_basis: ["GDPR", "diversity_reporting"],
        pii_redacted: true,
        anonymization_level: "partial",
      },
    },
    "profile_image.set": {
      event_type: "profile_image.set",
      description: "User uploads or updates profile image",
      required_fields: ["upload_method", "image_metadata"],
      optional_fields: ["moderation_result", "compression_applied"],
      compliance: {
        retention_period_days: 1095,
        data_classification: "confidential",
        regulatory_basis: ["GDPR", "content_moderation"],
        pii_redacted: true,
        anonymization_level: "partial",
      },
    },
    "password.create": {
      event_type: "password.create",
      description: "Password creation during registration",
      required_fields: ["strength_score", "validation_result"],
      optional_fields: ["breach_check_result", "password_manager_detected"],
      compliance: {
        retention_period_days: 1095,
        data_classification: "restricted",
        regulatory_basis: ["security_monitoring", "breach_prevention"],
        pii_redacted: true,
        anonymization_level: "full",
      },
    },
    "password.change": {
      event_type: "password.change",
      description: "Password change by authenticated user",
      required_fields: ["change_method", "strength_score"],
      optional_fields: ["old_password_verified", "breach_check_result"],
      compliance: {
        retention_period_days: 1095,
        data_classification: "restricted",
        regulatory_basis: ["security_monitoring", "breach_prevention"],
        pii_redacted: true,
        anonymization_level: "full",
      },
    },
    "registration.attempt": {
      event_type: "registration.attempt",
      description: "User registration attempt",
      required_fields: ["registration_method", "validation_result"],
      optional_fields: ["invite_code_used", "referral_source"],
      compliance: {
        retention_period_days: 1095,
        data_classification: "confidential",
        regulatory_basis: ["GDPR", "user_analytics"],
        pii_redacted: true,
        anonymization_level: "partial",
      },
    },
  };

  constructor(private readonly configService: ConfigService) {}

  /**
   * Emit audit event for legal acceptance
   */
  async emitLegalAcceptanceEvent(
    outcome: "success" | "failure",
    policyType: string,
    policyVersion: string,
    acceptanceMethod: string,
    context: {
      correlationId: string;
      tenantId?: string;
      userId?: string;
      sessionId?: string;
      request: any;
      marketingConsent?: boolean;
      previousPolicyVersion?: string;
    },
  ): Promise<void> {
    const eventData: EventData = {
      policy_type: policyType,
      policy_version: policyVersion,
      acceptance_method: acceptanceMethod,
      marketing_consent: context.marketingConsent,
      previous_policy_version: context.previousPolicyVersion,
    };

    await this.emitAuditEvent("legal.accept", outcome, context, eventData);
  }

  /**
   * Emit audit event for identity capture
   */
  async emitIdentityCaptureEvent(
    outcome: "success" | "failure" | "partial",
    captureMethod: string,
    fieldsCaptured: string[],
    context: {
      correlationId: string;
      tenantId?: string;
      userId?: string;
      request: any;
      verificationMethod?: string;
      confidenceScore?: number;
    },
  ): Promise<void> {
    const eventData: EventData = {
      capture_method: captureMethod,
      fields_captured: fieldsCaptured,
      verification_method: context.verificationMethod,
      confidence_score: context.confidenceScore,
    };

    await this.emitAuditEvent("identity.capture", outcome, context, eventData);
  }

  /**
   * Emit audit event for username operations
   */
  async emitUsernameEvent(
    eventType: "users.username.check" | "users.username.set",
    outcome: "success" | "failure" | "denied",
    context: {
      correlationId: string;
      tenantId?: string;
      userId?: string;
      request: any;
      usernameLength?: number;
      availabilityResult?: boolean;
      suggestionsProvided?: boolean;
      rateLimitHit?: boolean;
      operationType?: "create" | "update";
      validationResult?: any;
      previousUsernameHash?: string;
      changeReason?: string;
    },
  ): Promise<void> {
    let eventData: EventData;

    if (eventType === "users.username.check") {
      eventData = {
        username_length: context.usernameLength,
        availability_result: context.availabilityResult,
        suggestions_provided: context.suggestionsProvided,
        rate_limit_hit: context.rateLimitHit,
      };
    } else {
      eventData = {
        operation_type: context.operationType,
        validation_result: context.validationResult,
        previous_username_hash: context.previousUsernameHash,
        change_reason: context.changeReason,
      };
    }

    await this.emitAuditEvent(eventType, outcome, context, eventData);
  }

  /**
   * Emit audit event for pronouns setting
   */
  async emitPronounsEvent(
    outcome: "success" | "failure",
    pronounsType: string,
    source: string,
    context: {
      correlationId: string;
      tenantId?: string;
      userId?: string;
      request: any;
      previousPronouns?: string;
      customPronouns?: string;
    },
  ): Promise<void> {
    const eventData: EventData = {
      pronouns_type: pronounsType,
      source: source,
      previous_pronouns: context.previousPronouns,
      custom_pronouns: context.customPronouns,
    };

    await this.emitAuditEvent("pronouns.set", outcome, context, eventData);
  }

  /**
   * Emit audit event for profile image operations
   */
  async emitProfileImageEvent(
    outcome: "success" | "failure" | "partial",
    uploadMethod: string,
    imageMetadata: any,
    context: {
      correlationId: string;
      tenantId?: string;
      userId?: string;
      request: any;
      moderationResult?: any;
      compressionApplied?: boolean;
    },
  ): Promise<void> {
    const eventData: EventData = {
      upload_method: uploadMethod,
      image_metadata: this.sanitizeImageMetadata(imageMetadata),
      moderation_result: context.moderationResult,
      compression_applied: context.compressionApplied,
    };

    await this.emitAuditEvent("profile_image.set", outcome, context, eventData);
  }

  /**
   * Emit audit event for password operations
   */
  async emitPasswordEvent(
    eventType: "password.create" | "password.change",
    outcome: "success" | "failure",
    strengthScore: number,
    validationResult: any,
    context: {
      correlationId: string;
      tenantId?: string;
      userId?: string;
      request: any;
      breachCheckResult?: any;
      passwordManagerDetected?: boolean;
      changeMethod?: string;
      oldPasswordVerified?: boolean;
    },
  ): Promise<void> {
    const eventData: EventData = {
      strength_score: strengthScore,
      validation_result: validationResult,
      breach_check_result: context.breachCheckResult,
      password_manager_detected: context.passwordManagerDetected,
    };

    if (eventType === "password.change") {
      eventData.change_method = context.changeMethod;
      eventData.old_password_verified = context.oldPasswordVerified;
    }

    await this.emitAuditEvent(eventType, outcome, context, eventData);
  }

  /**
   * Core audit event emission
   */
  private async emitAuditEvent(
    eventType: string,
    outcome: "success" | "failure" | "partial" | "denied",
    context: {
      correlationId: string;
      tenantId?: string;
      userId?: string;
      sessionId?: string;
      request: any;
    },
    eventData: EventData,
  ): Promise<void> {
    return this.tracer.startActiveSpan("emit-audit-event", async (span) => {
      try {
        span.setAttributes({
          "audit.event_type": eventType,
          "audit.outcome": outcome,
          "correlation.id": context.correlationId,
        });

        const schema = this.auditSchemas[eventType];
        if (!schema) {
          throw new Error(`Unknown audit event type: ${eventType}`);
        }

        // Build the complete audit event
        const auditEvent: AuditEvent = {
          event_type: eventType,
          outcome,
          correlation_id: context.correlationId,
          tenant_id: context.tenantId,
          timestamp: new Date().toISOString(),
          user_context: this.buildUserContext(context),
          request_context: await this.buildRequestContext(
            context.request,
            eventType,
          ),
          event_data: this.sanitizeEventData(eventData, schema),
          compliance: schema.compliance,
        };

        // Validate required fields
        this.validateAuditEvent(auditEvent, schema);

        // Log the audit event (structured logging)
        this.logger.log("Audit event emitted", {
          audit_event: auditEvent,
          schema_version: "1.0",
          service: "onboarding-service",
        });

        // TODO: Integrate with external audit systems
        await this.sendToAuditSystem(auditEvent);

        span.setAttributes({
          "audit.emitted": true,
          "audit.compliance.retention_days":
            schema.compliance.retention_period_days,
        });
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: 2, message: "Audit event emission failed" });

        this.logger.error("Failed to emit audit event", {
          error: error.message,
          event_type: eventType,
          correlation_id: context.correlationId,
        });

        // Don't throw - audit failures shouldn't break main flow
      } finally {
        span.end();
      }
    });
  }

  private buildUserContext(context: {
    userId?: string;
    sessionId?: string;
    request: any;
  }): UserContext {
    return {
      user_id: context.userId,
      session_id: context.sessionId,
      authentication_method: context.request.user
        ? "authenticated"
        : "anonymous",
      user_agent_hash: this.hashForAudit(
        context.request.headers["user-agent"] || "",
      ),
      is_authenticated: !!context.userId,
    };
  }

  private async buildRequestContext(
    request: any,
    eventType: string,
  ): Promise<RequestContext> {
    const ip = this.extractClientIp(request);
    const userAgent = request.headers["user-agent"] || "";

    return {
      ip_hash: this.hashForAudit(ip),
      device_fingerprint_hash: request.headers["x-device-fingerprint"]
        ? this.hashForAudit(request.headers["x-device-fingerprint"])
        : undefined,
      endpoint: eventType,
      method: request.method,
      user_agent_family: this.extractUserAgentFamily(userAgent),
      referrer_domain: this.extractReferrerDomain(request.headers.referer),
      geolocation: await this.getGeolocation(ip),
    };
  }

  private sanitizeEventData(
    eventData: EventData,
    schema: AuditSchema,
  ): EventData {
    const sanitized: EventData = {};

    // Only include allowed fields from schema
    const allowedFields = [
      ...schema.required_fields,
      ...schema.optional_fields,
    ];

    for (const field of allowedFields) {
      if (eventData.hasOwnProperty(field)) {
        sanitized[field] = eventData[field];
      }
    }

    return sanitized;
  }

  private sanitizeImageMetadata(metadata: any): any {
    if (!metadata) return null;

    // Remove potentially sensitive metadata
    return {
      format: metadata.format,
      width: metadata.width,
      height: metadata.height,
      size: metadata.size,
      has_exif: !!metadata.exif,
      color_space: metadata.colorSpace,
    };
  }

  private validateAuditEvent(event: AuditEvent, schema: AuditSchema): void {
    for (const requiredField of schema.required_fields) {
      if (!event.event_data.hasOwnProperty(requiredField)) {
        throw new Error(
          `Missing required field for ${schema.event_type}: ${requiredField}`,
        );
      }
    }
  }

  private extractClientIp(request: any): string {
    return (
      request.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      request.headers["x-real-ip"] ||
      request.connection?.remoteAddress ||
      request.socket?.remoteAddress ||
      request.ip ||
      "unknown"
    );
  }

  private extractUserAgentFamily(userAgent: string): string {
    if (userAgent.includes("Chrome")) return "Chrome";
    if (userAgent.includes("Firefox")) return "Firefox";
    if (userAgent.includes("Safari")) return "Safari";
    if (userAgent.includes("Edge")) return "Edge";
    return "Other";
  }

  private extractReferrerDomain(referer?: string): string | undefined {
    if (!referer) return undefined;

    try {
      const url = new URL(referer);
      return url.hostname;
    } catch {
      return undefined;
    }
  }

  private async getGeolocation(
    ip: string,
  ): Promise<{ country?: string; region?: string } | undefined> {
    // TODO: Implement geolocation lookup (e.g., MaxMind GeoIP)
    // For now, return undefined to avoid external dependencies
    return undefined;
  }

  private hashForAudit(value: string): string {
    if (!value) return "empty";

    // Simple hash for audit correlation (use stronger hash in production)
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      const char = value.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  private async sendToAuditSystem(auditEvent: AuditEvent): Promise<void> {
    // TODO: Implement integration with external audit systems
    // Examples: Splunk, Elasticsearch, CloudTrail, etc.

    // For now, just ensure the event is logged with proper structure
    const auditLog = {
      "@timestamp": auditEvent.timestamp,
      "@version": "1",
      "event.category": "audit",
      "event.type": auditEvent.event_type,
      "event.outcome": auditEvent.outcome,
      "trace.id": auditEvent.correlation_id,
      audit: auditEvent,
    };

    // This would typically go to a dedicated audit log stream
    this.logger.log("AUDIT_EVENT", auditLog);
  }
}
