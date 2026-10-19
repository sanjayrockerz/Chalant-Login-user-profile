# Chat Backend user-schema handoff packet

**Prepared:** 2026-10-19  
**Source repository:** [bigdaddyhara/chat-backend](https://github.com/bigdaddyhara/chat-backend)  
**Source documentation revision:** `371c4c26`  
**Purpose:** Provide the Chat Backend maintainer's request and supporting migration/schema evidence for review by the Chalant Login/User Profile maintainers.

## Read first

1. [360 — Chat Backend developer request](360_P0T03_CHAT_BACKEND_DEVELOPER_REQUEST_2026-10-19.md) — requested outcome, questions, boundaries, and suggested reply format.
2. [359 — Blocked-task developer handoff](359_BLOCKED_TASK_DEVELOPER_HANDOFF_2026-10-19.md) — ten-task dependency context and additional evidence needs.
3. [358 — Chalant Auth schema crosswalk](358_P0T03_CHALANT_AUTH_USERS_SCHEMA_CROSSWALK_2026-10-19.md) and [357 — owner clarification](357_P0T03_EXTERNAL_USER_SCHEMA_OWNER_CLARIFICATION_2026-10-19.md) — latest ownership investigation.

## Included supporting records

- [356 — Current-revision P1-T07 full gate](356_P1T07_CURRENT_REVISION_FULL_GATE_AND_SKIP_INVENTORY_2026-10-19.md)
- [94 — Fresh canonical migration replay](94_P0T03_FRESH_CANONICAL_MIGRATION_REPLAY_2026-10-10.md)
- [221 — Earlier shared-users compatibility recheck](221_P0T03_SHARED_USERS_SCHEMA_COMPATIBILITY_RECHECK_2026-10-12.md)
- [233 — Timezone migration repair](233_P0T03_TIMEZONE_MIGRATION_SQL_FIX_2026-10-13.md)
- [08 — Database contract plan](08_DATABASE_CONTRACT_PLAN.md)
- [03 — Dependency and execution order](03_DEPENDENCY_AND_EXECUTION_ORDER.md)

## Evidence interpretation

These files are copied from the Chat Backend documentation at the source revision above. They record the state and evidence available on their stated dates. The older Community-group-chat candidate in file 221 is superseded as the owner lead by files 357/358. The timezone migration defect in file 233 is recorded as fixed. The fresh migration failure in file 94 used a disposable database; it is not evidence of the deployed database's current schema. The packet asks the maintainers to verify current ownership and deployment facts and propose the safe integration contract; it does not authorize changes to an owner-managed schema.

Some Markdown links in the copied reports point to additional evidence in the source repository. To follow those references, use the same paths under [`docs/remediation`](https://github.com/bigdaddyhara/chat-backend/tree/371c4c26/docs/remediation) at the source revision.
