# Blocked remediation tasks — developer information handoff

**Prepared:** 2026-10-19

**Repository:** Chat Backend, current documentation commit `0431f9d8`

**Purpose:** Request concrete source, ownership, deployment, and evidence details from the developer maintaining the service/report. This document records what is needed to unblock the ten currently blocked task IDs. It does not request code or database changes in another repository.

**Developer-facing request:** [360 — Chat Backend developer request](360_P0T03_CHAT_BACKEND_DEVELOPER_REQUEST_2026-10-19.md) is the short, stand-alone brief to send first. This file remains the detailed evidence and dependency reference for all ten blocked tasks.

## Request to the service/report maintainer

Please answer the questions in the task sections below from the current source of truth. For each answer, include the repository and commit SHA, exact schema/migration/configuration file paths, and the relevant command output or report/evidence link. If you cannot verify an item, mark it **unknown** and name the person or system that can verify it. Please do not send credentials, tokens, production personal data, or unsanitized query literals.

The most useful immediate response is the **P0-T03 integration contract**. That decision is upstream of most of the blocked queue. The remaining requested details should be answered where available; several tasks depend on Chat Backend work and do not need the external maintainer to implement them.

## Current status and dependency chain

The canonical task register at preparation time records **14/43 DONE, 0 IN PROGRESS, 0 VERIFYING, 10 BLOCKED, and 19 NOT STARTED**. A task is marked BLOCKED when its required next acceptance step depends on an unresolved owner decision or predecessor, even if useful code or local evidence already exists.

```text
Chalant Auth schema/deployment contract
  └─ P0-T03
      ├─ P1-T03: raw SQL routine deployment contract
      └─ P1-T04: users ownership and migration paths
          └─ P1-T07: same-revision release gate closure
              └─ P2-T01: query tracing / PostgreSQL statistics acceptance
                  └─ P2-T02: critical-path measurement acceptance
                      ├─ P2-T03: conversation-list and block-lookup acceptance
                      │   └─ also needs login-userprofile owner approval
                      ├─ P2-T04: Redis invalidation runtime/deployment acceptance
                      └─ P2-T05: outbox budget acceptance

Separate owner decision: P3-T04 module/route disposition
```

The owner has identified **`chalant-auth-monorepo`** as the external user-schema repository. That resolves repository identity only. The source crosswalk found two distinct user schemas there; the exact physical integration table, role and field ownership, and migration/deployment contract remain unresolved. See [357 — owner clarification](357_P0T03_EXTERNAL_USER_SCHEMA_OWNER_CLARIFICATION_2026-10-19.md) and [358 — schema crosswalk](358_P0T03_CHALANT_AUTH_USERS_SCHEMA_CROSSWALK_2026-10-19.md).

## Per-task information required

### P0-T03 — canonical PostgreSQL/Redis bootstrap and migration replay

**Why blocked:** The user table/schema owner and canonical migration contract are not established. The repo-owned timezone migration defect has already been fixed; do not treat that historical defect as the current blocker.

**Current compatibility question:** The active signup service selects `services/personal-email-signup-backend/prisma/auth.schema.prisma`, which maps `User` to quoted `"User"`, uses UUID IDs, and has no `UserRole`. A separate root schema maps a UUID model to lowercase `users`, but the active signup package does not select it. Chat Backend currently expects lowercase `users`, text/CUID IDs, and `UserRole(USER, MODERATOR, ADMIN)`.

**Please provide or confirm:**

1. Which physical table is the supported shared identity source: quoted `"User"`, lowercase `users`, or another explicitly named table?
2. Which service/schema/migration directory owns that table, and which exact migration chain is deployed or intended for fresh installs?
3. Confirm the ID type and generation contract and whether Chat Backend may use that ID directly as its foreign key.
4. Define role/authorization semantics. In particular, explain how Chat's `USER`, `MODERATOR`, and `ADMIN` concepts map, if at all, to the Auth service model. Account status must not be assumed to mean an application role.
5. Identify which service owns email, username, status, profile fields, and any Chat-specific fields. State whether Chat-only fields belong in separate tables.
6. Give the supported fresh-install and existing-database migration order, including how an already-deployed database is identified and validated.
7. Provide sanitized DDL/schema excerpts and migration names, with the source commit SHA. State whether a disposable fresh replay and existing-schema compatibility check have actually passed, and attach their outputs if available.

**Acceptance evidence needed in Chat Backend:** an agreed written contract, compatibility mapping, and repeatable disposable PostgreSQL validation for fresh and existing-owner-schema paths before changing Chat Backend relations/migrations. No replacement `users` table, owner migration edit, ID cast, or role/status substitution is authorized by this request.

### P1-T03 — raw SQL routine inventory and supported deployment

**Why blocked:** It depends on P0-T03's canonical database/migration contract. Local routine work exists, but a full fresh migration replay is not accepted until the owner schema path is resolved.

**Please provide or confirm:**

- The authoritative inventory of database routines, overloads, triggers, extensions, and any objects required by service code or workers.
- Which repository and migration system owns each object, the supported install/upgrade command, required database role/privileges, and required ordering relative to the user-schema migrations.
- Whether both fresh install and upgrade of an existing database are supported; identify compatibility/deprecation behavior for older signatures.
- Current routine contract tests or database replay evidence, including commit SHA and exact routine signatures tested.

**Acceptance evidence needed in Chat Backend:** routine inventory reconciled to active callers, supported installation path identified, and the routine contracts verified as part of the accepted fresh/existing migration paths. Please mark routines outside this service or not in your ownership as such; this task does not assume the external developer owns Chat Backend migrations.

### P1-T04 — authoritative users ownership and migration paths

**Why blocked:** It requires P1-T03's supported routine/migration ordering plus owner input for the authoritative user table and fresh/existing database paths.

**Please provide or confirm:**

- Whether the P0-T03 table, ID, role, and field-ownership answers above are the approved contract.
- The expected migration sequence for a clean database and for each supported existing schema state.
- How existing rows, foreign keys, indexes, enum values, and service-owned profile data are preserved or migrated.
- Any required compatibility period where old and new application versions or schema representations coexist.
- Evidence from disposable replay/upgrade tests, including starting schema/version, resulting schema, row/constraint checks, and commit SHA.

**Acceptance evidence needed in Chat Backend:** owner-approved schema contract, explicit fresh and existing migration strategy, and successful repeatable database proofs. Unknown production migration state must remain unknown; do not infer it from checked-in source.

### P1-T07 — same-revision release gate and residual disposition

**Why blocked:** The current broad gate and compiled runtime smoke are recorded, but closure is gated on P1-T03/P1-T04 migration prerequisites. This is primarily Chat Backend work, not a request for the external service owner to run Chat Backend's suite.

**Current evidence:** [356 — current-revision full gate](356_P1T07_CURRENT_REVISION_FULL_GATE_AND_SKIP_INVENTORY_2026-10-19.md) records 452/484 suites passing, 0 failing, 32 pending; and 9,464/9,904 tests passing, 0 failing, 440 pending. The compiled app returned live/readiness 200 and exited cleanly after SIGTERM using disposable PostgreSQL and Redis. These results do not establish canonical migration replay or deployment readiness.

**Please provide or confirm:** any later report/gate run after the recorded tested revision `3749d3c3`, and whether your report contains an approved owner migration contract that supersedes the open questions above. Include exact revision and scope. If neither exists, no external action is needed for this task yet; it resumes after P1-T03/P1-T04.

### P2-T01 — safe query tracing and PostgreSQL statistics baseline

**Why blocked:** It waits for P1-T07 acceptance. Source-level query instrumentation and local Docker evidence exist; the remaining task must not be represented as production evidence based on those local runs.

**Please provide, if available:**

- Sanitized representative workload/query-shape information and expected traffic window for the report (no bind values or user data).
- PostgreSQL version/provider, `pg_stat_statements` availability and retention/reset policy, and the approved read-only way to collect a baseline.
- Whether the deployed metrics endpoint is scraped, its network/auth policy, and the dashboard/data-source revision used by the report.
- Any existing query latency, pool wait, connection, or saturation evidence with time window and environment label.

**Acceptance boundary:** after upstream release/migration gates, Chat Backend must reconcile a privacy-bounded tracing and PostgreSQL statistics baseline against a representative environment. If production access is unavailable, say so and identify the strongest approved non-production source.

### P2-T02 — critical HTTP, WebSocket, media, anonymous-chat, and worker paths

**Why blocked:** It waits on P2-T01. Extensive local Docker profiles already exist, including an 8× synthetic co-load diagnostic; they are not representative traffic, deployment, capacity, SLO, or cost proof.

**Please provide, if available:**

- A sanitized workload model or report basis: arrival rates, concurrency, payload/room sizes, geographic or tenant skew, burst/reconnect patterns, and critical success/latency targets.
- The actual deployment topology to model (app replicas, Node/runtime, Redis/PostgreSQL/provider versions, object storage, autoscaling and termination limits), or state which values are not known.
- Which externally owned providers or staging environments can be used for integration proof and the constraints on their use.
- Any production incident or report observation that should be reproduced; include timestamps/window and sanitized identifiers only.

**Acceptance boundary:** Chat Backend will use these inputs to choose a representative profile and reconcile requests to durable rows, delivery receipts, queue/outbox state, resources, failures, and cleanup. Existing synthetic profiles remain diagnostic-only unless their representativeness is justified.

### P2-T03 — conversation-list/unread amplification and external block lookup

**Why blocked:** It depends on P2-T01 and P2-T02, and the current tracker also records a required `login-userprofile` owner approval for the proposed block-lookup batching contract. Current source evidence indicates sequential external block checks can dominate worst-case list latency; no request semantics were changed.

**Please provide or confirm:**

- The owner/contact and approval route for `login-userprofile`'s block authority (if you are not that owner, identify the correct one).
- Whether a batch lookup endpoint is supported or planned; exact request/response, max batch size, timeout, authorization, consistency/freshness, partial-failure, and rate-limit semantics.
- Sanitized typical and worst-case conversation counts and whether block filtering is enabled in the target deployment.
- Any endpoint latency/query-count evidence that identifies the report's measured path and environment.

**Acceptance boundary:** preserve the existing fail-safe/visibility contract; do not change block semantics or claim latency improvement until the owning service approves the contract and the end-to-end path is measured.

### P2-T04 — bounded Redis cache invalidation

**Why blocked:** It waits on P2-T02. Prior work includes bounded cache-key behavior and a user-approved post-commit invalidation contract with a 300-second TTL fallback, but deployed Redis behavior and representative workload proof remain separate acceptance evidence.

**Please provide, if available:**

- Redis provider/version/topology, cluster/shard arrangement, eviction policy, key TTL policy, and the relevant cache/search namespace ownership.
- Sanitized key-count/memory/command-rate and cache hit/miss/invalidations for the representative workload; do not send key values or user identifiers.
- Which message/group/profile changes are authoritative invalidation events, the transaction/commit boundary, and any cross-service writers that must publish invalidations.
- Whether production/staging metrics or a supported disposable provider test can be used to verify bounded invalidation and the 300-second fallback.

**Acceptance boundary:** demonstrate no unbounded key scan in the hot path, correct post-commit freshness, bounded work, and safe fallback under the approved workload. A local Redis proof does not establish deployed cache correctness.

### P2-T05 — outbox lease, batch, retry, and concurrency budgets

**Why blocked:** It waits on P2-T02. Retry boundaries and a local fanout cap already have tests, but calibrated runtime lease/batch/retry/concurrency budgets remain open.

**Please provide, if available:**

- Deployment replica/worker counts, transaction and shutdown limits, expected enqueue rate and burst size, recipient fanout distribution, and delivery latency target.
- Current lease duration, claim batch size, poll/backoff policy, retry classification, dead-letter policy, and operator recovery procedure as deployed/configured.
- Sanitized queue/outbox depth, oldest-row age, attempt counts, claim conflicts, delivery failures, and worker resource observations with their time window.
- Any report-backed backlog or duplicate-delivery incidents that should shape acceptance criteria.

**Acceptance boundary:** derive budgets from measured load and deployment limits; prove idempotency, bounded claims/retries, drain/recovery behavior, and resource impact. Existing unit/local proofs do not establish production lease sizing.

### P3-T04 — disposition of modules and routes outside the main runtime graph

**Why blocked:** The source reachability review is complete, but module ownership and consumer intent are unresolved. No module was activated or deleted. See [224 — module reachability disposition](224_P3T04_MODULE_REACHABILITY_DISPOSITION_2026-10-13.md).

**Please provide or identify the accountable owner for each disposition:**

| Module                    | Decision needed                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `AdminModule`             | Is there a supported admin/API entrypoint and route owner, or should the module remain dormant/retire?       |
| `MonitoringModule`        | Is activation intended? Name its owner and confirm startup database/cron side effects are acceptable.        |
| `RecoveryModule`          | Is there a supported API root, or is the recovery functionality dormant/retiring?                            |
| `FeatureFlagsModule`      | Activate, retain dormant, or retire; identify the current flag source/owner and runtime root if active.      |
| `DevicesModule`           | Identify route consumers and supported entrypoint; distinguish tested construction from deployed activation. |
| `SyncModule`              | Identify API owner/consumers and whether routes should be activated, retained dormant, or retired.           |
| `FieldAuditModule`        | Confirm CLI ownership and whether module-vs-CLI organization is intentional.                                 |
| `GroundTruthModule`       | Confirm the three verification scripts remain supported operational roots and name their owner.              |
| `PrivacyScannerCliModule` | Confirm package commands and operational owner remain supported.                                             |

**For each answer, include:** owner/team, decision (`activate`, `retain dormant`, or `retire`), supported entrypoint, expected environment/configuration, operational side effects, and evidence that consumers/deployments use or do not use it. No deletion or activation should be inferred from absence in `AppModule` alone.

## Response form

Please reply using this compact form for each item you can verify:

```text
Task ID:
Decision or answer:
Owning repository/service/team:
Source commit SHA:
Schema/config/migration/entrypoint paths:
Fresh-install or deployed-state evidence:
Evidence link or sanitized command/output:
Known unknowns and who can resolve them:
```

## What this response can unblock

1. A definitive P0-T03 owner schema/deployment contract can start the Chat Backend compatibility decision and fresh/existing migration proof.
2. That resolution supplies prerequisites for P1-T03 and P1-T04. Their completion then permits the same-revision P1-T07 release gate to be evaluated against the canonical migration path.
3. P1-T07 acceptance is the registered predecessor for P2-T01; P2-T01 is the predecessor for P2-T02; P2-T02 then releases the P2-T03/P2-T04/P2-T05 evidence work, subject to P2-T03's separate `login-userprofile` approval.
4. P3-T04 can proceed independently once module owners provide dispositions and supported-entrypoint evidence.

## Source references

- [Task register](02_ENGINEERING_TASK_REGISTER.md) — current task IDs, dependencies, and statuses.
- [Execution tracker](15_EXECUTION_TRACKER.md) — current queue and retained dated evidence.
- [P0-T03 owner clarification](357_P0T03_EXTERNAL_USER_SCHEMA_OWNER_CLARIFICATION_2026-10-19.md).
- [P0-T03 Chalant Auth schema crosswalk](358_P0T03_CHALANT_AUTH_USERS_SCHEMA_CROSSWALK_2026-10-19.md).
- [P1-T07 current-revision full gate and skip inventory](356_P1T07_CURRENT_REVISION_FULL_GATE_AND_SKIP_INVENTORY_2026-10-19.md).
- [P3-T04 module reachability disposition](224_P3T04_MODULE_REACHABILITY_DISPOSITION_2026-10-13.md).

## Related files to send with this handoff

These are the earlier records that document the same database ownership and migration problem. Send them with this handoff when requesting the maintainer's response:

### Core P0-T03 history

- [94 — fresh canonical migration replay (2026-10-10)](94_P0T03_FRESH_CANONICAL_MIGRATION_REPLAY_2026-10-10.md): records the fresh replay stopping because `users` is not created by Chat Backend's migration chain, the role-enum incompatibility seen with an earlier candidate, and a later timezone migration defect. Its task status and candidate-owner details are historical.
- [221 — shared users schema compatibility recheck (2026-10-12)](221_P0T03_SHARED_USERS_SCHEMA_COMPATIBILITY_RECHECK_2026-10-12.md): documents the earlier Community-group-chat candidate and its incompatible enum/fields. That candidate is **superseded as the owner lead** by the later clarification naming `chalant-auth-monorepo`; retain this file as historical evidence, not the current owner answer.
- [233 — timezone migration SQL and Prisma mapping repair (2026-10-13)](233_P0T03_TIMEZONE_MIGRATION_SQL_FIX_2026-10-13.md): records the fix for the later timezone migration defect. This defect is fixed and is not the outstanding owner/schema blocker.
- [08 — database contract plan](08_DATABASE_CONTRACT_PLAN.md): defines the fresh-install, existing-database, routine, compatibility, and recovery evidence expected before schema work is considered safe.
- [03 — dependency and execution order](03_DEPENDENCY_AND_EXECUTION_ORDER.md): records why owner/schema and routine contracts precede migration changes and the release gate.

### Current owner and gate evidence

- [357 — external user schema owner clarification (2026-10-19)](357_P0T03_EXTERNAL_USER_SCHEMA_OWNER_CLARIFICATION_2026-10-19.md): records the owner's identification of `chalant-auth-monorepo` and the remaining unanswered contract questions.
- [358 — Chalant Auth users schema crosswalk (2026-10-19)](358_P0T03_CHALANT_AUTH_USERS_SCHEMA_CROSSWALK_2026-10-19.md): current source comparison of the selected signup-service schema, the separate lowercase `users` schema, and Chat Backend's expectations.
- [356 — current-revision P1-T07 full gate (2026-10-19)](356_P1T07_CURRENT_REVISION_FULL_GATE_AND_SKIP_INVENTORY_2026-10-19.md): latest full-gate evidence and its limits; it does not resolve the migration-owner dependency.

The dates and task statuses inside historical files reflect the checkpoints when they were written. Use this handoff plus the latest task register for current status; do not read old `IN PROGRESS` labels as the current classification.
