/**
 * Push Token Format Validator
 *
 * Validates FCM and APNs push token formats before storage.
 * Prevents invalid tokens from entering database and causing delivery failures.
 *
 * FCM tokens: 100-500 alphanumeric chars plus underscore, hyphen, colon
 * APNs tokens: Exactly 64 hexadecimal characters
 */

export type PushPlatform = "ios" | "android";

/**
 * FCM token format validation
 * Pattern: /^[A-Za-z0-9_\-:]{100,500}$/
 *
 * @param token - FCM registration token string
 * @returns true if valid FCM format, false otherwise
 */
export function validateFcmToken(token: string): boolean {
  if (!token || typeof token !== "string") {
    return false;
  }

  // FCM tokens: 100-500 chars, alphanumeric + underscore/hyphen/colon only
  const fcmPattern = /^[A-Za-z0-9_\-:]{100,500}$/;
  return fcmPattern.test(token);
}

/**
 * APNs token format validation
 * Pattern: /^[0-9a-fA-F]{64}$/
 *
 * @param token - APNs device token hex string
 * @returns true if valid APNs format, false otherwise
 */
export function validateApnsToken(token: string): boolean {
  if (!token || typeof token !== "string") {
    return false;
  }

  // APNs tokens: exactly 64 hexadecimal characters
  const apnsPattern = /^[0-9a-fA-F]{64}$/;
  return apnsPattern.test(token);
}

/**
 * Platform-aware token validation dispatcher
 *
 * @param token - Push token string
 * @param platform - 'ios' or 'android'
 * @returns true if token format matches platform requirements
 */
export function validateToken(token: string, platform: PushPlatform): boolean {
  if (!token || !platform) {
    return false;
  }

  switch (platform) {
    case "android":
      return validateFcmToken(token);
    case "ios":
      return validateApnsToken(token);
    default:
      return false;
  }
}

/**
 * Get human-readable validation error message
 *
 * @param platform - 'ios' or 'android'
 * @returns Descriptive error message for invalid token format
 */
export function getValidationErrorMessage(platform: PushPlatform): string {
  switch (platform) {
    case "android":
      return "Invalid FCM token format: must be 100-500 alphanumeric characters (including underscore, hyphen, colon)";
    case "ios":
      return "Invalid APNs token format: must be exactly 64 hexadecimal characters";
    default:
      return "Invalid push token format for specified platform";
  }
}

/**
 * TokenValidator class for use in NestJS services
 */
export class TokenValidator {
  static validateFcmToken = validateFcmToken;
  static validateApnsToken = validateApnsToken;
  static validateToken = validateToken;
  static getValidationErrorMessage = getValidationErrorMessage;
}
