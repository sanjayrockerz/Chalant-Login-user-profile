import * as bcrypt from 'bcryptjs';
import { PasswordBreachService } from '../password-breach.service';
import { PasswordPolicyService } from './password-policy.service';

describe('PasswordPolicyService', () => {
  let breachService: jest.Mocked<PasswordBreachService>;
  let service: PasswordPolicyService;

  beforeEach(() => {
    breachService = {
      checkPassword: jest.fn().mockResolvedValue({ isBreached: false }),
    } as unknown as jest.Mocked<PasswordBreachService>;

    service = new PasswordPolicyService(breachService);
  });

  it('rejects passwords shorter than the minimum length', async () => {
    const result = await service.evaluate('short');
    expect(result.compliant).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'too_short' }),
      ]),
    );
  });

  it('rejects passwords found in the top common list', async () => {
    const result = await service.evaluate('password');
    expect(result.compliant).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'common_password' }),
      ]),
    );
  });

  it('rejects dictionary words even when not obviously common', async () => {
  const result = await service.evaluate('volcano');
    expect(result.compliant).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'dictionary_word' }),
      ]),
    );
  });

  it('rejects keyboard walk patterns', async () => {
  const result = await service.evaluate('asdfghjkl;');
    expect(result.compliant).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'keyboard_pattern' }),
      ]),
    );
  });

  it('rejects passwords that appear in HIBP', async () => {
    breachService.checkPassword.mockResolvedValue({ isBreached: true, breachCount: 42, source: 'haveibeenpwned' });
    const result = await service.evaluate('CorrectHorseBatteryStaple1!');
    expect(breachService.checkPassword).toHaveBeenCalled();
    expect(result.compliant).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'breached_password' }),
      ]),
    );
  });

  it('returns bcrypt hash for compliant passwords', async () => {
    const password = 'Unique passphrase 2025!';
    const result = await service.evaluate(password, { skipHIBP: true });

    expect(result.compliant).toBe(true);
    expect(result.hash).toBeDefined();
    expect(result.warnings.length).toBeGreaterThanOrEqual(0);
    expect(await bcrypt.compare(password.normalize('NFKC'), result.hash!)).toBe(true);
  });

  it('emits warnings for weak but compliant passwords', async () => {
    const result = await service.evaluate('aaaaaaaabbbbbbbb', { skipHIBP: true });
    expect(result.compliant).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Consider choosing a longer passphrase'),
      ]),
    );
  });
});
