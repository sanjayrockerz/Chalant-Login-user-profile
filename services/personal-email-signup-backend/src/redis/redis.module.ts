/**
 * Redis Module Stub
 * 
 * Provides Redis service configuration and dependency injection setup.
 * This stub enables NestJS module imports and DI resolution.
 * 
 * TODO: Replace with actual Redis module configuration
 * - Configure Redis cluster connections
 * - Add connection pooling and health checks
 * - Set up proper retry and failover logic
 * 
 * Consumers: app.module.ts, rate_limiter.module.ts
 * Priority: Critical (blocks caching and rate limiting)
 */

import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { RedisService } from './redis.service';

/**
 * Redis module providing caching and session management
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
