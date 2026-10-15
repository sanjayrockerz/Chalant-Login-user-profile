import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { ConfigService } from "../config/config.service";
import { UserService } from "../user/user.service";
import { MetricsService } from "../metrics/metrics.service";
import { CanonicalPolicyService } from "../policies/canonical-policy.service";
import {
  AcceptTermsDto,
  TermsAcceptanceResponse,
} from "./dto/accept-terms.dto";

export interface TermsValidationResult {
  isValid: boolean;
  currentVersion: string;
  userVersion?: string | null;
  requiresAcceptance: boolean;
}

@Injectable()
export class TermsService {
  private readonly logger = new Logger(TermsService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly userService: UserService,
    private readonly canonicalPolicy: CanonicalPolicyService,
    private readonly metricsService?: MetricsService,
  ) {}

  /**
   * Get the current active policy version from configuration
   */
  getActivePolicyVersion(): string {
    return this.configService.get("ACTIVE_POLICY_VERSION") || "v2025-10-08-1";
  }

  /**
   * Check if terms acceptance is currently enforced
   */
  isTermsEnforcementEnabled(): boolean {
    const mode = this.configService.get("REQUIRE_TERMS_ENFORCE_MODE") || "off";
    return mode === "enforce";
  }

  /**
   * Validate user's terms status against current policy
   */
  async validateUserTermsStatus(
    userId: string,
  ): Promise<TermsValidationResult> {
    const currentVersion = this.getActivePolicyVersion();

    const user = await this.userService.findById(userId);

    if (!user) {
      throw new BadRequestException("User not found");
    }

    const userVersion = user.termsVersion;
    const requiresAcceptance = !userVersion || userVersion !== currentVersion;

    return {
      isValid: !requiresAcceptance,
      currentVersion,
      userVersion,
      requiresAcceptance,
    };
  }

  /**
   * Record terms acceptance for a user (idempotent)
   */
  async acceptTerms(
    userId: string,
    acceptTermsDto: AcceptTermsDto,
    correlationId: string,
  ): Promise<TermsAcceptanceResponse> {
    const start = Date.now();
    const currentVersion = this.getActivePolicyVersion();

    // Validate the requested version matches current policy
    if (acceptTermsDto.terms_version !== currentVersion) {
      // Increment invalid version metric
      try {
        this.metricsService?.errorsTotal.inc({ type: "invalid_terms_version" });
      } catch {
        // Ignore metrics failures
      }

      throw new BadRequestException({
        error: "INVALID_TERMS_VERSION",
        message: `Invalid terms version. Current active version is ${currentVersion}`,
        provided_version: acceptTermsDto.terms_version,
        required_version: currentVersion,
        correlation_id: correlationId,
      });
    }

    const result = await this.canonicalPolicy.accept(userId, {
      policyVersion: currentVersion,
    });
    const acceptedAt = result.acceptedAt;

    // Update metrics
    try {
      this.metricsService?.termsAcceptedTotal.inc({ version: currentVersion });
      this.metricsService?.termsAcceptanceLatency.observe(
        (Date.now() - start) / 1000,
      );
    } catch {
      // Ignore metrics failures
    }

    this.logger.log(`Terms acceptance recorded for user`, {
      correlationId,
      userId: userId.toString(),
      version: currentVersion,
      acceptedAt: acceptedAt.toISOString(),
    });

    return {
      message: "Terms acceptance recorded successfully",
      accepted_version: currentVersion,
      accepted_at: acceptedAt,
      correlation_id: correlationId,
    };
  }

  /**
   * Validate terms version for registration
   */
  validateRegistrationTerms(termsVersion?: string): {
    valid: boolean;
    error?: any;
  } {
    if (!this.isTermsEnforcementEnabled()) {
      return { valid: true };
    }

    const currentVersion = this.getActivePolicyVersion();

    if (!termsVersion) {
      return {
        valid: false,
        error: {
          error: "TERMS_ACCEPTANCE_REQUIRED",
          message: `Terms acceptance required. Current policy version: ${currentVersion}`,
          required_version: currentVersion,
        },
      };
    }

    if (termsVersion !== currentVersion) {
      return {
        valid: false,
        error: {
          error: "INVALID_TERMS_VERSION",
          message: `Invalid terms version. Current active version is ${currentVersion}`,
          provided_version: termsVersion,
          required_version: currentVersion,
        },
      };
    }

    return { valid: true };
  }
}
