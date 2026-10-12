import { parsePhoneNumberFromString, CountryCode } from 'libphonenumber-js';
import { NormalizationError } from './errors';

export interface NormalizeOptions {
  /**
   * Default ISO alpha-2 country code used when the input lacks an international prefix.
   * Typically derived from the user's selected country during signup.
   */
  defaultCountry?: CountryCode;
  /**
   * Fallback ISO alpha-2 country inferred from context (e.g., IP geolocation).
   * Used only if the default country does not yield a valid number.
   */
  fallbackCountry?: CountryCode;
  /**
   * Reject toll-free, short-code, and emergency numbers when true (default).
   */
  rejectServiceNumbers?: boolean;
}

export interface NormalizedPhoneNumber {
  /** E.164 formatted phone number (+14155552671). */
  e164: string;
  /** ISO alpha-2 country code determined during parsing (e.g. "US"). */
  country: CountryCode;
  /** National Significant Number (NSN) component without country code. */
  nationalNumber: string;
}

const vanityMap: Record<string, string> = {
  A: '2',
  B: '2',
  C: '2',
  D: '3',
  E: '3',
  F: '3',
  G: '4',
  H: '4',
  I: '4',
  J: '5',
  K: '5',
  L: '5',
  M: '6',
  N: '6',
  O: '6',
  P: '7',
  Q: '7',
  R: '7',
  S: '7',
  T: '8',
  U: '8',
  V: '8',
  W: '9',
  X: '9',
  Y: '9',
  Z: '9'
};

const serviceTypes = new Set([
  'TOLL_FREE',
  'UNKNOWN',
  'VOICEMAIL',
  'PERSONAL_NUMBER',
  'PAGER',
  'UAN',
  'EMERGENCY',
  'SHORT_CODE'
]);

/**
 * Convert vanity letters (1-800-FLOWERS) to digits.
 */
function applyVanityMapping(input: string): string {
  return input.replace(/[A-Za-z]/g, (char) => vanityMap[char.toUpperCase()] ?? '');
}

function stripExtension(input: string): string {
  // Common extension indicators: ext, ext., extension, x1234, #1234, ;ext=123
  const patterns = [
    /(ext\.?|extension|x|#)\s*\d+$/i,
    /;\s*ext=\d+$/i,
    /;\s*p=\d+$/i
  ];

  return patterns.reduce((acc, pattern) => acc.replace(pattern, ''), input);
}

function sanitize(rawInput: string): string {
  let value = rawInput.trim();
  value = stripExtension(value);
  value = applyVanityMapping(value);

  // Allow only digits and plus signs temporarily
  value = value.replace(/[^0-9+]/g, '');

  if (value.startsWith('00')) {
    value = `+${value.slice(2)}`;
  }

  if (value.startsWith('+')) {
    // Remove any additional plus characters beyond the first
    value = `+${value.slice(1).replace(/\+/g, '')}`;
  } else {
    value = value.replace(/\+/g, '');
  }

  return value;
}

function tryParse(value: string, country?: CountryCode) {
  try {
    return parsePhoneNumberFromString(value, country ?? undefined) ?? null;
  } catch (error) {
    return null;
  }
}

function isServiceNumber(type: string | undefined): boolean {
  if (!type) {
    return false;
  }
  return serviceTypes.has(type);
}

export function normalizePhoneNumber(rawInput: string, options: NormalizeOptions = {}): NormalizedPhoneNumber {
  if (!rawInput || rawInput.trim().length === 0) {
    throw new NormalizationError('INVALID_INPUT', 'Phone number is required');
  }

  const sanitized = sanitize(rawInput);

  if (sanitized.length < 4) {
    throw new NormalizationError('INVALID_INPUT', 'Phone number is too short after sanitization', {
      sanitized
    });
  }

  let candidates: Array<{ number: ReturnType<typeof parsePhoneNumberFromString>; source: string }> = [];

  const international = sanitized.startsWith('+');
  if (international) {
    const parsed = tryParse(sanitized);
    if (parsed) {
      candidates.push({ number: parsed, source: 'international' });
    }
  }

  if (!international && options.defaultCountry) {
    const parsed = tryParse(sanitized, options.defaultCountry);
    if (parsed) {
      candidates.push({ number: parsed, source: 'defaultCountry' });
    }
  }

  if (!international && options.fallbackCountry && options.fallbackCountry !== options.defaultCountry) {
    const parsed = tryParse(sanitized, options.fallbackCountry);
    if (parsed) {
      candidates.push({ number: parsed, source: 'fallbackCountry' });
    }
  }

  const parsedNumber = candidates
    .map(({ number }) => number)
    .find((number) => number !== undefined && number.isValid());

  if (!parsedNumber) {
    throw new NormalizationError('INVALID_NUMBER', 'Unable to parse phone number to a valid E.164 format', {
      sanitized,
      defaultCountryTried: options.defaultCountry,
      fallbackCountryTried: options.fallbackCountry
    });
  }

  if (parsedNumber.number.length > 16) {
    throw new NormalizationError('INVALID_NUMBER', 'Phone number exceeds E.164 maximum length', {
      e164: parsedNumber.number
    });
  }

  if (options.rejectServiceNumbers !== false && isServiceNumber(parsedNumber.getType())) {
    throw new NormalizationError('SERVICE_NUMBER', 'Service and short codes are not allowed', {
      type: parsedNumber.getType()
    });
  }

  return {
    e164: parsedNumber.number,
    country: parsedNumber.country as CountryCode,
    nationalNumber: parsedNumber.nationalNumber
  };
}

export { NormalizationError } from './errors';
