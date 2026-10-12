import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { CanonicalAuthModule } from "../canonical-auth/canonical-auth.module";
import { ConfigModule } from "../config/config.module";
import { MetricsModule } from "../metrics/metrics.module";
import { RateLimiterModule } from "../rate_limiter/rate_limiter.module";
import { HtmlSanitizerService } from "../security/html-sanitizer.service";
import { ContactsController } from "./contacts.controller";
import {
  CanonicalPhoneHashingAdapter,
  CanonicalPhoneNormalizationAdapter,
} from "./canonical-contact-adapters";
import { ContactsAnomalyService } from "./contacts-anomaly.service";
import { ContactsFeatureFlagService } from "./contacts-feature-flags.service";
import { ContactMatchingService } from "./contact-matching.service";
import { ContactsObservabilityService } from "./contacts-observability.service";
import { ContactsRepository } from "./contacts.repository";
import { ContactSuggestionService } from "./contact-suggestion.service";
import { ContactsService } from "./contacts.service";
import {
  PHONE_HASHING_PORT,
  PHONE_NORMALIZATION_PORT,
} from "./contacts.tokens";
import { SuggestionRankingService } from "./suggestion-ranking.service";
import { createLogger } from "winston";

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    MetricsModule,
    RateLimiterModule,
    CanonicalAuthModule,
  ],
  controllers: [ContactsController],
  providers: [
    ContactsService,
    ContactsRepository,
    ContactMatchingService,
    ContactSuggestionService,
    ContactsFeatureFlagService,
    SuggestionRankingService,
    ContactsAnomalyService,
    HtmlSanitizerService,
    {
      provide: ContactsObservabilityService,
      useFactory: () => new ContactsObservabilityService(createLogger()),
    },
    {
      provide: PHONE_NORMALIZATION_PORT,
      useClass: CanonicalPhoneNormalizationAdapter,
    },
    {
      provide: PHONE_HASHING_PORT,
      useClass: CanonicalPhoneHashingAdapter,
    },
  ],
  exports: [ContactsService],
})
export class ContactsModule {}
