// filepath: src/validation/normalizers/username.normalizer.ts
// Utility helpers for consistently normalizing and validating usernames across
// the onboarding services. These helpers centralize the rules so controllers,
// DTOs, and validators can share a single source of truth.

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;
export const USERNAME_REGEX = /^[a-z0-9._]+$/;

function stripControlCharacters(value: string): string {
	try {
		return value.replace(/\p{C}/gu, '');
	} catch (error) {
		return value.replace(/[\x00-\x1F\x7F]/g, '');
	}
}

/**
 * Normalize a username using Unicode NFKC normalization, lower casing and
 * control character stripping. Whitespace is collapsed and trimmed but left as
 * a single space so validation can detect and reject it when disallowed.
 */
export function normalizeUsername(input: unknown): string {
	if (input === undefined || input === null) {
		return '';
	}

	let value = String(input);
	value = value.normalize('NFKC');
	value = value.replace(/\s+/g, ' ').trim();
	value = value.toLocaleLowerCase();
	value = stripControlCharacters(value);

	return value;
}

/**
 * Validate raw username input against the allowed character set and length
 * bounds. This mirrors Instagram-style username constraints.
 */
export function isValidUsernameForm(value?: string): boolean {
	if (!value) {
		return false;
	}

	const length = Array.from(value).length;
	if (length < USERNAME_MIN_LENGTH || length > USERNAME_MAX_LENGTH) {
		return false;
	}

	try {
		return /^[\p{L}\p{N}._]+$/u.test(value);
	} catch (error) {
		return USERNAME_REGEX.test(value);
	}
}

export function hasConsecutiveSpecials(value: string): boolean {
	return /[._]{2,}/.test(value);
}

export function startsOrEndsWithSpecial(value: string): boolean {
	return /^[._]|[._]$/.test(value);
}