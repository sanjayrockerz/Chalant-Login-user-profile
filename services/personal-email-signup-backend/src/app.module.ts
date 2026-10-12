import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module";
import { PrismaModule } from "../prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";
import { UsernameController } from "./user/username.controller";
import { ProfileController } from "./user/profile.controller";
import { APP_GUARD } from "@nestjs/core";
import { CustomThrottlerGuard } from "./security/custom-throttler.guard";
import { AuthModule } from "./auth_cc/auth.module";
import { EmailModule } from "./email/email.module";
import { UserModule } from "./user/user.module";
import { HealthModule } from "./health/health.module";
import { SecurityModule } from "./security/security.module";
import { MetricsModule } from "./metrics/metrics.module";
import { RateLimiterModule } from "./rate_limiter/rate_limiter.module";
import { AbuseModule } from "./abuse/abuse.module";
import { PhaseBModule } from "./phase-b/phase-b.module";
import { EnhancedOTPModule } from "./otp/enhanced-otp.module";
import { PhaseCModule } from "./phase-c/phase-c.module";
import { IdentityModule } from "./identity/identity.module";
import { LoggingInterceptor } from "./common/interceptors/logging.interceptor";
import { IdempotencyInterceptor } from "./common/interceptors/idempotency.interceptor";
import { ContactsModule } from "./contacts/contacts.module";
import { CanonicalPolicyModule } from "./policies/canonical-policy.module";
import { CanonicalAuthModule } from "./canonical-auth/canonical-auth.module";
import { CanonicalProfileService } from "./user/canonical-profile.service";

@Module({
  imports: [
    ConfigModule,
    EmailModule,
    PrismaModule,
    RedisModule,
    UserModule,
    AuthModule,
    HealthModule,
    SecurityModule,
    MetricsModule,
    RateLimiterModule,
    AbuseModule,
    PhaseBModule, // Phase B Enhanced Controls
    EnhancedOTPModule, // Enhanced OTP with Phase B integration
    PhaseCModule, // Phase C Production Rollout
    IdentityModule,
    CanonicalAuthModule,
    ContactsModule,
    CanonicalPolicyModule,
  ],
  controllers: [UsernameController, ProfileController],
  providers: [
    CanonicalProfileService,
    LoggingInterceptor,
    IdempotencyInterceptor,
    { provide: APP_GUARD, useClass: CustomThrottlerGuard },
  ],
})
export class AppModule {}
