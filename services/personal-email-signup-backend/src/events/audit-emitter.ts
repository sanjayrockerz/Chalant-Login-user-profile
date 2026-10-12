/**
 * Local Audit Emitter Stub
 *
 * Cross-service audit event logging and emission functionality.
 * This is a local copy to resolve cross-service dependencies.
 *
 * TODO: Replace with actual audit implementation
 * - Implement proper audit event schema
 * - Add audit event persistence
 * - Integrate with centralized audit system
 * - Add correlation tracking
 *
 * Consumers: Controllers requiring audit logging
 * Priority: Medium (audit and compliance)
 */

export interface AuditEventContext {
  user?: {
    userId: string | null;
    email?: string;
    role?: string;
  };
  headers?: Record<string, any>;
  body?: Record<string, any>;
  query?: Record<string, any>;
  params?: Record<string, any>;
  ip?: string;
  userAgent?: string;
}

export interface AuditEvent {
  id: string;
  action: string;
  result: "success" | "failure" | "warning";
  timestamp: string;
  context: AuditEventContext;
  metadata?: {
    tenant_id?: string;
    correlation_id?: string;
    service: string;
    version: string;
  };
}

/**
 * Build audit event object
 */
export function buildAuditEvent(
  context: AuditEventContext,
  action: string,
  result: "success" | "failure" | "warning",
  metadata?: { tenant_id?: string; correlation_id?: string },
): AuditEvent {
  // Sanitize sensitive data from headers and body
  const sanitizedHeaders = sanitizeHeaders(context.headers || {});
  const sanitizedBody = sanitizeBody(context.body || {});

  return {
    id: `audit_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    action,
    result,
    timestamp: new Date().toISOString(),
    context: {
      ...context,
      headers: sanitizedHeaders,
      body: sanitizedBody,
    },
    metadata: {
      ...metadata,
      service: "personal-email-signup-backend",
      version: "1.0.0-stub",
    },
  };
}

/**
 * Emit audit event
 */
export async function emitAudit(event: AuditEvent): Promise<void> {
  try {
    // TODO: Implement actual audit emission
    // - Send to centralized audit service
    // - Store in audit database
    // - Send to monitoring systems
    // - Handle retries and failures

    // Stub implementation - log to console
    console.log(`[AUDIT] ${event.action} - ${event.result}`, {
      id: event.id,
      timestamp: event.timestamp,
      user: event.context.user?.userId,
      correlation_id: event.metadata?.correlation_id,
      tenant_id: event.metadata?.tenant_id,
    });
  } catch (error) {
    // Never let audit failures break the main flow
    console.error("[AUDIT ERROR] Failed to emit audit event:", error);
  }
}

/**
 * Sanitize headers by removing sensitive information
 */
function sanitizeHeaders(headers: Record<string, any>): Record<string, any> {
  const sensitiveHeaders = [
    "authorization",
    "cookie",
    "x-api-key",
    "x-auth-token",
    "x-access-token",
    "x-refresh-token",
    "x-session-id",
  ];

  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();

    if (sensitiveHeaders.includes(lowerKey)) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Sanitize body by removing sensitive information
 */
function sanitizeBody(body: Record<string, any>): Record<string, any> {
  const sensitiveFields = [
    "password",
    "token",
    "secret",
    "key",
    "otp",
    "pin",
    "ssn",
    "social_security_number",
    "credit_card",
    "cvv",
  ];

  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(body)) {
    const lowerKey = key.toLowerCase();

    if (sensitiveFields.some((field) => lowerKey.includes(field))) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeBody(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
