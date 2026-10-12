import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * UploadContactsDto
 *
 * Describes the payload accepted by POST /contacts/upload.
 * Each phone number undergoes a lightweight syntactic check prior to
 * normalization and hashing in the service layer.
 */
export class UploadContactsDto {
  @ApiProperty({
    description: 'List of phone numbers to normalize and hash',
    type: [String],
    minItems: 1,
    maxItems: 500,
    example: ['+14155551234', '+442071838750'],
  })
  @IsArray({ message: 'phones must be provided as an array' })
  @ArrayMinSize(1, { message: 'at least one phone number is required' })
  @ArrayMaxSize(500, { message: 'no more than 500 phone numbers per upload' })
  @IsString({ each: true, message: 'each phone number must be a string value' })
  @Matches(/^[+0-9()\-.\s]{4,32}$/u, {
    each: true,
    message: 'each phone number must resemble a valid international phone number',
  })
  phones!: string[];

  @ApiPropertyOptional({
    description: 'Opaque identifier supplied by the client for idempotency or auditing',
    example: 'client-batch-2025-10-17-01',
  })
  @IsOptional()
  @IsString()
  client_batch_id?: string;
}

/**
 * SuggestedUserSummaryDto
 *
 * Compact representation of a suggested user returned to the client.
 */
export class SuggestedUserSummaryDto {
  @ApiProperty({ description: 'Unique identifier of the suggested user', example: 'a7f0d9d0-0f01-4e0d-a45f-9faae6be7d4e' })
  @IsString()
  id!: string;

  @ApiProperty({ description: 'Display name for the suggested user', example: 'Jordan Nguyen' })
  @IsString()
  display_name!: string;

  @ApiPropertyOptional({ description: 'Profile image URL for the suggested user', example: 'https://cdn.example.com/avatars/a7f0d9d0.png' })
  @IsOptional()
  @IsString()
  profile_image_url?: string | null;
}

/**
 * SuggestionDto
 *
 * Represents a single friend suggestion derived from the upload.
 */
export class SuggestionDto {
  @ApiProperty({ description: 'Suggested user summary' })
  @ValidateNested()
  @Type(() => SuggestedUserSummaryDto)
  suggested_user!: SuggestedUserSummaryDto;

  @ApiProperty({ description: 'Match classification', enum: ['mutual', 'one_sided'], example: 'mutual' })
  @IsString()
  match_type!: 'mutual' | 'one_sided';

  @ApiProperty({ description: 'Confidence score in the suggestion', minimum: 0, maximum: 1, example: 0.84 })
  match_strength!: number;

  @ApiProperty({ description: 'ISO-8601 timestamp when this suggestion was generated', example: '2025-10-17T08:30:15.000Z' })
  @IsString()
  created_at!: string;

  @ApiProperty({ description: 'Indicates whether the user has seen this suggestion before', example: true })
  is_new!: boolean;
}

/**
 * UploadContactsMetadataDto
 *
 * Aggregated statistics describing the outcome of the upload.
 */
export class UploadContactsMetadataDto {
  @ApiProperty({ description: 'Total phone numbers supplied by the client', example: 42 })
  total_uploaded!: number;

  @ApiProperty({ description: 'Count of phone numbers discarded as duplicates', example: 5 })
  duplicates_skipped!: number;

  @ApiProperty({ description: 'Count of phone numbers rejected during validation', example: 3 })
  invalid_phones!: number;

  @ApiProperty({ description: 'Count of new hashes persisted for this upload', example: 34 })
  new_hashes_stored!: number;

  @ApiProperty({ description: 'Number of suggestions generated for the caller', example: 12 })
  suggestions_generated!: number;
}

export class UploadSecuritySignalDto {
  @ApiProperty({ description: 'Unique identifier for the detected signal', example: 'duplicate_ratio_high' })
  @IsString()
  type!: string;

  @ApiProperty({ description: 'Severity classification for the signal', enum: ['low', 'medium', 'high'], example: 'medium' })
  @IsString()
  @IsIn(['low', 'medium', 'high'])
  severity!: 'low' | 'medium' | 'high';

  @ApiProperty({ description: 'Human-readable description of the signal', example: '85% of supplied contacts were duplicates' })
  @IsString()
  message!: string;
}

export class UploadSecurityReviewDto {
  @ApiProperty({ description: 'Recommended action for the caller', enum: ['allow', 'monitor', 'challenge', 'block'], example: 'challenge' })
  @IsString()
  @IsIn(['allow', 'monitor', 'challenge', 'block'])
  action!: 'allow' | 'monitor' | 'challenge' | 'block';

  @ApiProperty({ description: 'Signals that triggered the security review', type: [UploadSecuritySignalDto] })
  @ValidateNested({ each: true })
  @Type(() => UploadSecuritySignalDto)
  signals!: UploadSecuritySignalDto[];

  @ApiPropertyOptional({ description: 'Optional cooldown period suggested for the caller before retrying', example: 3600 })
  @IsOptional()
  cooldown_seconds?: number;
}

/**
 * UploadContactErrorDto
 *
 * Optional per-phone errors returned when the platform elects to expose
 * detailed feedback. Each entry references the user supplied input.
 */
export class UploadContactErrorDto {
  @ApiProperty({ description: 'Original phone string supplied by the client', example: '12345' })
  phone!: string;

  @ApiProperty({ description: 'Reason the phone number was rejected', example: 'Invalid international format' })
  reason!: string;
}

/**
 * UploadContactsResponseDto
 *
 * Canonical response envelope for POST /contacts/upload.
 */
export class UploadContactsResponseDto {
  @ApiProperty({ description: 'Indicates whether the upload succeeded', example: true })
  success!: boolean;

  @ApiProperty({ description: 'Top suggestions derived from the upload', type: [SuggestionDto] })
  suggestions!: SuggestionDto[];

  @ApiPropertyOptional({ description: 'Cursor to request the next page of suggestions, when available', example: 'page=2&limit=20' })
  @IsOptional()
  @IsString()
  next_cursor?: string;

  @ApiProperty({ description: 'Operational metadata for the upload', type: UploadContactsMetadataDto })
  @ValidateNested()
  @Type(() => UploadContactsMetadataDto)
  metadata!: UploadContactsMetadataDto;

  @ApiPropertyOptional({ description: 'Detailed errors for rejected phones', type: [UploadContactErrorDto] })
  @ValidateNested({ each: true })
  @Type(() => UploadContactErrorDto)
  @IsOptional()
  errors?: UploadContactErrorDto[];

  @ApiPropertyOptional({ description: 'Security review details when the upload triggers anomaly detection', type: UploadSecurityReviewDto })
  @ValidateNested()
  @Type(() => UploadSecurityReviewDto)
  @IsOptional()
  security_review?: UploadSecurityReviewDto;

  @ApiProperty({ description: 'Correlation identifier echoed back to the client', example: 'req-3f2a6d8f-4d20-4c8e-b83f-9c02b82a2c6d' })
  correlation_id!: string;
}
