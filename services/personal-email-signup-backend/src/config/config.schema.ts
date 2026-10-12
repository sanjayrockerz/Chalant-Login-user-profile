import { z } from "zod";

export const configSchema = z.object({
  // Age validation
  MIN_DECLARED_AGE: z.number().default(13),

  // Terms enforcement
  REQUIRE_TERMS_ENFORCE_MODE: z.enum(["off", "warn", "enforce"]).default("off"),
  ACTIVE_POLICY_VERSION: z.string().default("v2025-10-07-1"),

  // Username validation
  REQUIRE_USERNAME_NORMALIZATION: z.boolean().default(true),
  REQUIRE_USERNAME_DENYLIST: z.boolean().default(true),
  USERNAME_CHANGE_WINDOW_SECONDS: z.number().default(86400),

  // Database
  DATABASE_URL: z.string(),

  // JWT
  JWT_SECRET: z.string(),
  JWT_EXPIRES_IN: z.string().default("1h"),

  // Redis
  REDIS_URL: z.string(),

  // Contact hashing. Legacy mode remains the default until a controlled
  // re-upload/re-index migration has been approved.
  CONTACT_HASH_MODE: z
    .enum(["sha256-v1", "hmac-sha256-v2"])
    .default("sha256-v1"),
  CONTACT_HMAC_KEY: z.string().optional(),

  // Rate limiting
  RATE_LIMIT_TTL: z.number().default(60),
  RATE_LIMIT_MAX: z.number().default(10),
  RATE_LIMIT_GLOBAL_LIMIT: z.number().default(1000),
  RATE_LIMIT_GLOBAL_TTL: z.number().default(60),
  RATE_LIMIT_GLOBAL_BLOCK_SECONDS: z.number().default(120),
  RATE_LIMIT_IP_LIMIT: z.number().default(60),
  RATE_LIMIT_DEVICE_LIMIT: z.number().default(20),
  RATE_LIMIT_USER_LIMIT: z.number().default(100),
  RATE_LIMIT_IP_TTL: z.number().default(3600),
  RATE_LIMIT_DEVICE_TTL: z.number().default(3600),
  RATE_LIMIT_USER_TTL: z.number().default(3600),
  RATE_LIMIT_IP_BLOCK_SECONDS: z.number().default(300),
  RATE_LIMIT_DEVICE_BLOCK_SECONDS: z.number().default(300),
  RATE_LIMIT_USER_BLOCK_SECONDS: z.number().default(300),

  // Contacts anomaly detection thresholds
  CONTACTS_ANOMALY_DUPLICATE_RATIO_WARN: z.number().default(0.5),
  CONTACTS_ANOMALY_DUPLICATE_RATIO_BLOCK: z.number().default(0.9),
  CONTACTS_ANOMALY_INVALID_RATIO_WARN: z.number().default(0.4),
  CONTACTS_ANOMALY_INVALID_RATIO_BLOCK: z.number().default(0.75),
  CONTACTS_ANOMALY_SEQUENTIAL_RATIO_WARN: z.number().default(0.35),
  CONTACTS_ANOMALY_SEQUENTIAL_RATIO_BLOCK: z.number().default(0.6),
  CONTACTS_ANOMALY_TEST_NUMBER_THRESHOLD: z.number().default(5),
  CONTACTS_ANOMALY_VELOCITY_WINDOW_SECONDS: z.number().default(300),
  CONTACTS_ANOMALY_USER_VELOCITY_THRESHOLD: z.number().default(6),
  CONTACTS_ANOMALY_IP_VELOCITY_THRESHOLD: z.number().default(12),

  // High velocity detection thresholds
  USERNAME_ENUMERATION_WINDOW_SECONDS: z.number().default(300),
  USERNAME_ENUMERATION_IP_THRESHOLD: z.number().default(30),
  USERNAME_ENUMERATION_GLOBAL_THRESHOLD: z.number().default(200),
  PASSWORD_BRUTE_FORCE_WINDOW_SECONDS: z.number().default(900),
  PASSWORD_BRUTE_FORCE_IP_THRESHOLD: z.number().default(50),
  PASSWORD_BRUTE_FORCE_USER_THRESHOLD: z.number().default(10),

  // Password policy
  PASSWORD_MIN_LENGTH: z.number().default(8),
  PASSWORD_REQUIRE_UPPERCASE: z.boolean().default(true),
  PASSWORD_REQUIRE_LOWERCASE: z.boolean().default(true),
  PASSWORD_REQUIRE_NUMBERS: z.boolean().default(true),
  PASSWORD_REQUIRE_SYMBOLS: z.boolean().default(false),

  // Environment
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.number().default(3000),

  // Logging
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // OTP
  OTP_EXPIRES_IN: z.number().default(300),
  OTP_LENGTH: z.number().default(6),

  // Security
  CORS_ORIGIN: z.string().default("*"),
  COOKIE_SECRET: z.string(),
  CSP_DEFAULT_SRC: z.string().default("'self'"),
  CSP_SCRIPT_SRC: z.string().default("'self'"),
  CSP_STYLE_SRC: z.string().default("'self' 'unsafe-inline'"),
  CSP_IMG_SRC: z.string().default("'self' data:"),
  CSP_CONNECT_SRC: z.string().default("'self'"),
  CSP_FONT_SRC: z.string().default("'self' data:"),
  CSP_FRAME_ANCESTORS: z.string().default("'none'"),

  // External APIs
  EMAIL_SERVICE_URL: z.string().optional(),
  EMAIL_DELIVERY_ENABLED: z.boolean().default(false),
  EMAIL_PROVIDER: z.enum(["smtp", "test"]).default("smtp"),
  EMAIL_FROM: z.string().email().default("no-reply@example.invalid"),
  EMAIL_SMTP_HOST: z.string().optional(),
  EMAIL_SMTP_PORT: z.number().int().positive().optional(),
  EMAIL_SMTP_SECURE: z.boolean().default(true),
  EMAIL_SMTP_USER: z.string().optional(),
  EMAIL_SMTP_PASSWORD: z.string().optional(),
  EMAIL_SMTP_TIMEOUT_MS: z.number().int().positive().default(10000),
  EMAIL_VERIFY_BASE_URL: z.string().url().optional(),
  PASSWORD_RESET_BASE_URL: z.string().url().optional(),
  CANONICAL_RECOVERY_ENABLED: z.boolean().default(false),
  RECOVERY_TOKEN_TTL_SECONDS: z.number().int().positive().default(900),
  RECOVERY_RATE_LIMIT: z.number().int().positive().default(3),
  RECOVERY_RATE_WINDOW_SECONDS: z.number().int().positive().default(3600),
  BREACH_DETECTION_SERVICE_URL: z.string().optional(),

  // Optional Google OpenID Connect sign-in. Missing values keep the provider disabled.
  GOOGLE_OIDC_ENABLED: z.boolean().default(false),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  GOOGLE_OIDC_STATE_TTL_SECONDS: z.number().int().positive().default(600),

  // Optional Apple web authentication. Required values are checked when enabled.
  APPLE_OIDC_ENABLED: z.boolean().default(false),
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_TEAM_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_PRIVATE_KEY: z.string().optional(),
  APPLE_PRIVATE_KEY_FILE: z.string().optional(),
  APPLE_REDIRECT_URI: z.string().url().optional(),
  APPLE_OIDC_STATE_TTL_SECONDS: z.number().int().positive().default(600),
});

export type Config = z.infer<typeof configSchema>;
