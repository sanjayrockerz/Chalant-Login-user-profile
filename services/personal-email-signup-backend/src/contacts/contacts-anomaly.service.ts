import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "../config/config.service";
import { MetricsService } from "../metrics/metrics.service";
import { RateLimiterService } from "../rate_limiter/rate_limiter.service";
import { ContactUploadDto } from "./dto/contacts.dto";
import { NormalizationResult, RequestContext } from "./contacts.types";

export interface AnomalySignal {
  type: string;
  severity: "low" | "medium" | "high";
  message: string;
}

export interface AnomalyAssessment {
  action: "allow" | "monitor" | "challenge" | "block";
  signals: AnomalySignal[];
  cooldownSeconds?: number;
}

interface AssessmentParams {
  userIdHash: string;
  ipHash: string;
  deviceIdHash: string;
  uploadDto: ContactUploadDto;
  normalization: NormalizationResult;
  context: RequestContext;
  duplicateCount: number;
  newHashes: number;
  processingTimeMs: number;
}

@Injectable()
export class ContactsAnomalyService {
  private readonly logger = new Logger(ContactsAnomalyService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  async assess(params: AssessmentParams): Promise<AnomalyAssessment> {
    const signals: AnomalySignal[] = [];
    const contactCount = params.uploadDto.contacts.length;
    const duplicateRatio =
      contactCount > 0 ? params.duplicateCount / contactCount : 0;
    const invalidRatio =
      contactCount > 0
        ? params.normalization.invalidIdentifiers.length / contactCount
        : 0;
    const sequentialRatio = this.calculateSequentialRatio(params.normalization);
    const testNumberHits = this.countTestNumbers(params.normalization);
    const newHashesStored = params.newHashes;

    this.evaluateDuplicateRatio(signals, duplicateRatio);
    this.evaluateInvalidRatio(signals, invalidRatio);
    this.evaluateSequentialRatio(signals, sequentialRatio);
    this.evaluateTestData(signals, testNumberHits);

    if (contactCount > 0 && newHashesStored === 0) {
      signals.push({
        type: "no_new_hashes",
        severity: "medium",
        message: "Upload produced no new contact hashes",
      });
    }

    const velocitySignal = await this.evaluateVelocity(signals, params);
    if (velocitySignal?.cooldownSeconds) {
      signals.push({
        type: velocitySignal.signal.type,
        severity: velocitySignal.signal.severity,
        message: velocitySignal.signal.message,
      });
    }

    const action = this.resolveAction(signals);
    let cooldownSeconds: number | undefined = velocitySignal?.cooldownSeconds;

    if (action === "block" && !cooldownSeconds) {
      cooldownSeconds = this.resolveNumberConfig(
        "CONTACTS_ANOMALY_VELOCITY_WINDOW_SECONDS",
        300,
      );
    }

    if (signals.length > 0) {
      signals.forEach((signal) =>
        this.metrics.incrementSuspiciousEvent(signal.type, signal.severity),
      );
      this.logger.warn("contacts.upload:anomaly_signals", {
        correlationId: params.context.correlationId,
        tenantId: params.context.tenantId,
        signals,
        action,
        cooldownSeconds,
        ipHash: params.ipHash,
        userIdHash: params.userIdHash,
        deviceIdHash: params.deviceIdHash,
      });
    }

    return { action, signals, cooldownSeconds };
  }

  private evaluateDuplicateRatio(
    signals: AnomalySignal[],
    ratio: number,
  ): void {
    const warnThreshold = this.resolveNumberConfig(
      "CONTACTS_ANOMALY_DUPLICATE_RATIO_WARN",
      0.5,
    );
    const blockThreshold = this.resolveNumberConfig(
      "CONTACTS_ANOMALY_DUPLICATE_RATIO_BLOCK",
      0.9,
    );

    if (ratio >= blockThreshold) {
      signals.push({
        type: "duplicate_ratio_high",
        severity: "high",
        message: `Duplicate ratio ${Math.round(ratio * 100)}% exceeds block threshold`,
      });
      return;
    }

    if (ratio >= warnThreshold) {
      signals.push({
        type: "duplicate_ratio_elevated",
        severity: "medium",
        message: `Duplicate ratio ${Math.round(ratio * 100)}% exceeds warning threshold`,
      });
    }
  }

  private evaluateInvalidRatio(signals: AnomalySignal[], ratio: number): void {
    const warnThreshold = this.resolveNumberConfig(
      "CONTACTS_ANOMALY_INVALID_RATIO_WARN",
      0.4,
    );
    const blockThreshold = this.resolveNumberConfig(
      "CONTACTS_ANOMALY_INVALID_RATIO_BLOCK",
      0.75,
    );

    if (ratio >= blockThreshold) {
      signals.push({
        type: "invalid_ratio_high",
        severity: "high",
        message: `Invalid ratio ${Math.round(ratio * 100)}% exceeds block threshold`,
      });
      return;
    }

    if (ratio >= warnThreshold) {
      signals.push({
        type: "invalid_ratio_elevated",
        severity: "medium",
        message: `Invalid ratio ${Math.round(ratio * 100)}% exceeds warning threshold`,
      });
    }
  }

  private evaluateSequentialRatio(
    signals: AnomalySignal[],
    ratio: number,
  ): void {
    const warnThreshold = this.resolveNumberConfig(
      "CONTACTS_ANOMALY_SEQUENTIAL_RATIO_WARN",
      0.35,
    );
    const blockThreshold = this.resolveNumberConfig(
      "CONTACTS_ANOMALY_SEQUENTIAL_RATIO_BLOCK",
      0.6,
    );

    if (ratio >= blockThreshold) {
      signals.push({
        type: "sequential_pattern_high",
        severity: "high",
        message: `Sequential pattern ratio ${Math.round(ratio * 100)}% exceeds block threshold`,
      });
      return;
    }

    if (ratio >= warnThreshold) {
      signals.push({
        type: "sequential_pattern_elevated",
        severity: "medium",
        message: `Sequential pattern ratio ${Math.round(ratio * 100)}% exceeds warning threshold`,
      });
    }
  }

  private evaluateTestData(signals: AnomalySignal[], hits: number): void {
    const threshold = this.resolveNumberConfig(
      "CONTACTS_ANOMALY_TEST_NUMBER_THRESHOLD",
      5,
    );
    if (hits >= threshold && hits < threshold * 2) {
      signals.push({
        type: "test_number_detected",
        severity: "medium",
        message: `${hits} test or placeholder numbers detected`,
      });
    } else if (hits >= threshold * 2) {
      signals.push({
        type: "test_number_mass",
        severity: "high",
        message: `${hits} test or placeholder numbers detected`,
      });
    }
  }

  private async evaluateVelocity(
    signals: AnomalySignal[],
    params: AssessmentParams,
  ) {
    const windowSeconds = this.resolveNumberConfig(
      "CONTACTS_ANOMALY_VELOCITY_WINDOW_SECONDS",
      300,
    );
    const userThreshold = this.resolveNumberConfig(
      "CONTACTS_ANOMALY_USER_VELOCITY_THRESHOLD",
      6,
    );
    const ipThreshold = this.resolveNumberConfig(
      "CONTACTS_ANOMALY_IP_VELOCITY_THRESHOLD",
      12,
    );

    const [{ count: userCount }, { count: ipCount }] = await Promise.all([
      this.rateLimiter.incrementWindowCounter(
        "contacts_upload_user_velocity",
        params.userIdHash,
        windowSeconds,
      ),
      this.rateLimiter.incrementWindowCounter(
        "contacts_upload_ip_velocity",
        params.ipHash,
        windowSeconds,
      ),
    ]);

    let cooldownSeconds: number | undefined;
    if (userCount > userThreshold) {
      signals.push({
        type: "user_velocity_exceeded",
        severity: userCount > userThreshold * 2 ? "high" : "medium",
        message: `User performed ${userCount} uploads within ${windowSeconds}s window`,
      });
      cooldownSeconds = windowSeconds;
    }

    if (ipCount > ipThreshold) {
      signals.push({
        type: "ip_velocity_exceeded",
        severity: ipCount > ipThreshold * 2 ? "high" : "medium",
        message: `IP observed ${ipCount} uploads within ${windowSeconds}s window`,
      });
      cooldownSeconds = Math.max(cooldownSeconds ?? 0, windowSeconds);
    }

    if (cooldownSeconds) {
      return {
        signal: {
          type: "velocity_window",
          severity: "medium",
          message: "Upload velocity exceeds baseline expectations",
        },
        cooldownSeconds,
      } as const;
    }

    return undefined;
  }

  private resolveAction(signals: AnomalySignal[]): AnomalyAssessment["action"] {
    let action: AnomalyAssessment["action"] = "allow";
    for (const signal of signals) {
      if (signal.severity === "high") {
        action = "block";
        break;
      }

      if (signal.severity === "medium") {
        if (action === "allow" || action === "monitor") {
          action = "challenge";
        }
        continue;
      }

      if (signal.severity === "low" && action === "allow") {
        action = "monitor";
      }
    }

    return action;
  }

  private calculateSequentialRatio(normalization: NormalizationResult): number {
    if (normalization.uniqueContacts.length === 0) {
      return 0;
    }

    const sequentialMatches = normalization.uniqueContacts.filter((contact) => {
      const digits = contact.normalizedValue.replace(/\D/g, "");
      if (digits.length < 6) {
        return false;
      }

      const ascending = this.isMonotonicSequence(digits);
      const repeated = new Set(digits).size <= 2;
      return ascending || repeated;
    });

    return sequentialMatches.length / normalization.uniqueContacts.length;
  }

  private isMonotonicSequence(digits: string): boolean {
    let increasing = true;
    for (let i = 1; i < digits.length; i++) {
      const prev = Number(digits[i - 1]);
      const curr = Number(digits[i]);
      if ((curr - prev + 10) % 10 !== 1) {
        increasing = false;
        break;
      }
    }
    return increasing;
  }

  private countTestNumbers(normalization: NormalizationResult): number {
    const patterns = [/^12345/, /^555/, /^000+$/, /^999+$/, /^888+$/];
    return normalization.uniqueContacts.filter((contact) => {
      const digits = contact.normalizedValue.replace(/\D/g, "");
      if (digits.length < 6) {
        return false;
      }
      return patterns.some((pattern) => pattern.test(digits));
    }).length;
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
}
