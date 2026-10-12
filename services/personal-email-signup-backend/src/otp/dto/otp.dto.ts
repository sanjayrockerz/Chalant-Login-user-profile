import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, Length, Matches } from 'class-validator';

export class RequestOtpDto {
  @ApiProperty({
    description: 'Email address to send OTP to',
    example: 'john.doe@example.com',
    format: 'email',
    type: 'string'
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;
}

export class VerifyOtpDto {
  @ApiProperty({
    description: 'Email address the OTP was sent to',
    example: 'john.doe@example.com',
    format: 'email',
    type: 'string'
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;

  @ApiProperty({
    description: '4-digit verification code',
    example: '1234',
    minLength: 4,
    maxLength: 4,
    pattern: '^[0-9]{4}$',
    type: 'string'
  })
  @IsNotEmpty({ message: 'Verification code is required' })
  @Length(4, 4, { message: 'Verification code must be exactly 4 digits' })
  @Matches(/^[0-9]{4}$/, { message: 'Verification code must contain only numbers' })
  code: string;
}

export class OtpResponseDto {
  @ApiProperty({
    description: 'Response message indicating success or failure',
    example: 'If an account exists with this email, a verification code has been sent.',
    type: 'string'
  })
  message: string;

  @ApiProperty({
    description: 'Whether the operation was successful',
    example: true,
    type: 'boolean'
  })
  success: boolean;

  @ApiProperty({
    description: 'Number of seconds to wait before retrying (for rate limited requests)',
    example: 60,
    type: 'number',
    required: false
  })
  retryAfter?: number;

  @ApiProperty({
    description: 'Number of verification attempts remaining',
    example: 4,
    type: 'number',
    required: false
  })
  attemptsRemaining?: number;

  @ApiProperty({
    description: 'Unique correlation ID for request tracking',
    example: 'lkj2h1g-3f4a5b6c7d8e',
    type: 'string'
  })
  correlationId: string;
}

export class VerifyOtpResponseDto extends OtpResponseDto {
  @ApiProperty({
    description: 'Whether the email has been verified',
    example: true,
    type: 'boolean',
    required: false
  })
  isVerified?: boolean;
}

export class ErrorResponseDto {
  @ApiProperty({
    description: 'Error message',
    example: 'Rate limit exceeded. Please try again later.',
    type: 'string'
  })
  message: string;

  @ApiProperty({
    description: 'Always false for error responses',
    example: false,
    type: 'boolean'
  })
  success: boolean;

  @ApiProperty({
    description: 'HTTP status code',
    example: 429,
    type: 'number'
  })
  statusCode: number;

  @ApiProperty({
    description: 'Unique correlation ID for request tracking',
    example: 'lkj2h1g-3f4a5b6c7d8e',
    type: 'string'
  })
  correlationId: string;

  @ApiProperty({
    description: 'Number of seconds to wait before retrying',
    example: 60,
    type: 'number',
    required: false
  })
  retryAfter?: number;
}