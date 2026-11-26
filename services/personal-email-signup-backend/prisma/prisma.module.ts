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

function requireDatabaseUrl(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} must be configured before Prisma starts`);
  return value;
}

async function assertRestrictedRuntimeRole(
  client: PrismaClient,
  expectedRole: string,
): Promise<void> {
  const rows = await client.$queryRaw<
    Array<{
      role_name: string;
      is_superuser: boolean;
      can_create_database: boolean;
      can_create_role: boolean;
      can_replicate: boolean;
      bypasses_rls: boolean;
      owns_schema: boolean;
      owns_relation: boolean;
      has_role_membership: boolean;
    }>
  >`
    SELECT current_user AS role_name,
           role.rolsuper AS is_superuser,
           role.rolcreatedb AS can_create_database,
           role.rolcreaterole AS can_create_role,
           role.rolreplication AS can_replicate,
           role.rolbypassrls AS bypasses_rls,
           EXISTS (
             SELECT 1 FROM pg_namespace n
              WHERE n.nspname = 'public' AND n.nspowner = role.oid
           ) AS owns_schema,
           EXISTS (
             SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relowner = role.oid
           ) AS owns_relation,
           EXISTS (
             SELECT 1 FROM pg_auth_members membership
              WHERE membership.member = role.oid
           ) AS has_role_membership
      FROM pg_roles role WHERE role.rolname = current_user`;
  const role = rows[0];
  if (
    !role ||
    role.role_name !== expectedRole ||
    role.is_superuser ||
    role.can_create_database ||
    role.can_create_role ||
    role.can_replicate ||
    role.bypasses_rls ||
    role.owns_schema ||
    role.owns_relation ||
    role.has_role_membership
  ) {
    throw new Error(
      "Auth database connection is not the configured non-owner runtime role",
    );
  }
}

/**
 * Prisma service providing database access
 */
export class PrismaService extends PrismaClient {
  constructor() {
    const databaseUrl =
      process.env.DATABASE_URL_AUTH ?? process.env.DATABASE_URL;
    if (!databaseUrl)
      throw new Error(
        "DATABASE_URL_AUTH must be configured before Prisma starts",
      );
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
    if (
      process.env.NODE_ENV === "production" ||
      process.env.AUTH_REQUIRE_SEPARATE_DATABASE_ROLES === "true"
    ) {
      await assertRestrictedRuntimeRole(
        this,
        requireDatabaseUrl("AUTH_RUNTIME_DATABASE_ROLE"),
      );
    }
  }

  async onModuleDestroy() {
    // TODO: Implement graceful shutdown
    await this.$disconnect();
  }
}

/**
 * Separate, non-owner connection used only for transactions which atomically
 * mutate SOC receipts/resources together with protected Auth source rows.
 * It is never allowed to fall back implicitly to the ordinary runtime URL.
 */
export class AuthSafetyPrismaService extends PrismaClient {
  constructor() {
    const databaseUrl = requireDatabaseUrl("AUTH_SAFETY_DATABASE_URL");
    super({ datasources: { db: { url: databaseUrl } } });
  }

  async onModuleInit() {
    await this.$connect();
    if (
      process.env.NODE_ENV === "production" ||
      process.env.AUTH_REQUIRE_SEPARATE_DATABASE_ROLES === "true"
    ) {
      await assertRestrictedRuntimeRole(
        this,
        requireDatabaseUrl("AUTH_SAFETY_DATABASE_ROLE"),
      );
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

/**
 * Prisma module providing database configuration
 */
@Global()
@Module({
  providers: [PrismaService, AuthSafetyPrismaService],
  exports: [PrismaService, AuthSafetyPrismaService],
})
export class PrismaModule {}
