# Feature Flags Module

## Overview

The feature flags module provides runtime feature toggling, A/B testing, and gradual rollout capabilities. It enables controlled feature releases without code deployments.

## Features

- **Feature Toggles**: Enable/disable features at runtime
- **Gradual Rollouts**: Percentage-based feature releases (10% → 50% → 100%)
- **User Targeting**: Target specific users, tenants, or user segments
- **A/B Testing**: Variant testing for feature optimization
- **Remote Configuration**: Update flags without deployment
- **Fallback Values**: Safe defaults when flag service unavailable

## Architecture

```
src/feature-flags/
├── feature-flags.module.ts      # NestJS module
├── feature-flags.service.ts     # Flag evaluation logic
├── decorators/
│   └── feature-flag.decorator.ts  # Route-level flag guards
└── providers/
    ├── local.provider.ts        # Local JSON config
    ├── remote.provider.ts       # Remote API (LaunchDarkly, etc)
    └── redis.provider.ts        # Redis-backed flags
```

## Usage

### Import Module

```typescript
// app.module.ts
import { FeatureFlagsModule } from './feature-flags/feature-flags.module';

@Module({
  imports: [
    FeatureFlagsModule.register({
      provider: 'redis', // 'local' | 'remote' | 'redis'
      redisConnection: process.env.REDIS_URL,
    }),
  ],
})
export class AppModule {}
```

### Check Feature Flag

```typescript
// user.service.ts
import { Injectable } from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags/feature-flags.service';

@Injectable()
export class UserService {
  constructor(private featureFlags: FeatureFlagsService) {}

  async createUser(email: string) {
    // Check if new validation enabled
    const enhancedValidation = await this.featureFlags.isEnabled(
      'enhanced-email-validation',
      { userId: email }
    );

    if (enhancedValidation) {
      await this.validateEmailWithAdvancedChecks(email);
    } else {
      await this.validateEmailBasic(email);
    }

    return this.prisma.user.create({ data: { email } });
  }
}
```

### Percentage Rollout

```typescript
// Gradually roll out to 25% of users
const isEnabled = await this.featureFlags.isEnabled(
  'new-otp-flow',
  { userId: user.id },
  { defaultValue: false, rolloutPercentage: 25 }
);

if (isEnabled) {
  // New OTP flow
  await this.sendOTPv2(user.email);
} else {
  // Old OTP flow
  await this.sendOTP(user.email);
}
```

### User/Tenant Targeting

```typescript
// Enable for specific tenants
const isEnabled = await this.featureFlags.isEnabled(
  'premium-features',
  { 
    userId: user.id,
    tenantId: user.tenant_id,
    userSegment: user.plan // 'free' | 'premium'
  }
);
```

### Decorator-Based Guards

```typescript
// auth.controller.ts
import { UseFeatureFlag } from './feature-flags/decorators/feature-flag.decorator';

@Controller('auth')
export class AuthController {
  
  @Post('request-otp-v2')
  @UseFeatureFlag('new-otp-flow')
  async requestOTPv2(@Body() dto: RequestOTPDto) {
    // This endpoint only accessible if flag is enabled
    return this.authService.requestOTPv2(dto);
  }
}
```

## Feature Flag Configuration

### Local Provider (JSON)

```json
// feature-flags.json
{
  "new-otp-flow": {
    "enabled": true,
    "rollout_percentage": 50,
    "description": "New OTP generation flow with better UX"
  },
  "premium-features": {
    "enabled": true,
    "target_tenants": ["acme-corp", "tech-inc"],
    "description": "Premium features for paying customers"
  },
  "enhanced-logging": {
    "enabled": false,
    "description": "Detailed debug logging (performance impact)"
  }
}
```

### Redis Provider

```typescript
// Store flags in Redis
await this.redis.hset('feature-flags', {
  'new-otp-flow': JSON.stringify({
    enabled: true,
    rollout_percentage: 75,
  }),
  'premium-features': JSON.stringify({
    enabled: true,
    target_tenants: ['acme-corp'],
  }),
});
```

### Remote Provider (LaunchDarkly)

```typescript
// feature-flags.module.ts
import * as LaunchDarkly from 'launchdarkly-node-server-sdk';

const ldClient = LaunchDarkly.init(process.env.LAUNCHDARKLY_SDK_KEY);

@Injectable()
export class RemoteFeatureFlagsProvider {
  async isEnabled(flagKey: string, context: any): Promise<boolean> {
    return ldClient.variation(flagKey, context, false);
  }
}
```

## Implementation

### Feature Flags Service

```typescript
// feature-flags.service.ts
import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';

interface FlagContext {
  userId?: string;
  tenantId?: string;
  userSegment?: string;
  [key: string]: any;
}

interface FlagOptions {
  defaultValue?: boolean;
  rolloutPercentage?: number;
}

@Injectable()
export class FeatureFlagsService {
  constructor(private provider: FeatureFlagsProvider) {}

  async isEnabled(
    flagKey: string,
    context: FlagContext = {},
    options: FlagOptions = {}
  ): Promise<boolean> {
    try {
      // Get flag configuration
      const flag = await this.provider.getFlag(flagKey);

      if (!flag) {
        return options.defaultValue ?? false;
      }

      // Check if flag is globally disabled
      if (!flag.enabled) {
        return false;
      }

      // Check tenant targeting
      if (flag.target_tenants?.length && context.tenantId) {
        if (!flag.target_tenants.includes(context.tenantId)) {
          return false;
        }
      }

      // Check user segment targeting
      if (flag.target_segments?.length && context.userSegment) {
        if (!flag.target_segments.includes(context.userSegment)) {
          return false;
        }
      }

      // Percentage-based rollout
      if (flag.rollout_percentage !== undefined && context.userId) {
        const userHash = this.hashUserId(context.userId, flagKey);
        const bucket = userHash % 100;
        return bucket < flag.rollout_percentage;
      }

      // Flag is enabled
      return true;
    } catch (error) {
      logger.error('Feature flag evaluation failed', {
        flag: flagKey,
        error: error.message,
        correlation_id: context.correlationId,
      });
      return options.defaultValue ?? false;
    }
  }

  // Consistent hashing for rollout
  private hashUserId(userId: string, flagKey: string): number {
    const hash = createHash('md5')
      .update(`${userId}:${flagKey}`)
      .digest('hex');
    return parseInt(hash.substring(0, 8), 16);
  }
}
```

### Decorator Implementation

```typescript
// decorators/feature-flag.decorator.ts
import { SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import { FeatureFlagGuard } from '../guards/feature-flag.guard';

export const FEATURE_FLAG_KEY = 'feature_flag';

export function UseFeatureFlag(flagKey: string) {
  return applyDecorators(
    SetMetadata(FEATURE_FLAG_KEY, flagKey),
    UseGuards(FeatureFlagGuard)
  );
}
```

```typescript
// guards/feature-flag.guard.ts
import { Injectable, CanActivate, ExecutionContext, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureFlagsService } from '../feature-flags.service';
import { FEATURE_FLAG_KEY } from '../decorators/feature-flag.decorator';

@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private featureFlags: FeatureFlagsService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const flagKey = this.reflector.get<string>(FEATURE_FLAG_KEY, context.getHandler());
    
    if (!flagKey) {
      return true; // No flag specified, allow access
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    const isEnabled = await this.featureFlags.isEnabled(flagKey, {
      userId: user?.id,
      tenantId: user?.tenant_id,
    });

    if (!isEnabled) {
      throw new NotFoundException('Feature not available');
    }

    return true;
  }
}
```

## A/B Testing

```typescript
// Get variant for A/B test
async getVariant(
  flagKey: string,
  context: FlagContext,
  variants: string[] = ['control', 'treatment']
): Promise<string> {
  const flag = await this.provider.getFlag(flagKey);
  
  if (!flag?.enabled) {
    return 'control';
  }

  const userHash = this.hashUserId(context.userId, flagKey);
  const variantIndex = userHash % variants.length;
  
  return variants[variantIndex];
}

// Usage
const variant = await this.featureFlags.getVariant(
  'signup-button-test',
  { userId: user.id },
  ['control', 'variant-a', 'variant-b']
);

if (variant === 'variant-a') {
  // Show green button
} else if (variant === 'variant-b') {
  // Show blue button
} else {
  // Show original button (control)
}
```

## Observability

### Metrics

```typescript
// Track flag evaluations
const flagEvaluationsCounter = new Counter({
  name: 'feature_flag_evaluations_total',
  help: 'Total feature flag evaluations',
  labelNames: ['flag_key', 'result'],
});

async isEnabled(flagKey: string, context: FlagContext): Promise<boolean> {
  const result = await this.evaluateFlag(flagKey, context);
  
  flagEvaluationsCounter.inc({
    flag_key: flagKey,
    result: result ? 'enabled' : 'disabled',
  });
  
  return result;
}
```

### Logging

```typescript
// Log flag changes
logger.info('Feature flag evaluated', {
  flag: flagKey,
  result: isEnabled,
  user_id: context.userId,
  tenant_id: context.tenantId,
  correlation_id: context.correlationId,
});
```

## Admin API

```typescript
// admin.controller.ts
@Controller('admin/feature-flags')
export class FeatureFlagsAdminController {
  constructor(private featureFlags: FeatureFlagsService) {}

  @Get()
  async listFlags() {
    return this.featureFlags.listAll();
  }

  @Patch(':flagKey')
  async updateFlag(
    @Param('flagKey') flagKey: string,
    @Body() update: UpdateFlagDto
  ) {
    await this.featureFlags.updateFlag(flagKey, update);
    return { success: true };
  }

  @Post(':flagKey/rollout')
  async updateRollout(
    @Param('flagKey') flagKey: string,
    @Body() { percentage }: { percentage: number }
  ) {
    await this.featureFlags.setRolloutPercentage(flagKey, percentage);
    return { success: true, percentage };
  }
}
```

## Testing

### Unit Tests

```typescript
// feature-flags.service.spec.ts
describe('FeatureFlagsService', () => {
  let service: FeatureFlagsService;
  let provider: MockFeatureFlagsProvider;

  beforeEach(() => {
    provider = new MockFeatureFlagsProvider();
    service = new FeatureFlagsService(provider);
  });

  it('should return true when flag is enabled', async () => {
    provider.setFlag('test-flag', { enabled: true });
    
    const result = await service.isEnabled('test-flag');
    
    expect(result).toBe(true);
  });

  it('should respect rollout percentage', async () => {
    provider.setFlag('test-flag', {
      enabled: true,
      rollout_percentage: 50,
    });

    // User with hash that falls in 50% bucket
    const result1 = await service.isEnabled('test-flag', { userId: 'user-1' });
    
    // User with hash that falls outside 50% bucket
    const result2 = await service.isEnabled('test-flag', { userId: 'user-999' });

    // At least one should be enabled, one disabled (depends on hash)
    expect([result1, result2]).toContain(true);
    expect([result1, result2]).toContain(false);
  });
});
```

### Integration Tests

```typescript
// Test gradual rollout
it('should gradually enable feature', async () => {
  // Start at 0%
  await featureFlags.setRolloutPercentage('new-feature', 0);
  
  let enabled = await featureFlags.isEnabled('new-feature', { userId: 'test-user' });
  expect(enabled).toBe(false);

  // Increase to 100%
  await featureFlags.setRolloutPercentage('new-feature', 100);
  
  enabled = await featureFlags.isEnabled('new-feature', { userId: 'test-user' });
  expect(enabled).toBe(true);
});
```

## Best Practices

1. **Always Provide Defaults**: Use `defaultValue` to handle flag service outages
2. **Clean Up Old Flags**: Remove flags after full rollout
3. **Document Flags**: Include description and owner for each flag
4. **Monitor Usage**: Track which flags are actually being checked
5. **Consistent Hashing**: Use same hash algorithm for all rollouts
6. **Graceful Degradation**: Service should work if flag provider is down

## Troubleshooting

### Issue: Inconsistent Flag Values

**Symptom**: Same user sees different flag values

**Cause**: No consistent hashing, random evaluation

**Solution**: Use deterministic hashing based on user ID

### Issue: Flag Changes Not Reflected

**Symptom**: Flag update doesn't take effect immediately

**Cause**: Local caching of flags

**Solution**: 
```typescript
// Add TTL to cache
await this.cache.set(`flag:${flagKey}`, value, { ttl: 60 }); // 60 seconds
```

## Related Documentation

- [LaunchDarkly SDK](https://docs.launchdarkly.com/sdk/server-side/node-js)
- [Configuration Management](../config/README.md)
- [Production Runbook](../../docs/production-readiness/runbook.md)
