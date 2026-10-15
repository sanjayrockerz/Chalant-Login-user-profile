/**
 * Auth Module Stub
 *
 * Main authentication module providing JWT strategy, guards, and auth services.
 * This stub enables TypeScript compilation and NestJS DI resolution.
 *
 * TODO: Replace with actual authentication implementation
 * - Implement JwtAuthGuard for route protection
 * - Add JWT strategy for token validation
 * - Integrate with PassportJS for authentication strategies
 * - Add role-based access control (RBAC)
 *
 * Consumers: auth.controller.ts, protected routes, guards
 * Priority: Critical (blocks authentication flow)
 */

import { Module, forwardRef } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { ConfigModule } from "../config/config.module";
import { ConfigService } from "../config/config.service";
import { UserModule } from "../user/user.module";
import { RedisModule } from "../redis/redis.module";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { SecurityModule } from "../security/security.module";
import type { SignOptions } from "jsonwebtoken";
// TODO: Import actual strategy implementations
// import { JwtStrategy } from './strategies/jwt.strategy';
// import { LocalStrategy } from './strategies/local.strategy';

/**
 * Authentication module providing JWT-based authentication
 */
@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get("JWT_SECRET"),
        signOptions: {
          expiresIn: configService.get("JWT_EXPIRES_IN") as SignOptions["expiresIn"],
        },
      }),
      inject: [ConfigService],
    }),
    forwardRef(() => UserModule),
    RedisModule,
    SecurityModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    // TODO: Add strategy providers
    // JwtStrategy,
    // LocalStrategy,
  ],
  exports: [AuthService, JwtModule, PassportModule],
})
export class AuthModule {}
