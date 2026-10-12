// filepath: src/validation/normalizers/phone.normalizer.ts
// Thin wrapper around the shared phone normalization package so the onboarding
// layer has a convenient helper that always returns the metadata we care about.

import {
  normalizePhoneNumber,
  NormalizationError,
  NormalizeOptions,
  NormalizedPhoneNumber,
} from "../../../../../packages/phone-normalization/src";

export interface PhoneNormalizationResult extends NormalizedPhoneNumber {}

export type PhoneNormalizationOptions = NormalizeOptions;

export function normalizePhone(
  input: unknown,
  options: PhoneNormalizationOptions = {},
): PhoneNormalizationResult {
  if (input === undefined || input === null) {
    throw new NormalizationError("INVALID_INPUT", "Phone number is required");
  }

  const value = String(input).trim();
  return normalizePhoneNumber(value, options);
}
