/**
 * Auth CC Module Stub
 *
 * Alternative authentication module (auth_cc version).
 * This stub enables TypeScript compilation and NestJS DI resolution.
 *
 * TODO: Replace with actual auth_cc implementation
 * - Integrate existing auth.service.ts
 * - Add terms.controller.ts and terms.service.ts
 * - Configure authentication strategies
 *
 * Consumers: app.module.ts
 * Priority: Medium (alternative auth system)
 */

import { Module } from "@nestjs/common";
import { TermsController } from "./terms.controller";
import { TermsService } from "./terms.service";

/**
 * Auth CC module providing alternative authentication
 */
@Module({
  controllers: [TermsController],
  providers: [TermsService],
  exports: [TermsService],
})
export class AuthModule {}
