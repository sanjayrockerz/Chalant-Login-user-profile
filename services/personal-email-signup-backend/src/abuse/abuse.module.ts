/**
 * Abuse Module Stub
 *
 * Abuse detection and prevention module.
 * This stub enables TypeScript compilation and NestJS DI resolution.
 *
 * TODO: Replace with actual abuse detection implementation
 * - Implement rate limiting and throttling
 * - Add suspicious activity detection
 * - Implement IP reputation checks
 * - Add abuse reporting functionality
 *
 * Consumers: app.module.ts
 * Priority: Medium (security feature)
 */

import { Module } from "@nestjs/common";
import { AbuseService } from "./abuse.service";
import { AbuseController } from "./abuse.controller";

/**
 * Abuse detection and prevention module
 */
@Module({
  controllers: [AbuseController],
  providers: [AbuseService],
  exports: [AbuseService],
})
export class AbuseModule {}
