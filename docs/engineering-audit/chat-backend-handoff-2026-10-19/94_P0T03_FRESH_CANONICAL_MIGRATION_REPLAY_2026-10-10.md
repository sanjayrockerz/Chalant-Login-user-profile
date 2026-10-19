# P0-T03 Fresh Canonical Migration Replay

**Date:** 2026-10-10 (Asia/Kolkata)  
**Application source revision:** `83ae132d`  
**Status:** P0-T03 remains IN PROGRESS.  
**Evidence class:** Fresh local Docker PostgreSQL replay; not staging or production evidence.

## Setup and command

- Built the Dockerfile `build` target, which pins Node `24.7.0` and Prisma `7.10.0`.
- Started PostgreSQL `17.11` with a fresh `tmpfs` data directory on a task-specific internal Docker network. No host port was published.
- Ran the repository's canonical migration command inside the build image with `DATABASE_URL` targeting only that disposable database:

  ```sh
  npx prisma migrate deploy
  ```

- Prisma reported 61 migrations.

## Result

Replay exited **1** while applying the first migration, `20241111_add_user_privacy_settings`, with Prisma `P3018` and PostgreSQL SQLSTATE `42P01`: relation `users` does not exist. The first migration creates `user_privacy_settings` and its foreign key to `users`; it does not create `users`.

The database accepted connections during the replay. The Docker container used `tmpfs`; the disposable container, network and image were removed after capturing the output. No existing or hosted database was touched.

## Ownership boundary and next requirement

The prior owner statement recorded in [MOD-007](../audits/MOD-007_MEDIA_UPLOAD_RESOURCE_PROOF_2026-09-30.md) says the User Profile/Signup service creates `users` before Chat Backend migrations. A plausible local candidate was found in the read-only `Community-group-chat` checkout at `a57e6b2` (`apps/community-service/prisma/schema.prisma` and `apps/community-service/prisma/migrations/20250901_baseline_schema/migration.sql`): it maps a `User` model to `users` and creates that table. Its identity as the service named by the prior owner has not been confirmed.

The candidate's `UserRole` enum is `STUDENT`, `FACULTY`, `ADMIN`, `MODERATOR`; Chat Backend expects `USER`, `MODERATOR`, `ADMIN`. A focused disposable PostgreSQL check created only the candidate enum and the relevant `users(id, role)` shape, then applied Chat Backend migration `20260408101000_add_user_role_to_users`. The migration exited 0 because it skips an existing type and role column, but inserting `role='USER'` then failed with `invalid input value for enum "UserRole"`. This is a targeted compatibility test of the exact enum/column contract, not application of the full Community-group-chat baseline or confirmation that it is the production owner. The inspected checkout had unrelated modified and untracked documentation files; the Prisma schema and migration files inspected were tracked and showed no diff. No source repository files were changed by this inspection.

## Next migration failure found after satisfying the first table precondition

A second isolated PostgreSQL `17.11` check created only minimal `users` and `messages` tables needed by Chat Backend migration `20251124120000_add_timezone_temporal_fields`, then ran that migration with `psql -v ON_ERROR_STOP=1`. It stopped with a syntax error at `ADD CONSTRAINT IF NOT EXISTS` for `messages_local_hour_check`. PostgreSQL reports `syntax error at or near "NOT"`. This shows a later blocker after the missing `users` precondition; it is not a successful full-chain replay.

Source comparison also found that this migration adds `timezone_updated_at` and `timezone_source`, while the current Prisma `User` model declares `timezoneUpdatedAt` and `timezoneSource` without `@map` attributes. Under Prisma's default mapping these are different column names. This is a source-level migration/model mismatch; the complete migration could not finish against the minimal fixture because of the unsupported constraint syntax.

These focused checks used disposable `tmpfs` PostgreSQL containers and synthetic minimum table shapes only. They do not establish the supported owner-provisioned database baseline. No migration file or source repository was changed.

The fresh replay reconfirms the missing prerequisite; this evidence does not authorize creating a replacement `users` table in Chat Backend migrations. The named schema owner, authoritative DDL/migration artifact, compatibility matrix, and deployment ordering remain unconfirmed.

P0-T03 remains IN PROGRESS. The next gate is to identify and inspect the authoritative `users` schema and supported fresh/upgrade deployment path, then replay both paths on disposable PostgreSQL. No migration-history change is made by this evidence run.
