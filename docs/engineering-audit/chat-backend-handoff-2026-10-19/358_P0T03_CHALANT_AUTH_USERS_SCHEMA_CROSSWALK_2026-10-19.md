# P0-T03 — Chalant Auth `User` schema crosswalk

**Date:** 2026-10-19
**Chat Backend revision:** `7f6c182151fee171660baa97b1d4326d2ff19a36`
**Owner-reported external service:** `chalant-auth-monorepo`
**Inspected owner checkout revision:** `abe21cfa21ddef4fb7a415871b541e5bbf083f95`
**Result:** authoritative repository identified; exact shared physical table and Chat integration contract remain unresolved. No source or database was changed.

## Source used by the Auth service

In `services/personal-email-signup-backend/package.json`, Prisma generation/deploy is configured with `prisma/auth.schema.prisma`. That schema's `User` model has no `@@map`, so its SQL table is the quoted, case-sensitive `"User"`; its migrations consistently create or alter `"User"`. The active model uses UUID `id`, unique `email` and `username`, account/onboarding/identity/profile fields, and no `UserRole` field or enum. Its current `UserAccountStatus` values are `ACTIVE`, `SUSPENDED`, and `DISABLED`.

The migration history has several legacy `CREATE TABLE "User"` migrations with integer IDs, followed by `20250521120000_switch_user_ids_to_uuid` to replace them. Canonical migrations dated 2026-10-09/10 add identity, provider-only password behavior, onboarding, and policy state to `"User"`. Existing audit evidence for the unchanged application tree at `9da0f96` reports a fresh-chain failure inside the integer-to-UUID migration; the inspected owner checkout is now at `abe21cfa`, whose intervening change is documented as a docs-only audit update. This crosswalk does not rerun that chain or establish any deployed database's migration state.

## Other user schema in the same repository

The repository also contains `db/prisma/schema.prisma`, which maps another `User` model to lowercase `users` and uses UUID IDs, plus `db/prisma/migrations/20251017_contact_discovery/migration.sql` and root `db/migrations/*` that alter lowercase `users`. The signup service package does not select this schema: its Prisma schema setting and generation command select `services/personal-email-signup-backend/prisma/auth.schema.prisma`. No inspected source establishes that the lowercase root schema is the shared, deployed identity table or defines a handoff between these two representations. Do not equate them based only on the overlapping model/table names.

The owner checkout was at `abe21cfa` with one pre-existing untracked repository-context document. The referenced schemas/migrations were read only. No checkout files, including that untracked file, were changed.

## Chat Backend compatibility gap

Chat Backend's `prisma/schema.prisma` maps its model to lowercase `users`. It declares a text/CUID user ID and a required `UserRole` (`USER`, `MODERATOR`, `ADMIN`). Existing Chat Backend migrations alter lowercase `users`, add that enum/column, and add text foreign keys to `users.id`; the chain has no migration that creates the external owner table. The Auth service's selected schema instead exposes `"User"`, UUID IDs, and no system-role column/enum. Therefore there is no safe migration-order-only fix: table name, ID type, and role semantics all differ. The Auth service's separate lowercase `users` model is also UUID-based and is not the signup service's selected Prisma schema.

## Next contract decision

Treat `chalant-auth-monorepo` as the schema-owning repository, as confirmed by its owner. Before changing Chat Backend migrations or Prisma relations, choose and document the integration target:

1. **Use Auth service `"User"` as the canonical identity row.** Define how Chat Backend maps UUID identities and profile fields, whether Chat-specific data belongs in separate tables keyed by that UUID, and how authorization formerly based on `UserRole` is represented (Auth account status is not an equivalent role).
2. **Use Chalant's lowercase `users` table as the cross-service contract.** The owner must confirm that this otherwise separate schema is authoritative/deployed and define the UUID, field ownership, and role contract plus ordering relative to Auth migrations.

After that choice, validate both fresh and existing-owner-schema paths on disposable PostgreSQL. Until then, do not add a Chat-owned replacement users table, mutate Auth migrations, cast IDs, or map `USER` to `ACTIVE`/`STUDENT`/another status. P0-T03 and dependent P1-T03/P1-T04 remain blocked; P1-T07 is also BLOCKED on those registered dependencies.
