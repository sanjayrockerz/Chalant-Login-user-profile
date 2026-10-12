// filepath: src/validation/normalizers/display-name.normalizer.ts
// Helpers for display name normalization. Display names allow a wider set of
// characters than usernames but should still be trimmed, de-duplicated for
// whitespace, and stripped of control characters.

export interface DisplayNameOptions {
  minLength?: number;
  maxLength?: number;
}

function stripControlCharacters(value: string): string {
  try {
    return value.replace(/\p{C}/gu, "");
  } catch (error) {
    return value.replace(/[\x00-\x1F\x7F]/g, "");
  }
}

function stripUnsupportedCharacters(value: string): string {
  try {
    return value.replace(/[^\p{L}\p{M}\p{N} .,'\-]/gu, "");
  } catch (error) {
    return value.replace(/[^A-Za-z0-9 .,'\-]/g, "");
  }
}

export function normalizeDisplayName(input: unknown): string {
  if (input === undefined || input === null) {
    return "";
  }

  let value = String(input).normalize("NFKC");
  value = stripControlCharacters(value);
  value = stripUnsupportedCharacters(value);
  value = value.replace(/\s+/g, " ").trim();

  return value;
}

export function isValidDisplayName(
  value: string,
  options: DisplayNameOptions = {},
): boolean {
  const { minLength = 1, maxLength = 80 } = options;

  if (!value) {
    return false;
  }

  const length = Array.from(value).length;
  if (length < minLength || length > maxLength) {
    return false;
  }

  return true;
}
