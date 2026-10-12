import { 
  registerDecorator, 
  ValidationOptions, 
  ValidationArguments, 
  ValidatorConstraint, 
  ValidatorConstraintInterface 
} from 'class-validator';
import { PushPlatform, PushTokenType } from '../dto/push-token.dto';

/**
 * Custom validator for FCM token format
 * FCM tokens are base64url-encoded strings, typically 152+ characters
 */
@ValidatorConstraint({ name: 'isFcmToken', async: false })
export class IsFcmTokenConstraint implements ValidatorConstraintInterface {
  validate(token: string, args: ValidationArguments) {
    if (!token || typeof token !== 'string') {
      return false;
    }

    // FCM tokens are base64url encoded and typically 152+ characters
    // They contain letters, numbers, hyphens, and underscores
    const fcmTokenPattern = /^[A-Za-z0-9_-]{152,}$/;
    
    return fcmTokenPattern.test(token);
  }

  defaultMessage(args: ValidationArguments) {
    return 'FCM token must be a valid base64url-encoded string with at least 152 characters';
  }
}

/**
 * Custom validator for APNs token format
 * APNs device tokens are 64 character hex strings (32 bytes)
 */
@ValidatorConstraint({ name: 'isApnsToken', async: false })
export class IsApnsTokenConstraint implements ValidatorConstraintInterface {
  validate(token: string, args: ValidationArguments) {
    if (!token || typeof token !== 'string') {
      return false;
    }

    // APNs tokens are 64 character hexadecimal strings
    const apnsTokenPattern = /^[a-fA-F0-9]{64}$/;
    
    return apnsTokenPattern.test(token);
  }

  defaultMessage(args: ValidationArguments) {
    return 'APNs token must be a 64-character hexadecimal string';
  }
}

/**
 * Custom validator to ensure platform and token type compatibility
 */
@ValidatorConstraint({ name: 'isPlatformTokenCompatible', async: false })
export class IsPlatformTokenCompatibleConstraint implements ValidatorConstraintInterface {
  validate(value: any, args: ValidationArguments) {
    const object = args.object as any;
    const platform = object.platform;
    const tokenType = object.tokenType;
    const token = object.token;

    if (!platform || !tokenType || !token) {
      return false; // Let other validators handle missing fields
    }

    // Check platform-token type compatibility
    const isCompatible = 
      (platform === PushPlatform.IOS && tokenType === PushTokenType.APNS) ||
      (platform === PushPlatform.ANDROID && tokenType === PushTokenType.FCM);

    if (!isCompatible) {
      return false;
    }

    // Validate token format based on type
    if (tokenType === PushTokenType.FCM) {
      return new IsFcmTokenConstraint().validate(token, args);
    } else if (tokenType === PushTokenType.APNS) {
      return new IsApnsTokenConstraint().validate(token, args);
    }

    return false;
  }

  defaultMessage(args: ValidationArguments) {
    const object = args.object as any;
    const platform = object.platform;
    const tokenType = object.tokenType;

    if (platform === PushPlatform.IOS && tokenType !== PushTokenType.APNS) {
      return 'iOS platform requires APNs token type';
    }
    if (platform === PushPlatform.ANDROID && tokenType !== PushTokenType.FCM) {
      return 'Android platform requires FCM token type';
    }

    return 'Invalid token format for the specified platform and token type';
  }
}

/**
 * Custom validator for device metadata structure
 */
@ValidatorConstraint({ name: 'isValidDeviceMetadata', async: false })
export class IsValidDeviceMetadataConstraint implements ValidatorConstraintInterface {
  validate(metadata: any, args: ValidationArguments) {
    if (!metadata) {
      return true; // Optional field
    }

    if (typeof metadata !== 'object') {
      return false;
    }

    // Validate required structure and reasonable values
    if (metadata.model && typeof metadata.model !== 'string') {
      return false;
    }

    if (metadata.osVersion && !/^\d+\.\d+(\.\d+)?$/.test(metadata.osVersion)) {
      return false;
    }

    if (metadata.appVersion && typeof metadata.appVersion !== 'string') {
      return false;
    }

    if (metadata.deviceId && (typeof metadata.deviceId !== 'string' || metadata.deviceId.length < 8)) {
      return false;
    }

    if (metadata.locale && !/^[a-z]{2}-[A-Z]{2}$/.test(metadata.locale)) {
      return false;
    }

    if (metadata.timezone && typeof metadata.timezone !== 'string') {
      return false;
    }

    return true;
  }

  defaultMessage(args: ValidationArguments) {
    return 'Device metadata must contain valid model, osVersion, appVersion, deviceId, locale, and timezone fields';
  }
}

/**
 * Decorator for FCM token validation
 */
export function IsFcmToken(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isFcmToken',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: IsFcmTokenConstraint,
    });
  };
}

/**
 * Decorator for APNs token validation
 */
export function IsApnsToken(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isApnsToken',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: IsApnsTokenConstraint,
    });
  };
}

/**
 * Decorator for platform-token compatibility validation
 */
export function IsPlatformTokenCompatible(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isPlatformTokenCompatible',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: IsPlatformTokenCompatibleConstraint,
    });
  };
}

/**
 * Decorator for device metadata validation
 */
export function IsValidDeviceMetadata(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isValidDeviceMetadata',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: IsValidDeviceMetadataConstraint,
    });
  };
}

/**
 * Utility functions for token validation
 */
export class TokenValidationUtils {
  /**
   * Validates FCM token format
   */
  static isValidFcmToken(token: string): boolean {
    if (!token || typeof token !== 'string') {
      return false;
    }
    
    // FCM tokens are base64url strings, typically 152+ characters
    const fcmPattern = /^[A-Za-z0-9_-]{152,}$/;
    return fcmPattern.test(token);
  }

  /**
   * Validates APNs token format
   */
  static isValidApnsToken(token: string): boolean {
    if (!token || typeof token !== 'string') {
      return false;
    }
    
    // APNs tokens are 64-character hex strings
    const apnsPattern = /^[a-fA-F0-9]{64}$/;
    return apnsPattern.test(token);
  }

  /**
   * Validates token based on platform and type
   */
  static validateTokenForPlatform(
    token: string, 
    platform: PushPlatform, 
    tokenType: PushTokenType
  ): { isValid: boolean; error?: string } {
    // Check platform-token type compatibility first
    const isCompatible = 
      (platform === PushPlatform.IOS && tokenType === PushTokenType.APNS) ||
      (platform === PushPlatform.ANDROID && tokenType === PushTokenType.FCM);

    if (!isCompatible) {
      return {
        isValid: false,
        error: `Platform ${platform} is not compatible with token type ${tokenType}`
      };
    }

    // Validate token format
    if (tokenType === PushTokenType.FCM) {
      const isValid = this.isValidFcmToken(token);
      return {
        isValid,
        error: isValid ? undefined : 'Invalid FCM token format'
      };
    }

    if (tokenType === PushTokenType.APNS) {
      const isValid = this.isValidApnsToken(token);
      return {
        isValid,
        error: isValid ? undefined : 'Invalid APNs token format'
      };
    }

    return {
      isValid: false,
      error: 'Unknown token type'
    };
  }

  /**
   * Masks a token for safe logging/response
   */
  static maskToken(token: string): string {
    if (!token || token.length < 8) {
      return '***';
    }
    
    // Show only last 8 characters
    return `***...${token.slice(-8)}`;
  }

  /**
   * Generates a SHA-256 hash of the token for duplicate detection
   */
  static hashToken(token: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Validates device metadata structure
   */
  static validateDeviceMetadata(metadata: any): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!metadata) {
      return { isValid: true, errors }; // Optional field
    }

    if (typeof metadata !== 'object') {
      errors.push('Device metadata must be an object');
      return { isValid: false, errors };
    }

    // Validate individual fields
    if (metadata.model !== undefined && typeof metadata.model !== 'string') {
      errors.push('Device model must be a string');
    }

    if (metadata.osVersion !== undefined && !/^\d+\.\d+(\.\d+)?$/.test(metadata.osVersion)) {
      errors.push('OS version must be in format X.Y or X.Y.Z');
    }

    if (metadata.appVersion !== undefined && typeof metadata.appVersion !== 'string') {
      errors.push('App version must be a string');
    }

    if (metadata.deviceId !== undefined && 
        (typeof metadata.deviceId !== 'string' || metadata.deviceId.length < 8)) {
      errors.push('Device ID must be a string with at least 8 characters');
    }

    if (metadata.locale !== undefined && !/^[a-z]{2}-[A-Z]{2}$/.test(metadata.locale)) {
      errors.push('Locale must be in format xx-XX (e.g., en-US)');
    }

    if (metadata.timezone !== undefined && typeof metadata.timezone !== 'string') {
      errors.push('Timezone must be a string');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Normalizes device metadata for storage
   */
  static normalizeDeviceMetadata(metadata: any): any {
    if (!metadata) {
      return {};
    }

    const normalized: any = {};

    // Only include valid fields with proper types
    if (metadata.model && typeof metadata.model === 'string') {
      normalized.model = metadata.model.trim();
    }

    if (metadata.osVersion && typeof metadata.osVersion === 'string') {
      normalized.osVersion = metadata.osVersion.trim();
    }

    if (metadata.appVersion && typeof metadata.appVersion === 'string') {
      normalized.appVersion = metadata.appVersion.trim();
    }

    if (metadata.deviceId && typeof metadata.deviceId === 'string') {
      normalized.deviceId = metadata.deviceId.trim();
    }

    if (metadata.locale && typeof metadata.locale === 'string') {
      normalized.locale = metadata.locale.trim().toLowerCase();
    }

    if (metadata.timezone && typeof metadata.timezone === 'string') {
      normalized.timezone = metadata.timezone.trim();
    }

    return normalized;
  }
}