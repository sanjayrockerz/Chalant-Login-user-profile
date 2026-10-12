/**
 * Custom Class Validator Decorator for Push Tokens
 *
 * Integrates TokenValidator with class-validator for DTO validation.
 * Provides @IsValidPushToken() decorator for RegisterTokenDto.
 */

import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";
import { TokenValidator, PushPlatform } from "../utils/token-validator.util";

/**
 * Custom validator constraint for push token format
 */
@ValidatorConstraint({ name: "isValidPushToken", async: false })
export class IsValidPushTokenConstraint
  implements ValidatorConstraintInterface
{
  validate(token: string, args: ValidationArguments): boolean {
    const object = args.object as any;
    const platform: PushPlatform = object.platform;

    if (!platform) {
      // Platform must be specified; validation will be handled by @IsEnum
      return false;
    }

    return TokenValidator.validateToken(token, platform);
  }

  defaultMessage(args: ValidationArguments): string {
    const object = args.object as any;
    const platform: PushPlatform = object.platform;

    if (!platform) {
      return "Platform must be specified to validate token format";
    }

    return TokenValidator.getValidationErrorMessage(platform);
  }
}

/**
 * Decorator for validating push token format based on platform
 *
 * Usage:
 * ```typescript
 * class RegisterTokenDto {
 *   @IsEnum(['ios', 'android'])
 *   platform: PushPlatform;
 *
 *   @IsValidPushToken()
 *   token: string;
 * }
 * ```
 *
 * @param validationOptions - Optional class-validator options
 */
export function IsValidPushToken(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsValidPushTokenConstraint,
    });
  };
}
