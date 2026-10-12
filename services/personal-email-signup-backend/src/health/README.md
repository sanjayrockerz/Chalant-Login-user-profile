# Health Check Module

## Overview

The health check module provides liveness and readiness probes for Kubernetes and monitoring systems. It validates the health of dependencies (database, Redis, external services) and exposes status endpoints.

## Features

- **Liveness Probe**: Indicates if the service is running
- **Readiness Probe**: Indicates if the service can handle traffic
- **Dependency Checks**: Database, Redis, email service health
- **Graceful Degradation**: Partial health status reporting
- **Custom Health Indicators**: Extensible health check system

## Endpoints

### GET /health

Basic health check (liveness probe).

**Response** (200 OK):
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T12:00:00Z",
  "version": "1.2.3"
}
```

---

### GET /health/ready

Readiness probe with dependency checks.

**Response** (200 OK):
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T12:00:00Z",
  "version": "1.2.3",
  "checks": {
    "database": "healthy",
    "redis": "healthy",
    "email_service": "healthy"
  },
  "uptime": 86400
}
```

**Response** (503 Service Unavailable - Dependencies Down):
```json
{
  "status": "unhealthy",
  "timestamp": "2024-01-15T12:00:00Z",
  "version": "1.2.3",
  "checks": {
    "database": "unhealthy",
    "redis": "healthy",
    "email_service": "degraded"
  },
  "errors": [
    {
      "component": "database",
      "message": "Connection timeout"
    }
  ]
}
```

## Architecture

```
src/health/
├── health.module.ts           # NestJS module
├── health.controller.ts       # Health endpoints
├── health.service.ts          # Health check orchestration
└── indicators/                # Health check implementations
    ├── database.indicator.ts
    ├── redis.indicator.ts
    └── email.indicator.ts
```

## Usage

### Import Module

```typescript
// app.module.ts
import { HealthModule } from './health/health.module';

@Module({
  imports: [HealthModule],
})
export class AppModule {}
```

### Basic Health Check

```typescript
// health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private healthService: HealthService) {}

  @Get()
  async check() {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.APP_VERSION || '1.0.0',
    };
  }

  @Get('ready')
  async ready() {
    const checks = await this.healthService.checkAll();
    const allHealthy = Object.values(checks).every(status => status === 'healthy');
    
    if (!allHealthy) {
      throw new ServiceUnavailableException('Service not ready');
    }

    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      checks,
    };
  }
}
```

### Custom Health Indicator

```typescript
// indicators/database.indicator.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/database.service';

@Injectable()
export class DatabaseHealthIndicator {
  constructor(private prisma: PrismaService) {}

  async check(): Promise<{ status: string; message?: string }> {
    try {
      // Simple query to verify connection
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'healthy' };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: error.message,
      };
    }
  }
}
```

```typescript
// indicators/redis.indicator.ts
import { Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class RedisHealthIndicator {
  constructor(private redis: RedisService) {}

  async check(): Promise<{ status: string; message?: string }> {
    try {
      const result = await this.redis.ping();
      return result === 'PONG' 
        ? { status: 'healthy' }
        : { status: 'unhealthy', message: 'Unexpected ping response' };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: error.message,
      };
    }
  }
}
```

### Health Service Orchestration

```typescript
// health.service.ts
import { Injectable } from '@nestjs/common';
import { DatabaseHealthIndicator } from './indicators/database.indicator';
import { RedisHealthIndicator } from './indicators/redis.indicator';

@Injectable()
export class HealthService {
  constructor(
    private databaseIndicator: DatabaseHealthIndicator,
    private redisIndicator: RedisHealthIndicator,
  ) {}

  async checkAll(): Promise<Record<string, string>> {
    const [database, redis] = await Promise.all([
      this.databaseIndicator.check(),
      this.redisIndicator.check(),
    ]);

    return {
      database: database.status,
      redis: redis.status,
    };
  }

  async isReady(): Promise<boolean> {
    const checks = await this.checkAll();
    return Object.values(checks).every(status => status === 'healthy');
  }
}
```

## Kubernetes Integration

### Liveness Probe

```yaml
# deployment.yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 30
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3
```

### Readiness Probe

```yaml
readinessProbe:
  httpGet:
    path: /health/ready
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 3
```

### Startup Probe

```yaml
startupProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 0
  periodSeconds: 10
  timeoutSeconds: 3
  failureThreshold: 30
```

## Graceful Shutdown

```typescript
// main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Enable graceful shutdown
  app.enableShutdownHooks();
  
  // Handle termination signals
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, starting graceful shutdown');
    await app.close();
    process.exit(0);
  });

  await app.listen(3000);
}
bootstrap();
```

## Observability

### Metrics

```typescript
// Track health check duration
const healthCheckDuration = new Histogram({
  name: 'health_check_duration_seconds',
  help: 'Health check duration',
  labelNames: ['check_type', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1],
});

async check() {
  const start = Date.now();
  const result = await this.performCheck();
  const duration = (Date.now() - start) / 1000;
  
  healthCheckDuration.observe({
    check_type: 'database',
    status: result.status,
  }, duration);
  
  return result;
}
```

### Logging

```typescript
// Log health check failures
if (result.status === 'unhealthy') {
  logger.error('Health check failed', {
    component: 'database',
    error: result.message,
    correlation_id: requestContext.correlationId,
  });
}
```

## Advanced Patterns

### Degraded Status

Some dependencies may be degraded but not completely down:

```typescript
async check(): Promise<{ status: string }> {
  try {
    const latency = await this.measureDatabaseLatency();
    
    if (latency < 100) return { status: 'healthy' };
    if (latency < 500) return { status: 'degraded' };
    return { status: 'unhealthy' };
  } catch (error) {
    return { status: 'unhealthy' };
  }
}
```

### Circuit Breaker Integration

```typescript
import { CircuitBreaker } from '@nestjs/circuit-breaker';

@Injectable()
export class EmailHealthIndicator {
  private circuitBreaker: CircuitBreaker;

  constructor(private emailService: EmailService) {
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 3000,
    });
  }

  async check() {
    if (this.circuitBreaker.isOpen()) {
      return { status: 'degraded', message: 'Circuit breaker open' };
    }

    try {
      await this.circuitBreaker.execute(() => this.emailService.ping());
      return { status: 'healthy' };
    } catch (error) {
      return { status: 'unhealthy', message: error.message };
    }
  }
}
```

### Cache Health Status

Avoid checking external services on every request:

```typescript
@Injectable()
export class CachedHealthService {
  private cache = new Map<string, { status: string; timestamp: number }>();
  private cacheTTL = 10000; // 10 seconds

  async check(indicator: HealthIndicator): Promise<string> {
    const cached = this.cache.get(indicator.name);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.status;
    }

    const result = await indicator.check();
    this.cache.set(indicator.name, {
      status: result.status,
      timestamp: Date.now(),
    });

    return result.status;
  }
}
```

## Testing

### Unit Tests

```typescript
// health.service.spec.ts
describe('HealthService', () => {
  let service: HealthService;
  let databaseIndicator: DatabaseHealthIndicator;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: DatabaseHealthIndicator,
          useValue: {
            check: jest.fn().mockResolvedValue({ status: 'healthy' }),
          },
        },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
    databaseIndicator = module.get<DatabaseHealthIndicator>(DatabaseHealthIndicator);
  });

  it('should return healthy when all checks pass', async () => {
    const result = await service.checkAll();
    expect(result.database).toBe('healthy');
  });

  it('should return unhealthy when database fails', async () => {
    jest.spyOn(databaseIndicator, 'check').mockResolvedValue({
      status: 'unhealthy',
      message: 'Connection failed',
    });

    const result = await service.checkAll();
    expect(result.database).toBe('unhealthy');
  });
});
```

### Integration Tests

```typescript
// health.controller.e2e.spec.ts
describe('Health Controller (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  it('/health (GET) should return 200', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe('healthy');
      });
  });

  it('/health/ready (GET) should check dependencies', () => {
    return request(app.getHttpServer())
      .get('/health/ready')
      .expect(200)
      .expect((res) => {
        expect(res.body.checks).toBeDefined();
        expect(res.body.checks.database).toBe('healthy');
      });
  });
});
```

## Troubleshooting

### Issue: Readiness Probe Failing

**Symptom**: Pods marked as not ready, no traffic routed

**Diagnosis**:
```bash
# Check pod logs
kubectl logs <pod-name> -n production

# Test health endpoint directly
kubectl port-forward <pod-name> 3000:3000
curl http://localhost:3000/health/ready
```

**Common Causes**:
- Database connection pool exhausted
- Redis unavailable
- Network policies blocking connectivity

### Issue: False Positive Health Checks

**Symptom**: Health checks pass but service is actually unhealthy

**Solution**:
- Add more comprehensive checks (test write operations, not just connections)
- Check query performance, not just connectivity
- Validate business logic works (e.g., can create user)

## Best Practices

1. **Liveness vs Readiness**: Liveness should be simple (is process alive?), readiness should check dependencies
2. **Timeout Configuration**: Set appropriate timeouts (3-5 seconds) to avoid cascading failures
3. **Failure Threshold**: Allow 2-3 failures before marking unhealthy (network blips)
4. **Cache Results**: Don't hammer dependencies on every health check
5. **Log Failures**: Always log why health checks fail for debugging
6. **Graceful Degradation**: Service can be partially healthy (some features degraded)

## Related Documentation

- [Kubernetes Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [Production Runbook](../../docs/production-readiness/runbook.md)
- [Infrastructure Guide](../../infra/README.md)
