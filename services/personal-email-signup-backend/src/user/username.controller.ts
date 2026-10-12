// filepath: src/user/username.controller.ts
import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ConflictException,
  Logger,
  Req,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { MultiDimThrottleGuard } from "../security/multi-dim-throttle.guard";
import { UserService } from "./user.service";
import { ConfigService } from "../config/config.service";
import { MetricsService } from "../metrics/metrics.service";
import { VelocitySignalsService } from "../security/velocity-signals.service";
import {
  isValidUsernameForm,
  normalizeUsername,
  RESERVED_USERNAMES,
} from "./username-utils";
import { emitAudit, buildAuditEvent } from "../events/audit-emitter";
import { randomUUID } from "crypto";
import { Request } from "express";

// Optional tracer
let tracer: any = null;
try {
  const { trace } = require("@opentelemetry/api");
  tracer = trace.getTracer("personal-email-signup-backend");
} catch (e) {
  tracer = null;
}

interface UsernameAvailabilityResponse {
  available: boolean;
  error?: string;
  correlation_id?: string;
}

interface SetUsernameDto {
  username?: string;
}

@ApiTags("username")
@Controller("username")
@UseGuards(ThrottlerGuard, MultiDimThrottleGuard)
export class UsernameController {
  private readonly logger = new Logger(UsernameController.name);

  constructor(
    private readonly userService: UserService,
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
    private readonly velocitySignals: VelocitySignalsService,
  ) {}

  @Get("available")
  @ApiOperation({ summary: "Check username availability" })
  @ApiQuery({ name: "q", required: true, description: "Username to check" })
  @ApiResponse({ status: 200, description: "Username availability result" })
  @ApiResponse({ status: 400, description: "Invalid username format" })
  @ApiResponse({ status: 409, description: "Username is reserved" })
  async available(
    @Query("q") q: string,
    @Req() req: Request,
  ): Promise<UsernameAvailabilityResponse> {
    const start = Date.now();
    const correlationId = randomUUID();
    const span = tracer ? tracer.startSpan("username.available") : null;

    try {
      const username = String(q || "").trim();

      if (!isValidUsernameForm(username)) {
        this.metricsService.requestLatencySeconds.observe(
          { endpoint: "username.available" },
          (Date.now() - start) / 1000,
        );
        if (span) span.setAttribute("error", true);
        if (span) span.end();

        throw new BadRequestException({
          error: "invalid_format",
          correlation_id: correlationId,
        });
      }

      const normalized = normalizeUsername(username);
      const enforceDenylist = this.configService.get(
        "REQUIRE_USERNAME_DENYLIST",
      );

      if (enforceDenylist && RESERVED_USERNAMES.has(normalized)) {
        this.metricsService.requestLatencySeconds.observe(
          { endpoint: "username.available" },
          (Date.now() - start) / 1000,
        );
        if (span) span.end();

        throw new ConflictException({ error: "reserved" });
      }

      const enforceNormalization = this.configService.get(
        "REQUIRE_USERNAME_NORMALIZATION",
      );
      const lookupKey = enforceNormalization ? normalized : username;
      const existing = enforceNormalization
        ? await this.userService.findByNormalizedUsername(lookupKey)
        : await this.userService.findByUsername(lookupKey);

      this.metricsService.requestLatencySeconds.observe(
        { endpoint: "username.available" },
        (Date.now() - start) / 1000,
      );
      if (span) span.end();

      return { available: !existing };
    } catch (error) {
      if (span) span.setAttribute("error", true);
      if (span) span.end();

      this.logger.error(
        `Username availability check failed: ${error.message}`,
        error.stack,
      );

      // Re-throw if it's already a HTTP exception
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException
      ) {
        throw error;
      }

      throw new BadRequestException("Failed to check username availability");
    } finally {
      await this.recordUsernameVelocitySignal(req, correlationId);
    }
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Set username for authenticated user" })
  @ApiResponse({ status: 200, description: "Username set successfully" })
  @ApiResponse({ status: 400, description: "Invalid username or missing" })
  @ApiResponse({
    status: 409,
    description: "Username already taken or reserved",
  })
  async set(
    @Body() body: SetUsernameDto,
  ): Promise<{ ok: boolean; correlation_id: string }> {
    const start = Date.now();
    const correlationId = randomUUID();
    const span = tracer ? tracer.startSpan("username.set") : null;

    try {
      const { username } = body;

      if (!username || !isValidUsernameForm(username)) {
        this.metricsService.requestLatencySeconds.observe(
          { endpoint: "username.set" },
          (Date.now() - start) / 1000,
        );
        if (span) span.setAttribute("error", true);
        if (span) span.end();

        throw new BadRequestException({
          error: "invalid_format",
          correlation_id: correlationId,
        });
      }

      const normalized = normalizeUsername(username);
      const enforceDenylist = this.configService.get(
        "REQUIRE_USERNAME_DENYLIST",
      );

      if (enforceDenylist && RESERVED_USERNAMES.has(normalized)) {
        this.metricsService.usernameConflictsTotal.inc();
        this.metricsService.requestLatencySeconds.observe(
          { endpoint: "username.set" },
          (Date.now() - start) / 1000,
        );
        if (span) span.setAttribute("error", true);
        if (span) span.end();

        throw new ConflictException({
          error: "reserved",
          correlation_id: correlationId,
        });
      }

      const enforceNormalization = this.configService.get(
        "REQUIRE_USERNAME_NORMALIZATION",
      );
      const lookupKey = enforceNormalization ? normalized : username;
      const conflict = enforceNormalization
        ? await this.userService.findByNormalizedUsername(lookupKey)
        : await this.userService.findByUsername(lookupKey);

      if (conflict) {
        this.metricsService.usernameConflictsTotal.inc();
        this.metricsService.requestLatencySeconds.observe(
          { endpoint: "username.set" },
          (Date.now() - start) / 1000,
        );
        if (span) span.setAttribute("error", true);
        if (span) span.end();

        throw new ConflictException({
          error: "conflict",
          correlation_id: correlationId,
        });
      }

      // In a real implementation, you'd get user from JWT token and check rate limits
      // For now, just simulate success
      try {
        await emitAudit(
          buildAuditEvent(
            {
              user: { userId: "unknown" },
              headers: {},
              body: { username: "[REDACTED]" },
            },
            "username.set",
            "success",
            { correlation_id: correlationId },
          ),
        );
      } catch (e) {
        this.logger.warn(
          "Username set audit failed",
          e instanceof Error ? e.message : String(e),
        );
      }

      this.metricsService.requestLatencySeconds.observe(
        { endpoint: "username.set" },
        (Date.now() - start) / 1000,
      );
      if (span) span.end();

      return { ok: true, correlation_id: correlationId };
    } catch (error) {
      if (span) span.setAttribute("error", true);
      if (span) span.end();

      this.logger.error(`Username set failed: ${error.message}`, error.stack);

      // Re-throw if it's already a HTTP exception
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException
      ) {
        throw error;
      }

      this.metricsService.usernameConflictsTotal.inc();
      this.metricsService.requestLatencySeconds.observe(
        { endpoint: "username.set" },
        (Date.now() - start) / 1000,
      );

      throw new BadRequestException("Failed to set username");
    }
  }

  private async recordUsernameVelocitySignal(
    req: Request,
    correlationId: string,
  ): Promise<void> {
    try {
      await this.velocitySignals.trackUsernameEnumeration({
        ipAddress: this.extractClientIp(req),
        correlationId,
      });
    } catch (error) {
      this.logger.warn(
        "Failed to record username enumeration velocity signal",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private extractClientIp(req: Request): string {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length) {
      return forwarded.split(",")[0].trim();
    }
    if (Array.isArray(forwarded) && forwarded.length) {
      return forwarded[0];
    }
    return req.ip || req.socket?.remoteAddress || "unknown";
  }
}
