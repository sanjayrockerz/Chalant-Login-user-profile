import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpStatus,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createHash } from "crypto";
import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { RateLimiterService } from "../rate_limiter/rate_limiter.service";
import { ConfigService } from "../config/config.service";
import { MetricsService } from "../metrics/metrics.service";
import {
  RateLimitOptions,
  RateLimitDimensionRule,
  RATE_LIMIT_RULES_KEY,
} from "./rate_limit.decorator";
import { RequestWithPrincipal } from "../canonical-auth/canonical-auth.types";

interface DimensionCheck {
  key: string;
  identity: string;
  limit: number;
  windowSeconds: number;
  metricLabel: string;
  scope: string;
  blockSeconds: number;
}

@Injectable()
export class MultiDimThrottleGuard implements CanActivate {
  constructor(
    private readonly rl: RateLimiterService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ctx = context.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const tenantId = req.headers["x-tenant-id"] as string | undefined;
    const correlationId =
      (req.headers["x-correlation-id"] as string) || uuidv4();
    res.setHeader("x-correlation-id", correlationId);

    const ip = this.hashIdentifier(
      req.ip || req.connection?.remoteAddress || "unknown",
    );
    const userId = this.hashIdentifier(
      (req as unknown as RequestWithPrincipal).user?.subject || "anonymous",
    );
    const deviceId = this.hashIdentifier(
      (req.headers["x-device-id"] as string) || "unknown-device",
    );
    const hashedTenant = this.hashIdentifier(tenantId || "default");
    const scope = this.buildScopeKey(req);
    const rules = this.reflector.getAllAndOverride<
      RateLimitOptions | undefined
    >(RATE_LIMIT_RULES_KEY, [context.getHandler(), context.getClass()]);

    const dimensions = this.buildDimensions({
      scope,
      userId,
      ip,
      deviceId,
      tenantId: hashedTenant,
      rules,
    });

    for (const dimension of dimensions) {
      if (dimension.limit <= 0 || !dimension.identity) {
        continue;
      }

      const result = await this.rl.checkAndIncrement(
        dimension.key,
        dimension.identity,
        dimension.limit,
        dimension.windowSeconds,
        dimension.scope,
        dimension.blockSeconds,
      );

      if (!result.allowed) {
        this.metrics.incrementRateLimitSaturation(dimension.metricLabel);
        this.metrics.observeRequestLatency(req.path, 0.001);
        if (typeof result.retryAfter === "number" && result.retryAfter >= 0) {
          res.setHeader("Retry-After", result.retryAfter);
        }
        res.status(HttpStatus.TOO_MANY_REQUESTS).json({
          error: "rate_limited",
          reason: dimension.metricLabel,
          retry_after_seconds: result.retryAfter,
          correlation_id: correlationId,
        });
        return false;
      }
    }

    return true;
  }

  private buildDimensions(params: {
    scope: string;
    userId: string;
    ip: string;
    deviceId: string;
    tenantId: string;
    rules?: RateLimitOptions;
  }): DimensionCheck[] {
    const { scope, userId, ip, deviceId, tenantId, rules } = params;

    const user = this.buildDimension("user", userId, scope, rules?.user, {
      limit: this.resolveNumberConfig("RATE_LIMIT_USER_LIMIT", 100),
      window: this.resolveNumberConfig("RATE_LIMIT_USER_TTL", 3600),
      block: this.resolveNumberConfig("RATE_LIMIT_USER_BLOCK_SECONDS", 300),
    });

    const ipDim = this.buildDimension("ip", ip, scope, rules?.ip, {
      limit: this.resolveNumberConfig("RATE_LIMIT_IP_LIMIT", 60),
      window: this.resolveNumberConfig("RATE_LIMIT_IP_TTL", 3600),
      block: this.resolveNumberConfig("RATE_LIMIT_IP_BLOCK_SECONDS", 300),
    });

    const device = this.buildDimension(
      "device",
      deviceId,
      scope,
      rules?.device,
      {
        limit: this.resolveNumberConfig("RATE_LIMIT_DEVICE_LIMIT", 20),
        window: this.resolveNumberConfig("RATE_LIMIT_DEVICE_TTL", 3600),
        block: this.resolveNumberConfig("RATE_LIMIT_DEVICE_BLOCK_SECONDS", 300),
      },
    );

    const tenant = rules?.tenant
      ? this.buildDimension("tenant", tenantId, scope, rules.tenant, {
          limit: this.resolveNumberConfig("RATE_LIMIT_USER_LIMIT", 100),
          window: this.resolveNumberConfig("RATE_LIMIT_USER_TTL", 3600),
          block: this.resolveNumberConfig("RATE_LIMIT_USER_BLOCK_SECONDS", 300),
        })
      : undefined;

    const global = this.buildDimension(
      "global",
      "global",
      scope,
      rules?.global,
      {
        limit: this.resolveNumberConfig(
          "RATE_LIMIT_GLOBAL_LIMIT",
          this.resolveNumberConfig("RATE_LIMIT_MAX", 0),
        ),
        window: this.resolveNumberConfig(
          "RATE_LIMIT_GLOBAL_TTL",
          this.resolveNumberConfig("RATE_LIMIT_TTL", 60),
        ),
        block: this.resolveNumberConfig("RATE_LIMIT_GLOBAL_BLOCK_SECONDS", 120),
      },
    );

    return [user, ipDim, device, tenant, global].filter(
      (dim): dim is DimensionCheck => Boolean(dim),
    );
  }

  private buildDimension(
    key: string,
    identity: string,
    scope: string,
    rule: RateLimitDimensionRule | undefined,
    fallback: { limit: number; window: number; block: number },
  ): DimensionCheck | undefined {
    const limit = typeof rule?.limit === "number" ? rule.limit : fallback.limit;
    const windowSeconds = this.parseWindowToSeconds(
      rule?.window,
      fallback.window,
    );
    const blockSeconds =
      rule?.block !== undefined
        ? this.parseWindowToSeconds(String(rule.block), fallback.block)
        : fallback.block;

    if (!limit || limit <= 0) {
      return undefined;
    }

    return {
      key,
      identity,
      limit,
      windowSeconds,
      metricLabel: key,
      scope,
      blockSeconds,
    };
  }

  private resolveNumberConfig(key: string, fallback: number): number {
    const value = this.config.get(key as any) as unknown;
    if (typeof value === "number" && !Number.isNaN(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    return fallback;
  }

  private parseWindowToSeconds(
    window: string | undefined,
    fallbackSeconds: number,
  ): number {
    if (!window || typeof window !== "string") {
      return fallbackSeconds;
    }

    const trimmed = window.trim().toLowerCase();
    if (/^\d+$/.test(trimmed)) {
      return Number(trimmed);
    }

    const match = trimmed.match(/^(\d+)\s*(s|m|h|d)$/);
    if (!match) {
      return fallbackSeconds;
    }

    const value = Number(match[1]);
    const unit = match[2];

    switch (unit) {
      case "d":
        return value * 24 * 60 * 60;
      case "h":
        return value * 60 * 60;
      case "m":
        return value * 60;
      case "s":
      default:
        return value;
    }
  }

  private hashIdentifier(value: string): string {
    return createHash("sha256")
      .update(value ?? "unknown")
      .digest("hex");
  }

  private buildScopeKey(req: Request): string {
    const method = (req.method || "GET").toLowerCase();
    const route = (req as unknown as { route?: { path?: unknown } }).route;
    const routePath = typeof route?.path === "string" ? route.path : undefined;
    const rawPath = routePath ?? req.path ?? "unknown";
    const path = rawPath.replace(/[:\s]/g, "_");
    return `${method}:${path}`;
  }
}
