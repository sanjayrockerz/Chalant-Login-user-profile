/**
 * Push Token Validator Unit Tests
 * 
 * Comprehensive test coverage for FCM and APNs token format validation.
 * Tests valid formats, boundary conditions, and common invalid patterns.
 */

import {
  validateFcmToken,
  validateApnsToken,
  validateToken,
  getValidationErrorMessage,
  TokenValidator,
} from './token-validator.util';

describe('TokenValidator', () => {
  describe('validateFcmToken', () => {
    describe('valid FCM tokens', () => {
      it('should accept 100-character token', () => {
        const token = 'a'.repeat(100);
        expect(validateFcmToken(token)).toBe(true);
      });

      it('should accept 152-character token', () => {
        const token = 'a'.repeat(152);
        expect(validateFcmToken(token)).toBe(true);
      });

      it('should accept 200-character token', () => {
        const token = 'A'.repeat(200);
        expect(validateFcmToken(token)).toBe(true);
      });

      it('should accept 499-character token', () => {
        const token = '1'.repeat(499);
        expect(validateFcmToken(token)).toBe(true);
      });

      it('should accept 500-character token (max length)', () => {
        const token = 'Z'.repeat(500);
        expect(validateFcmToken(token)).toBe(true);
      });

      it('should accept token with underscores', () => {
        const token = 'a_b_c_' + 'd'.repeat(94);
        expect(validateFcmToken(token)).toBe(true);
      });

      it('should accept token with hyphens', () => {
        const token = 'a-b-c-' + 'd'.repeat(94);
        expect(validateFcmToken(token)).toBe(true);
      });

      it('should accept token with colons', () => {
        const token = 'a:b:c:' + 'd'.repeat(94);
        expect(validateFcmToken(token)).toBe(true);
      });

      it('should accept token with mixed valid characters', () => {
        const token = 'aZ09_-:' + 'x'.repeat(93);
        expect(validateFcmToken(token)).toBe(true);
      });

      it('should accept realistic FCM token', () => {
        // Realistic 152-character FCM token (within 100-500 range)
        const token = 'cXJq9_8sRK2wGhJ3vN5mLP:APA91bF7Yx2kT4nQ8pM6wR1vL3sJ9hD0cB5eG7fK2mN4pQ8rT6vX9yA2bC5dE7fG9hJ1kL3mN5pQ8rT0vX3yZ6aB9cD2eF5gH8jK1lM4nP7qS0tV3wY6zA9bC2dE5fG8hJ1k';
        expect(validateFcmToken(token)).toBe(true);
      });
    });

    describe('invalid FCM tokens', () => {
      it('should reject token that is too short (99 chars)', () => {
        const token = 'a'.repeat(99);
        expect(validateFcmToken(token)).toBe(false);
      });

      it('should reject token that is too long (501 chars)', () => {
        const token = 'a'.repeat(501);
        expect(validateFcmToken(token)).toBe(false);
      });

      it('should reject token with spaces', () => {
        const token = 'abc def ' + 'g'.repeat(92);
        expect(validateFcmToken(token)).toBe(false);
      });

      it('should reject token with @ symbol', () => {
        const token = 'abc@def' + 'g'.repeat(93);
        expect(validateFcmToken(token)).toBe(false);
      });

      it('should reject token with # symbol', () => {
        const token = 'abc#def' + 'g'.repeat(93);
        expect(validateFcmToken(token)).toBe(false);
      });

      it('should reject token with $ symbol', () => {
        const token = 'abc$def' + 'g'.repeat(93);
        expect(validateFcmToken(token)).toBe(false);
      });

      it('should reject token with newline', () => {
        const token = 'abc\ndef' + 'g'.repeat(93);
        expect(validateFcmToken(token)).toBe(false);
      });

      it('should reject empty string', () => {
        expect(validateFcmToken('')).toBe(false);
      });

      it('should reject null', () => {
        // @ts-ignore - testing invalid input
        expect(validateFcmToken(null)).toBe(false);
      });

      it('should reject undefined', () => {
        // @ts-ignore - testing invalid input
        expect(validateFcmToken(undefined)).toBe(false);
      });
    });
  });

  describe('validateApnsToken', () => {
    describe('valid APNs tokens', () => {
      it('should accept 64 lowercase hex characters', () => {
        const token = 'a'.repeat(64);
        expect(validateApnsToken(token)).toBe(true);
      });

      it('should accept 64 uppercase hex characters', () => {
        const token = 'A'.repeat(64);
        expect(validateApnsToken(token)).toBe(true);
      });

      it('should accept 64 mixed case hex characters', () => {
        const token = 'aAbBcCdDeEfF0123456789abcdefABCDEF0123456789abcdefABCDEF01234567';
        expect(validateApnsToken(token)).toBe(true);
      });

      it('should accept all numeric hex', () => {
        const token = '0123456789'.repeat(6) + '0123';
        expect(validateApnsToken(token)).toBe(true);
      });

      it('should accept realistic APNs token', () => {
        const token = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
        expect(validateApnsToken(token)).toBe(true);
      });

      it('should accept APNs token with mixed hex chars', () => {
        const token = 'aB3d5f7E9c1A4b6D8e0F2a4c6e8b0d2f4a6c8e0b2d4f6a8c0e2b4d6f8a0c2e4f';
        expect(validateApnsToken(token)).toBe(true);
      });
    });

    describe('invalid APNs tokens', () => {
      it('should reject token with 63 characters (too short)', () => {
        const token = 'a'.repeat(63);
        expect(validateApnsToken(token)).toBe(false);
      });

      it('should reject token with 65 characters (too long)', () => {
        const token = 'a'.repeat(65);
        expect(validateApnsToken(token)).toBe(false);
      });

      it('should reject token containing "g"', () => {
        const token = 'g' + 'a'.repeat(63);
        expect(validateApnsToken(token)).toBe(false);
      });

      it('should reject token containing "z"', () => {
        const token = 'z' + 'a'.repeat(63);
        expect(validateApnsToken(token)).toBe(false);
      });

      it('should reject token with spaces', () => {
        const token = 'abcd efgh' + '1'.repeat(55);
        expect(validateApnsToken(token)).toBe(false);
      });

      it('should reject token with hyphen', () => {
        const token = 'abcd-efgh' + '1'.repeat(55);
        expect(validateApnsToken(token)).toBe(false);
      });

      it('should reject token with underscore', () => {
        const token = 'abcd_efgh' + '1'.repeat(55);
        expect(validateApnsToken(token)).toBe(false);
      });

      it('should reject empty string', () => {
        expect(validateApnsToken('')).toBe(false);
      });

      it('should reject null', () => {
        // @ts-ignore - testing invalid input
        expect(validateApnsToken(null)).toBe(false);
      });

      it('should reject undefined', () => {
        // @ts-ignore - testing invalid input
        expect(validateApnsToken(undefined)).toBe(false);
      });
    });
  });

  describe('validateToken (platform dispatcher)', () => {
    it('should validate FCM token for android platform', () => {
      const token = 'a'.repeat(150);
      expect(validateToken(token, 'android')).toBe(true);
    });

    it('should validate APNs token for ios platform', () => {
      const token = 'a'.repeat(64);
      expect(validateToken(token, 'ios')).toBe(true);
    });

    it('should reject FCM token format for ios platform', () => {
      const token = 'a'.repeat(150);
      expect(validateToken(token, 'ios')).toBe(false);
    });

    it('should reject APNs token format for android platform', () => {
      const token = 'a'.repeat(64);
      expect(validateToken(token, 'android')).toBe(false);
    });

    it('should reject empty token', () => {
      expect(validateToken('', 'ios')).toBe(false);
      expect(validateToken('', 'android')).toBe(false);
    });

    it('should reject null platform', () => {
      const token = 'a'.repeat(100);
      // @ts-ignore - testing invalid input
      expect(validateToken(token, null)).toBe(false);
    });
  });

  describe('getValidationErrorMessage', () => {
    it('should return FCM error message for android platform', () => {
      const message = getValidationErrorMessage('android');
      expect(message).toContain('FCM');
      expect(message).toContain('100-500');
      expect(message).toContain('alphanumeric');
    });

    it('should return APNs error message for ios platform', () => {
      const message = getValidationErrorMessage('ios');
      expect(message).toContain('APNs');
      expect(message).toContain('64');
      expect(message).toContain('hexadecimal');
    });

    it('should return generic message for invalid platform', () => {
      // @ts-ignore - testing invalid input
      const message = getValidationErrorMessage('invalid');
      expect(message).toContain('Invalid push token format');
    });
  });

  describe('TokenValidator class', () => {
    it('should expose validateFcmToken as static method', () => {
      expect(typeof TokenValidator.validateFcmToken).toBe('function');
      expect(TokenValidator.validateFcmToken('a'.repeat(100))).toBe(true);
    });

    it('should expose validateApnsToken as static method', () => {
      expect(typeof TokenValidator.validateApnsToken).toBe('function');
      expect(TokenValidator.validateApnsToken('a'.repeat(64))).toBe(true);
    });

    it('should expose validateToken as static method', () => {
      expect(typeof TokenValidator.validateToken).toBe('function');
      expect(TokenValidator.validateToken('a'.repeat(100), 'android')).toBe(true);
    });

    it('should expose getValidationErrorMessage as static method', () => {
      expect(typeof TokenValidator.getValidationErrorMessage).toBe('function');
      expect(TokenValidator.getValidationErrorMessage('ios')).toContain('APNs');
    });
  });
});
