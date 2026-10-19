# Database Contract Plan

**Status:** planning only. This document does not authorize production DDL or connect to any database.

## Contract to establish

1. **Authority:** identify owner/source of truth for every table, especially externally provisioned `users`; reconcile Prisma schema, SQL migrations, runtime queries and deployment provisioning.
2. **Fresh install:** empty disposable DB receives a deterministic complete schema, extensions, functions, triggers, grants and indexes using the supported migration entrypoint.
3. **Existing install:** supported starting revisions upgrade in order; migration history is trustworthy; drift is detected rather than papered over.
4. **Runtime:** application role has least privilege; required routines and transaction isolation are present; connection/pool behavior is bounded.
5. **Compatibility:** current and previous app versions can coexist during rollout where needed; destructive column removal follows expand/contract.
6. **Recovery:** backup/restore, forward-fix and rollback limits are explicit.

## Discovery procedure

- Enumerate Prisma models, migrations, raw SQL, references to SQL functions/procedures/triggers, schema-push commands, fixture/bootstrap DDL and CI-only setup.
- Trace each routine from caller to creation source, signature, security definer/invoker context, permissions and transaction behavior.
- Compare expected and observed schema only on an explicitly disposable target; preserve a sanitized schema diff.
- Determine what owns `users` and other externally managed objects from an accountable deployment/schema owner. A Prisma model or test bootstrap is not authoritative by itself.
- Classify every object: app-owned, provider-owned, externally provisioned, test-only, deprecated or unknown.

## Migration design method

- Versioned, immutable migration files; no hidden mutation of an already-applied migration.
- Idempotency only where appropriate and explicit: avoid `IF NOT EXISTS` that conceals wrong shape/owner.
- Expand/contract for rolling compatibility: add nullable/compatible field or new representation; dual-read/write only with a bounded transition; backfill in resumable batches; validate; switch readers; remove old form in a later release.
- Evaluate lock duration, table rewrite, index build mode, statement/lock timeout, replication lag and transaction size using representative data.
- Deploy required routines in canonical migration path; test permissions and exact signatures; do not create them only in Jest bootstrap.
- For an external `users` contract, prefer a documented verification/compatibility check over taking schema ownership without authority.

## Verification matrix

| Scenario                               | Required proof                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| Empty database                         | Full canonical replay; expected objects/routines/indexes/grants; application smoke. |
| Supported prior version                | Upgrade path and history; no out-of-order or duplicate object behavior.             |
| Existing externally owned users schema | Owner-approved contract validation; no destructive mutation.                        |
| Concurrent app versions                | Compatibility during deploy and rollback window.                                    |
| Large-table change                     | Lock/runtime/resource estimate and resumable backfill/recovery plan.                |
| Failure midway                         | Transaction/partial-apply behavior, retry safety and forward-fix.                   |
| Restore                                | Backup captured and restore to disposable target with validation.                   |

## Prisma and raw SQL controls

Pin Prisma CLI/client versions coherently. Choose one canonical migration command and document that `db push` is not production history. Validate generated client after schema changes. For raw SQL, capture parameterization, result types, nullability, transaction client, query plan and database permissions. Add contract tests that fail if required routines are missing; do not rely on a test bootstrap silently creating the missing object.

## Risk, rollback and approval boundary

Schema rollback is not always safe after writes. For destructive or data-transforming changes, plan forward repair and restore rather than assuming a down migration can recover data. Identify owner, approver, deployment operator, backup evidence, maintenance window and abort conditions. No production DDL begins until P1-T04 has owner-approved fresh/existing contracts and P1-T03 has routine provenance. User permission and deployment policy remain separate gates.

## Completion evidence

Store migration inventory, object ownership table, sanitized schema diffs, exact commands and versions, fresh/upgrade outputs, routine signatures, lock analysis, compatibility tests, backup/restore evidence, reviewer and remaining unknowns under the task evidence record. Mark unavailable production schema facts UNKNOWN, not inferred PASS.
