import { Injectable } from "@nestjs/common";
import { configSchema, Config } from "./config.schema";

@Injectable()
export class ConfigService {
  private config: Config;

  constructor() {
    this.config = this.validateConfig();
  }

  private validateConfig(): Config {
    try {
      const config = configSchema.parse({
        // Parse environment variables with proper type coercion
        MIN_DECLARED_AGE: parseInt(process.env.MIN_DECLARED_AGE || "13", 10),
        REQUIRE_TERMS_ENFORCE_MODE:
          (process.env.REQUIRE_TERMS_ENFORCE_MODE as
            | "off"
            | "warn"
            | "enforce") || "off",
        ACTIVE_POLICY_VERSION:
          process.env.ACTIVE_POLICY_VERSION || "v2025-10-07-1",
        REQUIRE_USERNAME_NORMALIZATION:
          process.env.REQUIRE_USERNAME_NORMALIZATION === "true",
        REQUIRE_USERNAME_DENYLIST:
          process.env.REQUIRE_USERNAME_DENYLIST === "true",
        USERNAME_CHANGE_WINDOW_SECONDS: parseInt(
          process.env.USERNAME_CHANGE_WINDOW_SECONDS || "86400",
          10,
        ),
        DATABASE_URL: process.env.DATABASE_URL,
        JWT_SECRET: process.env.JWT_SECRET,
        JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "1h",
        REDIS_URL: process.env.REDIS_URL,
        CONTACT_HASH_MODE:
          (process.env.CONTACT_HASH_MODE as "sha256-v1" | "hmac-sha256-v2") ||
          "sha256-v1",
        CONTACT_HMAC_KEY: process.env.CONTACT_HMAC_KEY,
        RATE_LIMIT_TTL: parseInt(process.env.RATE_LIMIT_TTL || "60", 10),
        RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX || "10", 10),
        RATE_LIMIT_GLOBAL_LIMIT: parseInt(
          process.env.RATE_LIMIT_GLOBAL_LIMIT || "1000",
          10,
        ),
        RATE_LIMIT_GLOBAL_TTL: parseInt(
          process.env.RATE_LIMIT_GLOBAL_TTL || "60",
          10,
        ),
        RATE_LIMIT_GLOBAL_BLOCK_SECONDS: parseInt(
          process.env.RATE_LIMIT_GLOBAL_BLOCK_SECONDS || "120",
          10,
        ),
        RATE_LIMIT_IP_LIMIT: parseInt(
          process.env.RATE_LIMIT_IP_LIMIT || "60",
          10,
        ),
        RATE_LIMIT_DEVICE_LIMIT: parseInt(
          process.env.RATE_LIMIT_DEVICE_LIMIT || "20",
          10,
        ),
        RATE_LIMIT_USER_LIMIT: parseInt(
          process.env.RATE_LIMIT_USER_LIMIT || "100",
          10,
        ),
        RATE_LIMIT_IP_TTL: parseInt(
          process.env.RATE_LIMIT_IP_TTL || "3600",
          10,
        ),
        RATE_LIMIT_DEVICE_TTL: parseInt(
          process.env.RATE_LIMIT_DEVICE_TTL || "3600",
          10,
        ),
        RATE_LIMIT_USER_TTL: parseInt(
          process.env.RATE_LIMIT_USER_TTL || "3600",
          10,
        ),
        PASSWORD_MIN_LENGTH: parseInt(
          process.env.PASSWORD_MIN_LENGTH || "8",
          10,
        ),
        PASSWORD_REQUIRE_UPPERCASE:
          process.env.PASSWORD_REQUIRE_UPPERCASE !== "false",
        PASSWORD_REQUIRE_LOWERCASE:
          process.env.PASSWORD_REQUIRE_LOWERCASE !== "false",
        PASSWORD_REQUIRE_NUMBERS:
          process.env.PASSWORD_REQUIRE_NUMBERS !== "false",
        PASSWORD_REQUIRE_SYMBOLS:
          process.env.PASSWORD_REQUIRE_SYMBOLS === "true",
        NODE_ENV:
          (process.env.NODE_ENV as "development" | "production" | "test") ||
          "development",
        PORT: parseInt(process.env.PORT || "3000", 10),
        LOG_LEVEL:
          (process.env.LOG_LEVEL as "debug" | "info" | "warn" | "error") ||
          "info",
        OTP_EXPIRES_IN: parseInt(process.env.OTP_EXPIRES_IN || "300", 10),
        OTP_LENGTH: parseInt(process.env.OTP_LENGTH || "6", 10),
        CORS_ORIGIN: process.env.CORS_ORIGIN || "*",
        COOKIE_SECRET: process.env.COOKIE_SECRET,
        CSP_DEFAULT_SRC: process.env.CSP_DEFAULT_SRC || "'self'",
        CSP_SCRIPT_SRC: process.env.CSP_SCRIPT_SRC || "'self'",
        CSP_STYLE_SRC: process.env.CSP_STYLE_SRC || "'self' 'unsafe-inline'",
        CSP_IMG_SRC: process.env.CSP_IMG_SRC || "'self' data:",
        CSP_CONNECT_SRC: process.env.CSP_CONNECT_SRC || "'self'",
        CSP_FONT_SRC: process.env.CSP_FONT_SRC || "'self' data:",
        CSP_FRAME_ANCESTORS: process.env.CSP_FRAME_ANCESTORS || "'none'",
        EMAIL_SERVICE_URL: process.env.EMAIL_SERVICE_URL,
        EMAIL_DELIVERY_ENABLED: process.env.EMAIL_DELIVERY_ENABLED === "true",
        EMAIL_PROVIDER:
          (process.env.EMAIL_PROVIDER as "smtp" | "test") || "smtp",
        EMAIL_FROM: process.env.EMAIL_FROM || "no-reply@example.invalid",
        EMAIL_SMTP_HOST: process.env.EMAIL_SMTP_HOST,
        EMAIL_SMTP_PORT: process.env.EMAIL_SMTP_PORT
          ? parseInt(process.env.EMAIL_SMTP_PORT, 10)
          : undefined,
        EMAIL_SMTP_SECURE: process.env.EMAIL_SMTP_SECURE !== "false",
        EMAIL_SMTP_USER: process.env.EMAIL_SMTP_USER,
        EMAIL_SMTP_PASSWORD: process.env.EMAIL_SMTP_PASSWORD,
        EMAIL_SMTP_TIMEOUT_MS: parseInt(
          process.env.EMAIL_SMTP_TIMEOUT_MS || "10000",
          10,
        ),
        EMAIL_VERIFY_BASE_URL: process.env.EMAIL_VERIFY_BASE_URL,
        PASSWORD_RESET_BASE_URL: process.env.PASSWORD_RESET_BASE_URL,
        CANONICAL_RECOVERY_ENABLED:
          process.env.CANONICAL_RECOVERY_ENABLED === "true",
        RECOVERY_TOKEN_TTL_SECONDS: parseInt(
          process.env.RECOVERY_TOKEN_TTL_SECONDS || "900",
          10,
        ),
        RECOVERY_RATE_LIMIT: parseInt(
          process.env.RECOVERY_RATE_LIMIT || "3",
          10,
        ),
        RECOVERY_RATE_WINDOW_SECONDS: parseInt(
          process.env.RECOVERY_RATE_WINDOW_SECONDS || "3600",
          10,
        ),
        BREACH_DETECTION_SERVICE_URL: process.env.BREACH_DETECTION_SERVICE_URL,
        GOOGLE_OIDC_ENABLED: process.env.GOOGLE_OIDC_ENABLED === "true",
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
        GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
        GOOGLE_OIDC_STATE_TTL_SECONDS: parseInt(
          process.env.GOOGLE_OIDC_STATE_TTL_SECONDS || "600",
          10,
        ),
        APPLE_OIDC_ENABLED: process.env.APPLE_OIDC_ENABLED === "true",
        APPLE_CLIENT_ID: process.env.APPLE_CLIENT_ID,
        APPLE_TEAM_ID: process.env.APPLE_TEAM_ID,
        APPLE_KEY_ID: process.env.APPLE_KEY_ID,
        APPLE_PRIVATE_KEY: process.env.APPLE_PRIVATE_KEY,
        APPLE_PRIVATE_KEY_FILE: process.env.APPLE_PRIVATE_KEY_FILE,
        APPLE_REDIRECT_URI: process.env.APPLE_REDIRECT_URI,
        APPLE_OIDC_STATE_TTL_SECONDS: parseInt(
          process.env.APPLE_OIDC_STATE_TTL_SECONDS || "600",
          10,
        ),
        RATE_LIMIT_IP_BLOCK_SECONDS: parseInt(
          process.env.RATE_LIMIT_IP_BLOCK_SECONDS || "300",
          10,
        ),
        RATE_LIMIT_DEVICE_BLOCK_SECONDS: parseInt(
          process.env.RATE_LIMIT_DEVICE_BLOCK_SECONDS || "300",
          10,
        ),
        RATE_LIMIT_USER_BLOCK_SECONDS: parseInt(
          process.env.RATE_LIMIT_USER_BLOCK_SECONDS || "300",
          10,
        ),
        USERNAME_ENUMERATION_WINDOW_SECONDS: parseInt(
          process.env.USERNAME_ENUMERATION_WINDOW_SECONDS || "300",
          10,
        ),
        USERNAME_ENUMERATION_IP_THRESHOLD: parseInt(
          process.env.USERNAME_ENUMERATION_IP_THRESHOLD || "30",
          10,
        ),
        USERNAME_ENUMERATION_GLOBAL_THRESHOLD: parseInt(
          process.env.USERNAME_ENUMERATION_GLOBAL_THRESHOLD || "200",
          10,
        ),
        PASSWORD_BRUTE_FORCE_WINDOW_SECONDS: parseInt(
          process.env.PASSWORD_BRUTE_FORCE_WINDOW_SECONDS || "900",
          10,
        ),
        PASSWORD_BRUTE_FORCE_IP_THRESHOLD: parseInt(
          process.env.PASSWORD_BRUTE_FORCE_IP_THRESHOLD || "50",
          10,
        ),
        PASSWORD_BRUTE_FORCE_USER_THRESHOLD: parseInt(
          process.env.PASSWORD_BRUTE_FORCE_USER_THRESHOLD || "10",
          10,
        ),
      });
      if (config.APPLE_OIDC_ENABLED) {
        const missing = [
          ["APPLE_CLIENT_ID", config.APPLE_CLIENT_ID],
          ["APPLE_TEAM_ID", config.APPLE_TEAM_ID],
          ["APPLE_KEY_ID", config.APPLE_KEY_ID],
          ["APPLE_REDIRECT_URI", config.APPLE_REDIRECT_URI],
          [
            "APPLE_PRIVATE_KEY or APPLE_PRIVATE_KEY_FILE",
            config.APPLE_PRIVATE_KEY || config.APPLE_PRIVATE_KEY_FILE,
          ],
        ]
          .filter(([, value]) => !value)
          .map(([name]) => name);
        if (missing.length > 0) {
          throw new Error(
            `Apple authentication is enabled but configuration is missing: ${missing.join(", ")}`,
          );
        }
      }
      return config;
    } catch (error) {
      throw new Error(`Invalid configuration: ${error}`);
    }
  }

  get<K extends keyof Config>(key: K): Config[K] {
    return this.config[key];
  }

  getAll(): Config {
    return this.config;
  }
}
