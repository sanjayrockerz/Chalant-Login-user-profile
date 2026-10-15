/**
 * User Module Stub
 *
 * User management module providing user services and repositories.
 * This stub enables TypeScript compilation and NestJS DI resolution.
 *
 * TODO: Replace with actual user management implementation
 * - Add user repository with Prisma integration
 * - Implement user CRUD operations
 * - Add user validation and sanitization
 * - Integrate with authentication flows
 *
 * Consumers: auth.module.ts, user.controller.ts
 * Priority: Critical (blocks user management)
 */

import { Module } from "@nestjs/common";
import { ConfigModule } from "../config/config.module";
import { PrismaModule } from "../../prisma/prisma.module";
import { RedisModule } from "../redis/redis.module";
import { UserService } from "./user.service";
import { HashedPhoneBackfillJob } from "./jobs/hashed-phone-backfill.job";
import { SecurityModule } from "../security/security.module";

/**
 * User management module
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    RedisModule,
    SecurityModule,
    // Avoid circular dependency with AuthModule
    // forwardRef(() => AuthModule),
  ],
  // The legacy UserController is intentionally not registered. Its routes
  // are unfinished and do not enforce canonical ownership. Profile changes
  // use ProfileController/CanonicalProfileService instead.
  controllers: [],
  providers: [UserService, HashedPhoneBackfillJob],
  exports: [UserService, HashedPhoneBackfillJob],
})
export class UserModule {}
