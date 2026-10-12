import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsObject,
  ValidateNested,
  IsString,
} from "class-validator";
import { Transform, Type } from "class-transformer";
import { IsValidPushToken } from "../decorators/is-valid-push-token.decorator";

export enum PushTokenPlatformEnum {
  IOS = "ios",
  ANDROID = "android",
}

export type PushTokenPlatform = `${PushTokenPlatformEnum}`;

export class DeviceMetadataDto {
  @IsOptional()
  @IsString()
  @Transform(({ value, obj }) => value ?? obj?.model ?? obj?.device_model, {
    toClassOnly: true,
  })
  model?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value, obj }) => value ?? obj?.osVersion ?? obj?.os_version, {
    toClassOnly: true,
  })
  osVersion?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value, obj }) => value ?? obj?.appVersion ?? obj?.app_version, {
    toClassOnly: true,
  })
  appVersion?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value, obj }) => value ?? obj?.deviceId ?? obj?.device_id, {
    toClassOnly: true,
  })
  deviceId?: string;
}

export class RegisterTokenDto {
  @IsNotEmpty({ message: "Token is required" })
  @IsString({ message: "Token must be a string" })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsValidPushToken({
    message: "Invalid push token format for the specified platform",
  })
  token!: string;

  @IsEnum(PushTokenPlatformEnum, {
    message: 'Platform must be either "ios" or "android"',
  })
  @Transform(({ value }) =>
    typeof value === "string" ? value.toLowerCase() : value,
  )
  platform!: PushTokenPlatform;

  @IsOptional()
  @IsObject({ message: "Device metadata must be an object" })
  @ValidateNested()
  @Type(() => DeviceMetadataDto)
  @Transform(
    ({ value, obj }) => value ?? obj?.device_metadata ?? obj?.deviceMetadata,
    { toClassOnly: true },
  )
  deviceMetadata?: DeviceMetadataDto;
}

export interface NormalizedDeviceMetadata {
  model?: string;
  os_version?: string;
  app_version?: string;
  device_id?: string;
}

export const normalizeDeviceMetadata = (
  metadata?: DeviceMetadataDto,
): NormalizedDeviceMetadata | undefined => {
  if (!metadata) {
    return undefined;
  }

  const normalized: NormalizedDeviceMetadata = {};

  if (metadata.model) {
    normalized.model = metadata.model;
  }

  if (metadata.osVersion) {
    normalized.os_version = metadata.osVersion;
  }

  if (metadata.appVersion) {
    normalized.app_version = metadata.appVersion;
  }

  if (metadata.deviceId) {
    normalized.device_id = metadata.deviceId;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
};
