// filepath: src/validation/normalizers/age.normalizer.ts

export interface AgeValidationOptions {
  min?: number;
  max?: number;
}

export function normalizeAge(input: unknown): number | null {
  if (input === undefined || input === null) {
    return null;
  }

  if (typeof input === 'number' && Number.isFinite(input)) {
    return Math.trunc(input);
  }

  const value = String(input).trim();
  if (value.length === 0) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.trunc(parsed);
}

export function isValidAge(age: number | null, options: AgeValidationOptions = {}): boolean {
  if (age === null || !Number.isFinite(age)) {
    return false;
  }

  const { min = 0, max = 150 } = options;
  if (age < min) {
    return false;
  }
  if (age > max) {
    return false;
  }

  return true;
}
