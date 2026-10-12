import { describe, expect, test } from 'vitest';
import type { CountryCode } from 'libphonenumber-js';
import { normalizePhoneNumber, NormalizationError } from '../index';

type ValidCase = {
  input: string;
  expected: string;
  defaultCountry?: CountryCode;
  rejectServiceNumbers?: boolean;
};

const validCases: ValidCase[] = [
  { input: '(415) 555-0123', expected: '+14155550123', defaultCountry: 'US' },
  { input: '+1 415 555 0123', expected: '+14155550123' },
  { input: '0044 20 7946 0958', expected: '+442079460958' },
  { input: '+44 (0)20 7946 0958', expected: '+442079460958' },
  { input: '020 7946 0958', expected: '+442079460958', defaultCountry: 'GB' },
  { input: '98765 43210', expected: '+919876543210', defaultCountry: 'IN' },
  { input: '+91-98765-43210', expected: '+919876543210' },
  { input: '0491 570 156', expected: '+32491570156', defaultCountry: 'BE' },
  { input: '+61 2 9374 4000', expected: '+61293744000' },
  { input: '(02) 9374 4000', expected: '+61293744000', defaultCountry: 'AU' },
  { input: '030 901820', expected: '+4930901820', defaultCountry: 'DE' },
  { input: '+49 30 901820', expected: '+4930901820' },
  { input: '01 23 45 67 89', expected: '+33123456789', defaultCountry: 'FR' },
  { input: '+33 1 23 45 67 89', expected: '+33123456789' },
  { input: '081 234 5678', expected: '+390812345678', defaultCountry: 'IT' },
  { input: '+39 081 234 5678', expected: '+390812345678' },
  { input: '070 1234 567', expected: '+46701234567', defaultCountry: 'SE' },
  { input: '+46 70 123 45 67', expected: '+46701234567' },
  { input: '021 123 4567', expected: '+64211234567', defaultCountry: 'NZ' },
  { input: '+64 21 123 4567', expected: '+64211234567' },
  { input: '090-1234-5678', expected: '+819012345678', defaultCountry: 'JP' },
  { input: '+81 90-1234-5678', expected: '+819012345678' },
  { input: '010-1234-5678', expected: '+821012345678', defaultCountry: 'KR' },
  { input: '+82 10-1234-5678', expected: '+821012345678' },
  { input: '0917 123 4567', expected: '+639171234567', defaultCountry: 'PH' },
  { input: '(202) 555-0123', expected: '+12025550123', defaultCountry: 'US' },
  { input: '+52 1 55 1234 5678', expected: '+525512345678' },
  { input: '0555 123 4567', expected: '+905551234567', defaultCountry: 'TR' },
  { input: '+55 (21) 91234-5678', expected: '+5521912345678' },
  { input: '2123 4567', expected: '+85221234567', defaultCountry: 'HK' },
  { input: '+351 21 234 5678', expected: '+351212345678' },
  { input: '1-800-FLOWERS', expected: '+18003569377', defaultCountry: 'US', rejectServiceNumbers: false },
  { input: '+7 (495) 123-45-67', expected: '+74951234567' },
  { input: '02-1234-5678 ext 99', expected: '+82212345678', defaultCountry: 'KR' },
  { input: '011 44 20 7946 0958', expected: '+442079460958', defaultCountry: 'US' },
  { input: '0 800 123 456', expected: '+49800123456', defaultCountry: 'DE', rejectServiceNumbers: false }
] ;

describe('normalizePhoneNumber - valid cases', () => {
  test.each(validCases)('normalizes %s', (testCase: ValidCase) => {
    const { input, expected, defaultCountry, rejectServiceNumbers = true } = testCase;
    const result = normalizePhoneNumber(input, { defaultCountry, rejectServiceNumbers });
    expect(result.e164).toBe(expected);
    expect(result.country).toBeDefined();
    expect(result.nationalNumber.length).toBeGreaterThan(0);
  });
});

type InvalidCase = {
  input: string;
  code: NormalizationError['code'];
  defaultCountry?: CountryCode;
};

const invalidCases: InvalidCase[] = [
  { input: '', defaultCountry: 'US', code: 'INVALID_INPUT' },
  { input: '123', defaultCountry: 'US', code: 'INVALID_INPUT' },
  { input: '911', defaultCountry: 'US', code: 'INVALID_INPUT' },
  { input: '+999123456789', code: 'INVALID_NUMBER' },
  { input: 'abcd-efgh', defaultCountry: 'US', code: 'INVALID_NUMBER' },
  { input: '+1 900 123 4567', code: 'INVALID_NUMBER' },
  { input: '+33 123456', code: 'INVALID_NUMBER' },
  { input: '020 7946 0958', code: 'INVALID_NUMBER', defaultCountry: undefined },
  { input: '112', defaultCountry: 'GB', code: 'INVALID_INPUT' },
  { input: '+44 1234567890123456', code: 'INVALID_NUMBER' }
];

describe('normalizePhoneNumber - invalid cases', () => {
  test.each(invalidCases)('rejects %s', (testCase: InvalidCase) => {
    const { input, defaultCountry, code } = testCase;
    let caught: unknown;
    try {
      normalizePhoneNumber(input, { defaultCountry, rejectServiceNumbers: true });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NormalizationError);
    expect((caught as NormalizationError).code).toBe(code);
  });
});

// Edge cases around fallback country detection

describe('normalizePhoneNumber - fallback country logic', () => {
  test('uses fallback country when default fails', () => {
    const result = normalizePhoneNumber('051 123 4567', {
      defaultCountry: 'US',
      fallbackCountry: 'CH'
    });
    expect(result.e164).toBe('+41511234567');
    expect(result.country).toBe('CH');
  });

  test('rejects when both default and fallback fail', () => {
    expect(() =>
      normalizePhoneNumber('051 123 4567', { defaultCountry: 'US', fallbackCountry: 'GB' })
    ).toThrowError(NormalizationError);
  });
});
