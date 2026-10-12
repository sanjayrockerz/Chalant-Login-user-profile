import { Module } from "@nestjs/common";
import { PasswordBreachService } from "./password-breach.service";
import { PasswordPolicyService } from "./password-policy/password-policy.service";
import { ConfigModule } from "../config/config.module";
import { RedisModule } from "../redis/redis.module";
import { RedisThrottlerStorageService } from "./redis-throttler.storage";
import { CustomThrottlerGuard } from "./custom-throttler.guard";
import { VelocitySignalsService } from "./velocity-signals.service";
import { HtmlSanitizerService } from "./html-sanitizer.service";

@Module({
  imports: [ConfigModule, RedisModule],
  providers: [
    PasswordBreachService,
    PasswordPolicyService,
    RedisThrottlerStorageService,
    CustomThrottlerGuard,
    VelocitySignalsService,
    HtmlSanitizerService,
  ],
  exports: [
    PasswordBreachService,
    PasswordPolicyService,
    RedisThrottlerStorageService,
    CustomThrottlerGuard,
    VelocitySignalsService,
    HtmlSanitizerService,
  ],
})
export class SecurityModule {}
