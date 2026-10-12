import { InjectionToken } from "@nestjs/common";

export interface PhoneNormalizationPort {
  normalize: (
    input: string,
    countryHint?: string,
  ) => Promise<NormalizedPhoneResult> | NormalizedPhoneResult;
}

export interface PhoneHashingPort {
  hash: (input: string) => string;
  verify: (input: string, digest: string) => boolean;
}

export interface NormalizedPhoneResult {
  e164: string;
  countryCode: string;
  region: string;
  nationalNumber: string;
}

export const PHONE_NORMALIZATION_PORT: InjectionToken<PhoneNormalizationPort> =
  Symbol("PHONE_NORMALIZATION_PORT");
export const PHONE_HASHING_PORT: InjectionToken<PhoneHashingPort> =
  Symbol("PHONE_HASHING_PORT");
