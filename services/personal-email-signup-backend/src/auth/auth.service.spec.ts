import { BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService, CompletePasswordResetRequest } from './auth.service';
import { ConfigService } from '../config/config.service';
import { UserService } from '../user/user.service';
import { RedisService } from '../redis/redis.service';
import { EmailService } from '../email/email.service';
import { PasswordPolicyService, PasswordPolicyResult } from '../security/password-policy/password-policy.service';

const createMock = <T extends object>(overrides: Partial<Record<keyof T, any>> = {}): jest.Mocked<T> => {
  const proxy: Record<string, any> = {};
  Object.keys(overrides).forEach((key) => {
    proxy[key] = overrides[key as keyof T];
  });
  return proxy as jest.Mocked<T>;
};

describe('AuthService.resetPasswordWithToken', () => {
  let authService: AuthService;
  let jwtService: jest.Mocked<JwtService>;
  let configService: jest.Mocked<ConfigService>;
  let userService: jest.Mocked<UserService>;
  let redisService: jest.Mocked<RedisService>;
  let emailService: jest.Mocked<EmailService>;
  let passwordPolicy: jest.Mocked<PasswordPolicyService>;

  beforeEach(() => {
    jwtService = createMock<JwtService>({
      sign: jest.fn(),
      verify: jest.fn(),
      verifyAsync: jest.fn(),
    });

    configService = createMock<ConfigService>({
      get: jest.fn(),
    });

    userService = createMock<UserService>({
      findById: jest.fn(),
      updatePassword: jest.fn(),
    });

    redisService = createMock<RedisService>({
      get: jest.fn(),
      del: jest.fn(),
      storeOTP: jest.fn(),
      verifyOTP: jest.fn(),
    });

    emailService = createMock<EmailService>({
      sendOTP: jest.fn(),
      sendPasswordReset: jest.fn(),
    });

    passwordPolicy = createMock<PasswordPolicyService>({
      evaluate: jest.fn(),
    });

    authService = new AuthService(
      jwtService,
      configService,
      userService,
      redisService,
      emailService,
      passwordPolicy,
    );
  });

  const validPolicyResult = (overrides: Partial<PasswordPolicyResult> = {}): PasswordPolicyResult => ({
    compliant: true,
    score: 4,
    crackTimesDisplay: {
      online_throttling_100_per_hour: 'centuries',
      online_no_throttling_10_per_second: 'centuries',
      offline_slow_hashing_1e4_per_second: 'centuries',
      offline_fast_hashing_1e10_per_second: 'centuries',
    },
    warnings: [],
    violations: [],
    breached: false,
    hash: '$2b$12$abcdefghijklmnopqrstuv',
    ...overrides,
  });

  const request = (overrides: Partial<CompletePasswordResetRequest> = {}): CompletePasswordResetRequest => ({
    token: 'reset-token',
    newPassword: 'SecureP@ssw0rd!',
    correlation_id: 'corr-id',
    tenant_id: 'tenant',
    ...overrides,
  });

  it('throws BadRequestException when the token is missing', async () => {
    await expect(authService.resetPasswordWithToken(request({ token: '' }))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequestException when the token lookup fails', async () => {
    redisService.get.mockResolvedValue(null);

    await expect(authService.resetPasswordWithToken(request())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws NotFoundException when the user does not exist', async () => {
    redisService.get.mockResolvedValue({ userId: 'missing-user' });
    userService.findById.mockResolvedValue(null as any);

    await expect(authService.resetPasswordWithToken(request())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws BadRequestException when password policy fails', async () => {
    redisService.get.mockResolvedValue({ userId: 'user-1' });
    userService.findById.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      username: 'user1',
      password: 'old-hash',
    } as any);
    passwordPolicy.evaluate.mockResolvedValue(
      validPolicyResult({ compliant: false, hash: undefined, violations: [{ code: 'too_short', message: 'Too short' }] }),
    );

    await expect(authService.resetPasswordWithToken(request())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updates password and clears token for compliant passwords', async () => {
    redisService.get.mockResolvedValue({ userId: 'user-1' });
    userService.findById.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      username: 'user1',
      password: 'old-hash',
    } as any);
    passwordPolicy.evaluate.mockResolvedValue(validPolicyResult());

    const result = await authService.resetPasswordWithToken(request());

    expect(passwordPolicy.evaluate).toHaveBeenCalledWith('SecureP@ssw0rd!', {
      userInputs: ['user@example.com', 'user1'],
    });
    expect(userService.updatePassword).toHaveBeenCalledWith('user-1', '$2b$12$abcdefghijklmnopqrstuv');
    expect(redisService.del).toHaveBeenCalledWith('password-reset:reset-token');
    expect(result).toEqual({ success: true });
  });
});
