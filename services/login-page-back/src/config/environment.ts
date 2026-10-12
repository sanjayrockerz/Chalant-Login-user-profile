import { z } from 'zod';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Environment variable schema validation
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3000'),
  
  // Database configuration
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.string().transform(Number).default('5432'),
  DB_NAME: z.string().default('auth_system'),
  DB_USER: z.string().default('auth_user'),
  DB_PASSWORD: z.string().min(8),
  DB_SSL: z.string().transform(val => val === 'true').default('false'),
  DB_POOL_MIN: z.string().transform(Number).default('2'),
  DB_POOL_MAX: z.string().transform(Number).default('20'),
  
  // Redis configuration
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_TLS: z.string().transform(val => val === 'true').default('false'),
  
  // JWT configuration
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('1h'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  JWT_ISSUER: z.string().default('auth-system'),
  JWT_AUDIENCE: z.string().default('auth-system-users'),
  
  // MFA configuration
  MFA_ISSUER: z.string().default('Enterprise Auth System'),
  MFA_WINDOW: z.string().transform(Number).default('2'),
  MFA_STEP: z.string().transform(Number).default('30'),
  
  // AWS configuration
  AWS_REGION: z.string().default('us-east-1'),
  AWS_KMS_KEY_ARN: z.string().optional(),
  AWS_SECRETS_MANAGER_ARN: z.string().optional(),
  
  // Security configuration
  BCRYPT_ROUNDS: z.string().transform(Number).default('12'),
  RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default('900000'), // 15 minutes
  RATE_LIMIT_MAX_ATTEMPTS: z.string().transform(Number).default('5'),
  SESSION_TIMEOUT_MINUTES: z.string().transform(Number).default('60'),
  
  // Monitoring configuration
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  METRICS_PORT: z.string().transform(Number).default('9090'),
  HEALTH_CHECK_PORT: z.string().transform(Number).default('8080'),
  
  // Email configuration (DEPRECATED - notifications disabled)
  // SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, FROM_EMAIL removed
  // These values are no longer used in runtime
  
  // App configuration
  APP_NAME: z.string().default('Auth System'),
  APP_VERSION: z.string().default('1.0.0'),
  FRONTEND_URL: z.string().default('http://localhost:3000'),
  BACKEND_URL: z.string().default('http://localhost:8000'),
  
  // CORS configuration
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3001')
  ,
  // Feature flags
  LEGACY_READ_FALLBACK_ENABLED: z.string().transform(val => val === 'true').default('true'),
  DISABLE_NOTIFICATIONS: z.string().transform(val => val === 'true').default('true'),
  DISABLE_BLOCKCHAIN_ANCHORING: z.string().transform(val => val === 'true').default('true')
});

// Validate environment variables
const env = envSchema.parse(process.env);

// Configuration object
export const config = {
  environment: env.NODE_ENV,
  
  app: {
    name: env.APP_NAME,
    version: env.APP_VERSION,
    frontendUrl: env.FRONTEND_URL,
    backendUrl: env.BACKEND_URL
  },
  
  server: {
    port: env.PORT,
    host: '0.0.0.0'
  },
  
  database: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    ssl: env.DB_SSL,
    pool: {
      min: env.DB_POOL_MIN,
      max: env.DB_POOL_MAX
    }
  },
  
  redis: {
    url: env.REDIS_URL,
    password: env.REDIS_PASSWORD,
    tls: env.REDIS_TLS
  },
  
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'your-super-secret-access-key-change-in-production',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'your-super-secret-refresh-key-change-in-production',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '1h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    algorithm: 'HS256' as const,
    issuer: process.env.JWT_ISSUER || 'auth-system',
    audience: process.env.JWT_AUDIENCE || 'auth-system-users'
  },
  
  mfa: {
    issuer: env.MFA_ISSUER,
    window: env.MFA_WINDOW,
    step: env.MFA_STEP
  },
  
  aws: {
    region: env.AWS_REGION,
    kmsKeyArn: env.AWS_KMS_KEY_ARN,
    secretsManagerArn: env.AWS_SECRETS_MANAGER_ARN
  },
  
  security: {
    bcryptRounds: env.BCRYPT_ROUNDS,
    rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
    rateLimitMaxAttempts: env.RATE_LIMIT_MAX_ATTEMPTS,
    sessionTimeoutMinutes: env.SESSION_TIMEOUT_MINUTES
  },
  
  monitoring: {
    logLevel: env.LOG_LEVEL,
    metricsPort: env.METRICS_PORT,
    healthCheckPort: env.HEALTH_CHECK_PORT
  },
  
  // Email configuration removed - notifications disabled
  // SMTP and email config no longer available in runtime
  
  cors: {
    allowedOrigins: env.NODE_ENV === 'production' 
      ? env.CORS_ORIGINS.split(',').map(origin => origin.trim())
      : env.CORS_ORIGINS.split(',').map(origin => origin.trim())
  }
  ,
  featureFlags: {
    legacyReadFallbackEnabled: env.LEGACY_READ_FALLBACK_ENABLED,
    disableNotifications: env.DISABLE_NOTIFICATIONS,
    disableBlockchainAnchoring: env.DISABLE_BLOCKCHAIN_ANCHORING
  }
};

// Validation helper
export function validateConfig(): void {
  const requiredSecrets = [
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'DB_PASSWORD'
  ];
  
  const missingSecrets = requiredSecrets.filter(secret => 
    !process.env[secret] || process.env[secret].includes('change_me')
  );
  
  if (missingSecrets.length > 0) {
    throw new Error(`Missing or invalid configuration: ${missingSecrets.join(', ')}`);
  }
  
  // Additional validation for production
  if (env.NODE_ENV === 'production') {
    if (!env.AWS_KMS_KEY_ARN) {
      throw new Error('AWS_KMS_KEY_ARN is required in production');
    }
    
    // Email configuration removed - notifications disabled
    // No longer validating SMTP_HOST or FROM_EMAIL
  }
}

// Export types
export type Config = typeof config;
export type Environment = typeof env.NODE_ENV;
