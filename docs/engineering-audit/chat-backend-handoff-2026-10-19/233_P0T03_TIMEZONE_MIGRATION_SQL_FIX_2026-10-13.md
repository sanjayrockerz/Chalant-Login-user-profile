# P0-T03 — Timezone migration SQL and Prisma mapping repair

**Date:** 2026-10-13<br>
**Status:** One migration defect fixed; P0-T03 remains IN PROGRESS<br>
**Base revision:** `b4cf12fbd8827c528f8ec6ff2d7a800c290d4a9e`<br>
**Code revision:** `1bf195edf6c044346f77eff7901af64cc1d2fd4d`

## Change

The `20251124120000_add_timezone_temporal_fields` migration used PostgreSQL syntax `ADD CONSTRAINT IF NOT EXISTS`, which PostgreSQL rejects. Replaced those four statements with a `DO` block that checks `pg_constraint` for the specific table and constraint name before adding the unchanged check expression. This preserves the intended constraints and makes retries safe if an earlier non-transactional attempt added some constraints before failing.

The Prisma `User.timezoneUpdatedAt` and `User.timezoneSource` fields now map to the physical columns `timezone_updated_at` and `timezone_source` created by that migration. The model field names and query API remain the same.

## Verification

- **RED:** PostgreSQL rejected the original migration on the minimal fixture at `ADD CONSTRAINT IF NOT EXISTS` with `syntax error at or near "EXISTS"`.
- **GREEN:** On a fresh, isolated local PostgreSQL 18.3 cluster with synthetic minimum `users` and `messages` tables, the updated migration applied successfully twice. The four named constraints existed exactly once afterward.
- Four invalid inserts (hour 24, day 7, week 54, and a non-zero-padded date) were each rejected by their corresponding check constraint.
- `npx prisma validate` passed using the host-installed Prisma 7.4.2. `npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` showed `timezone_updated_at` and `timezone_source` as physical columns.
- `npm run typecheck`, `npm run build`, and `git diff --check` passed.

The PostgreSQL instance was local and isolated under a temporary directory; it was stopped and the fixture directory removed. The Docker daemon remained unresponsive, so this did not use the repository's pinned PostgreSQL 17.11 image. The local Prisma 7.4.2 install also differs from the repository's declared `^7.10.0` dependency.

## Boundaries and remaining gate

The fixture deliberately supplies synthetic `users` and `messages` tables. It does not replay all 61 canonical migrations, confirm the authoritative shared `users` schema, check the `UserRole` enum contract, or prove a supported fresh/upgrade deployment path. The known missing `users` prerequisite remains. P0-T03 stays IN PROGRESS pending the schema owner's authoritative baseline and deployment ordering, followed by full fresh and upgrade replay on the pinned disposable database.

This corrects a historical migration file because its checked-in SQL cannot execute on PostgreSQL. No hosted or existing database was inspected for its `_prisma_migrations` checksum/history. An environment that previously applied a separately corrected copy may require owner-guided reconciliation; this local fixture is not a production migration-safety claim.
