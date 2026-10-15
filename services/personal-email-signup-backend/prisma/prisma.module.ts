/**
 * Prisma Database Module Stub
 *
 * Provides Prisma ORM configuration and connection management for PostgreSQL.
 * This stub enables TypeScript compilation and NestJS DI resolution.
 *
 * TODO: Replace with actual Prisma configuration
 * - Configure database connection string from environment
 * - Add connection pooling and monitoring
 * - Implement proper error handling and retry logic
 *
 * Consumers: app.module.ts, database services
 * Priority: Critical (blocks compilation)
 */

import { Module, Global } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * Prisma service providing database access
 */
export class PrismaService extends PrismaClient {
  constructor() {
    const databaseUrl =
      process.env.DATABASE_URL_AUTH ?? process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL_AUTH must be configured before Prisma starts",
      );
    }
    super({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    // TODO: Implement graceful shutdown
    await this.$disconnect();
  }
}

/**
 * Prisma module providing database configuration
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
