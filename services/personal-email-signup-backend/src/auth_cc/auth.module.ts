/**
 * Terms compatibility module.
 *
 * This module owns only the legacy terms endpoints. It is deliberately not
 * an authentication owner; CanonicalAuthModule owns all /auth routes.
 *
 * TODO: Replace with actual auth_cc implementation
 * - Integrate existing auth.service.ts
 * - Add terms.controller.ts and terms.service.ts
 * - Configure authentication strategies
 *
 * Consumers: app.module.ts
 */

import { Module } from "@nestjs/common";
import { UserModule } from "../user/user.module";
import { MetricsModule } from "../metrics/metrics.module";
import { CanonicalPolicyModule } from "../policies/canonical-policy.module";
import { CanonicalAuthModule } from "../canonical-auth/canonical-auth.module";
import { TermsController } from "./terms.controller";
import { TermsService } from "./terms.service";

/**
 * Compatibility module providing terms acceptance only.
 */
@Module({
  imports: [
    UserModule,
    MetricsModule,
    CanonicalAuthModule,
    CanonicalPolicyModule,
  ],
  controllers: [TermsController],
  providers: [TermsService],
  exports: [TermsService],
})
export class TermsModule {}
