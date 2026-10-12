import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AcceptTermsDto {
  @ApiProperty({
    description: 'Terms and privacy policy version to accept',
    example: 'v2025-10-08-1',
    pattern: '^v[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]+$'
  })
  @IsNotEmpty()
  @IsString()
  @Matches(/^v[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]+$/, {
    message: 'terms_version must follow semantic versioning format: vYYYY-MM-DD-N'
  })
  terms_version: string;
}

export class TermsAcceptanceResponse {
  @ApiProperty({
    description: 'Success message confirming terms acceptance',
    example: 'Terms acceptance recorded successfully'
  })
  message: string;

  @ApiProperty({
    description: 'Version of terms that was accepted',
    example: 'v2025-10-08-1'
  })
  accepted_version: string;

  @ApiProperty({
    description: 'Timestamp when acceptance was recorded',
    example: '2025-10-08T14:30:00.000Z'
  })
  accepted_at: Date;

  @ApiProperty({
    description: 'Correlation ID for audit trail',
    example: 'req_abc123xyz789'
  })
  correlation_id: string;
}