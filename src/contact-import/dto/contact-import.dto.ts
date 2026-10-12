import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ContactDto {
  @IsEnum(['phone', 'email'])
  type: 'phone' | 'email';

  @IsString()
  value: string;
}

export class ContactImportDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContactDto)
  contacts: ContactDto[];
}

export class ContactDiscoveryPreferencesDto {
  @IsBoolean()
  allowDiscovery: boolean;

  @IsEnum(['mutual-only', 'one-sided', 'disabled'])
  discoveryMode: 'mutual-only' | 'one-sided' | 'disabled';

  @IsBoolean()
  allowSuggestions: boolean;

  @IsBoolean()
  @IsOptional()
  phoneDiscovery?: boolean;

  @IsBoolean()
  @IsOptional()
  emailDiscovery?: boolean;
}

export interface ContactNormalizationResult {
  type: 'phone' | 'email';
  normalized: string;
  original: string;
}

export interface DiscoveryResult {
  userId: string;
  platform: string;
  discoveryToken: string;
  mutual: boolean;
  timestamp: Date;
}

export interface DiscoveryResultDto {
  discoveries: DiscoveryResult[];
  importedCount: number;
  discoveredCount: number;
  timestamp: Date;
}

export interface ContactPrivacyPrefs {
  userId: string;
  allowDiscovery: boolean;
  discoveryMode: 'mutual-only' | 'one-sided' | 'disabled';
  allowSuggestions: boolean;
  phoneDiscovery: boolean;
  emailDiscovery: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DiscoveryToken {
  id: string;
  requesterId: string;
  targetId: string;
  contactHash: string;
  platform: string;
  status: 'pending' | 'matched' | 'expired';
  createdAt: Date;
  expiresAt: Date;
}