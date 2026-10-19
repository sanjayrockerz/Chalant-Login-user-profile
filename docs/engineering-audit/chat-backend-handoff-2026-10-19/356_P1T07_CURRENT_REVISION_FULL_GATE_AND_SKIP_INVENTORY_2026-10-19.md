# P1-T07 current-revision full gate and skip inventory

**Evidence:** E-397. **Date:** 2026-10-19. **Revision:** `3749d3c3eb67ba6b270052f3296d2c16bfd50f27` (`main`). **Decision:** P1-T07 remains **VERIFYING / NO-GO**.

## Current-revision gate

The retained runner archived the exact commit and used Docker Node `24.7.0-alpine`, PostgreSQL `17.11-alpine`, and Redis `7.4.11-alpine`. It installed from the lockfile, validated/generated/pushed the Prisma schema, applied CI batch routines, then ran the broad repository checks and Jest at `--maxWorkers=25%`. No host database or Redis service was used.

All 20 recorded steps exited 0, including typecheck, full lint, format, build, strict ratchet (`current=0`, `baseline=144`, `added=0`, `resolved=77`), runtime/package validation, architecture checks, prepare-hook and CI contracts, production and development dependency checks, runtime supply-chain validation, `validate:all`, and full Jest.

Jest discovered **484 suites**: **452 passed, 0 failed, 32 pending**. It discovered **9,904 tests**: **9,464 passed, 0 failed, 440 pending**. The run is a current-revision local gate result; it is not deployment, canonical migration replay, production, capacity, or SLO evidence. Summed command durations were **494.92 seconds**, excluding Docker setup and cleanup overhead.

Cleanup verified removal of the runner, PostgreSQL and Redis containers, network, and generated credentials. The three images pulled for this run were also removed after verification.

## Current-revision compiled runtime smoke

E-398 starts the compiled entrypoint on this same revision using the repository's runtime alias registration (`node -r ./scripts/register-dist-paths.cjs dist/src/main.js`, the command used by `npm start`). With disposable PostgreSQL 17.11 and Redis 7.4.11, `/health/live` returned HTTP 200 with `{"status":"ok"}`; `/health/ready` returned HTTP 200 with database and Redis both `up`. SIGTERM closed the app and the process exited 0; the shutdown hook reported 2.54 seconds. The four documented `GROUP_CHAT_*` limits were set in the isolated environment. Store/container/network/credential cleanup verified, and the task-pulled images were removed.

Two setup attempts are preserved as excluded: the first invoked the compiled file without the runtime path registrar; the second used the correct command but omitted the four required group-chat limit variables. Neither is evidence of a product failure.

## Refreshed pending-test inventory

The full-Jest JSON contains 440 pending assertions across 34 source files. The source controls were checked at this revision and grouped as follows:

| Source disposition                         |  Files | Pending tests | Current meaning                                                                                                                                                                |
| ------------------------------------------ | -----: | ------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `xdescribe`-disabled anonymous-chat suites |      9 |           187 | Tests remain disabled in source; provider/contract ownership and restore-or-retire decisions are not evidenced.                                                                |
| Explicit source skips                      |      5 |            94 | Includes disabled config/security/group-chat blocks, three excluded large reconnect benchmarks, and one socket-handler case. Review rationale and replacement coverage.        |
| Environment/provider opt-ins               |     20 |           159 | Dedicated PostgreSQL/Redis/container, recovery, load, multi-process, or S3 settings are required. These were intentionally not enabled wholesale in the normal full-Jest gate. |
| **Total**                                  | **34** |       **440** | Reconciles to the current Jest JSON.                                                                                                                                           |

Exact file paths, per-file pending counts, source-control lines, commands, outputs, hashes, runtime, and cleanup receipt are retained under [the run evidence](evidence/P1T07_3749d3c3_2026-10-19/p1t07-e95e1e015b/). The opt-in inventory is not evidence that those gated tests pass when enabled. The existing anonymous multi-process profile has separate P2-T02 evidence; the other gated suites need their own approved, isolated fixtures or an explicit reason to remain gated.

## Cross-check against existing remediation evidence

The repository already has separate local proof for important behavior in several gated areas: anonymous multi-process assignment ([277](277_P2T02_ANON_CHAT_MULTIPROCESS_PROFILE_2026-10-15.md)), core realtime membership with Redis ([275](275_P2T02_CORE_REALTIME_MULTIPROCESS_REDIS_ADAPTER_2026-10-15.md)), outbox Redis recovery ([82](82_P0T06_OUTBOX_REDIS_RECOVERY_AND_LIFECYCLE_PROOF_2026-10-09.md)), the HTTP-woken outbox relay ([336](336_P2T02_HTTP_WAKE_CROSS_PROCESS_SOCKET_RECEIPT_2026-10-18.md)), and the S3-compatible provider contract ([337](337_P2T02_S3_COMPATIBLE_MEDIA_PROVIDER_INTEGRATION_2026-10-18.md)). These are behavior-specific historical proofs, not a claim that all 159 opt-in assertions passed on the current revision.

Do not enable `test/load/matching-load.test.ts` as a substitute for active-path proof: it uses the decommissioned `MatchingEngineService` and an in-memory queue, as documented in [256](256_P2T02_GROUP_DELIVERY_BOUNDARY_PROFILE_PLAN_2026-10-14.md). The three recovery-validation suites require an independently running recovery API; this repository gate does not provision that API. The remaining provider/database opt-ins should be run only with their named disposable fixture and cleanup contract. No blanket opt-in is justified by this inventory.

The current local gate, compiled runtime smoke, and this historical-evidence cross-check are complete. The repository owner has now made the test governance disposition recorded below. P1-T07's remaining registered dependency is P1-T03/P1-T04, which requires authoritative shared-users DDL, role enum, and deployment ordering not established by existing repository evidence. The owner identified `chalant-auth-monorepo`; its two user-schema representations and the unresolved physical integration target are recorded in [357](357_P0T03_EXTERNAL_USER_SCHEMA_OWNER_CLARIFICATION_2026-10-19.md) and [358](358_P0T03_CHALANT_AUTH_USERS_SCHEMA_CROSSWALK_2026-10-19.md).

## Owner disposition — 2026-10-19

The repository owner approved the conservative disposition: leave all 281 source-disabled assertions unchanged and disabled; leave the 159 environment/provider assertions behind their existing named opt-in gates; do not delete, restore, or blanket-enable tests based only on this inventory. Rationale: the source records include stale/decommissioned contracts and integrations whose intended owners or runtime fixtures are not established here, while existing focused proofs cover only specific behaviors. Accountable owner/reviewer: repository owner. Review checkpoint: 2027-01-17 (90 days from this decision). This is a dated retain-and-review decision, not proof that the pending assertions pass or that every disabled scenario has replacement coverage.

## Remaining P1-T07 acceptance

- P1-T07's test skip/opt-in disposition is recorded above. The configured Jest result remains 440 pending assertions by owner decision; it must not be described as 9,904 tests all passing.
- Resolve P1-T03/P1-T04 migration prerequisites. P1-T03 is not started and depends on P0-T03; P1-T04 requires the authoritative shared-users schema owner/DDL, role enum, and supported fresh/existing deployment order. The repository cannot safely invent those contracts.

The configured full gate is green on `3749d3c3`; the owner-approved skip disposition is recorded. P1-T07 remains VERIFYING because its registered P1-T03/P1-T04 dependencies are incomplete. This task status does not change the separate release decision: **NO-GO**. No task closure count changes: **14/43 DONE**.
