import { SetMetadata } from "@nestjs/common";

export const RATE_LIMIT_RULES_KEY = "rate_limit_rules";

export interface RateLimitDimensionRule {
  limit: number;
  window: string;
}

export interface RateLimitOptions {
  user?: RateLimitDimensionRule;
  ip?: RateLimitDimensionRule;
  device?: RateLimitDimensionRule;
}

export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_RULES_KEY, options);
