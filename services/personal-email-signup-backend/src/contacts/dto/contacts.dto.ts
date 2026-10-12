import {
  IsString,
  IsEmail,
  IsPhoneNumber,
  IsEnum,
  IsBoolean,
  IsOptional,
  IsNumber,
  IsArray,
  ValidateNested,
  ArrayMaxSize,
  ArrayMinSize,
  Min,
  Max,
  IsDateString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Contact Import Data Transfer Objects
 * 
 * Defines the API contracts for contact upload, suggestions, and privacy controls.
 * All DTOs include comprehensive validation and OpenAPI documentation.
 */

export enum ContactIdentifierType {
  PHONE = 'phone',
  EMAIL = 'email',
}

export enum MatchType {
  MUTUAL = 'mutual',
  ONE_SIDED = 'one_sided',
  ALL = 'all',
}

export enum DeletionReason {
  PRIVACY_PREFERENCE = 'privacy_preference',
  TEMPORARY_PRIVACY = 'temporary_privacy',
  ACCOUNT_CLOSURE = 'account_closure',
  DATA_MINIMIZATION = 'data_minimization',
  OTHER = 'other',
}

/**
 * Contact Identifier DTO
 * Represents a single contact identifier (phone or email) for upload.
 */
export class ContactIdentifierDto {
  @ApiProperty({
    description: 'Contact identifier (phone number or email address)',
    example: '+1234567890',
    minLength: 3,
    maxLength: 320, // Max email length per RFC
  })
  @IsString()
  @Length(3, 320)
  identifier: string;

  @ApiProperty({
    description: 'Type of contact identifier',
    enum: ContactIdentifierType,
    example: ContactIdentifierType.PHONE,
  })
  @IsEnum(ContactIdentifierType)
  type: ContactIdentifierType;
}

/**
 * Contact Upload DTO
 * Request body for uploading contacts for friend discovery.
 */
export class ContactUploadDto {
  @ApiProperty({
    description: 'Array of contact identifiers to upload',
    type: [ContactIdentifierDto],
    example: [
      { identifier: '+1234567890', type: 'phone' },
      { identifier: 'friend@example.com', type: 'email' },
    ],
    minItems: 1,
    maxItems: 1000,
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one contact is required' })
  @ArrayMaxSize(1000, { message: 'Maximum 1000 contacts allowed per upload' })
  @ValidateNested({ each: true })
  @Type(() => ContactIdentifierDto)
  contacts: ContactIdentifierDto[];

  @ApiProperty({
    description: 'Acknowledgment that user understands privacy implications',
    example: true,
  })
  @IsBoolean()
  privacy_acknowledgment: boolean;

  @ApiProperty({
    description: 'Consent for data retention according to platform policy',
    example: true,
  })
  @IsBoolean()
  data_retention_consent: boolean;

  @ApiPropertyOptional({
    description: 'Optional user notes about the upload',
    example: 'Importing contacts from phone backup',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  notes?: string;
}

/**
 * Processing Summary DTO
 * Summary of contact upload processing results.
 */
export class ProcessingSummaryDto {
  @ApiProperty({
    description: 'Total number of contacts processed',
    example: 150,
  })
  total_processed: number;

  @ApiProperty({
    description: 'Number of contacts successfully matched',
    example: 142,
  })
  successfully_matched: number;

  @ApiProperty({
    description: 'Number of contacts that failed validation',
    example: 5,
  })
  validation_failures: number;

  @ApiProperty({
    description: 'Number of duplicate contacts found and deduplicated',
    example: 3,
  })
  duplicates_found: number;

  @ApiProperty({
    description: 'Breakdown of processing by identifier type',
    example: { phone: 80, email: 70 },
  })
  type_breakdown: Record<string, number>;
}

/**
 * Contact Suggestion DTO
 * Represents a single friend suggestion from contact matching.
 */
export class ContactSuggestionDto {
  @ApiProperty({
    description: 'Unique identifier for the suggested user',
    example: 'user_abc123',
  })
  user_id: string;

  @ApiProperty({
    description: 'Display name of the suggested user',
    example: 'John Smith',
  })
  display_name: string;

  @ApiPropertyOptional({
    description: 'Profile picture URL of the suggested user',
    example: 'https://cdn.example.com/avatars/user_abc123.jpg',
  })
  profile_picture_url?: string;

  @ApiProperty({
    description: 'Match type indicating mutual or one-sided discovery',
    enum: ['mutual', 'one_sided'],
    example: 'mutual',
  })
  match_type: 'mutual' | 'one_sided';

  @ApiProperty({
    description: 'Confidence score for the match (0.0 to 1.0)',
    example: 0.95,
    minimum: 0,
    maximum: 1,
  })
  confidence_score: number;

  @ApiProperty({
    description: 'Type of identifier that created the match',
    enum: ContactIdentifierType,
    example: ContactIdentifierType.PHONE,
  })
  match_source: ContactIdentifierType;

  @ApiProperty({
    description: 'Timestamp when the match was first discovered',
    example: '2024-01-15T10:30:00Z',
  })
  discovered_at: string;

  @ApiPropertyOptional({
    description: 'Number of mutual connections between users',
    example: 5,
  })
  mutual_connections?: number;

  @ApiPropertyOptional({
    description: 'Indicates if this user is currently active on the platform',
    example: true,
  })
  is_active?: boolean;

  @ApiProperty({
    description: 'Indicates if this suggestion can be acted upon (not blocked, etc.)',
    example: true,
  })
  is_actionable: boolean;
}

/**
 * Pagination DTO
 * Pagination metadata for suggestion responses.
 */
export class PaginationDto {
  @ApiProperty({
    description: 'Current page number (1-based)',
    example: 1,
  })
  page: number;

  @ApiProperty({
    description: 'Current offset within the full result set',
    example: 0,
  })
  offset: number;

  @ApiProperty({
    description: 'Number of items per page',
    example: 20,
  })
  limit: number;

  @ApiProperty({
    description: 'Total number of suggestions available',
    example: 87,
  })
  total: number;

  @ApiProperty({
    description: 'Total number of pages available',
    example: 5,
  })
  total_pages: number;

  @ApiProperty({
    description: 'Whether there are more pages available',
    example: true,
  })
  has_next: boolean;

  @ApiProperty({
    description: 'Whether additional records are available beyond this page',
    example: true,
  })
  has_more: boolean;

  @ApiProperty({
    description: 'Whether there are previous pages available',
    example: false,
  })
  has_previous: boolean;
}

/**
 * Contact Upload Response DTO
 * Response for successful contact upload with friend suggestions.
 */
export class ContactUploadResponseDto {
  @ApiProperty({
    description: 'Unique identifier for this upload batch',
    example: 'batch_abc123xyz',
  })
  upload_batch_id: string;

  @ApiProperty({
    description: 'Summary of contact processing results',
    type: ProcessingSummaryDto,
  })
  processing_summary: ProcessingSummaryDto;

  @ApiProperty({
    description: 'Array of friend suggestions based on uploaded contacts',
    type: [ContactSuggestionDto],
  })
  suggestions: ContactSuggestionDto[];

  @ApiPropertyOptional({
    description: 'Identifiers that failed validation during processing',
    type: [String],
    example: ['12345', 'abc'],
  })
  invalid_identifiers?: string[];

  @ApiProperty({
    description: 'Pagination information for suggestions',
    type: PaginationDto,
  })
  pagination: PaginationDto;

  @ApiProperty({
    description: 'Timestamp when the upload was processed',
    example: '2024-01-15T10:30:00Z',
  })
  processed_at: string;

  @ApiProperty({
    description: 'Data retention information',
    example: {
      retention_period_days: 90,
      expires_at: '2024-04-15T10:30:00Z',
      can_delete_anytime: true,
    },
  })
  retention_info: {
    retention_period_days: number;
    expires_at: string;
    can_delete_anytime: boolean;
  };

  @ApiProperty({
    description: 'Privacy controls and settings information',
    example: {
      discovery_enabled: true,
      mutual_discovery_only: false,
      can_opt_out: true,
    },
  })
  privacy_controls: {
    discovery_enabled: boolean;
    mutual_discovery_only: boolean;
    can_opt_out: boolean;
  };

  @ApiPropertyOptional({
    description: 'Security review metadata when anomaly detection triggers additional safeguards',
    example: {
      action: 'challenge',
      cooldown_seconds: 3600,
      signals: [
        { type: 'duplicate_ratio_high', severity: 'high', message: '92% duplicates detected' },
      ],
    },
  })
  security_review?: {
    action: 'allow' | 'monitor' | 'challenge' | 'block';
    cooldown_seconds?: number;
    signals: Array<{ type: string; severity: 'low' | 'medium' | 'high'; message: string }>;
  };
}

/**
 * Suggestion Query DTO
 * Query parameters for retrieving friend suggestions.
 */
export class SuggestionQueryDto {
  @ApiPropertyOptional({
    description: 'Filter suggestions by match type',
    enum: MatchType,
    example: MatchType.MUTUAL,
  })
  @IsOptional()
  @IsEnum(MatchType)
  match_type?: MatchType;

  @ApiPropertyOptional({
    description: 'Minimum confidence score for suggestions (0.0 to 1.0)',
    example: 0.7,
    minimum: 0,
    maximum: 1,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1)
  @Transform(({ value }) => parseFloat(value))
  min_confidence?: number;

  @ApiPropertyOptional({
    description: 'Page number for pagination (1-based)',
    example: 1,
    minimum: 1,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10))
  page?: number;

  @ApiPropertyOptional({
    description: 'Offset for pagination (overrides page when provided)',
    example: 0,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => parseInt(value, 10))
  offset?: number;

  @ApiPropertyOptional({
    description: 'Number of suggestions per page (max 50)',
    example: 20,
    minimum: 1,
    maximum: 50,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(50)
  @Transform(({ value }) => parseInt(value, 10))
  limit?: number;

  @ApiPropertyOptional({
    description: 'ISO timestamp to filter suggestions newer than this date',
    example: '2024-01-01T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  since?: string;

  @ApiPropertyOptional({
    description: 'Only include suggestions from active users',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  active_users_only?: boolean;
}

/**
 * Contact Suggestion Response DTO
 * Response for friend suggestion retrieval.
 */
export class ContactSuggestionResponseDto {
  @ApiProperty({
    description: 'Array of friend suggestions',
    type: [ContactSuggestionDto],
  })
  suggestions: ContactSuggestionDto[];

  @ApiProperty({
    description: 'Pagination information',
    type: PaginationDto,
  })
  pagination: PaginationDto;

  @ApiProperty({
    description: 'Timestamp when suggestions were generated',
    example: '2024-01-15T10:30:00Z',
  })
  generated_at: string;

  @ApiProperty({
    description: 'Cache information for client optimization',
    example: {
      cached: true,
      cache_expires_at: '2024-01-15T10:45:00Z',
      fresh_data_available_at: '2024-01-15T11:00:00Z',
    },
  })
  cache_info: {
    cached: boolean;
    cache_expires_at: string;
    fresh_data_available_at: string;
  };

  @ApiProperty({
    description: 'Summary statistics for all available suggestions',
    example: {
      total_mutual: 15,
      total_one_sided: 72,
      avg_confidence: 0.83,
      newest_match_age_hours: 2,
    },
  })
  summary_stats: {
    total_mutual: number;
    total_one_sided: number;
    avg_confidence: number;
    newest_match_age_hours: number;
  };
}

/**
 * Privacy Controls DTO
 * Request body for privacy control operations and data deletion.
 */
export class PrivacyControlsDto {
  @ApiProperty({
    description: 'Confirmation that user wants to delete contacts',
    example: true,
  })
  @IsBoolean()
  confirm_deletion: boolean;

  @ApiProperty({
    description: 'Whether to opt out of future contact-based discovery',
    example: true,
  })
  @IsBoolean()
  opt_out_of_discovery: boolean;

  @ApiPropertyOptional({
    description: 'Reason for deletion request',
    enum: DeletionReason,
    example: DeletionReason.PRIVACY_PREFERENCE,
  })
  @IsOptional()
  @IsEnum(DeletionReason)
  deletion_reason?: DeletionReason;

  @ApiPropertyOptional({
    description: 'Optional user feedback about the deletion',
    example: 'Want to maintain privacy while using the platform',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  feedback?: string;
}

/**
 * Deletion Summary DTO
 * Summary of contact deletion operation results.
 */
export class DeletionSummaryDto {
  @ApiProperty({
    description: 'Number of contact identifiers deleted',
    example: 150,
  })
  contacts_deleted: number;

  @ApiProperty({
    description: 'Number of suggestions cleared from discovery',
    example: 87,
  })
  suggestions_cleared: number;

  @ApiProperty({
    description: 'Number of mutual discoveries affected',
    example: 23,
  })
  mutual_discoveries_removed: number;

  @ApiProperty({
    description: 'Timestamp when deletion was completed',
    example: '2024-01-15T10:30:00Z',
  })
  completed_at: string;
}

/**
 * Privacy Settings DTO
 * Current privacy settings and discovery preferences.
 */
export class PrivacySettingsDto {
  @ApiProperty({
    description: 'Whether contact-based discovery is enabled',
    example: false,
  })
  discovery_enabled: boolean;

  @ApiProperty({
    description: 'Whether user has opted out of contact discovery',
    example: true,
  })
  discovery_opted_out: boolean;

  @ApiProperty({
    description: 'Whether to only allow mutual discoveries',
    example: false,
  })
  mutual_discovery_only: boolean;

  @ApiProperty({
    description: 'Timestamp when settings were last updated',
    example: '2024-01-15T10:30:00Z',
  })
  last_updated: string;
}

/**
 * Contact Deletion Response DTO
 * Response for successful contact deletion and privacy control updates.
 */
export class ContactDeletionResponseDto {
  @ApiProperty({
    description: 'Unique identifier for this deletion batch',
    example: 'deletion_abc123xyz',
  })
  deletion_batch_id: string;

  @ApiProperty({
    description: 'Summary of deletion operation results',
    type: DeletionSummaryDto,
  })
  deletion_summary: DeletionSummaryDto;

  @ApiProperty({
    description: 'Updated privacy settings after deletion',
    type: PrivacySettingsDto,
  })
  privacy_settings: PrivacySettingsDto;

  @ApiProperty({
    description: 'Information about data removal timeline',
    example: {
      immediate_removal: true,
      full_purge_within_days: 30,
      audit_retention_days: 2555, // 7 years for compliance
      can_re_enable: true,
    },
  })
  removal_info: {
    immediate_removal: boolean;
    full_purge_within_days: number;
    audit_retention_days: number;
    can_re_enable: boolean;
  };

  @ApiProperty({
    description: 'Compliance and legal information',
    example: {
      gdpr_compliant: true,
      ccpa_compliant: true,
      right_to_be_forgotten: true,
      data_portability_available: false,
    },
  })
  compliance_info: {
    gdpr_compliant: boolean;
    ccpa_compliant: boolean;
    right_to_be_forgotten: boolean;
    data_portability_available: boolean;
  };
}