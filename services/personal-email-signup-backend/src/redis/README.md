# Redis Module

## Overview

The Redis module provides caching, session storage, and rate limiting capabilities for the signup backend service.

## Features

- **Caching**: OTP storage, user session caching
- **Rate Limiting**: Request throttling per email/IP
- **Session Management**: JWT token blacklisting
- **Pub/Sub**: Event broadcasting (future)
- **Connection Pooling**: Efficient connection reuse

## Architecture

```
src/redis/
├── redis.module.ts          # NestJS module
├── redis.service.ts         # Core Redis operations
├── cache.service.ts         # High-level caching patterns
└── rate-limiter.service.ts  # Rate limiting logic
```

## Usage

### Import Module

```typescript
// app.module.ts
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    RedisModule.register({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT),
      password: process.env.REDIS_PASSWORD,
    }),
  ],
})
export class AppModule {}
```

### Basic Operations

```typescript
// auth.service.ts
import { Injectable } from '@nestjs/common';
import { RedisService } from './redis/redis.service';

@Injectable()
export class AuthService {
  constructor(private redis: RedisService) {}

  // Store OTP with expiration
  async storeOTP(email: string, otp: string): Promise<void> {
    const key = `otp:${email}`;
    const ttl = 600; // 10 minutes
    await this.redis.setex(key, ttl, otp);
  }

  // Retrieve and verify OTP
  async verifyOTP(email: string, otp: string): Promise<boolean> {
    const key = `otp:${email}`;
    const storedOTP = await this.redis.get(key);
    
    if (storedOTP === otp) {
      await this.redis.del(key); // Delete after successful verification
      return true;
    }
    return false;
  }
}
```

### Caching Pattern

```typescript
// cache.service.ts
@Injectable()
export class CacheService {
  constructor(private redis: RedisService) {}

  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttl: number = 300
  ): Promise<T> {
    // Try cache first
    const cached = await this.redis.get(key);
    if (cached) {
      return JSON.parse(cached);
    }

    // Cache miss: compute value
    const value = await factory();
    
    // Store in cache
    await this.redis.setex(key, ttl, JSON.stringify(value));
    
    return value;
  }
}

// Usage
const user = await this.cache.getOrSet(
  `user:${userId}`,
  () => this.prisma.user.findUnique({ where: { id: userId } }),
  600 // 10 minutes
);
```

### Rate Limiting

```typescript
// rate-limiter.service.ts
@Injectable()
export class RateLimiterService {
  constructor(private redis: RedisService) {}

  async checkRateLimit(
    identifier: string,
    maxAttempts: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number }> {
    const key = `rate-limit:${identifier}`;
    
    const current = await this.redis.incr(key);
    
    if (current === 1) {
      // First request in window
      await this.redis.expire(key, windowSeconds);
    }
    
    const remaining = Math.max(0, maxAttempts - current);
    const allowed = current <= maxAttempts;
    
    return { allowed, remaining };
  }
}

// Usage in controller
@Post('auth/request-otp')
async requestOTP(@Body() dto: RequestOTPDto) {
  const { allowed, remaining } = await this.rateLimiter.checkRateLimit(
    `otp-request:${dto.email}`,
    3,  // 3 attempts
    900 // 15 minutes
  );

  if (!allowed) {
    throw new TooManyRequestsException('Rate limit exceeded');
  }

  // Proceed with OTP generation...
}
```

### JWT Token Blacklist

```typescript
// Blacklist revoked tokens
async revokeToken(token: string, expiresIn: number): Promise<void> {
  const key = `blacklist:${token}`;
  await this.redis.setex(key, expiresIn, '1');
}

// Check if token is blacklisted
async isTokenRevoked(token: string): Promise<boolean> {
  const key = `blacklist:${token}`;
  const exists = await this.redis.exists(key);
  return exists === 1;
}
```

## Configuration

### Environment Variables

```bash
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=secret
REDIS_DB=0
REDIS_TLS_ENABLED=false
REDIS_KEY_PREFIX=signup-backend:
```

### Connection Options

```typescript
// redis.module.ts
RedisModule.register({
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT),
  password: process.env.REDIS_PASSWORD,
  db: parseInt(process.env.REDIS_DB || '0'),
  keyPrefix: process.env.REDIS_KEY_PREFIX || 'signup:',
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});
```

## Key Naming Conventions

Use structured, hierarchical keys:

```
# OTP storage
otp:<email>                     → "123456"

# Rate limiting
rate-limit:otp-request:<email>  → 3
rate-limit:login:<ip>           → 10

# User session cache
user:<user_id>                  → {"id":"...", "email":"..."}

# JWT blacklist
blacklist:<token_hash>          → "1"

# Feature flags
feature-flag:<flag_name>        → "enabled"
```

## Data Structures

### Strings (SET/GET)

```typescript
// Store OTP
await this.redis.set('otp:user@example.com', '123456');
await this.redis.expire('otp:user@example.com', 600);

// Or combined
await this.redis.setex('otp:user@example.com', 600, '123456');
```

### Hashes (HSET/HGET)

```typescript
// Store user object
await this.redis.hset('user:123', {
  email: 'user@example.com',
  verified: 'true',
  tenant_id: 'acme-corp'
});

// Get specific field
const email = await this.redis.hget('user:123', 'email');

// Get all fields
const user = await this.redis.hgetall('user:123');
```

### Lists (LPUSH/RPOP)

```typescript
// Job queue
await this.redis.lpush('email-queue', JSON.stringify({ to: 'user@example.com', otp: '123456' }));
const job = await this.redis.rpop('email-queue');
```

### Sets (SADD/SMEMBERS)

```typescript
// Track active sessions
await this.redis.sadd('active-sessions:user123', 'session-token-1');
await this.redis.sadd('active-sessions:user123', 'session-token-2');

const sessions = await this.redis.smembers('active-sessions:user123');
```

### Sorted Sets (ZADD/ZRANGE)

```typescript
// Leaderboard
await this.redis.zadd('signup-leaderboard', Date.now(), 'user123');

// Get top users by signup time
const topUsers = await this.redis.zrange('signup-leaderboard', 0, 9);
```

## Observability

### Metrics (Prometheus)

```typescript
// Track cache hit/miss
const cacheHitsCounter = new Counter({
  name: 'redis_cache_hits_total',
  help: 'Total Redis cache hits',
  labelNames: ['key_prefix']
});

const cacheMissesCounter = new Counter({
  name: 'redis_cache_misses_total',
  help: 'Total Redis cache misses',
  labelNames: ['key_prefix']
});

async get(key: string): Promise<string | null> {
  const value = await this.redis.get(key);
  
  if (value) {
    cacheHitsCounter.inc({ key_prefix: key.split(':')[0] });
  } else {
    cacheMissesCounter.inc({ key_prefix: key.split(':')[0] });
  }
  
  return value;
}
```

### Connection Monitoring

```typescript
// Track Redis connection status
const redisConnectionGauge = new Gauge({
  name: 'redis_connection_status',
  help: 'Redis connection status (1 = connected, 0 = disconnected)'
});

this.redis.on('connect', () => {
  redisConnectionGauge.set(1);
  logger.info('Redis connected');
});

this.redis.on('error', (err) => {
  redisConnectionGauge.set(0);
  logger.error('Redis error', { error: err.message });
});
```

### Logging

```typescript
// Log Redis operations with correlation ID
async setWithLogging(key: string, value: string, ttl?: number): Promise<void> {
  logger.debug('Redis SET', {
    key,
    ttl,
    correlation_id: this.requestContext.correlationId,
    tenant_id: this.requestContext.tenantId
  });
  
  if (ttl) {
    await this.redis.setex(key, ttl, value);
  } else {
    await this.redis.set(key, value);
  }
}
```

## Error Handling

```typescript
try {
  await this.redis.set('key', 'value');
} catch (error) {
  logger.error('Redis operation failed', {
    error: error.message,
    stack: error.stack,
    correlation_id: this.requestContext.correlationId
  });
  
  // Fallback: proceed without cache
  return await this.database.query();
}
```

### Graceful Degradation

```typescript
// Don't fail requests if Redis is down
async getUserWithCache(userId: string): Promise<User> {
  try {
    // Try cache first
    const cached = await this.redis.get(`user:${userId}`);
    if (cached) return JSON.parse(cached);
  } catch (error) {
    logger.warn('Redis unavailable, falling back to database', { error });
  }
  
  // Fallback to database
  const user = await this.prisma.user.findUnique({ where: { id: userId } });
  
  // Attempt to cache (fire and forget)
  this.redis.setex(`user:${userId}`, 300, JSON.stringify(user)).catch(() => {});
  
  return user;
}
```

## Performance Optimization

### Pipeline (Batch Operations)

```typescript
// Instead of multiple round trips
await this.redis.set('key1', 'value1');
await this.redis.set('key2', 'value2');
await this.redis.set('key3', 'value3');

// Use pipeline
const pipeline = this.redis.pipeline();
pipeline.set('key1', 'value1');
pipeline.set('key2', 'value2');
pipeline.set('key3', 'value3');
await pipeline.exec();
```

### Eviction Policies

Configure Redis eviction policy in `redis.conf`:

```
maxmemory 1gb
maxmemory-policy allkeys-lru
```

**Eviction Policies**:
- `allkeys-lru`: Evict least recently used keys (recommended for cache)
- `volatile-lru`: Evict LRU keys with TTL
- `allkeys-lfu`: Evict least frequently used keys
- `volatile-ttl`: Evict keys with shortest TTL

## Testing

### Unit Tests (Mock Redis)

```typescript
// auth.service.spec.ts
const mockRedis = {
  get: jest.fn(),
  setex: jest.fn(),
  del: jest.fn(),
};

const module = await Test.createTestingModule({
  providers: [
    AuthService,
    { provide: RedisService, useValue: mockRedis },
  ],
}).compile();

it('should store OTP with expiration', async () => {
  await service.storeOTP('user@example.com', '123456');
  
  expect(mockRedis.setex).toHaveBeenCalledWith(
    'otp:user@example.com',
    600,
    '123456'
  );
});
```

### Integration Tests (Redis Container)

```typescript
// redis.integration.spec.ts
import { Redis } from 'ioredis';

describe('RedisService (Integration)', () => {
  let redis: Redis;

  beforeAll(() => {
    redis = new Redis({
      host: process.env.TEST_REDIS_HOST || 'localhost',
      port: parseInt(process.env.TEST_REDIS_PORT || '6379'),
      db: 1, // Use separate DB for tests
    });
  });

  afterAll(async () => {
    await redis.flushdb(); // Clean test DB
    await redis.quit();
  });

  it('should set and get value', async () => {
    await redis.set('test-key', 'test-value');
    const value = await redis.get('test-key');
    expect(value).toBe('test-value');
  });
});
```

## Troubleshooting

### Issue: Connection Refused

**Symptom**: `Error: connect ECONNREFUSED 127.0.0.1:6379`

**Solution**:
```bash
# Check Redis is running
redis-cli ping  # Should return PONG

# Check connection details
echo $REDIS_HOST
echo $REDIS_PORT

# Verify network connectivity
telnet redis-host 6379
```

### Issue: Memory Evictions

**Symptom**: Cache misses increasing, `evicted_keys` metric growing

**Solution**:
```bash
# Check eviction stats
redis-cli INFO stats | grep evicted_keys

# Check memory usage
redis-cli INFO memory

# Increase Redis memory
# In redis.conf: maxmemory 2gb
```

### Issue: High Latency

**Symptom**: Slow Redis operations

**Solution**:
```bash
# Check slow log
redis-cli SLOWLOG GET 10

# Monitor real-time commands
redis-cli MONITOR

# Check network latency
redis-cli --latency
```

## Security

### Authentication

```typescript
// Use password authentication
RedisModule.register({
  host: process.env.REDIS_HOST,
  password: process.env.REDIS_PASSWORD,
  tls: {
    rejectUnauthorized: true,
    ca: fs.readFileSync('/path/to/ca.crt'),
  },
});
```

### Network Isolation

- Run Redis in private VPC subnet
- Use security groups to restrict access
- Enable TLS for in-transit encryption

### Key Expiration

Always set TTL to prevent memory leaks:

```typescript
// WRONG: No expiration
await this.redis.set('otp:user@example.com', '123456');

// CORRECT: With TTL
await this.redis.setex('otp:user@example.com', 600, '123456');
```

## Related Documentation

- [Redis Commands Reference](https://redis.io/commands)
- [ioredis Documentation](https://github.com/luin/ioredis)
- [Production Runbook](../../docs/production-readiness/runbook.md)
