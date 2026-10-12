// filepath: src/validation/onboarding-validation.service.ts
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { trace } from '@opentelemetry/api';
import {
  normalizeUsername,
  isValidUsernameForm,
  hasConsecutiveSpecials,
  startsOrEndsWithSpecial,
  USERNAME_MIN_LENGTH,
  USERNAME_MAX_LENGTH
} from './normalizers/username.normalizer';
import {
  normalizeDisplayName,
  isValidDisplayName
} from './normalizers/display-name.normalizer';
import {
  normalizePhone,
  PhoneNormalizationOptions,
  PhoneNormalizationResult
} from './normalizers/phone.normalizer';
import {
  normalizeAge,
  isValidAge,
  AgeValidationOptions
} from './normalizers/age.normalizer';
import { NormalizationError } from '../../../../packages/phone-normalization/src/errors';

export interface ValidationResult<T = any> {
  isValid: boolean;
  data: T | null;
  errors: ValidationError[];
  warnings: string[];
  sanitized: any; // PII-safe version for logging
}

export interface ValidationError {
  field: string;
  code: string;
  message: string;
  value?: any; // Redacted if sensitive
}

export interface ValidationContext {
  correlationId: string;
  endpoint: string;
  userId?: string;
  ip?: string;
}

// Standardized error response structure
export interface OnboardingErrorResponse {
  error: string;
  message: string;
  statusCode: number;
  correlation_id: string;
  timestamp: string;
  path: string;
  details?: {
    field_errors?: ValidationError[];
    warnings?: string[];
  };
}

interface DisplayNameValidationOptions {
  optional?: boolean;
  minLength?: number;
  maxLength?: number;
}

interface PhoneValidationOptions extends PhoneNormalizationOptions {
  required?: boolean;
}

interface DeclaredAgeValidationOptions extends AgeValidationOptions {
  required?: boolean;
}

export interface RegistrationValidationOptions {
  phone?: PhoneValidationOptions;
  declaredAge?: DeclaredAgeValidationOptions;
}

export interface NormalizedRegistrationPayload {
  username: string;
  normalizedUsername: string;
  email: string;
  password: string;
  displayName?: string | null;
  displayUsername?: string | null;
  declaredAge?: number | null;
  phone?: PhoneNormalizationResult | null;
  pronouns?: string | null;
  termsVersion?: string | null;
  profileImageUrl?: string | null;
}

@Injectable()
export class OnboardingValidationService {
  private readonly logger = new Logger(OnboardingValidationService.name);
  private readonly tracer = trace.getTracer('onboarding-validation');

  // Sensitive field patterns for redaction
  private readonly sensitiveFields = new Set([
    'password',
    'confirm_password',
    'current_password',
    'new_password',
    'token',
    'access_token',
    'refresh_token',
    'api_key',
    'secret',
    'otp',
    'verification_code',
    'sms_code',
    'email_code',
    'recovery_code',
    'backup_code',
    'credit_card',
    'ssn',
    'social_security'
  ]);

  // PII field patterns for careful handling
  private readonly piiFields = new Set([
    'email',
    'phone',
    'phone_number',
    'first_name',
    'last_name',
    'full_name',
    'date_of_birth',
    'birth_date',
    'address',
    'postal_code',
    'zip_code',
    'ip_address'
  ]);

  // URL patterns that might contain secrets
  private readonly secretUrlPatterns = [
    /\/reset-password\/[a-zA-Z0-9-_]+/,
    /\/verify-email\/[a-zA-Z0-9-_]+/,
    /\/invite\/[a-zA-Z0-9-_]+/,
    /token=[a-zA-Z0-9-_]+/,
    /key=[a-zA-Z0-9-_]+/,
    /secret=[a-zA-Z0-9-_]+/
  ];

  /**
   * Validate username input with Instagram rules
   */
  validateUsername(input: any, context: ValidationContext): ValidationResult {
    return this.tracer.startActiveSpan('validate-username', (span) => {
      try {
        span.setAttributes({
          'validation.type': 'username',
          'correlation.id': context.correlationId
        });

        const errors: ValidationError[] = [];
        const normalized = normalizeUsername(input?.username ?? input);

        if (this.isBlank(normalized)) {
          errors.push({
            field: 'username',
            code: 'required',
            message: 'Username is required'
          });
          return this.buildValidationResult(false, null, errors, [], context);
        }

        const length = Array.from(normalized).length;
        if (length < USERNAME_MIN_LENGTH || length > USERNAME_MAX_LENGTH) {
          errors.push({
            field: 'username',
            code: 'invalid_length',
            message: `Username must be between ${USERNAME_MIN_LENGTH} and ${USERNAME_MAX_LENGTH} characters`
          });
        }

        if (length >= USERNAME_MIN_LENGTH && length <= USERNAME_MAX_LENGTH) {
          if (!isValidUsernameForm(normalized)) {
            errors.push({
              field: 'username',
              code: 'invalid_characters',
              message: 'Username can only contain letters, numbers, periods, and underscores'
            });
          }

          if (hasConsecutiveSpecials(normalized)) {
            errors.push({
              field: 'username',
              code: 'consecutive_specials',
              message: 'Username cannot contain consecutive periods or underscores'
            });
          }

          if (startsOrEndsWithSpecial(normalized)) {
            errors.push({
              field: 'username',
              code: 'invalid_boundaries',
              message: 'Username cannot start or end with periods or underscores'
            });
          }
        }

        const isValid = errors.length === 0;
        return this.buildValidationResult(isValid, isValid ? normalized : null, errors, [], context);

      } catch (error) {
        span.recordException(error as Error);
        this.logger.error('Username validation failed', {
          error: error.message,
          correlation_id: context.correlationId
        });
        
        return this.buildValidationResult(false, null, [{
          field: 'username',
          code: 'validation_error',
          message: 'Username validation failed'
        }], [], context);
      } finally {
        span.end();
      }
    });
  }

  /**
   * Validate email with normalization
   */
  validateEmail(input: any, context: ValidationContext): ValidationResult {
    return this.tracer.startActiveSpan('validate-email', (span) => {
      try {
        span.setAttributes({
          'validation.type': 'email',
          'correlation.id': context.correlationId
        });

        const errors: ValidationError[] = [];
        let email = this.normalizeString(input?.email || input);

        if (!email || email.trim().length === 0) {
          errors.push({
            field: 'email',
            code: 'required',
            message: 'Email is required'
          });
          return this.buildValidationResult(false, null, errors, [], context);
        }

        email = email.trim().toLowerCase();

        // Basic email format validation
        const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        if (!emailPattern.test(email)) {
          errors.push({
            field: 'email',
            code: 'invalid_format',
            message: 'Invalid email format'
          });
        }

        // Length validation
        if (email.length > 254) {
          errors.push({
            field: 'email',
            code: 'too_long',
            message: 'Email address is too long'
          });
        }

        // Disposable email check (basic patterns)
        const disposablePatterns = [
          /10minutemail\./,
          /tempmail\./,
          /guerrillamail\./,
          /mailinator\./,
          /throwaway\./
        ];

        const isDisposable = disposablePatterns.some(pattern => pattern.test(email));
        if (isDisposable) {
          errors.push({
            field: 'email',
            code: 'disposable_email',
            message: 'Disposable email addresses are not allowed'
          });
        }

        const isValid = errors.length === 0;
        return this.buildValidationResult(isValid, isValid ? email : null, errors, [], context);

      } catch (error) {
        span.recordException(error as Error);
        this.logger.error('Email validation failed', {
          error: error.message,
          correlation_id: context.correlationId
        });
        
        return this.buildValidationResult(false, null, [{
          field: 'email',
          code: 'validation_error',
          message: 'Email validation failed'
        }], [], context);
      } finally {
        span.end();
      }
    });
  }

  /**
   * Validate password strength
   */
  validatePassword(input: any, context: ValidationContext): ValidationResult {
    return this.tracer.startActiveSpan('validate-password', (span) => {
      try {
        span.setAttributes({
          'validation.type': 'password',
          'correlation.id': context.correlationId
        });

        const errors: ValidationError[] = [];
        const warnings: string[] = [];
        const password = input?.password || input;

        if (!password || typeof password !== 'string') {
          errors.push({
            field: 'password',
            code: 'required',
            message: 'Password is required'
          });
          return this.buildValidationResult(false, null, errors, warnings, context);
        }

        // Length requirements
        if (password.length < 8) {
          errors.push({
            field: 'password',
            code: 'too_short',
            message: 'Password must be at least 8 characters long'
          });
        }

        if (password.length > 128) {
          errors.push({
            field: 'password',
            code: 'too_long',
            message: 'Password must not exceed 128 characters'
          });
        }

        // Strength requirements
        const hasLowercase = /[a-z]/.test(password);
        const hasUppercase = /[A-Z]/.test(password);
        const hasDigits = /\d/.test(password);
        const hasSpecialChars = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);

        if (!hasLowercase) {
          errors.push({
            field: 'password',
            code: 'missing_lowercase',
            message: 'Password must contain at least one lowercase letter'
          });
        }

        if (!hasUppercase) {
          errors.push({
            field: 'password',
            code: 'missing_uppercase',
            message: 'Password must contain at least one uppercase letter'
          });
        }

        if (!hasDigits) {
          errors.push({
            field: 'password',
            code: 'missing_digits',
            message: 'Password must contain at least one number'
          });
        }

        if (!hasSpecialChars) {
          warnings.push('Consider adding special characters for stronger security');
        }

        // Common password checks
        const commonPasswords = [
          'password', 'password123', '123456', 'qwerty', 'admin', 'letmein',
          'welcome', 'monkey', '1234567890', 'iloveyou'
        ];

        if (commonPasswords.includes(password.toLowerCase())) {
          errors.push({
            field: 'password',
            code: 'too_common',
            message: 'Password is too common. Please choose a stronger password'
          });
        }

        const isValid = errors.length === 0;
        return this.buildValidationResult(isValid, isValid ? password : null, errors, warnings, context);

      } catch (error) {
        span.recordException(error as Error);
        this.logger.error('Password validation failed', {
          error: error.message,
          correlation_id: context.correlationId
        });
        
        return this.buildValidationResult(false, null, [{
          field: 'password',
          code: 'validation_error',
          message: 'Password validation failed'
        }], [], context);
      } finally {
        span.end();
      }
    });
  }

  validateDisplayName(
    value: any,
    fieldName: string,
    context: ValidationContext,
    options: DisplayNameValidationOptions = {}
  ): ValidationResult<string | null> {
    return this.tracer.startActiveSpan(`validate-${fieldName}`, (span) => {
      try {
        span.setAttributes({
          'validation.type': fieldName,
          'correlation.id': context.correlationId
        });

        const optional = options.optional !== false;
        const errors: ValidationError[] = [];
        const normalized = normalizeDisplayName(value);

        if (this.isBlank(value) || normalized.length === 0) {
          if (optional) {
            return this.buildValidationResult(true, null, errors, [], context);
          }

          errors.push({
            field: fieldName,
            code: 'required',
            message: `${this.humanizeField(fieldName)} is required`
          });
          return this.buildValidationResult(false, null, errors, [], context);
        }

        const minLength = options.minLength ?? 1;
        const maxLength = options.maxLength ?? 80;

        if (!isValidDisplayName(normalized, { minLength, maxLength })) {
          errors.push({
            field: fieldName,
            code: 'invalid_length',
            message: `${this.humanizeField(fieldName)} must be between ${minLength} and ${maxLength} characters`
          });
        }

        const isValid = errors.length === 0;
        return this.buildValidationResult(isValid, isValid ? normalized : null, errors, [], context);
      } catch (error) {
        span.recordException(error as Error);
        this.logger.error(`${this.humanizeField(fieldName)} validation failed`, {
          error: (error as Error).message,
          correlation_id: context.correlationId
        });

        return this.buildValidationResult(false, null, [{
          field: fieldName,
          code: 'validation_error',
          message: `${this.humanizeField(fieldName)} validation failed`
        }], [], context);
      } finally {
        span.end();
      }
    });
  }

  validatePhoneNumber(
    value: any,
    fieldName: string,
    context: ValidationContext,
    options: PhoneValidationOptions = {}
  ): ValidationResult<PhoneNormalizationResult | null> {
    return this.tracer.startActiveSpan(`validate-${fieldName}`, (span) => {
      try {
        span.setAttributes({
          'validation.type': fieldName,
          'correlation.id': context.correlationId
        });

        const required = options.required === true;
        const errors: ValidationError[] = [];

        if (this.isBlank(value)) {
          if (!required) {
            return this.buildValidationResult(true, null, errors, [], context);
          }

          errors.push({
            field: fieldName,
            code: 'required',
            message: `${this.humanizeField(fieldName)} is required`
          });
          return this.buildValidationResult(false, null, errors, [], context);
        }

        try {
          const { required: _required, ...normalizeOptions } = options;
          const normalized = normalizePhone(value, normalizeOptions);
          return this.buildValidationResult(true, normalized, errors, [], context);
        } catch (error) {
          if (error instanceof NormalizationError) {
            errors.push({
              field: fieldName,
              code: error.code.toLowerCase(),
              message: error.message
            });
            return this.buildValidationResult(false, null, errors, [], context);
          }
          throw error;
        }
      } catch (error) {
        span.recordException(error as Error);
        this.logger.error(`${this.humanizeField(fieldName)} validation failed`, {
          error: (error as Error).message,
          correlation_id: context.correlationId
        });

        return this.buildValidationResult(false, null, [{
          field: fieldName,
          code: 'validation_error',
          message: `${this.humanizeField(fieldName)} validation failed`
        }], [], context);
      } finally {
        span.end();
      }
    });
  }

  validateDeclaredAge(
    value: any,
    fieldName: string,
    context: ValidationContext,
    options: DeclaredAgeValidationOptions = {}
  ): ValidationResult<number | null> {
    return this.tracer.startActiveSpan(`validate-${fieldName}`, (span) => {
      try {
        span.setAttributes({
          'validation.type': fieldName,
          'correlation.id': context.correlationId
        });

        const required = options.required === true;
        const errors: ValidationError[] = [];

        if (this.isBlank(value)) {
          if (!required) {
            return this.buildValidationResult(true, null, errors, [], context);
          }

          errors.push({
            field: fieldName,
            code: 'required',
            message: `${this.humanizeField(fieldName)} is required`
          });
          return this.buildValidationResult(false, null, errors, [], context);
        }

        const normalized = normalizeAge(value);
        if (normalized === null || Number.isNaN(normalized)) {
          errors.push({
            field: fieldName,
            code: 'invalid_type',
            message: `${this.humanizeField(fieldName)} must be an integer`
          });
          return this.buildValidationResult(false, null, errors, [], context);
        }

        const min = options.min ?? 0;
        const max = options.max ?? 150;

        if (!isValidAge(normalized, { min, max })) {
          if (normalized < min) {
            errors.push({
              field: fieldName,
              code: 'below_minimum',
              message: `${this.humanizeField(fieldName)} must be at least ${min}`
            });
          } else if (normalized > max) {
            errors.push({
              field: fieldName,
              code: 'above_maximum',
              message: `${this.humanizeField(fieldName)} must be no more than ${max}`
            });
          }
        }

        const isValid = errors.length === 0;
        return this.buildValidationResult(isValid, isValid ? normalized : null, errors, [], context);
      } catch (error) {
        span.recordException(error as Error);
        this.logger.error(`${this.humanizeField(fieldName)} validation failed`, {
          error: (error as Error).message,
          correlation_id: context.correlationId
        });

        return this.buildValidationResult(false, null, [{
          field: fieldName,
          code: 'validation_error',
          message: `${this.humanizeField(fieldName)} validation failed`
        }], [], context);
      } finally {
        span.end();
      }
    });
  }

  validateRegistrationPayload(
    input: any,
    context: ValidationContext,
    options: RegistrationValidationOptions = {}
  ): ValidationResult<NormalizedRegistrationPayload> {
    return this.tracer.startActiveSpan('validate-registration-payload', (span) => {
      try {
        span.setAttributes({
          'validation.type': 'registration',
          'correlation.id': context.correlationId
        });

        const errors: ValidationError[] = [];
        const warnings: string[] = [];

        const normalized: NormalizedRegistrationPayload = {
          username: '',
          normalizedUsername: '',
          email: '',
          password: '',
          displayName: null,
          displayUsername: null,
          declaredAge: null,
          phone: null,
          pronouns: null,
          termsVersion: null,
          profileImageUrl: null
        };

        const usernameResult = this.validateUsername({ username: input?.username }, context);
        errors.push(...usernameResult.errors);
        warnings.push(...usernameResult.warnings);
        if (usernameResult.isValid && usernameResult.data) {
          normalized.username = this.normalizeString(input?.username ?? usernameResult.data);
          normalized.normalizedUsername = normalizeUsername(usernameResult.data);
        }

        const emailResult = this.validateEmail({ email: input?.email }, context);
        errors.push(...emailResult.errors);
        warnings.push(...emailResult.warnings);
        if (emailResult.isValid && emailResult.data) {
          normalized.email = emailResult.data;
        }

        const passwordResult = this.validatePassword({ password: input?.password }, context);
        errors.push(...passwordResult.errors);
        warnings.push(...passwordResult.warnings);
        if (passwordResult.isValid && passwordResult.data) {
          normalized.password = passwordResult.data;
        }

        const displayNameResult = this.validateDisplayName(
          input?.display_name ?? input?.displayName,
          'display_name',
          context,
          { optional: true, maxLength: 80 }
        );
        errors.push(...displayNameResult.errors);
        warnings.push(...displayNameResult.warnings);
        if (displayNameResult.isValid) {
          normalized.displayName = displayNameResult.data;
        }

        const displayUsernameResult = this.validateDisplayName(
          input?.displayUsername ?? input?.display_username,
          'displayUsername',
          context,
          { optional: true, maxLength: USERNAME_MAX_LENGTH }
        );
        errors.push(...displayUsernameResult.errors);
        warnings.push(...displayUsernameResult.warnings);
        if (displayUsernameResult.isValid) {
          normalized.displayUsername = displayUsernameResult.data;
        }

        const phoneResult = this.validatePhoneNumber(
          input?.phone_number ?? input?.phone,
          'phone_number',
          context,
          options.phone ?? {}
        );
        errors.push(...phoneResult.errors);
        warnings.push(...phoneResult.warnings);
        if (phoneResult.isValid) {
          normalized.phone = phoneResult.data;
        }

        const ageResult = this.validateDeclaredAge(
          input?.declared_age ?? input?.declaredAge,
          'declared_age',
          context,
          options.declaredAge ?? {}
        );
        errors.push(...ageResult.errors);
        warnings.push(...ageResult.warnings);
        if (ageResult.isValid) {
          normalized.declaredAge = ageResult.data;
        }

        normalized.pronouns = this.normalizeOptionalString(input?.pronouns);
        normalized.termsVersion = this.normalizeOptionalString(input?.terms_version ?? input?.termsVersion);
        normalized.profileImageUrl = this.normalizeOptionalString(input?.profile_image_url ?? input?.profileImageUrl);

        if (!normalized.displayUsername) {
          normalized.displayUsername = normalized.username || null;
        }

        const isValid = errors.length === 0;
        return this.buildValidationResult(
          isValid,
          isValid ? normalized : null,
          errors,
          warnings,
          context
        );
      } catch (error) {
        span.recordException(error as Error);
        this.logger.error('Registration payload validation failed', {
          error: (error as Error).message,
          correlation_id: context.correlationId
        });

        return this.buildValidationResult(false, null, [{
          field: 'registration',
          code: 'validation_error',
          message: 'Registration payload validation failed'
        }], [], context);
      } finally {
        span.end();
      }
    });
  }

  /**
   * Validate legal acceptance data
   */
  validateLegalAcceptance(input: any, context: ValidationContext): ValidationResult {
    return this.tracer.startActiveSpan('validate-legal-acceptance', (span) => {
      try {
        const errors: ValidationError[] = [];
        const data: any = {};

        // Required: terms acceptance
        if (!input?.terms_accepted || input.terms_accepted !== true) {
          errors.push({
            field: 'terms_accepted',
            code: 'required',
            message: 'Terms of service must be accepted'
          });
        } else {
          data.terms_accepted = true;
        }

        // Required: privacy policy acceptance
        if (!input?.privacy_accepted || input.privacy_accepted !== true) {
          errors.push({
            field: 'privacy_accepted',
            code: 'required',
            message: 'Privacy policy must be accepted'
          });
        } else {
          data.privacy_accepted = true;
        }

        // Optional: marketing consent
        data.marketing_consent = input?.marketing_consent === true;

        // Validate policy version if provided
        if (input?.policy_version) {
          const version = this.normalizeString(input.policy_version);
          if (!/^\d+\.\d+$/.test(version)) {
            errors.push({
              field: 'policy_version',
              code: 'invalid_format',
              message: 'Invalid policy version format'
            });
          } else {
            data.policy_version = version;
          }
        }

        const isValid = errors.length === 0;
        return this.buildValidationResult(isValid, data, errors, [], context);

      } catch (error) {
        span.recordException(error as Error);
        this.logger.error('Legal acceptance validation failed', {
          error: error.message,
          correlation_id: context.correlationId
        });
        
        return this.buildValidationResult(false, null, [{
          field: 'legal',
          code: 'validation_error',
          message: 'Legal acceptance validation failed'
        }], [], context);
      } finally {
        span.end();
      }
    });
  }

  /**
   * Redact sensitive information from any object for logging
   */
  sanitizeForLogging(data: any, context?: ValidationContext): any {
    if (!data) return data;

    if (typeof data === 'string') {
      return this.redactString(data);
    }

    if (Array.isArray(data)) {
      return data.map(item => this.sanitizeForLogging(item, context));
    }

    if (typeof data === 'object') {
      const sanitized: any = {};
      
      for (const [key, value] of Object.entries(data)) {
        const lowerKey = key.toLowerCase();
        
        if (this.sensitiveFields.has(lowerKey)) {
          sanitized[key] = '[REDACTED]';
        } else if (this.piiFields.has(lowerKey)) {
          sanitized[key] = this.hashForLogging(String(value));
        } else if (typeof value === 'string' && this.containsSecretUrl(value)) {
          sanitized[key] = this.redactSecretUrls(value);
        } else {
          sanitized[key] = this.sanitizeForLogging(value, context);
        }
      }
      
      return sanitized;
    }

    return data;
  }

  /**
   * Create standardized error response
   */
  createErrorResponse(
    error: string,
    message: string,
    statusCode: number,
    correlationId: string,
    path: string,
    details?: any
  ): OnboardingErrorResponse {
    return {
      error,
      message,
      statusCode,
      correlation_id: correlationId,
      timestamp: new Date().toISOString(),
      path,
      details: details ? this.sanitizeForLogging(details) : undefined
    };
  }

  /**
   * Throw standardized validation exception
   */
  throwValidationError(
    errors: ValidationError[],
    correlationId: string,
    path: string
  ): never {
    throw new BadRequestException(
      this.createErrorResponse(
        'validation_failed',
        'Input validation failed',
        400,
        correlationId,
        path,
        { field_errors: errors }
      )
    );
  }

  private isBlank(value: any): boolean {
    if (value === null || value === undefined) {
      return true;
    }

    if (typeof value === 'string') {
      return value.trim().length === 0;
    }

    return false;
  }

  private humanizeField(fieldName: string): string {
    if (!fieldName) {
      return '';
    }

    const spaced = fieldName
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .toLowerCase();

    return spaced.replace(/(^|\s)\w/g, (match) => match.toUpperCase()).trim();
  }

  private normalizeOptionalString(value: any): string | null {
    if (this.isBlank(value)) {
      return null;
    }

    const normalized = this.normalizeString(value);
    return normalized.length > 0 ? normalized : null;
  }

  private normalizeString(value: any): string {
    if (typeof value !== 'string') {
      return String(value || '');
    }
    return value.trim();
  }

  private buildValidationResult<T>(
    isValid: boolean,
    data: T | null,
    errors: ValidationError[],
    warnings: string[],
    context: ValidationContext
  ): ValidationResult<T> {
    return {
      isValid,
      data,
      errors,
      warnings,
      sanitized: this.sanitizeForLogging(data, context)
    };
  }

  private redactString(value: string): string {
    // Redact potential secrets in strings
    if (value.length > 20) {
      return `${value.substring(0, 4)}***${value.substring(value.length - 4)}`;
    }
    return '[REDACTED]';
  }

  private containsSecretUrl(value: string): boolean {
    return this.secretUrlPatterns.some(pattern => pattern.test(value));
  }

  private redactSecretUrls(value: string): string {
    let redacted = value;
    this.secretUrlPatterns.forEach(pattern => {
      redacted = redacted.replace(pattern, '[URL_WITH_SECRET_REDACTED]');
    });
    return redacted;
  }

  private hashForLogging(value: string): string {
    // Simple hash for PII correlation without exposure
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      const char = value.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `[HASH:${hash.toString(16)}]`;
  }
}