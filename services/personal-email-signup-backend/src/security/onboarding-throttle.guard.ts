// filepath: src/security/onboarding-throttle.guard.ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { randomUUID } from "crypto";
import { trace } from "@opentelemetry/api";

export interface RateLimitConfig {
  ip: { limit: number; windowMs: number };
  user: { limit: number; windowMs: number };
  device: { limit: number; windowMs: number };
  endpoint: string;
}

export interface ThrottleKey {
  ip?: string;
  userId?: string;
  deviceId?: string;
  endpoint: string;
}

export interface RateLimitViolation {
  dimension: "ip" | "user" | "device";
  limit: number;
  windowMs: number;
  retryAfter: number;
}

// Decorator for setting custom rate limits per endpoint
export const OnboardingThrottle = (config: Partial<RateLimitConfig>) =>
  Reflector.createDecorator<Partial<RateLimitConfig>>();

// Metadata key for rate limit config
export const ONBOARDING_THROTTLE_KEY = "onboarding-throttle";

@Injectable()
export class OnboardingThrottleGuard implements CanActivate {
  private readonly logger = new Logger(OnboardingThrottleGuard.name);
  private readonly tracer = trace.getTracer("onboarding-throttle-guard");
  private readonly rateLimitStore = new Map<
    string,
    { count: number; resetTime: number }
  >();

  // Default rate limits - can be overridden per endpoint
  private readonly defaultLimits: RateLimitConfig = {
    ip: { limit: 100, windowMs: 15 * 60 * 1000 }, // 100 requests per 15 minutes per IP
    user: { limit: 50, windowMs: 15 * 60 * 1000 }, // 50 requests per 15 minutes per user
    device: { limit: 30, windowMs: 15 * 60 * 1000 }, // 30 requests per 15 minutes per device
    endpoint: "default",
  };

  // Stricter limits for sensitive endpoints
  private readonly endpointLimits: Record<string, Partial<RateLimitConfig>> = {
    "username-availability": {
      ip: { limit: 60, windowMs: 15 * 60 * 1000 },
      user: { limit: 30, windowMs: 15 * 60 * 1000 },
      device: { limit: 20, windowMs: 15 * 60 * 1000 },
    },
    "username-update": {
      ip: { limit: 10, windowMs: 60 * 60 * 1000 }, // 10 updates per hour per IP
      user: { limit: 3, windowMs: 24 * 60 * 60 * 1000 }, // 3 updates per day per user
      device: { limit: 5, windowMs: 60 * 60 * 1000 },
    },
    registration: {
      ip: { limit: 10, windowMs: 60 * 60 * 1000 },
      user: { limit: 1, windowMs: 24 * 60 * 60 * 1000 }, // 1 registration per day per user
      device: { limit: 3, windowMs: 24 * 60 * 60 * 1000 },
    },
    "legal-acceptance": {
      ip: { limit: 20, windowMs: 60 * 60 * 1000 },
      user: { limit: 10, windowMs: 60 * 60 * 1000 },
      device: { limit: 5, windowMs: 60 * 60 * 1000 },
    },
    "identity-capture": {
      ip: { limit: 50, windowMs: 60 * 60 * 1000 },
      user: { limit: 20, windowMs: 60 * 60 * 1000 },
      device: { limit: 15, windowMs: 60 * 60 * 1000 },
    },
    "profile-updates": {
      ip: { limit: 30, windowMs: 60 * 60 * 1000 },
      user: { limit: 20, windowMs: 60 * 60 * 1000 },
      device: { limit: 15, windowMs: 60 * 60 * 1000 },
    },
  };

  constructor(
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const correlationId = request.headers["x-correlation-id"] || randomUUID();

    return this.tracer.startActiveSpan(
      "onboarding-throttle-check",
      async (span) => {
        try {
          span.setAttributes({
            "http.method": request.method,
            "http.route": request.route?.path || request.url,
            "correlation.id": correlationId,
          });

          // Extract rate limit configuration
          const endpointConfig =
            this.reflector.get(ONBOARDING_THROTTLE_KEY, context.getHandler()) ||
            {};
          const endpointName = this.getEndpointName(request);
          const limits = this.buildRateLimits(endpointName, endpointConfig);

          // Extract throttle keys
          const keys = this.extractThrottleKeys(request, endpointName);

          // Check each dimension
          const violations: RateLimitViolation[] = [];

          // Check IP-based rate limit
          if (keys.ip) {
            const ipViolation = await this.checkRateLimit(
              `ip:${keys.ip}:${endpointName}`,
              limits.ip,
              "ip",
            );
            if (ipViolation) violations.push(ipViolation);
          }

          // Check user-based rate limit (if authenticated)
          if (keys.userId) {
            const userViolation = await this.checkRateLimit(
              `user:${keys.userId}:${endpointName}`,
              limits.user,
              "user",
            );
            if (userViolation) violations.push(userViolation);
          }

          // Check device-based rate limit
          if (keys.deviceId) {
            const deviceViolation = await this.checkRateLimit(
              `device:${keys.deviceId}:${endpointName}`,
              limits.device,
              "device",
            );
            if (deviceViolation) violations.push(deviceViolation);
          }

          // If any violations, throw structured 429 error
          if (violations.length > 0) {
            const mostRestrictive = violations.reduce((prev, curr) =>
              curr.retryAfter > prev.retryAfter ? curr : prev,
            );

            await this.logRateLimitViolation(keys, violations, correlationId);

            span.setAttributes({
              "rate_limit.violated": true,
              "rate_limit.dimension": mostRestrictive.dimension,
              "rate_limit.retry_after": mostRestrictive.retryAfter,
            });

            throw new HttpException(
              {
                error: "rate_limit_exceeded",
                message: "Too many requests. Please try again later.",
                statusCode: HttpStatus.TOO_MANY_REQUESTS,
                correlation_id: correlationId,
                retry_after: mostRestrictive.retryAfter,
                limits: {
                  endpoint: endpointName,
                  violations: violations.map((v) => ({
                    dimension: v.dimension,
                    retry_after: v.retryAfter,
                  })),
                },
              },
              HttpStatus.TOO_MANY_REQUESTS,
            );
          }

          span.setAttributes({
            "rate_limit.violated": false,
            "rate_limit.endpoint": endpointName,
          });

          return true;
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({ code: 2, message: "Rate limit check failed" });

          if (error instanceof HttpException) {
            throw error;
          }

          // Log error but allow request through (fail open for reliability)
          this.logger.error("Rate limit check failed", {
            error: error.message,
            correlation_id: correlationId,
          });

          return true;
        } finally {
          span.end();
        }
      },
    );
  }

  private getEndpointName(request: any): string {
    const path = request.route?.path || request.url;

    // Map paths to endpoint names
    if (path.includes("/username/availability")) return "username-availability";
    if (path.includes("/username") && request.method === "PATCH")
      return "username-update";
    if (path.includes("/register")) return "registration";
    if (path.includes("/legal/accept")) return "legal-acceptance";
    if (path.includes("/identity")) return "identity-capture";
    if (path.includes("/profile") || path.includes("/pronouns"))
      return "profile-updates";

    return "default";
  }

  private buildRateLimits(
    endpointName: string,
    overrides: Partial<RateLimitConfig>,
  ): RateLimitConfig {
    const endpointDefaults = this.endpointLimits[endpointName] || {};

    return {
      ip: { ...this.defaultLimits.ip, ...endpointDefaults.ip, ...overrides.ip },
      user: {
        ...this.defaultLimits.user,
        ...endpointDefaults.user,
        ...overrides.user,
      },
      device: {
        ...this.defaultLimits.device,
        ...endpointDefaults.device,
        ...overrides.device,
      },
      endpoint: endpointName,
    };
  }

  private extractThrottleKeys(request: any, endpoint: string): ThrottleKey {
    // Extract IP (handle proxies)
    const ip =
      request.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      request.headers["x-real-ip"] ||
      request.connection?.remoteAddress ||
      request.socket?.remoteAddress ||
      request.ip;

    // Extract user ID (if authenticated)
    const userId = request.user?.id || request.user?.userId;

    // Extract device ID from headers or generate fingerprint
    const deviceId =
      request.headers["x-device-id"] ||
      request.headers["x-device-fingerprint"] ||
      this.generateDeviceFingerprint(request);

    return {
      ip: this.normalizeIp(ip),
      userId: userId?.toString(),
      deviceId,
      endpoint,
    };
  }

  private async checkRateLimit(
    key: string,
    limit: { limit: number; windowMs: number },
    dimension: "ip" | "user" | "device",
  ): Promise<RateLimitViolation | null> {
    const now = Date.now();
    const entry = this.rateLimitStore.get(key);

    // Clean up expired entries
    if (entry && now > entry.resetTime) {
      this.rateLimitStore.delete(key);
    }

    const current = this.rateLimitStore.get(key) || {
      count: 0,
      resetTime: now + limit.windowMs,
    };

    if (current.count >= limit.limit) {
      const retryAfter = Math.ceil((current.resetTime - now) / 1000);
      return {
        dimension,
        limit: limit.limit,
        windowMs: limit.windowMs,
        retryAfter,
      };
    }

    // Increment counter
    current.count++;
    this.rateLimitStore.set(key, current);

    return null;
  }

  private normalizeIp(ip: string): string {
    if (!ip) return "unknown";

    // Handle IPv6 mapped IPv4
    if (ip.startsWith("::ffff:")) {
      return ip.substring(7);
    }

    // Remove port if present
    return ip.split(":")[0];
  }

  private generateDeviceFingerprint(request: any): string {
    const userAgent = request.headers["user-agent"] || "";
    const acceptLanguage = request.headers["accept-language"] || "";
    const acceptEncoding = request.headers["accept-encoding"] || "";

    // Create a simple fingerprint (in production, use more sophisticated method)
    const fingerprint = Buffer.from(
      `${userAgent}${acceptLanguage}${acceptEncoding}`,
    )
      .toString("base64")
      .substring(0, 16);

    return fingerprint;
  }

  private async logRateLimitViolation(
    keys: ThrottleKey,
    violations: RateLimitViolation[],
    correlationId: string,
  ): Promise<void> {
    // Log without PII
    this.logger.warn("Rate limit violation detected", {
      correlation_id: correlationId,
      endpoint: keys.endpoint,
      violations: violations.map((v) => ({
        dimension: v.dimension,
        limit: v.limit,
        window_ms: v.windowMs,
        retry_after: v.retryAfter,
      })),
      has_ip: !!keys.ip,
      has_user: !!keys.userId,
      has_device: !!keys.deviceId,
      // Hash IP for correlation without exposing PII
      ip_hash: keys.ip ? this.hashForLogging(keys.ip) : null,
    });
  }

  private hashForLogging(value: string): string {
    // Simple hash for correlation (use stronger hash in production)
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      const char = value.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(16);
  }

  // Cleanup expired entries periodically
  private cleanupExpiredEntries(): void {
    const now = Date.now();
    for (const [key, entry] of this.rateLimitStore.entries()) {
      if (now > entry.resetTime) {
        this.rateLimitStore.delete(key);
      }
    }
  }
}

// Structured error response for rate limit violations
export class RateLimitExceededError extends HttpException {
  constructor(
    endpoint: string,
    violations: RateLimitViolation[],
    correlationId: string,
  ) {
    const mostRestrictive = violations.reduce((prev, curr) =>
      curr.retryAfter > prev.retryAfter ? curr : prev,
    );

    super(
      {
        error: "rate_limit_exceeded",
        message: "Request rate limit exceeded. Please try again later.",
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        correlation_id: correlationId,
        retry_after: mostRestrictive.retryAfter,
        details: {
          endpoint,
          violations: violations.map((v) => ({
            dimension: v.dimension,
            retry_after: v.retryAfter,
          })),
        },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
