/**
 * Health Module Stub
 * 
 * Health check module providing system health monitoring.
 * This stub enables TypeScript compilation and NestJS DI resolution.
 * 
 * TODO: Replace with actual health check implementation
 * - Add database health checks
 * - Add Redis health checks
 * - Add external service health checks
 * - Implement detailed health metrics
 * 
 * Consumers: app.module.ts
 * Priority: Medium (health monitoring)
 */

import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/**
 * Health monitoring module
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}