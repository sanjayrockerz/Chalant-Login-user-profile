import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { createHash } from "crypto";
import { ThrottlerGuard } from "@nestjs/throttler";
import { ExecutionContext } from "@nestjs/common/interfaces";
import { Reflector } from "@nestjs/core";
import { ConfigService } from "../config/config.service";
import { RedisThrottlerStorageService } from "./redis-throttler.storage";

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  private readonly logger = new Logger(CustomThrottlerGuard.name);

  constructor(
    private readonly configService: ConfigService,
    storageService: RedisThrottlerStorageService,
    reflector: Reflector,
  ) {
    super(
      {
        storage: storageService,
        throttlers: [],
      } as any,
      storageService,
      reflector,
    );

    this.throttlers = this.buildDimensionThrottlers();
    this.commonOptions = {
      getTracker: (req) => req.ip,
      generateKey: this.generateKey.bind(this),
    };
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      return await super.canActivate(context);
    } catch (error) {
      this.logger.warn("Rate limit enforcement triggered", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
    detail: any,
  ): Promise<void> {
    const { req, res } = this.getRequestResponse(context);
    const retryAfter = Math.max(
      detail.timeToBlockExpire ?? detail.timeToExpire ?? 0,
      0,
    );
    if (retryAfter) {
      res.setHeader("Retry-After", retryAfter);
    }
    const correlationId =
      req?.correlationId ?? req?.headers?.["x-correlation-id"];
    const dimension = this.extractDimension(detail.key);
    throw new HttpException(
      {
        error: "rate_limited",
        dimension,
        retry_after_seconds: retryAfter,
        correlation_id: correlationId,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private buildDimensionThrottlers() {
    const globalLimit = Number(
      this.configService.get("RATE_LIMIT_GLOBAL_LIMIT") ?? 1000,
    );
    const globalTtlSeconds = Number(
      this.configService.get("RATE_LIMIT_GLOBAL_TTL") ?? 60,
    );
    const globalBlockSeconds = Number(
      this.configService.get("RATE_LIMIT_GLOBAL_BLOCK_SECONDS") ?? 120,
    );

    const ipLimit = Number(this.configService.get("RATE_LIMIT_IP_LIMIT") ?? 60);
    const ipTtl = Number(this.configService.get("RATE_LIMIT_IP_TTL") ?? 3600);
    const ipBlock = Number(
      this.configService.get("RATE_LIMIT_IP_BLOCK_SECONDS") ?? 300,
    );

    const deviceLimit = Number(
      this.configService.get("RATE_LIMIT_DEVICE_LIMIT") ?? 20,
    );
    const deviceTtl = Number(
      this.configService.get("RATE_LIMIT_DEVICE_TTL") ?? 3600,
    );
    const deviceBlock = Number(
      this.configService.get("RATE_LIMIT_DEVICE_BLOCK_SECONDS") ?? 300,
    );

    const userLimit = Number(
      this.configService.get("RATE_LIMIT_USER_LIMIT") ?? 100,
    );
    const userTtl = Number(
      this.configService.get("RATE_LIMIT_USER_TTL") ?? 3600,
    );
    const userBlock = Number(
      this.configService.get("RATE_LIMIT_USER_BLOCK_SECONDS") ?? 300,
    );

    return [
      {
        name: "global",
        limit: globalLimit,
        ttl: globalTtlSeconds * 1000,
        blockDuration: globalBlockSeconds * 1000,
        getTracker: () => "global",
        generateKey: (
          context: ExecutionContext,
          tracker: string,
          name: string,
        ) => this.buildKey(context, name, tracker),
      },
      {
        name: "ip",
        limit: ipLimit,
        ttl: ipTtl * 1000,
        blockDuration: ipBlock * 1000,
        getTracker: (req: Record<string, any>) =>
          this.hashIdentifier(this.extractIp(req)),
        generateKey: (
          context: ExecutionContext,
          tracker: string,
          name: string,
        ) => this.buildKey(context, name, tracker),
      },
      {
        name: "device",
        limit: deviceLimit,
        ttl: deviceTtl * 1000,
        blockDuration: deviceBlock * 1000,
        getTracker: (req: Record<string, any>) =>
          this.hashIdentifier(req.headers?.["x-device-id"] ?? "unknown-device"),
        generateKey: (
          context: ExecutionContext,
          tracker: string,
          name: string,
        ) => this.buildKey(context, name, tracker),
      },
      {
        name: "user",
        limit: userLimit,
        ttl: userTtl * 1000,
        blockDuration: userBlock * 1000,
        getTracker: (req: Record<string, any>) =>
          this.hashIdentifier(req.user?.id ?? "anonymous"),
        generateKey: (
          context: ExecutionContext,
          tracker: string,
          name: string,
        ) => this.buildKey(context, name, tracker),
      },
    ];
  }

  private buildKey(
    context: ExecutionContext,
    name: string,
    tracker: string,
  ): string {
    const handler = context.getHandler();
    const controller = context.getClass();
    const route = `${controller?.name ?? "Unknown"}:${handler?.name ?? "handler"}`;
    return `${name}:${route}:${tracker}`;
  }

  private extractDimension(key: string | undefined): string {
    if (!key) {
      return "global";
    }
    const [dimension] = key.split(":");
    return dimension || "global";
  }

  private extractIp(req: Record<string, any>): string {
    const headerIp = req.headers?.["x-forwarded-for"] as string | undefined;
    if (headerIp?.length) {
      return headerIp.split(",")[0].trim();
    }
    return req.ip || req.connection?.remoteAddress || "unknown";
  }

  private hashIdentifier(value: string): string {
    return createHash("sha256")
      .update(value ?? "unknown")
      .digest("hex");
  }
}
