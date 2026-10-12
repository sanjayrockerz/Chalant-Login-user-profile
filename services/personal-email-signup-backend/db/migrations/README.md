# Database Migrations

This directory contains database migrations for the personal-email-signup-backend service.

## Migration Strategy

We use **Prisma Migrate** for schema versioning and database evolution.

### Creating a Migration

```bash
# Generate migration from schema changes
npm run prisma:migrate:dev --name <descriptive-name>

# Example
npm run prisma:migrate:dev --name add-user-preferences-table
```

### Applying Migrations

```bash
# Development
npm run prisma:migrate:dev

# Production (via CI/CD)
npm run prisma:migrate:deploy
```

### Migration File Naming Convention

Format: `YYYYMMDDHHMMSS_<descriptive_name>.sql`

Example: `20251009120000_add_user_preferences_table.sql`

## Migration Best Practices

1. **Always review generated SQL** before applying
2. **Test migrations on a copy of production data** before deploying
3. **Make migrations reversible** when possible (provide DOWN migrations)
4. **Keep migrations small and focused** (one logical change per migration)
5. **Document complex migrations** with comments in the SQL file
6. **Never edit applied migrations** (create new ones instead)

## Rollback Strategy

```bash
# Rollback last migration (development only)
npm run prisma:migrate:reset

# Production rollbacks require manual intervention
# Document rollback steps in each migration file
```

## Migration Template

See `template.sql` for a standard migration file structure.

## Common Migration Types

### Adding a Table
```sql
-- migration: 20251009_add_audit_log_table
CREATE TABLE "audit_logs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT REFERENCES "users"("id"),
  "action" TEXT NOT NULL,
  "correlation_id" TEXT,
  "tenant_id" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "idx_audit_logs_user_id" ON "audit_logs"("user_id");
CREATE INDEX "idx_audit_logs_correlation_id" ON "audit_logs"("correlation_id");
```

### Adding a Column
```sql
-- migration: 20251009_add_email_verified_column
ALTER TABLE "users" ADD COLUMN "email_verified" BOOLEAN DEFAULT false;
```

### Data Migration
```sql
-- migration: 20251009_backfill_user_roles
UPDATE "users" 
SET "role" = 'user' 
WHERE "role" IS NULL;
```

## Troubleshooting

### Migration Fails in Production
1. Check logs for specific error message
2. Verify schema drift: `npm run prisma:migrate:status`
3. Resolve drift: `npm run prisma:migrate:resolve`
4. Contact DevOps for manual intervention if needed

### Schema Drift Detected
```bash
# Check migration status
npm run prisma:migrate:status

# Reset development database (⚠️ destructive)
npm run prisma:migrate:reset

# Re-apply all migrations
npm run prisma:migrate:deploy
```

## Related Documentation

- [Prisma Migrate Docs](https://www.prisma.io/docs/concepts/components/prisma-migrate)
- [Production Deployment Guide](../../docs/production-readiness/runbook.md)
- [Data Migration Guide](../../docs/migration/README.md)
