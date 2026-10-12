import { normalizeUsername, isValidUsernameForm } from './username-normalize';
import { RESERVED_USERNAMES } from './username-denylist';

describe('username normalization', () => {
  it('normalizes composed and decomposed forms to identical strings', () => {
    const composed = 'éxample'; // e + combining acute (may be decomposed depending on editor)
    const decomposed = 'éxample';
    const n1 = normalizeUsername(composed);
    const n2 = normalizeUsername(decomposed);
    expect(n1).toBe(n2);
  });

  it('validates allowed characters and length', () => {
    expect(isValidUsernameForm('alice')).toBe(true);
    expect(isValidUsernameForm('a')).toBe(false); // too short
    expect(isValidUsernameForm('this-is-a-very-long-username-that-exceeds-thirty-chars')).toBe(false);
    expect(isValidUsernameForm('user_name.123')).toBe(true);
    expect(isValidUsernameForm('bad*name')).toBe(false);
  });
});

describe('denylist', () => {
  it('contains known reserved names', () => {
    expect(RESERVED_USERNAMES.has('admin')).toBe(true);
    expect(RESERVED_USERNAMES.has('support')).toBe(true);
  });
});
