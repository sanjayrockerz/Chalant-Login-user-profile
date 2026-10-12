import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "crypto";
import { RateLimiterService } from "../rate_limiter/rate_limiter.service";
import { ConfigService } from "../config/config.service";
import { MetricsService } from "../metrics/metrics.service";

interface UsernameEnumerationParams {
  ipAddress: string;
  correlationId?: string;
}

interface BruteForceParams {
  ipAddress: string;
  userIdentifier: string;
  success: boolean;
  correlationId?: string;
}

@Injectable()
export class VelocitySignalsService {
  private readonly logger = new Logger(VelocitySignalsService.name);

  constructor(
    private readonly rateLimiter: RateLimiterService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  async trackUsernameEnumeration(
    params: UsernameEnumerationParams,
  ): Promise<void> {
    const windowSeconds = Number(
      this.config.get("USERNAME_ENUMERATION_WINDOW_SECONDS") ?? 300,
    );
    const ipThreshold = Number(
      this.config.get("USERNAME_ENUMERATION_IP_THRESHOLD") ?? 30,
    );
    const globalThreshold = Number(
      this.config.get("USERNAME_ENUMERATION_GLOBAL_THRESHOLD") ?? 200,
    );

    const ipHash = this.hashIdentifier(params.ipAddress);

    const [ipWindow, globalWindow] = await Promise.all([
      this.rateLimiter.incrementWindowCounter(
        "username_enum_ip",
        ipHash,
        windowSeconds,
      ),
      this.rateLimiter.incrementWindowCounter(
        "username_enum_global",
        "global",
        windowSeconds,
      ),
    ]);

    if (ipWindow.count > ipThreshold) {
      this.metrics.incrementSuspiciousEvent(
        "username_enumeration_ip",
        ipWindow.count > ipThreshold * 1.5 ? "high" : "medium",
      );
      this.logger.warn("Username enumeration velocity threshold exceeded", {
        correlationId: params.correlationId,
        ipHash,
        windowSeconds,
        count: ipWindow.count,
      });
    }

    if (globalWindow.count > globalThreshold) {
      this.metrics.incrementSuspiciousEvent(
        "username_enumeration_global",
        globalWindow.count > globalThreshold * 1.5 ? "high" : "medium",
      );
      this.logger.warn("Global username enumeration surge detected", {
        correlationId: params.correlationId,
        windowSeconds,
        count: globalWindow.count,
      });
    }
  }

  async trackBruteForceAttempt(params: BruteForceParams): Promise<void> {
    const windowSeconds = Number(
      this.config.get("PASSWORD_BRUTE_FORCE_WINDOW_SECONDS") ?? 900,
    );
    const ipThreshold = Number(
      this.config.get("PASSWORD_BRUTE_FORCE_IP_THRESHOLD") ?? 50,
    );
    const userThreshold = Number(
      this.config.get("PASSWORD_BRUTE_FORCE_USER_THRESHOLD") ?? 10,
    );

    const ipHash = this.hashIdentifier(params.ipAddress);
    const userHash = this.hashIdentifier(params.userIdentifier.toLowerCase());

    const counters = await Promise.all([
      this.rateLimiter.incrementWindowCounter(
        "password_bruteforce_ip",
        ipHash,
        windowSeconds,
      ),
      this.rateLimiter.incrementWindowCounter(
        "password_bruteforce_user",
        userHash,
        windowSeconds,
      ),
    ]);

    const [ipWindow, userWindow] = counters;

    if (!params.success) {
      if (ipWindow.count > ipThreshold) {
        this.metrics.incrementSuspiciousEvent(
          "password_bruteforce_ip",
          ipWindow.count > ipThreshold * 1.5 ? "high" : "medium",
        );
        this.logger.warn("Brute force velocity exceeded for IP", {
          correlationId: params.correlationId,
          ipHash,
          windowSeconds,
          count: ipWindow.count,
        });
      }

      if (userWindow.count > userThreshold) {
        this.metrics.incrementSuspiciousEvent(
          "password_bruteforce_user",
          userWindow.count > userThreshold * 1.5 ? "high" : "medium",
        );
        this.logger.warn("Brute force velocity exceeded for user identifier", {
          correlationId: params.correlationId,
          userHash,
          windowSeconds,
          count: userWindow.count,
        });
      }
    }
  }

  private hashIdentifier(value: string): string {
    return createHash("sha256")
      .update(value ?? "unknown")
      .digest("hex");
  }
}
