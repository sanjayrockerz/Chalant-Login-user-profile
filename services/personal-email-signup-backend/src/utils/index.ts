export const isValidUsernameForm = (value?: string) => !!value && value.trim().length > 0;
export const normalizeUsername = (value: string) => (value || '').trim().toLowerCase();

export * from '../security/phone-hash/phone-hash.util';
