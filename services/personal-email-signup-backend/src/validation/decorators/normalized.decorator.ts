// filepath: src/validation/decorators/normalized.decorator.ts
// Composite decorators that normalize and validate common onboarding fields.

import { applyDecorators, BadRequestException } from "@nestjs/common";
import { Transform } from "class-transformer";
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

import {
  normalizeUsername,
  USERNAME_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_REGEX,
} from "../normalizers/username.normalizer";
import { normalizeDisplayName } from "../normalizers/display-name.normalizer";
import {
  normalizePhone,
  PhoneNormalizationOptions,
} from "../normalizers/phone.normalizer";
import { normalizeAge } from "../normalizers/age.normalizer";
import { NormalizationError } from "../../../../../packages/phone-normalization/src/errors";

function isEmptyValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim().length === 0)
  );
}

export interface NormalizedUsernameOptions {
  optional?: boolean;
  minLength?: number;
  maxLength?: number;
}

export function NormalizedUsername(
  options: NormalizedUsernameOptions = {},
): PropertyDecorator {
  const {
    optional = false,
    minLength = USERNAME_MIN_LENGTH,
    maxLength = USERNAME_MAX_LENGTH,
  } = options;

  const decorators: PropertyDecorator[] = [
    Transform(({ value }) => {
      if (isEmptyValue(value)) {
        return optional ? undefined : value;
      }
      return normalizeUsername(value);
    }),
    IsString(),
    MinLength(minLength),
    MaxLength(maxLength),
    Matches(USERNAME_REGEX, {
      message:
        "Username can only contain lowercase letters, numbers, underscores, and periods",
    }),
  ];

  if (optional) {
    decorators.unshift(IsOptional());
  }

  return applyDecorators(...decorators);
}

export interface NormalizedDisplayNameOptions {
  optional?: boolean;
  minLength?: number;
  maxLength?: number;
}

export function NormalizedDisplayName(
  options: NormalizedDisplayNameOptions = {},
): PropertyDecorator {
  const { optional = true, minLength = 1, maxLength = 80 } = options;

  const decorators: PropertyDecorator[] = [
    Transform(({ value }) => {
      if (isEmptyValue(value)) {
        return optional ? undefined : "";
      }
      return normalizeDisplayName(value);
    }),
    IsString(),
    MinLength(minLength),
    MaxLength(maxLength),
  ];

  if (optional) {
    decorators.unshift(IsOptional());
  }

  return applyDecorators(...decorators);
}

export interface NormalizedPhoneOptions extends PhoneNormalizationOptions {
  optional?: boolean;
}

const E164_REGEX = /^\+[1-9]\d{1,14}$/;

export function NormalizedPhoneNumber(
  options: NormalizedPhoneOptions = {},
): PropertyDecorator {
  const { optional = true, ...normalizationOptions } = options;

  const decorators: PropertyDecorator[] = [
    Transform(({ value }) => {
      if (isEmptyValue(value)) {
        return optional ? undefined : value;
      }

      try {
        const normalized = normalizePhone(value, normalizationOptions);
        return normalized.e164;
      } catch (error) {
        if (error instanceof NormalizationError) {
          throw new BadRequestException({
            error: "invalid_phone_number",
            message: error.message,
            details: error.details ?? undefined,
          });
        }
        throw error;
      }
    }),
    IsString(),
    Matches(E164_REGEX, {
      message:
        "Phone number must be provided in E.164 format (e.g., +15551234567)",
    }),
  ];

  if (optional) {
    decorators.unshift(IsOptional());
  }

  return applyDecorators(...decorators);
}

export interface NormalizedAgeOptions {
  optional?: boolean;
  min?: number;
  max?: number;
}

export function NormalizedDeclaredAge(
  options: NormalizedAgeOptions = {},
): PropertyDecorator {
  const { optional = true, min = 0, max = 150 } = options;

  const decorators: PropertyDecorator[] = [
    Transform(({ value }) => {
      if (isEmptyValue(value)) {
        return optional ? undefined : value;
      }

      const normalized = normalizeAge(value);
      if (normalized === null || Number.isNaN(normalized)) {
        throw new BadRequestException({
          error: "invalid_declared_age",
          message: "Declared age must be an integer value",
        });
      }

      return normalized;
    }),
    IsInt(),
    Min(min),
    Max(max),
  ];

  if (optional) {
    decorators.unshift(IsOptional());
  }

  return applyDecorators(...decorators);
}
