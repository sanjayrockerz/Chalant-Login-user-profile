# Request for Chat Backend developer — shared user schema and migration contract

**Prepared:** 2026-10-19

**For:** The developer maintaining Chat Backend

**Purpose:** Get an evidence-based diagnosis and an agreed implementation path for Chat Backend's shared user-schema and migration problem. This request is intended to produce a safe fix, not only another audit summary.

## The request in one paragraph

Please verify the current Chat Backend integration against the identity service's authoritative schema and deployment path. Then tell us which table Chat Backend is expected to reference, how IDs, roles, and field ownership are meant to work, and how a fresh or existing database is provisioned. Based on those facts, propose the smallest safe Chat Backend change and the PostgreSQL checks that will prove it. We want to fix the integration and resume the release gate; we do not want a guessed schema, a duplicate identity table, or a change to another service's owned schema without its owner's agreement.

## Why we are asking

The available evidence shows incompatible contracts:

- Chat Backend's Prisma model maps to lowercase `users`, expects text/CUID IDs, and requires `UserRole(USER, MODERATOR, ADMIN)`.
- The inspected active signup service in `chalant-auth-monorepo` selects `services/personal-email-signup-backend/prisma/auth.schema.prisma`. Its `User` model maps to quoted `"User"`, uses UUID IDs, and has no `UserRole` field or enum.
- The same monorepo has a separate root Prisma schema that maps a UUID `User` model to lowercase `users`. The active signup package does not select that schema, and the evidence does not establish that it is the shared deployed identity table.
- Chat Backend's fresh canonical migration replay previously stopped because the `users` relation did not exist. This is recorded in [94 — Fresh canonical migration replay](94_P0T03_FRESH_CANONICAL_MIGRATION_REPLAY_2026-10-10.md).

These observations establish a contract mismatch in the checked-in sources and a failure in a disposable fresh replay. They do **not** establish which identity table is deployed in any shared environment, what schema the Auth service currently provisions there, or the approved rollout order.

## Important investigation history

- The repository owner identified `chalant-auth-monorepo` as the service repository that owns the external user schema. See [357 — Owner clarification](357_P0T03_EXTERNAL_USER_SCHEMA_OWNER_CLARIFICATION_2026-10-19.md).
- The current read-only source comparison is [358 — Chalant Auth schema crosswalk](358_P0T03_CHALANT_AUTH_USERS_SCHEMA_CROSSWALK_2026-10-19.md). It identifies the two distinct schemas and the unresolved physical-table/role/deployment decision.
- [221 — Earlier compatibility recheck](221_P0T03_SHARED_USERS_SCHEMA_COMPATIBILITY_RECHECK_2026-10-12.md) examined `Community-group-chat` as a possible owner. That candidate is **superseded** by the later owner clarification; do not treat it as the current table-owner answer.
- [233 — Timezone migration repair](233_P0T03_TIMEZONE_MIGRATION_SQL_FIX_2026-10-13.md) fixed a separate Chat Backend migration syntax and column-mapping defect. Do not spend time re-fixing that issue. Its successful synthetic fixture did not establish the external `users` contract or a full migration replay.

Historical task-status labels in older reports predate the current tracker. The present task register reports 14/43 DONE, no tasks IN PROGRESS, 10 BLOCKED, and 19 NOT STARTED. The exact blocked-task handoff is [359](359_BLOCKED_TASK_DEVELOPER_HANDOFF_2026-10-19.md).

## What we need from you first

Please respond with the facts and a recommendation before making schema or migration changes. For each answer, include the repository and commit SHA, file path, and sanitized evidence. If you cannot verify a production/deployment fact, mark it **unknown** and identify who can.

### 1. Confirm Chat Backend's actual integration path

- Which runtime entrypoint and Prisma schema does the deployed Chat Backend build use?
- Which table and columns do its runtime queries and foreign keys use for user identity?
- Which migrations, raw SQL routines, test bootstrap, or deployment scripts assume an externally pre-created `users` table?
- Is the external user schema provisioned in a separate deployment step? If so, name the owning service, exact artifact/command, and ordering contract.

### 2. Confirm the identity-owner contract

Please verify with the Chalant Auth owner, or point us to their written contract, for:

- The canonical physical table and schema/namespace used by the signup/auth flow.
- The ID type, generation method, and stability guarantees.
- Whether Chat Backend should reference the Auth ID directly or maintain a separate mapping.
- The intended authorization/role model. Auth account state (`ACTIVE`, `SUSPENDED`, `DISABLED`) must not be treated as equivalent to Chat roles (`USER`, `MODERATOR`, `ADMIN`) without an explicit owner-approved mapping.
- Ownership of email, username, profile, status, and Chat-specific fields; identify which service may add or alter each field.

If you are not authorized to answer for the identity service, please identify the exact person/team and ask them to confirm these points. Do not infer the contract from a similarly named model or a local schema alone.

### 3. Recommend the smallest safe Chat Backend fix

Once the owner contract is confirmed, please outline the Chat Backend changes you recommend, including:

- Prisma model/relation and foreign-key behavior for the chosen identity key.
- Whether Chat-owned attributes belong in separate tables or are approved columns on an owner-managed table.
- Any role/authorization changes needed to preserve current behavior.
- Required raw SQL routine signatures, migration placement, and compatibility with existing rows.
- Files to change and files that must remain owner-managed.

Please identify any behavior or authorization change this could cause. The target is a compatible integration with the owner service—not to move ownership of identity data into Chat Backend.

### 4. Define and run the proof needed before calling it fixed

Please propose or provide results for:

1. A fresh disposable PostgreSQL setup using the actual supported provisioning and migration sequence.
2. An upgrade from each supported existing schema baseline, including checks for preserved user IDs, foreign keys, roles/authorization, and Chat-owned data.
3. Required raw SQL routine installation and behavior tests through the supported path.
4. A compiled Chat Backend startup/readiness/shutdown smoke against the resulting schema.
5. Exact versions, commit SHAs, commands, exit codes, and sanitized outputs. No production credentials or personal data are needed.

Please distinguish `prisma db push` or synthetic table fixtures from canonical migration replay. A passing schema-push test alone does not prove the supported migration history.

## Scope and boundaries

This is the requested sequence:

1. **Now:** verify the facts and return an owner-backed schema/deployment contract plus your recommended Chat Backend fix.
2. **After the contract is agreed:** implement the Chat Backend-side change and focused migration/integration coverage; coordinate any owner-side change with the identity-service owner.
3. **Then:** rerun the same-revision release gate and update P1-T03, P1-T04, and P1-T07 with evidence and residual risks.

This is **not** a request to solve all ten blocked remediation tasks in one pass. P2 performance tasks follow their registered Phase 1 and measurement dependencies. It is also not authorization to create a second `users` table, silently cast UUIDs to CUID/text, equate account status with role, modify Chalant-owned migrations, or rewrite historical Chat Backend migrations before the ownership and compatibility decision is made.

## Suggested reply format

```text
Chat Backend commit/schema/entrypoint verified:
Current runtime user table and ID contract:
Identity owner and canonical deployed schema (or UNKNOWN):
Owner-confirmed role and field-ownership contract (or UNKNOWN):
Fresh-install provisioning and migration order:
Supported existing-database starting states and upgrade path:
Recommended Chat Backend code/migration changes:
Required owner-side changes and responsible team:
Proof run / environment / exact revision / commands / result:
Known unknowns, risks, and next decision needed:
```

## Files to read alongside this request

- [359 — Blocked-task handoff](359_BLOCKED_TASK_DEVELOPER_HANDOFF_2026-10-19.md) for the full ten-task dependency map and evidence requests.
- [357 — External schema owner clarification](357_P0T03_EXTERNAL_USER_SCHEMA_OWNER_CLARIFICATION_2026-10-19.md).
- [358 — Current Chalant Auth schema crosswalk](358_P0T03_CHALANT_AUTH_USERS_SCHEMA_CROSSWALK_2026-10-19.md).
- [94 — Historical fresh migration failure](94_P0T03_FRESH_CANONICAL_MIGRATION_REPLAY_2026-10-10.md).
- [233 — Fixed timezone migration defect](233_P0T03_TIMEZONE_MIGRATION_SQL_FIX_2026-10-13.md).
- [356 — Latest P1-T07 release-gate evidence](356_P1T07_CURRENT_REVISION_FULL_GATE_AND_SKIP_INVENTORY_2026-10-19.md).
