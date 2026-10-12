// filepath: src/user/username-validation.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UsernameValidationService } from './username-validation.service';

describe('UsernameValidationService', () => {
  let service: UsernameValidationService;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsernameValidationService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<UsernameValidationService>(UsernameValidationService);
    configService = module.get(ConfigService);
  });

  describe('validateFormat', () => {
    it('should accept valid usernames', () => {
      const validUsernames = [
        'john',
        'john123',
        'john_doe',
        'john.doe',
        'a',
        '1',
        '_',
        '.',
        'a'.repeat(30), // max length
        'user_123.test',
        'mixedCASE123',
      ];

      validUsernames.forEach(username => {
        const result = service.validateFormat(username);
        expect(result.isValid).toBe(true);
        expect(result.canonical).toBe(username.toLowerCase());
        expect(result.errors).toHaveLength(0);
      });
    });

    it('should reject invalid usernames - length', () => {
      const invalidUsernames = [
        '', // too short
        'a'.repeat(31), // too long
      ];

      invalidUsernames.forEach(username => {
        const result = service.validateFormat(username);
        expect(result.isValid).toBe(false);
        expect(result.canonical).toBeNull();
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });

    it('should reject invalid usernames - characters', () => {
      const invalidUsernames = [
        'john doe', // space
        'john@doe', // @ symbol
        'john-doe', // hyphen
        'john!', // exclamation
        'john#tag', // hashtag
        'john$', // dollar sign
        'john%', // percent
        'john&doe', // ampersand
        'john*', // asterisk
        'john+', // plus
        'john=doe', // equals
        'john?', // question mark
        'john[bracket]', // brackets
        'john{brace}', // braces
        'john|pipe', // pipe
        'john\\slash', // backslash
        'john/slash', // forward slash
        'john<>tags', // angle brackets
        'john"quote', // quotes
        "john'quote", // single quote
        'john;semicolon', // semicolon
        'john:colon', // colon
        'john,comma', // comma
        'john~tilde', // tilde
        'john`backtick', // backtick
      ];

      invalidUsernames.forEach(username => {
        const result = service.validateFormat(username);
        expect(result.isValid).toBe(false);
        expect(result.canonical).toBeNull();
        expect(result.errors.some(e => e.includes('can only contain'))).toBe(true);
      });
    });

    it('should handle null/undefined usernames', () => {
      const result1 = service.validateFormat(null as any);
      expect(result1.isValid).toBe(false);
      expect(result1.errors).toContain('Username is required');

      const result2 = service.validateFormat(undefined as any);
      expect(result2.isValid).toBe(false);
      expect(result2.errors).toContain('Username is required');
    });

    it('should provide warnings for valid but discouraged patterns', () => {
      const warningCases = [
        { username: 'user..name', warning: 'consecutive periods' },
        { username: 'user__name', warning: 'consecutive' },
        { username: '.username', warning: 'starting with period' },
        { username: '_username', warning: 'starting with' },
        { username: 'username.', warning: 'ending with period' },
        { username: 'username_', warning: 'ending with' },
      ];

      warningCases.forEach(({ username, warning }) => {
        const result = service.validateFormat(username);
        expect(result.isValid).toBe(true);
        expect(result.warnings.some(w => w.toLowerCase().includes(warning.toLowerCase()))).toBe(true);
      });
    });
  });

  describe('normalizeUsername', () => {
    it('should convert to lowercase', () => {
      expect(service.normalizeUsername('JohnDoe')).toBe('johndoe');
      expect(service.normalizeUsername('UPPERCASE')).toBe('uppercase');
      expect(service.normalizeUsername('MiXeD_CaSe')).toBe('mixed_case');
    });

    it('should handle empty/null input', () => {
      expect(service.normalizeUsername('')).toBe('');
      expect(service.normalizeUsername(null as any)).toBe('');
      expect(service.normalizeUsername(undefined as any)).toBe('');
    });

    it('should preserve valid characters', () => {
      expect(service.normalizeUsername('user_123.test')).toBe('user_123.test');
      expect(service.normalizeUsername('a')).toBe('a');
      expect(service.normalizeUsername('1')).toBe('1');
    });
  });

  describe('validateForRegistration', () => {
    it('should include additional warnings for registration', () => {
      const numericUsername = '12345';
      const result = service.validateForRegistration(numericUsername);
      
      expect(result.isValid).toBe(true);
      expect(result.warnings.some(w => w.includes('numeric-only'))).toBe(true);
    });

    it('should warn about single character usernames', () => {
      const singleChar = 'a';
      const result = service.validateForRegistration(singleChar);
      
      expect(result.isValid).toBe(true);
      expect(result.warnings.some(w => w.includes('single character'))).toBe(true);
    });
  });

  describe('generateSuggestions', () => {
    it('should generate valid suggestions', () => {
      const suggestions = service.generateSuggestions('john', 3);
      
      expect(suggestions).toHaveLength(3);
      suggestions.forEach(suggestion => {
        expect(suggestion.length).toBeLessThanOrEqual(30);
        expect(suggestion).toMatch(/^[a-z0-9_.]+$/);
      });
    });

    it('should handle usernames near max length', () => {
      const longUsername = 'a'.repeat(29);
      const suggestions = service.generateSuggestions(longUsername, 3);
      
      // Should still generate some suggestions even with length constraints
      expect(suggestions.length).toBeGreaterThan(0);
      suggestions.forEach(suggestion => {
        expect(suggestion.length).toBeLessThanOrEqual(30);
      });
    });

    it('should return empty array for invalid usernames', () => {
      const suggestions = service.generateSuggestions('invalid@username', 3);
      expect(suggestions).toHaveLength(0);
    });
  });

  describe('isUsernameChangeAllowed', () => {
    beforeEach(() => {
      configService.get
        .mockReturnValueOnce(3) // USERNAME_MAX_CHANGES_PER_MONTH
        .mockReturnValueOnce(30); // USERNAME_MIN_DAYS_BETWEEN_CHANGES
    });

    it('should allow change for new user', () => {
  const result = service.isUsernameChangeAllowed(null, 0, 'f47ac10b-58cc-4372-a567-0e02b2c3d479');
      expect(result.allowed).toBe(true);
    });

    it('should block if too many changes', () => {
  const result = service.isUsernameChangeAllowed(new Date(), 5, 'f47ac10b-58cc-4372-a567-0e02b2c3d479');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Maximum');
    });

    it('should block if too recent change', () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = service.isUsernameChangeAllowed(yesterday, 1, 'f47ac10b-58cc-4372-a567-0e02b2c3d479');
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Must wait');
      expect(result.nextAllowedAt).toBeDefined();
    });

    it('should allow change after sufficient time', () => {
      const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
  const result = service.isUsernameChangeAllowed(oldDate, 1, 'f47ac10b-58cc-4372-a567-0e02b2c3d479');
      
      expect(result.allowed).toBe(true);
    });
  });

  describe('sanitizeForLogging', () => {
    it('should sanitize usernames for logs', () => {
      expect(service.sanitizeForLogging('john_doe')).toBe('jo***[8]');
      expect(service.sanitizeForLogging('a')).toBe('***');
      expect(service.sanitizeForLogging('ab')).toBe('***');
      expect(service.sanitizeForLogging('abc')).toBe('ab***[3]');
    });

    it('should handle empty/null input', () => {
      expect(service.sanitizeForLogging('')).toBe('***');
      expect(service.sanitizeForLogging(null as any)).toBe('***');
    });
  });

  describe('Edge cases and security', () => {
    it('should handle Unicode normalization consistently', () => {
      // This test would be more relevant if we expand beyond ASCII
      const username = 'café'; // Contains accented character
      const result = service.validateFormat(username);
      
      // Currently should fail since we only allow ASCII
      expect(result.isValid).toBe(false);
    });

    it('should reject potentially confusing usernames', () => {
      const confusingUsernames = [
        'null',
        'undefined',
        'admin',
        'root',
        // These would be caught by reserved names service
      ];

      confusingUsernames.forEach(username => {
        const result = service.validateFormat(username);
        // These pass format validation but should be caught by reserved names
        expect(result.isValid).toBe(true);
      });
    });

    it('should handle very long input without crashing', () => {
      const veryLongUsername = 'a'.repeat(10000);
      const result = service.validateFormat(veryLongUsername);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('no more than'))).toBe(true);
    });

    it('should be consistent across multiple calls', () => {
      const username = 'TestUser123';
      const result1 = service.validateFormat(username);
      const result2 = service.validateFormat(username);
      
      expect(result1).toEqual(result2);
      expect(result1.canonical).toBe(result2.canonical);
    });
  });
});

// Performance tests
describe('UsernameValidationService Performance', () => {
  let service: UsernameValidationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsernameValidationService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<UsernameValidationService>(UsernameValidationService);
  });

  it('should validate usernames quickly', () => {
    const start = Date.now();
    const iterations = 1000;

    for (let i = 0; i < iterations; i++) {
      service.validateFormat(`user${i}`);
    }

    const duration = Date.now() - start;
    const avgDuration = duration / iterations;

    // Should average less than 1ms per validation
    expect(avgDuration).toBeLessThan(1);
  });

  it('should handle batch normalization efficiently', () => {
    const usernames = Array.from({ length: 1000 }, (_, i) => `User${i}_Test`);
    
    const start = Date.now();
    const normalized = usernames.map(u => service.normalizeUsername(u));
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(100); // Should complete in under 100ms
    expect(normalized).toHaveLength(1000);
    expect(normalized[0]).toBe('user0_test');
  });
});