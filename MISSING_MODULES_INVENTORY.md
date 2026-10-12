# Missing Modules Inventory

This document catalogs all missing TypeScript modules identified across the monorepo, their expected exports, and architectural requirements for stub generation.

## Discovery Summary

**Total missing modules identified**: 47+  
**Services analyzed**: 
- `services/personal-email-signup-backend` (NestJS, OTP signup, PostgreSQL, Redis)
- `services/login-page-back` (Express/NestJS auth system, multi-tenant observability)

**Analysis method**: TypeScript compilation errors + import statement extraction

## Critical Infrastructure Modules (Priority 1)

### Database & ORM
| Module Path | Expected Exports | Consumer Files | Architectural Notes |
|-------------|------------------|----------------|-------------------|
| `../prisma/prisma.module` | `PrismaModule` (NestJS module) | `app.module.ts` | Core database module for PostgreSQL via Prisma ORM |
| `./database/mongo-database.module` | `MongoDatabaseModule` (NestJS module) | `app.module.ts` | MongoDB integration module |
| `../database/database-manager` | `DatabaseManager`, `User`, `RefreshToken` (classes/interfaces) | Multiple auth services | Core database abstraction layer |
| `../../database/cache-manager` | `CacheManager` (class) | Config services | Database caching layer |
| `../entities/user.entity` | `User` (TypeORM entity) | `policies.service.ts` | User entity definition |
| `../entities/policy-acceptance-history.entity` | `PolicyAcceptanceHistory` (TypeORM entity) | Controllers | Policy tracking entity |

### Redis & Caching
| Module Path | Expected Exports | Consumer Files | Architectural Notes |
|-------------|------------------|----------------|-------------------|
| `../redis/redis.service` | `RedisService` (NestJS injectable) | `auth.service.ts`, `rate_limiter.service.ts`, `idempotency.interceptor.ts` | Core Redis service for caching, sessions, rate limiting |
| `./redis/redis.module` | `RedisModule` (NestJS module) | `app.module.ts`, `rate_limiter.module.ts` | Redis configuration and providers |

### Configuration
| Module Path | Expected Exports | Consumer Files | Architectural Notes |
|-------------|------------------|----------------|-------------------|
| `../config/environment` | `config` (object/function) | Multiple services | Environment configuration |
| `./config/config.module` | `ConfigModule` (NestJS module) | `app.module.ts` | Configuration management |
| `./config.schema` | `configSchema`, `Config` (validation schema + type) | Config services | Configuration validation |
| `../config/config.service` | `ConfigService` (NestJS injectable) | Multiple controllers | Configuration access service |

## Authentication & Security (Priority 1)

### Auth Services
| Module Path | Expected Exports | Consumer Files | Architectural Notes |
|-------------|------------------|----------------|-------------------|
| `./auth_cc/auth.module` | `AuthModule` (NestJS module) | `app.module.ts` | Core authentication module |
| `../auth/jwt-auth.guard` | `JwtAuthGuard` (NestJS guard) | `username.controller.ts` | JWT authentication guard |
| `../auth-services/credential-service/credential-service` | `CredentialService` (NestJS injectable) | Auth controllers | Credential management service |
| `../auth-services/mfa-engine/mfa-engine` | `MFAEngine` (class) | Auth services | Multi-factor authentication engine |

### Security & Rate Limiting
| Module Path | Expected Exports | Consumer Files | Architectural Notes |
|-------------|------------------|----------------|-------------------|
| `./security/custom-throttler.guard` | `CustomThrottlerGuard` (NestJS guard) | `app.module.ts` | Custom rate limiting guard |
| `../security/multi_dim_throttle.guard` | `MultiDimThrottleGuard` (NestJS guard) | `username.controller.ts` | Multi-dimensional rate limiting |
| `../security/rate-limiting/adaptive-limiter` | `loginRateLimiter` (function/middleware) | Route files | Adaptive rate limiting for login |
| `../security/password-breach.service` | `PasswordBreachService` (NestJS injectable) | Auth services | Password breach detection |

## Communication & Events (Priority 1)

### Email Service
| Module Path | Expected Exports | Consumer Files | Architectural Notes |
|-------------|------------------|----------------|-------------------|
| `../email/email.service` | `EmailService` (NestJS injectable) | `auth.service.ts`, `register.spec.ts` | Email sending service for OTP, notifications |

### Audit & Events
| Module Path | Expected Exports | Consumer Files | Architectural Notes |
|-------------|------------------|----------------|-------------------|
| `../../../login-page-back/src/events/audit-emitter` | `emitAudit`, `buildAuditEvent` (functions) | `auth.service.ts`, `policies.service.ts`, `profile.controller.ts` | Cross-service audit event system |
| `../../login-page-back/src/events/audit-emitter` | `emitAudit`, `buildAuditEvent` (functions) | `username.controller.ts` | Audit event emitters |
| `../events/audit-emitter` | `emitAudit` (function) | Route files | Local audit event emitter |

### Message Queue
| Module Path | Expected Exports | Consumer Files | Architectural Notes |
|-------------|------------------|----------------|-------------------|
| `./rabbitmq/rabbitmq.module` | `RabbitMQModule` (NestJS module) | `app.module.ts` | RabbitMQ integration for async processing |

## Observability & Monitoring (Priority 2)

### Logging
| Module Path | Expected Exports | Consumer Files | Architectural Notes |
|-------------|------------------|----------------|-------------------|
| `./logging/logging.module` | `LoggingModule` (NestJS module) | `app.module.ts` | Centralized logging configuration |
| `../utils/logger` | `logger`, `logHelpers` (Winston logger + utilities) | Multiple services | Structured logging with correlation_id, tenant_id |

### Metrics & Tracing
| Module Path | Expected Exports | Consumer Files | Architectural Notes |
|-------------|------------------|----------------|-------------------|
| `./metrics/metrics.module` | `MetricsModule` (NestJS module) | `app.module.ts` | Prometheus metrics collection |
| `../metrics/metrics.service` | `MetricsService` (NestJS injectable) | Controllers | Metrics recording service |
| `./tracing/tracing.module` | `TracingModule` (NestJS module) | `app.module.ts` | OpenTelemetry tracing configuration |

### Health Checks
| Module Path | Expected Exports | Consumer Files | Architectural Notes |
|-------------|------------------|----------------|-------------------|
| `./health/health.module` | `HealthModule` (NestJS module) | `app.module.ts` | Health check endpoints for k8s probes |

## Feature & Business Logic (Priority 2)

### User Management
| Module Path | Expected Exports | Consumer Files | Architectural Notes |
|-------------|------------------|----------------|-------------------|
| `./user/user.module` | `UserModule` (NestJS module) | `app.module.ts` | User management module |
| `../user/username-normalize` | `normalizeUsername`, `isValidUsernameForm` (functions) | `auth.service.ts`, `username.controller.ts` | Username validation and normalization |

### OTP & Auth Flows
| Module Path | Expected Exports | Consumer Files | Architectural Notes |
|-------------|------------------|----------------|-------------------|
| `./otp/otp.module` | `OtpModule` (NestJS module) | `app.module.ts` | OTP generation and validation |
| `./otp/enhanced-otp.module` | `EnhancedOTPModule` (NestJS module) | `app.module.ts` | Enhanced OTP with additional security |

### Feature Flags & Deployment
| Module Path | Expected Exports | Consumer Files | Architectural Notes |
|-------------|------------------|----------------|-------------------|
| `./feature-flags/feature-flags.module` | `FeatureFlagsModule` (NestJS module) | `app.module.ts` | Feature toggle management |
| `./deployment/deployment.module` | `DeploymentModule` (NestJS module) | `app.module.ts` | Deployment configuration and status |

### Phased Rollouts
| Module Path | Expected Exports | Consumer Files | Architectural Notes |
|-------------|------------------|----------------|-------------------|
| `./phase-b/phase-b.module` | `PhaseBModule` (NestJS module) | `app.module.ts` | Phase B rollout features |
| `./phase-c/phase-c.module` | `PhaseCModule` (NestJS module) | `app.module.ts` | Phase C rollout features |

## Utilities & Helpers (Priority 3)

### Middleware & Interceptors
| Module Path | Expected Exports | Consumer Files | Architectural Notes |
|-------------|------------------|----------------|-------------------|
| `./common/interceptors/idempotency.interceptor` | `IdempotencyInterceptor` (NestJS interceptor) | `app.module.ts` | Request idempotency handling |
| `./common/interceptors/logging.interceptor` | `LoggingInterceptor` (NestJS interceptor) | `app.module.ts` | Request/response logging |
| `../middleware/error-handler` | `asyncHandler`, `AuthenticationError` (middleware/error classes) | Route files | Error handling utilities |

### Validation & DTOs
| Module Path | Expected Exports | Consumer Files | Architectural Notes |
|-------------|------------------|----------------|-------------------|
| `./dto/accept-terms.dto` | `AcceptTermsDto`, `TermsAcceptanceResponse` (DTO classes) | Controllers | Terms acceptance validation |
| `./dto/create-user.dto` | `CreateUserDto` (DTO class) | User controllers | User creation validation |
| `../decorators/idempotent.decorator` | `IDEMPOTENCY_KEY` (decorator/constant) | Interceptors | Idempotency key decorator |

### Device & Testing
| Module Path | Expected Exports | Consumer Files | Architectural Notes |
|-------------|------------------|----------------|-------------------|
| `./device/device.module` | `DeviceModule` (NestJS module) | `app.module.ts` | Device fingerprinting and management |
| `./testing/testing.module` | `TestingModule` (NestJS module) | `app.module.ts` | Testing utilities and mocks |

### Security & Compliance
| Module Path | Expected Exports | Consumer Files | Architectural Notes |
|-------------|------------------|----------------|-------------------|
| `./abuse/abuse.module` | `AbuseModule` (NestJS module) | `app.module.ts` | Abuse detection and prevention |

## NestJS DI Requirements

### Module Decorators Required
- All modules must use `@Module()` decorator with appropriate imports/exports
- Global modules should use `@Module({ global: true })`
- Services should use `@Injectable()` decorator

### Provider Tokens Expected
- `CACHE_MANAGER` - Redis cache manager
- `DATABASE_CONNECTION` - Database connection pool
- Custom configuration tokens from ConfigService

### Guard & Interceptor Registration
- Guards: `CustomThrottlerGuard`, `MultiDimThrottleGuard`, `JwtAuthGuard`
- Interceptors: `IdempotencyInterceptor`, `LoggingInterceptor`
- Must implement NestJS guard/interceptor interfaces

## Architectural Patterns to Maintain

### Observability Standards
- All services must propagate `correlation_id` and `tenant_id`
- Winston logging with structured format
- Prometheus metrics with consistent labels
- OpenTelemetry span creation for tracing

### Security Patterns
- Multi-dimensional rate limiting (IP + device + user)
- Audit event emission for sensitive operations
- JWT token validation and refresh handling
- Password breach checking integration

### Error Handling
- Consistent HTTP status codes and error responses
- Correlation ID in all error responses
- Structured error logging with context

## Stub Generation Priority

1. **Critical Infrastructure** (blocks compilation): Database, Redis, Config modules
2. **Authentication & Security** (blocks auth flows): Auth services, guards, security modules  
3. **Observability** (affects monitoring): Logging, metrics, tracing modules
4. **Business Logic** (affects features): User, OTP, feature flag modules
5. **Utilities** (affects DX): Middleware, DTOs, helper functions

## Validation Checklist

- [ ] All TypeScript compilation errors resolved
- [ ] All import statements have corresponding module stubs
- [ ] NestJS dependency injection works for all modules
- [ ] Guard and interceptor registration succeeds
- [ ] Unit tests can run without missing module errors
- [ ] Build process completes successfully

---

**Generated**: October 9, 2025  
**Source**: TypeScript compilation analysis + import statement extraction  
**Target**: Monorepo stub generation for CI/CD pipeline