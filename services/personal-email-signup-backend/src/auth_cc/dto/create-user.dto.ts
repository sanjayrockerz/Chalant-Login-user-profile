// filepath: src/auth/dto/create-user.dto.ts
import {
  IsEmail,
  IsNotEmpty,
  MinLength,
  IsOptional,
  IsUrl,
  IsString,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  NormalizedDeclaredAge,
  NormalizedDisplayName,
  NormalizedPhoneNumber,
  NormalizedUsername,
} from "../../validation/decorators";

export class CreateUserDto {
  @ApiProperty({
    description: "Username for the user account",
    example: "johndoe",
    minLength: 1,
    type: "string",
  })
  @IsNotEmpty()
  @NormalizedUsername()
  username: string;

  @ApiProperty({
    description: "Valid email address for the user",
    example: "john.doe@example.com",
    format: "email",
    type: "string",
  })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    description:
      "Optional display username. If provided, will be stored alongside normalized username.",
  })
  @IsOptional()
  @NormalizedDisplayName({ optional: true, maxLength: 30, minLength: 1 })
  displayUsername?: string;
  @ApiProperty({
    description: "Password for the user account",
    example: "securePassword123",
    minLength: 6,
    type: "string",
  })
  @IsNotEmpty()
  @MinLength(6)
  password: string;

  @ApiProperty({
    description: "Display name to show in the product (optional, free-form)",
    example: "John Doe",
    required: false,
    type: "string",
  })
  @IsOptional()
  @NormalizedDisplayName()
  display_name?: string;

  @ApiPropertyOptional({
    description:
      "Optional phone number. The service normalizes it to E.164 format before persistence.",
    example: "+14155552671",
    type: "string",
  })
  @NormalizedPhoneNumber()
  phone_number?: string;

  @ApiProperty({
    description:
      "Declared age of the user (integer). Used for deterministic underage rejection; must be >= MIN_DECLARED_AGE",
    example: 18,
    required: false,
    type: "number",
  })
  @IsOptional()
  @NormalizedDeclaredAge({ optional: true, min: 0, max: 120 })
  declared_age?: number;

  @ApiProperty({
    description:
      "Pointer URL to the user profile image stored in an external media service (only store pointer here).",
    example: "https://media.example.com/avatars/abcd.jpg",
    required: false,
    type: "string",
    format: "uri",
  })
  @IsOptional()
  @IsUrl()
  profile_image_url?: string;

  @ApiProperty({
    description:
      "Optional pronouns string, free-form (e.g., he/him, they/them).",
    example: "they/them",
    required: false,
    type: "string",
  })
  @IsOptional()
  @IsString()
  pronouns?: string;

  @ApiProperty({
    description:
      "Terms and policies version accepted by user during registration.",
    example: "v2025-10-07-1",
    required: false,
    type: "string",
  })
  @IsOptional()
  @IsString()
  terms_version?: string;
}
