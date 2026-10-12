import { Module } from '@nestjs/common';
import { RateLimiterService } from './rate_limiter.service';
import { MultiDimThrottleGuard } from '../security/multi_dim_throttle.guard';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [RedisModule],
  providers: [RateLimiterService, MultiDimThrottleGuard],
  exports: [RateLimiterService, MultiDimThrottleGuard],
})
export class RateLimiterModule {}
