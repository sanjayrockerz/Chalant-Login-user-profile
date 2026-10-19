# P0-T03 — external `users` schema owner clarification

**Date:** 2026-10-19
**Chat Backend revision:** `252c193e`
**Decision (updated 2026-10-19):** repository owner identifies `chalant-auth-monorepo` as the external owner repository. Its source contains two distinct user schemas, so the exact shared physical table and migration contract remain unresolved. See the read-only crosswalk in [358](358_P0T03_CHALANT_AUTH_USERS_SCHEMA_CROSSWALK_2026-10-19.md). P0-T03 and dependent P1-T03/P1-T04 remain open.

## Owner clarification

The repository owner stated that Chat Backend does not own the shared `users` table, then identified `chalant-auth-monorepo` as the owning repository. This resolves repository identity, but not the authoritative schema inside that monorepo, its deployed migration baseline, the shared role enum, or deployment order and field ownership.

The Community-group-chat check below was a prior candidate investigation only. It is superseded as the owner candidate by the repository owner's clarification; it is not treated as authoritative evidence for this integration.

## Read-only candidate check

The previously recorded candidate is the local `Community-group-chat` checkout, `apps/community-service`, at working-tree revision `c83e7f52a3cd7c0782192c4078984fba85a2bc5c`. Its root `AGENTS.md` identifies the community-service Prisma schema as primary for that monorepo. The inspected schema and baseline migration are tracked and unchanged relative to that checkout's HEAD; that checkout has unrelated dirty changes in messaging tests and remediation documents, which were not touched.

The candidate's `apps/community-service/prisma/schema.prisma` maps `User` to `users` and defines `UserRole` as `STUDENT`, `FACULTY`, `ADMIN`, and `MODERATOR`. Its baseline migration `apps/community-service/prisma/migrations/20250901_baseline_schema/migration.sql` creates that enum and a `users` table with non-null `email`, `username`, and `passwordHash`, plus `CreatorTier` and other community-owned fields. Chat Backend expects `UserRole.USER`, `MODERATOR`, and `ADMIN`; its existing migrations do not add `USER` to an already-present enum. The existing compatibility evidence in [221](221_P0T03_SHARED_USERS_SCHEMA_COMPATIBILITY_RECHECK_2026-10-12.md) and [94](94_P0T03_FRESH_CANONICAL_MIGRATION_REPLAY_2026-10-10.md) shows the `USER` insertion fails against this candidate enum.

This is evidence that the candidate is a plausible external schema provider, not confirmation that it is the authoritative owner selected by the repository owner or that this baseline is deployed. No database was contacted, and no file in the candidate checkout was changed.

## Required next input and safe implementation boundary

Confirm whether `Community-group-chat/apps/community-service` is the authoritative owner. If yes, the owner contract must specify the valid mapping for Chat Backend's ordinary `USER` role, which service may add Chat-specific fields, and the supported owner-migration-before-Chat-migration order for fresh and existing databases. If another service is authoritative, provide its exact repository/migration or DDL and the equivalent role, field-ownership, and deployment-order contract.

Until that contract is identified, do not create a second `users` table, alter an owner-managed enum, modify historical Chat Backend migrations, or claim canonical migration replay. The current P1-T07 Jest/runtime evidence and owner-approved skip disposition remain valid for revision `3749d3c3`; P1-T07 cannot close its registered migration dependencies from this clarification alone.
