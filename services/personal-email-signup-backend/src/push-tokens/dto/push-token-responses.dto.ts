import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsString,
  IsNumber,
  IsOptional,
  IsUUID,
  IsDateString,
} from "class-validator";

/**
 * Standard API response wrapper for push token operations
 */
export class ApiResponseDto<T = any> {
  @ApiProperty({
    description: "Indicates if the operation was successful",
  })
  success: boolean;

  @ApiProperty({
    description: "Human-readable message describing the result",
  })
  message: string;

  @ApiPropertyOptional({
    description: "Response data (varies by endpoint)",
  })
  data?: T;

  @ApiPropertyOptional({
    description: "Error details if operation failed",
  })
  error?: {
    code: string;
    message: string;
    details?: any;
  };

  @ApiProperty({
    description: "Request correlation ID for tracing",
  })
  correlationId: string;

  @ApiProperty({
    description: "Response timestamp",
  })
  timestamp: string;
}

/**
 * Error response for push token operations
 */
export class PushTokenErrorResponseDto {
  @ApiProperty({
    description: "Error code",
    example: "INVALID_TOKEN_FORMAT",
  })
  @IsString()
  code: string;

  @ApiProperty({
    description: "Error message",
    example:
      "The provided token does not match the required format for FCM tokens",
  })
  @IsString()
  message: string;

  @ApiPropertyOptional({
    description: "Additional error details",
  })
  @IsOptional()
  details?: {
    field?: string;
    value?: string;
    expectedFormat?: string;
    validationErrors?: string[];
  };

  @ApiProperty({
    description: "Error timestamp",
  })
  @IsDateString()
  timestamp: string;

  @ApiProperty({
    description: "Request correlation ID",
  })
  @IsString()
  correlationId: string;
}

/**
 * Token registration response with created token details
 */
export class TokenRegistrationResponseDto {
  @ApiProperty({
    description: "Registration success indicator",
  })
  success: boolean = true;

  @ApiProperty({
    description: "Registration result message",
  })
  message: string = "Token registered successfully";

  @ApiProperty({
    description: "Created token details",
  })
  data: {
    tokenId: string;
    maskedToken: string;
    platform: string;
    isNewToken: boolean;
    isExistingTokenUpdated: boolean;
    deviceCount: number; // Total devices for this user
  };

  @ApiProperty({
    description: "Request correlation ID for tracing",
  })
  correlationId: string;

  @ApiProperty({
    description: "Response timestamp",
  })
  timestamp: string;
}

/**
 * Token validation summary for monitoring and health checks
 */
export class TokenValidationSummaryDto {
  @ApiProperty({
    description: "Total tokens validated in this batch",
  })
  @IsNumber()
  totalValidated: number;

  @ApiProperty({
    description: "Number of valid tokens",
  })
  @IsNumber()
  validTokens: number;

  @ApiProperty({
    description: "Number of invalid tokens",
  })
  @IsNumber()
  invalidTokens: number;

  @ApiProperty({
    description: "Number of expired tokens",
  })
  @IsNumber()
  expiredTokens: number;

  @ApiProperty({
    description: "Number of unregistered tokens",
  })
  @IsNumber()
  unregisteredTokens: number;

  @ApiProperty({
    description: "Validation processing time in milliseconds",
  })
  @IsNumber()
  processingTimeMs: number;

  @ApiProperty({
    description: "Validation timestamp",
  })
  @IsDateString()
  validatedAt: string;

  @ApiProperty({
    description: "Validation correlation ID",
  })
  @IsString()
  correlationId: string;
}

/**
 * User's push notification preferences (for future enhancement)
 */
export class PushNotificationPreferencesDto {
  @ApiProperty({
    description: "User ID",
  })
  @IsUUID()
  userId: string;

  @ApiProperty({
    description: "Whether push notifications are enabled",
  })
  enabled: boolean;

  @ApiPropertyOptional({
    description: "Preferred notification types",
  })
  @IsOptional()
  notificationTypes?: {
    alerts: boolean;
    badges: boolean;
    sounds: boolean;
    critical: boolean;
  };

  @ApiPropertyOptional({
    description: "Quiet hours configuration",
  })
  @IsOptional()
  quietHours?: {
    enabled: boolean;
    startTime: string; // HH:MM format
    endTime: string; // HH:MM format
    timezone: string;
  };

  @ApiPropertyOptional({
    description: "Category-specific preferences",
  })
  @IsOptional()
  categories?: {
    [categoryName: string]: {
      enabled: boolean;
      priority: "low" | "normal" | "high";
    };
  };

  @ApiProperty({
    description: "Last updated timestamp",
  })
  @IsDateString()
  updatedAt: string;
}

/**
 * Push notification delivery statistics
 */
export class DeliveryStatsDto {
  @ApiProperty({
    description: "Time period for these statistics",
  })
  period: {
    start: string;
    end: string;
    duration: string; // e.g., "24h", "7d", "30d"
  };

  @ApiProperty({
    description: "Overall delivery statistics",
  })
  overall: {
    totalSent: number;
    totalDelivered: number;
    totalFailed: number;
    deliveryRate: number; // percentage
    avgDeliveryTime: number; // milliseconds
  };

  @ApiProperty({
    description: "Statistics by platform",
  })
  byPlatform: {
    ios: {
      sent: number;
      delivered: number;
      failed: number;
      deliveryRate: number;
    };
    android: {
      sent: number;
      delivered: number;
      failed: number;
      deliveryRate: number;
    };
  };

  @ApiProperty({
    description: "Common failure reasons and counts",
  })
  failureReasons: Array<{
    reason: string;
    count: number;
    percentage: number;
  }>;

  @ApiProperty({
    description: "Statistics generation timestamp",
  })
  @IsDateString()
  generatedAt: string;
}

/**
 * Token cleanup operation result
 */
export class TokenCleanupResultDto {
  @ApiProperty({
    description: "Number of tokens marked for cleanup",
  })
  @IsNumber()
  markedForCleanup: number;

  @ApiProperty({
    description: "Number of tokens actually deleted",
  })
  @IsNumber()
  deleted: number;

  @ApiProperty({
    description: "Number of tokens deactivated",
  })
  @IsNumber()
  deactivated: number;

  @ApiProperty({
    description: "Cleanup criteria used",
  })
  criteria: {
    maxFailureCount: number;
    failureWindowDays: number;
    inactivityDays: number;
  };

  @ApiProperty({
    description: "Cleanup processing time in milliseconds",
  })
  @IsNumber()
  processingTimeMs: number;

  @ApiProperty({
    description: "Cleanup operation timestamp",
  })
  @IsDateString()
  executedAt: string;

  @ApiProperty({
    description: "Operation correlation ID",
  })
  @IsString()
  correlationId: string;
}

/**
 * Token migration result (for platform updates)
 */
export class TokenMigrationResultDto {
  @ApiProperty({
    description: "Migration operation ID",
  })
  @IsUUID()
  migrationId: string;

  @ApiProperty({
    description: "Migration type",
  })
  migrationType: "format_update" | "platform_change" | "encryption_update";

  @ApiProperty({
    description: "Number of tokens processed",
  })
  @IsNumber()
  tokensProcessed: number;

  @ApiProperty({
    description: "Number of successful migrations",
  })
  @IsNumber()
  successfulMigrations: number;

  @ApiProperty({
    description: "Number of failed migrations",
  })
  @IsNumber()
  failedMigrations: number;

  @ApiProperty({
    description: "Migration failures with details",
  })
  failures: Array<{
    tokenId: string;
    reason: string;
    originalValue?: string;
  }>;

  @ApiProperty({
    description: "Migration processing time in milliseconds",
  })
  @IsNumber()
  processingTimeMs: number;

  @ApiProperty({
    description: "Migration execution timestamp",
  })
  @IsDateString()
  executedAt: string;

  @ApiProperty({
    description: "Migration correlation ID",
  })
  @IsString()
  correlationId: string;
}

/**
 * System-wide push token metrics for monitoring
 */
export class SystemMetricsDto {
  @ApiProperty({
    description: "Total active tokens across all tenants",
  })
  @IsNumber()
  totalActiveTokens: number;

  @ApiProperty({
    description: "Active tokens by platform",
  })
  tokensByPlatform: {
    ios: number;
    android: number;
  };

  @ApiProperty({
    description: "Active tokens by tenant",
  })
  tokensByTenant: Array<{
    tenantId: string;
    count: number;
    percentage: number;
  }>;

  @ApiProperty({
    description: "Token health indicators",
  })
  healthIndicators: {
    healthyTokens: number;
    tokensWithFailures: number;
    staleTokens: number;
    averageFailureRate: number;
  };

  @ApiProperty({
    description: "Recent activity metrics",
  })
  recentActivity: {
    newRegistrations24h: number;
    validations24h: number;
    deliveries24h: number;
    failures24h: number;
  };

  @ApiProperty({
    description: "Database performance metrics",
  })
  performance: {
    avgQueryTime: number;
    cacheHitRate: number;
    activeConnections: number;
  };

  @ApiProperty({
    description: "Metrics collection timestamp",
  })
  @IsDateString()
  collectedAt: string;
}
