import { Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { PasswordBreachService } from "./password-breach.service";
import { PasswordPolicyService } from "./password-policy/password-policy.service";
import { ConfigModule } from "../config/config.module";
import { RedisModule } from "../redis/redis.module";
import { RateLimiterModule } from "../rate_limiter/rate_limiter.module";
import { RedisThrottlerStorageService } from "./redis-throttler.storage";
import { VelocitySignalsService } from "./velocity-signals.service";
import { HtmlSanitizerService } from "./html-sanitizer.service";

@Module({
  imports: [
    ConfigModule,
    RedisModule,
    RateLimiterModule,
    // CustomThrottlerGuard extends Nest's guard and still requires the
    // framework's options/storage tokens during module graph construction.
    ThrottlerModule.forRoot([]),
  ],
  providers: [
    PasswordBreachService,
    PasswordPolicyService,
    RedisThrottlerStorageService,
    VelocitySignalsService,
    HtmlSanitizerService,
  ],
  exports: [
    PasswordBreachService,
    PasswordPolicyService,
    RedisThrottlerStorageService,
    VelocitySignalsService,
    HtmlSanitizerService,
  ],
})
export class SecurityModule {}
