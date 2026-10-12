import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from "class-validator";
import { OnboardingStatus } from "@prisma/client";

export class UpdateCanonicalProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string | null;

  @IsOptional()
  @IsUrl({ protocols: ["http", "https"], require_protocol: true })
  @MaxLength(2048)
  profileImageUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  pronouns?: string | null;

  @IsOptional()
  @IsBoolean()
  allowContactDiscovery?: boolean;
}

export class UpdateOnboardingDto {
  @IsEnum(OnboardingStatus)
  status!: OnboardingStatus;
}
