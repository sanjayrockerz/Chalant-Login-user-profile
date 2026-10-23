import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PrismaModule } from "../../prisma/prisma.module";
import { ConfigModule } from "../config/config.module";
import { ConfigService } from "../config/config.service";
import { PasswordBreachService } from "../security/password-breach.service";
import { EmailModule } from "../email/email.module";
import { CanonicalAuthController } from "./canonical-auth.controller";
import { CanonicalAuthService } from "./canonical-auth.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { IdentityModule } from "../identity/identity.module";
import { RedisModule } from "../redis/redis.module";
import { GoogleAuthController } from "./google-auth.controller";
import { GoogleAuthService } from "./google-auth.service";
import { GOOGLE_OIDC_CLIENT, GoogleOidcClient } from "./google-oidc.types";
import { OAuth2Client } from "google-auth-library";
import { AppleAuthController } from "./apple-auth.controller";
import { AppleAuthService } from "./apple-auth.service";
import { AppleOidcClientAdapter } from "./apple-oidc.client";
import { APPLE_OIDC_CLIENT, AppleOidcClient } from "./apple-oidc.types";
import { CanonicalRecoveryController } from "./canonical-recovery.controller";
import { CanonicalRecoveryService } from "./canonical-recovery.service";
import { PasswordPolicyService } from "../security/password-policy/password-policy.service";
import { ChatProfileOutboxWorker } from "./chat-profile-outbox.worker";

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    IdentityModule,
    RedisModule,
    EmailModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get("JWT_SECRET"),
        verifyOptions: {
          issuer: "r3-canonical-identity",
          audience: "r3-api",
        },
      }),
    }),
  ],
  controllers: [
    CanonicalAuthController,
    GoogleAuthController,
    AppleAuthController,
    CanonicalRecoveryController,
  ],
  providers: [
    PasswordBreachService,
    PasswordPolicyService,
    CanonicalAuthService,
    {
      provide: GOOGLE_OIDC_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): GoogleOidcClient => {
        const client = new OAuth2Client(
          config.get("GOOGLE_CLIENT_ID") ?? "",
          config.get("GOOGLE_CLIENT_SECRET") ?? "",
          config.get("GOOGLE_REDIRECT_URI"),
        );
        return {
          generateAuthUrl: (options) => client.generateAuthUrl(options),
          getToken: (options) => client.getToken(options),
          verifyIdToken: (options) => client.verifyIdToken(options),
        };
      },
    },
    GoogleAuthService,
    {
      provide: APPLE_OIDC_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): AppleOidcClient =>
        new AppleOidcClientAdapter(config),
    },
    AppleAuthService,
    CanonicalRecoveryService,
    PasswordPolicyService,
    JwtAuthGuard,
    ChatProfileOutboxWorker,
  ],
  exports: [
    CanonicalAuthService,
    JwtAuthGuard,
    GoogleAuthService,
    AppleAuthService,
    CanonicalRecoveryService,
  ],
})
export class CanonicalAuthModule {}
