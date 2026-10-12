import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description: 'Email address for authentication',
    example: 'john.doe@example.com',
    format: 'email',
    type: 'string'
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'Password for authentication',
    example: 'securePassword123',
    type: 'string'
  })
  @IsNotEmpty()
  password: string;
}

export class AuthResponseDto {
  @ApiProperty({
    description: 'JWT access token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    type: 'string'
  })
  access_token: string;

  @ApiProperty({
    description: 'User information',
    type: 'object',
    properties: {
      id: { type: 'string', example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' },
      username: { type: 'string', example: 'johndoe' },
      email: { type: 'string', example: 'john.doe@example.com' },
      verified: { type: 'boolean', example: false }
    }
  })
  user: {
    id: string;
    username: string;
    email: string;
    verified: boolean;
  };
}

export class VerifyEmailDto {
  @ApiProperty({
    description: 'Email verification token received via email',
    example: 'abc123def456ghi789',
    type: 'string'
  })
  @IsNotEmpty()
  token: string;
}

export class ResendVerificationDto {
  @ApiProperty({
    description: 'Email address to resend verification to',
    example: 'john.doe@example.com',
    format: 'email',
    type: 'string'
  })
  @IsEmail()
  email: string;
}

export class MessageResponseDto {
  @ApiProperty({
    description: 'Response message',
    example: 'Verification email sent successfully',
    type: 'string'
  })
  message: string;
}

export class ErrorResponseDto {
  @ApiProperty({
    description: 'HTTP status code',
    example: 400,
    type: 'number'
  })
  statusCode: number;

  @ApiProperty({
    description: 'Error message or array of validation errors',
    oneOf: [
      { type: 'string', example: 'Invalid credentials' },
      { type: 'array', items: { type: 'string' }, example: ['email must be a valid email'] }
    ]
  })
  message: string | string[];

  @ApiProperty({
    description: 'Error type identifier',
    example: 'Bad Request',
    type: 'string'
  })
  error: string;

  @ApiProperty({
    description: 'Correlation ID for request tracking',
    example: 'req_abc123def456',
    type: 'string',
    required: false
  })
  correlationId?: string;

  @ApiProperty({
    description: 'Timestamp of the error',
    example: '2024-01-15T10:30:00.000Z',
    format: 'date-time',
    type: 'string'
  })
  timestamp: string;

  @ApiProperty({
    description: 'Request path where error occurred',
    example: '/api/auth/signup',
    type: 'string'
  })
  path: string;
}