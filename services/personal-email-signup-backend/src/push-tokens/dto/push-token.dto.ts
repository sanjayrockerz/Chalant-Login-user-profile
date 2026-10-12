import {
  IsString,
  IsEnum,
  IsOptional,
  IsObject,
  IsBoolean,
  IsUUID,
  IsInt,
  Min,
  Max,
  Matches,
  ValidateNested,
  IsDateString,
} from "class-validator";
import { Transform, Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * Enum definitions for push notification system
 */
export enum PushPlatform {
  IOS = "ios",
  ANDROID = "android",
}

export enum PushTokenType {
  FCM = "fcm",
  APNS = "apns",
}

/**
 * Device metadata structure for enhanced targeting and analytics
 */
export class DeviceMetadataDto {
  @ApiPropertyOptional({
    description: "Device model identifier",
    example: "iPhone14,2",
  })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({
    description: "Operating system version",
    example: "16.4.1",
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d+\.\d+(\.\d+)?$/, {
    message: "OS version must be in format X.Y or X.Y.Z",
  })
  osVersion?: string;

  @ApiPropertyOptional({
    description: "Application version",
    example: "2.1.0",
  })
  @IsOptional()
  @IsString()
  appVersion?: string;

  @ApiPropertyOptional({
    description: "Stable device identifier for analytics",
    example: "A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
  })
  @IsOptional()
  @IsString()
  deviceId?: string;

  @ApiPropertyOptional({
    description: "Device locale for localized notifications",
    example: "en-US",
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z]{2}-[A-Z]{2}$/, {
    message: "Locale must be in format xx-XX (e.g., en-US)",
  })
  locale?: string;

  @ApiPropertyOptional({
    description: "Timezone identifier",
    example: "America/New_York",
  })
  @IsOptional()
  @IsString()
  timezone?: string;
}

/**
 * DTO for registering a new push notification token
 */
export class RegisterPushTokenDto {
  @ApiProperty({
    description: "Push notification token from FCM or APNs",
    example: "fGhIjKlMnOpQrStUvWxYz1234567890aBcDeFgHiJkLmNoPqRsTuVwXyZ",
  })
  @IsString()
  @Transform(({ value }) => value?.trim())
  // FCM tokens are typically 152+ characters, APNs tokens are 64 hex characters
  @Matches(/^[A-Za-z0-9_-]{32,4096}$/, {
    message:
      "Token must be 32-4096 characters containing only alphanumeric, underscore, and dash characters",
  })
  token: string;

  @ApiProperty({
    description: "Target platform for notifications",
    enum: PushPlatform,
    example: PushPlatform.IOS,
  })
  @IsEnum(PushPlatform, {
    message: "Platform must be either ios or android",
  })
  platform: PushPlatform;

  @ApiProperty({
    description: "Type of push token",
    enum: PushTokenType,
    example: PushTokenType.APNS,
  })
  @IsEnum(PushTokenType, {
    message: "Token type must be either fcm or apns",
  })
  tokenType: PushTokenType;

  @ApiPropertyOptional({
    description: "Device metadata for enhanced targeting",
    type: DeviceMetadataDto,
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => DeviceMetadataDto)
  deviceMetadata?: DeviceMetadataDto;

  @ApiPropertyOptional({
    description: "Whether this token should be set as the primary device",
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean = false;

  /**
   * Custom validation to ensure platform and token type compatibility
   */
  static validatePlatformTokenType(
    platform: PushPlatform,
    tokenType: PushTokenType,
  ): boolean {
    return (
      (platform === PushPlatform.IOS && tokenType === PushTokenType.APNS) ||
      (platform === PushPlatform.ANDROID && tokenType === PushTokenType.FCM)
    );
  }
}

/**
 * DTO for updating an existing push token
 */
export class UpdatePushTokenDto {
  @ApiPropertyOptional({
    description: "Updated push notification token",
    example: "fGhIjKlMnOpQrStUvWxYz1234567890aBcDeFgHiJkLmNoPqRsTuVwXyZ",
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => value?.trim())
  @Matches(/^[A-Za-z0-9_-]{32,4096}$/, {
    message:
      "Token must be 32-4096 characters containing only alphanumeric, underscore, and dash characters",
  })
  token?: string;

  @ApiPropertyOptional({
    description: "Updated device metadata",
    type: DeviceMetadataDto,
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => DeviceMetadataDto)
  deviceMetadata?: DeviceMetadataDto;

  @ApiPropertyOptional({
    description: "Whether this token should be set as active",
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    description: "Whether this token should be set as the primary device",
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

/**
 * Query parameters for listing push tokens
 */
export class ListPushTokensQueryDto {
  @ApiPropertyOptional({
    description: "Filter by platform",
    enum: PushPlatform,
  })
  @IsOptional()
  @IsEnum(PushPlatform)
  platform?: PushPlatform;

  @ApiPropertyOptional({
    description: "Filter by active status",
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === "true" || value === true) return true;
    if (value === "false" || value === false) return false;
    return value;
  })
  active?: boolean = true;

  @ApiPropertyOptional({
    description: "Include tokens with failures",
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === "true" || value === true) return true;
    if (value === "false" || value === false) return false;
    return value;
  })
  includeFailures?: boolean = false;

  @ApiPropertyOptional({
    description: "Page number for pagination",
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => parseInt(value))
  page?: number = 1;

  @ApiPropertyOptional({
    description: "Items per page",
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => parseInt(value))
  limit?: number = 20;
}

/**
 * Response DTO for push token operations
 */
export class PushTokenResponseDto {
  @ApiProperty({
    description: "Token unique identifier",
    example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  })
  @IsUUID()
  id: string;

  @ApiProperty({
    description: "User identifier",
    example: "b2c3d4e5-f6a7-8901-bcde-f23456789012",
  })
  @IsUUID()
  userId: string;

  @ApiProperty({
    description: "Masked token for security (shows only last 8 characters)",
    example: "***...wxyz1234",
  })
  @IsString()
  maskedToken: string;

  @ApiProperty({
    description: "Target platform",
    enum: PushPlatform,
  })
  @IsEnum(PushPlatform)
  platform: PushPlatform;

  @ApiProperty({
    description: "Token type",
    enum: PushTokenType,
  })
  @IsEnum(PushTokenType)
  tokenType: PushTokenType;

  @ApiPropertyOptional({
    description: "Device metadata",
    type: DeviceMetadataDto,
  })
  @IsOptional()
  @IsObject()
  deviceMetadata?: DeviceMetadataDto;

  @ApiProperty({
    description: "Token registration timestamp",
    example: "2024-01-15T10:30:00Z",
  })
  @IsDateString()
  createdAt: string;

  @ApiProperty({
    description: "Last update timestamp",
    example: "2024-01-15T14:22:00Z",
  })
  @IsDateString()
  updatedAt: string;

  @ApiProperty({
    description: "Last validation timestamp",
    example: "2024-01-15T14:22:00Z",
  })
  @IsDateString()
  lastValidatedAt: string;

  @ApiPropertyOptional({
    description: "Last usage timestamp",
    example: "2024-01-15T14:22:00Z",
  })
  @IsOptional()
  @IsDateString()
  lastUsedAt?: string;

  @ApiProperty({
    description: "Token active status",
  })
  @IsBoolean()
  active: boolean;

  @ApiProperty({
    description: "Number of consecutive failures",
  })
  @IsInt()
  @Min(0)
  failureCount: number;

  @ApiPropertyOptional({
    description: "Last failure timestamp if any",
    example: "2024-01-15T12:15:00Z",
  })
  @IsOptional()
  @IsDateString()
  lastFailureAt?: string;

  @ApiPropertyOptional({
    description: "Reason for last failure if any",
    example: "InvalidRegistration",
  })
  @IsOptional()
  @IsString()
  failureReason?: string;

  @ApiProperty({
    description: "Tenant identifier",
  })
  @IsString()
  tenantId: string;
}

/**
 * Paginated response for listing push tokens
 */
export class PaginatedPushTokensResponseDto {
  @ApiProperty({
    description: "Array of push tokens",
    type: [PushTokenResponseDto],
  })
  @ValidateNested({ each: true })
  @Type(() => PushTokenResponseDto)
  tokens: PushTokenResponseDto[];

  @ApiProperty({
    description: "Pagination metadata",
  })
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

/**
 * DTO for bulk token operations
 */
export class BulkTokenOperationDto {
  @ApiProperty({
    description: "Array of token IDs to operate on",
    example: ["a1b2c3d4-e5f6-7890-abcd-ef1234567890"],
  })
  @IsUUID("4", { each: true })
  tokenIds: string[];

  @ApiProperty({
    description: "Operation to perform",
    enum: ["activate", "deactivate", "delete", "validate"],
  })
  @IsEnum(["activate", "deactivate", "delete", "validate"])
  operation: "activate" | "deactivate" | "delete" | "validate";

  @ApiPropertyOptional({
    description: "Reason for the operation",
    example: "User requested account cleanup",
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

/**
 * Response for bulk operations
 */
export class BulkOperationResultDto {
  @ApiProperty({
    description: "Number of tokens successfully processed",
  })
  @IsInt()
  @Min(0)
  successCount: number;

  @ApiProperty({
    description: "Number of tokens that failed processing",
  })
  @IsInt()
  @Min(0)
  failureCount: number;

  @ApiProperty({
    description: "Array of token IDs that were successfully processed",
  })
  @IsUUID("4", { each: true })
  successfulTokens: string[];

  @ApiProperty({
    description: "Array of failed operations with reasons",
  })
  failedOperations: Array<{
    tokenId: string;
    reason: string;
  }>;

  @ApiProperty({
    description: "Total processing time in milliseconds",
  })
  @IsInt()
  @Min(0)
  processingTimeMs: number;
}

/**
 * DTO for token validation results
 */
export class TokenValidationResultDto {
  @ApiProperty({
    description: "Token ID that was validated",
    example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  })
  @IsUUID()
  tokenId: string;

  @ApiProperty({
    description: "Validation result",
    enum: ["valid", "invalid", "expired", "unregistered", "error"],
  })
  @IsEnum(["valid", "invalid", "expired", "unregistered", "error"])
  result: "valid" | "invalid" | "expired" | "unregistered" | "error";

  @ApiPropertyOptional({
    description: "Platform-specific response code",
  })
  @IsOptional()
  @IsInt()
  responseCode?: number;

  @ApiPropertyOptional({
    description: "Validation error message if any",
  })
  @IsOptional()
  @IsString()
  message?: string;

  @ApiProperty({
    description: "Validation timestamp",
  })
  @IsDateString()
  validatedAt: string;
}

/**
 * Health check response for push token system
 */
export class PushTokenHealthDto {
  @ApiProperty({
    description: "Total number of active tokens",
  })
  @IsInt()
  @Min(0)
  totalActiveTokens: number;

  @ApiProperty({
    description: "Number of tokens by platform",
  })
  tokensByPlatform: {
    ios: number;
    android: number;
  };

  @ApiProperty({
    description: "Number of tokens with recent failures",
  })
  @IsInt()
  @Min(0)
  tokensWithFailures: number;

  @ApiProperty({
    description: "Number of tokens needing validation",
  })
  @IsInt()
  @Min(0)
  staleTokens: number;

  @ApiProperty({
    description: "Average failure count across all tokens",
  })
  @IsInt()
  @Min(0)
  avgFailureCount: number;

  @ApiProperty({
    description: "System health status",
  })
  @IsEnum(["healthy", "degraded", "unhealthy"])
  status: "healthy" | "degraded" | "unhealthy";

  @ApiProperty({
    description: "Health check timestamp",
  })
  @IsDateString()
  checkedAt: string;
}
