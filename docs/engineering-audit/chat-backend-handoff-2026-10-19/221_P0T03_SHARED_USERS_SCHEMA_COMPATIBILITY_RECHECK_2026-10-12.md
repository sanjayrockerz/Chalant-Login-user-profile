# P0-T03 — recheck of the shared `users` schema candidate

**Date:** 2026-10-12  
**Chat Backend revision:** `e15451a3`  
**Candidate repository revision:** Community-group-chat `2a9d3dc`, clean working tree  
**Result:** candidate creates the missing table, but compatibility and ownership are unconfirmed; P0-T03 remains **IN PROGRESS**

## Source evidence

- Chat Backend's `prisma/schema.prisma` defines a `User` model mapped to `users` with `UserRole` values `USER`, `MODERATOR`, and `ADMIN`. It also models Chat-specific profile, privacy, presence, timezone, connection, message, device, and revocation fields.
- The first Chat Backend migration, `20241111_add_user_privacy_settings`, creates `user_privacy_settings` with a foreign key to `users`; it does not create `users`. No migration under `prisma/migrations` creates that table.
- The read-only candidate checkout at `/Users/harishraghave/Library/Mobile Documents/com~apple~CloudDocs/Desktop/colleging/Community-group-chat` is at `2a9d3dc` and clean. Its `apps/community-service/prisma/migrations/20250901_baseline_schema/migration.sql` creates `public.users`. Its `apps/community-service/prisma/schema.prisma` also maps a `User` model to `users`.
- The candidate's `UserRole` is `STUDENT`, `FACULTY`, `ADMIN`, `MODERATOR`. Chat Backend's `20260408101000_add_user_role_to_users` migration creates `UserRole` only when the type is absent, then adds `role` using that type with default `USER`. It does not add `USER` to a pre-existing enum.
- The candidate and Chat Backend user models diverge in defaults and fields. The candidate requires password hash, username, and email, uses UUID-generated IDs, and includes `creatorTier`/credential-hardening fields. Chat Backend's model defaults IDs to CUIDs and includes its own privacy, presence, timezone, connections, devices, and messaging relations. Both map the model to the same table name; that overlap does not establish shared-table ownership or a safe union schema.

## Compatibility consequence

The previous disposable PostgreSQL check recorded in [94](94_P0T03_FRESH_CANONICAL_MIGRATION_REPLAY_2026-10-10.md) tested the exact enum conflict: the Chat Backend role migration succeeds against an existing candidate-shaped `UserRole`, but inserting a Chat user with role `USER` fails because the existing enum rejects that value. This source recheck confirms the conflicting enum values remain in the current candidate checkout. The candidate baseline's later migration date also means an external provisioning step would have to be explicitly ordered before Chat Backend's earlier-dated migration chain; no such deployment contract is verified here.

The candidate is therefore evidence of a possible `users` table source only. It is not evidence that Community-group-chat is the named User Profile/Signup owner, that its baseline is the deployed schema, or that Chat Backend may alter that shared table/type.

## Required owner handoff and safe next action

Before changing migration history, obtain from the responsible schema owner:

1. The authoritative service/repository and exact migration or DDL that provisions `public.users` and `UserRole` in each environment.
2. The supported ordering for that provision step and `prisma migrate deploy` for Chat Backend on both fresh and existing databases.
3. The intended role mapping or shared enum contract, including whether `USER` is valid for the owner-managed type.
4. The authoritative policy for field ownership and additive Chat Backend columns on the shared table.

Then validate the agreed contract on disposable PostgreSQL with both a fresh-database replay and an existing-owner-schema upgrade. Do not create a replacement `users` table, rewrite the enum, or change historical migrations based only on this candidate. No database was connected or modified in this recheck.
