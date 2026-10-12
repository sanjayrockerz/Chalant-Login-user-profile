import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsOptional, IsString, MinLength } from "class-validator";

export class UpdateUserDto {
  @ApiProperty({
    description: "Updated username for the user",
    example: "johndoe_updated",
    type: "string",
    required: false,
  })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiProperty({
    description: "Updated email address for the user",
    example: "john.updated@example.com",
    format: "email",
    type: "string",
    required: false,
  })
  @IsOptional()
  @IsEmail()
  email?: string;
}

export class ChangePasswordDto {
  @ApiProperty({
    description: "Current password for verification",
    example: "currentPassword123",
    type: "string",
  })
  @IsString()
  currentPassword: string;

  @ApiProperty({
    description: "New password for the user",
    example: "newSecurePassword123",
    minLength: 6,
    type: "string",
  })
  @IsString()
  @MinLength(6)
  newPassword: string;
}

export class UserProfileDto {
  @ApiProperty({
    description: "User ID",
    example: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    type: "string",
  })
  id: string;

  @ApiProperty({
    description: "Username",
    example: "johndoe",
    type: "string",
  })
  username: string;

  @ApiProperty({
    description: "Email address",
    example: "john.doe@example.com",
    type: "string",
  })
  email: string;

  @ApiProperty({
    description: "Email verification status",
    example: true,
    type: "boolean",
  })
  verified: boolean;

  @ApiProperty({
    description: "Account creation timestamp",
    example: "2024-01-15T10:30:00.000Z",
    format: "date-time",
    type: "string",
  })
  createdAt: string;

  @ApiProperty({
    description: "Last account update timestamp",
    example: "2024-01-15T10:30:00.000Z",
    format: "date-time",
    type: "string",
  })
  updatedAt: string;
}
