import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "../config/config.service";
import { createHash } from "crypto";

export interface BreachCheckResult {
  isBreached: boolean;
  breachCount?: number;
  source?: string;
}

@Injectable()
export class PasswordBreachService {
  private readonly logger = new Logger(PasswordBreachService.name);
  private readonly cache = new Map<string, BreachCheckResult>();
  private readonly endpoint: string;

  constructor(private readonly configService: ConfigService) {
    const configured =
      (this.configService.get("BREACH_DETECTION_SERVICE_URL") as
        | string
        | undefined) ??
      process.env.HIBP_API_BASE_URL ??
      process.env.PWNED_PASSWORDS_URL;
    this.endpoint = configured
      ? configured.replace(/\/$/, "")
      : "https://api.pwnedpasswords.com";
  }

  /**
   * Check if a password has been found in known data breaches
   * Uses k-anonymity with HaveIBeenPwned API (first 5 chars of SHA-1 hash)
   */
  async checkPasswordBreach(password: string): Promise<BreachCheckResult> {
    try {
      // Create SHA-1 hash of the password
      const sha1Hash = createHash("sha1")
        .update(password)
        .digest("hex")
        .toUpperCase();
      const hashPrefix = sha1Hash.substring(0, 5);
      const hashSuffix = sha1Hash.substring(5);

      if (this.cache.has(sha1Hash)) {
        return this.cache.get(sha1Hash)!;
      }

      // Make request to HaveIBeenPwned API using k-anonymity
      const response = await fetch(`${this.endpoint}/range/${hashPrefix}`, {
        method: "GET",
        headers: {
          "User-Agent": "personal-email-signup-backend-security-check",
          "Add-Padding": "true", // Request padding for additional privacy
        },
        // Set timeout for the request
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        this.logger.error(
          `Breach check API returned ${response.status}: ${response.statusText}`,
        );
        // Fail open - if service is down, don't block registration
        return { isBreached: false };
      }

      const responseText = await response.text();
      const lines = responseText.split("\n");

      // Look for our hash suffix in the response
      for (const line of lines) {
        const [suffix, count] = line.trim().split(":");
        if (suffix === hashSuffix) {
          const breachCount = parseInt(count, 10);
          this.logger.warn(`Password found in ${breachCount} breaches`);
          const result = {
            isBreached: true,
            breachCount: breachCount,
            source: "haveibeenpwned",
          };
          this.cache.set(sha1Hash, result);
          return result;
        }
      }

      // Password not found in breaches
      const safeResult: BreachCheckResult = { isBreached: false };
      this.cache.set(sha1Hash, safeResult);
      return safeResult;
    } catch (error) {
      this.logger.error("Error checking password breach status:", error);
      // Fail open - don't block users if the service is unavailable
      return { isBreached: false };
    }
  }

  /**
   * Check against common weak passwords list (local check)
   */
  async checkCommonPasswords(password: string): Promise<BreachCheckResult> {
    // List of most common weak passwords
    const commonPasswords = new Set([
      "password",
      "123456",
      "123456789",
      "qwerty",
      "abc123",
      "password123",
      "admin",
      "letmein",
      "welcome",
      "monkey",
      "1234567890",
      "password1",
      "qwerty123",
      "123abc",
      "password!",
      "admin123",
      "root",
      "toor",
      "pass",
      "test",
      "guest",
      "user",
      "123123",
      "default",
      "changeme",
    ]);

    const lowerPassword = password.toLowerCase();
    const isCommon = commonPasswords.has(lowerPassword);

    if (isCommon) {
      this.logger.warn(
        `Common weak password detected: ${lowerPassword.substring(0, 3)}***`,
      );
      return {
        isBreached: true,
        breachCount: 999999, // High number to indicate very common
        source: "common_passwords",
      };
    }

    return { isBreached: false };
  }

  /**
   * Comprehensive password breach check combining multiple sources
   */
  async checkPassword(password: string): Promise<BreachCheckResult> {
    // First check against common passwords (fast local check)
    const commonCheck = await this.checkCommonPasswords(password);
    if (commonCheck.isBreached) {
      return commonCheck;
    }

    // Then check against breach databases (external API)
    return this.checkPasswordBreach(password);
  }
}
