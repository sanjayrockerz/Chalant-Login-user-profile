# TypeScript Types Module

## Overview

This directory contains shared TypeScript types, interfaces, DTOs (Data Transfer Objects), and type utilities used across the application.

## Structure

```
src/types/
├── index.ts                  # Barrel exports
├── dtos/                     # Data Transfer Objects
│   ├── auth.dto.ts
│   ├── user.dto.ts
│   └── common.dto.ts
├── interfaces/               # TypeScript interfaces
│   ├── user.interface.ts
│   ├── request.interface.ts
│   └── response.interface.ts
├── enums/                    # Enumerations
│   ├── user-status.enum.ts
│   └── error-codes.enum.ts
└── utilities/                # Type utilities
    └── type-guards.ts
```

## Data Transfer Objects (DTOs)

DTOs define the shape of data for API requests and responses.

### Request DTOs

```typescript
// dtos/auth.dto.ts
import { IsEmail, IsNotEmpty, Length } from 'class-validator';

export class RequestOTPDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsNotEmpty()
  tenant_id: string;
}

export class VerifyOTPDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsNotEmpty()
  @Length(6, 6)
  otp: string;

  @IsNotEmpty()
  tenant_id: string;
}
```

### Response DTOs

```typescript
// dtos/auth.dto.ts
export class AuthResponseDto {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: UserDto;
}

export class OTPResponseDto {
  success: boolean;
  message: string;
  expires_in: number;
}
```

## Interfaces

Interfaces define contracts for objects and classes.

### Request Context

```typescript
// interfaces/request.interface.ts
export interface RequestContext {
  correlationId: string;
  tenantId?: string;
  userId?: string;
  ipAddress: string;
  userAgent: string;
  timestamp: Date;
}

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
  context: RequestContext;
}
```

### User Interface

```typescript
// interfaces/user.interface.ts
export interface User {
  id: string;
  email: string;
  email_verified: boolean;
  tenant_id: string;
  metadata?: UserMetadata;
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date;
}

export interface UserMetadata {
  last_login?: Date;
  login_count?: number;
  display_name?: string;
  timezone?: string;
  [key: string]: any;
}
```

### API Response Interface

```typescript
// interfaces/response.interface.ts
export interface ApiResponse<T = any> {
  data: T;
  metadata: ResponseMetadata;
}

export interface ResponseMetadata {
  correlation_id: string;
  timestamp: string;
  version?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}
```

## Enumerations

```typescript
// enums/user-status.enum.ts
export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
  DELETED = 'deleted',
}

export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
  SUPER_ADMIN = 'super_admin',
}
```

```typescript
// enums/error-codes.enum.ts
export enum ErrorCode {
  INVALID_EMAIL = 'INVALID_EMAIL',
  INVALID_OTP = 'INVALID_OTP',
  OTP_EXPIRED = 'OTP_EXPIRED',
  OTP_NOT_FOUND = 'OTP_NOT_FOUND',
  UNAUTHORIZED = 'UNAUTHORIZED',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}
```

## Type Guards

Type guards help with runtime type checking.

```typescript
// utilities/type-guards.ts
export function isUser(obj: any): obj is User {
  return (
    typeof obj === 'object' &&
    typeof obj.id === 'string' &&
    typeof obj.email === 'string' &&
    typeof obj.email_verified === 'boolean'
  );
}

export function isAuthenticatedRequest(req: any): req is AuthenticatedRequest {
  return (
    typeof req === 'object' &&
    req.user !== undefined &&
    req.context !== undefined
  );
}

export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
```

## Utility Types

```typescript
// utilities/type-utils.ts
export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;
export type Maybe<T> = T | null | undefined;

// Make all properties optional recursively
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// Make specific properties required
export type RequireKeys<T, K extends keyof T> = T & Required<Pick<T, K>>;

// Omit properties that are null or undefined
export type NonNullableFields<T> = {
  [P in keyof T]: NonNullable<T[P]>;
};

// Extract promise return type
export type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;
```

## Generic Types

```typescript
// Common generic patterns
export type AsyncFunction<T = any> = (...args: any[]) => Promise<T>;

export type Constructor<T = any> = new (...args: any[]) => T;

export type ValueOf<T> = T[keyof T];

export type Entries<T> = {
  [K in keyof T]: [K, T[K]];
}[keyof T][];
```

## Validation Decorators

```typescript
// Custom validation decorators
import { registerDecorator, ValidationOptions } from 'class-validator';

export function IsTenantId(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isTenantId',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any) {
          return typeof value === 'string' && /^[a-z0-9-]+$/.test(value);
        },
        defaultMessage() {
          return 'Tenant ID must be alphanumeric with hyphens';
        },
      },
    });
  };
}

export function IsStrongPassword(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isStrongPassword',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any) {
          // At least 8 chars, 1 uppercase, 1 lowercase, 1 number
          return (
            typeof value === 'string' &&
            value.length >= 8 &&
            /[A-Z]/.test(value) &&
            /[a-z]/.test(value) &&
            /[0-9]/.test(value)
          );
        },
        defaultMessage() {
          return 'Password must be at least 8 characters with uppercase, lowercase, and number';
        },
      },
    });
  };
}
```

## Usage Examples

### Using DTOs in Controllers

```typescript
// auth.controller.ts
import { Body, Controller, Post } from '@nestjs/common';
import { RequestOTPDto, AuthResponseDto } from './types/dtos/auth.dto';

@Controller('auth')
export class AuthController {
  @Post('request-otp')
  async requestOTP(@Body() dto: RequestOTPDto): Promise<OTPResponseDto> {
    // TypeScript knows dto has email and tenant_id
    return this.authService.sendOTP(dto.email, dto.tenant_id);
  }

  @Post('verify-otp')
  async verifyOTP(@Body() dto: VerifyOTPDto): Promise<AuthResponseDto> {
    return this.authService.verifyOTP(dto);
  }
}
```

### Using Interfaces

```typescript
// middleware/request-context.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { RequestContext } from '../types/interfaces/request.interface';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void) {
    const context: RequestContext = {
      correlationId: req.headers['x-correlation-id'] || uuidv4(),
      tenantId: req.headers['x-tenant-id'],
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      timestamp: new Date(),
    };

    req.context = context;
    next();
  }
}
```

### Using Type Guards

```typescript
// services/user.service.ts
import { isUser } from '../types/utilities/type-guards';

async function processUser(data: unknown) {
  if (isUser(data)) {
    // TypeScript knows data is User type here
    console.log(data.email);
    console.log(data.email_verified);
  } else {
    throw new Error('Invalid user data');
  }
}
```

## Best Practices

1. **Co-locate DTOs**: Keep request and response DTOs together
2. **Use Validation**: Always validate DTOs with class-validator
3. **Export from index**: Use barrel exports for clean imports
4. **Document Complex Types**: Add JSDoc comments for complex types
5. **Avoid `any`**: Use proper types or generics instead of `any`
6. **Use Readonly**: Mark properties as `readonly` when appropriate

## Testing

```typescript
// types.spec.ts
import { validate } from 'class-validator';
import { RequestOTPDto } from './dtos/auth.dto';

describe('RequestOTPDto', () => {
  it('should validate correct email', async () => {
    const dto = new RequestOTPDto();
    dto.email = 'user@example.com';
    dto.tenant_id = 'acme-corp';

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should reject invalid email', async () => {
    const dto = new RequestOTPDto();
    dto.email = 'invalid-email';
    dto.tenant_id = 'acme-corp';

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('email');
  });
});
```

## Related Documentation

- [class-validator](https://github.com/typestack/class-validator)
- [class-transformer](https://github.com/typestack/class-transformer)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
