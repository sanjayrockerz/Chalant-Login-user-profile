# Chalant Engineering Execution

## Phase 1 — Database migration repair and schema integrity

**Status: PASSED for the authorized disposable fresh-install and synthetic-upgrade scope.**

**Tested branch and revision:** `verification/phase1-phase2` at `d6edde1` (`ci: configure disposable contact hmac`). No main merge, deployment, production access, credential rotation, or live data operation occurred. The pre-existing untracked `CHALANT_CURRENT_STATE_AND_TARGET_GAPS.md` remains preserved and unstaged.

### Migration policy

- `20261009160000_canonical_schema` and `npm run migration:fresh:init` are authoritative for genuinely empty databases.
- Historical migrations remain immutable evidence and are not replayed for fresh installation.
- The checksum mismatch was substantive historical SQL drift, not line-ending drift. The local manifest is a reviewed repository baseline, not proof of compatibility with an unknown deployed database.
- Existing-deployment upgrades remain separately gated on an authorized sanitized schema snapshot, `_prisma_migrations` ledger, and database-owner-approved forward-only plan.

### Corrections executed

- Governed checksum checker and regression tests retained LF-normalized SHA-256 tamper detection: **4 tests passed**.
- Fresh initialization uses the canonical baseline and verifies PostgreSQL catalog UUID types and canonical foreign keys.
- Synthetic legacy fixture and forward-only UUID upgrade preserve dependent records before recreating foreign keys.
- Corrected CI uses PostgreSQL 16/Redis 7 disposable services, canonical fresh initialization, and the legacy rehearsal path.
- Fixed the synthetic fixture’s quoted PostgreSQL `"userId"` identifier and aligned its owner email with the existing upgrade verifier contract.

### GitHub Actions evidence

- [Phase 0 run 39045832299](https://github.com/sanjayrockerz/Chalant-Login-user-profile/actions/runs/39045832299) — **success**. Governance, PostgreSQL 16 fresh installation, synthetic integer-to-UUID upgrade, canonical identity/onboarding/policy migrations, upgrade verification, Redis checks, and identity persistence all passed.
- [Earlier Phase 0 run 39045094098](https://github.com/sanjayrockerz/Chalant-Login-user-profile/actions/runs/39045094098) — **success** after the fixture-verifier correction.
- [Services CI run 39044928607](https://github.com/sanjayrockerz/Chalant-Login-user-profile/actions/runs/39044928607) — **success**.

The successful Phase 0 identity job executed the real PostgreSQL 16 service and reported `LEGACY_UUID_UPGRADE_APPLIED`, then completed the three canonical follow-up migrations, `UPGRADE_FIXTURE_PRESERVED`, and the identity persistence tests. The database was disposable CI infrastructure; no local PostgreSQL 17 instance was used.

## Phase 2 — PostgreSQL/Redis application integration

**Status: FAILED as a workflow gate; functional test matrix passed.**

[Signup Service run 39045832250](https://github.com/sanjayrockerz/Chalant-Login-user-profile/actions/runs/39045832250) executed the real PostgreSQL 16 and Redis 7 matrix with all phase database variables, real Redis enforcement, and a disposable HMAC key.

| Suite | Result |
|---|---:|
| Unit suites | 37 passed; 285 tests passed; 0 skipped |
| PostgreSQL/Redis integration suites | 10 passed; 74 tests passed; 0 skipped |
| Lint, typecheck, Prisma generation, migration application | Passed |
| Workflow conclusion | Failed only on Jest coverage thresholds |

The integration run initially found and then resolved a CI environment defect: the contact suite lacked a valid HMAC key. After `CONTACT_HASH_MODE=hmac-sha256-v2` and a disposable 32+ byte key were added, all 74 integration tests passed. No application assertion failed in the final run.

The remaining failure is the existing split-suite Jest coverage policy: unit global coverage was 50.11% statements / 35.82% branches / 49.57% lines / 47.38% functions against 80% thresholds; integration global coverage was 41.34% statements / 25.83% branches / 41.31% lines / 40.39% functions against the same thresholds. Directory thresholds also failed. Thresholds were not lowered or bypassed. This is a workflow/coverage-policy gap requiring a deliberate owner decision or additional coverage work before the Signup workflow can be green.

## Final gate assessment

| Gate | Result | Evidence |
|---|---|---|
| Repository preservation | PASSED | Isolated branch; reviewed commits only; untracked user document preserved. |
| Governance and tamper tests | PASSED | Checker valid; 4 regression tests passed. |
| PostgreSQL 16 canonical fresh install | PASSED | Phase 0 run `39045832299`. |
| PostgreSQL 16 synthetic legacy upgrade | PASSED | Phase 0 run `39045832299`; records and FKs preserved. |
| Canonical follow-up migrations | PASSED | Identity, onboarding, and policy SQL executed and verified. |
| PostgreSQL/Redis integration behavior | PASSED | 10 suites, 74 tests, no skips in final integration run. |
| Unit regression behavior | PASSED | 37 suites, 285 tests, no skips. |
| Signup CI workflow | FAILED | Functional tests passed, but mandatory configured coverage thresholds failed. |
| Existing production-database upgrade | BLOCKED | No authorized deployed schema snapshot or migration ledger. |

**Phase 1: PASSED** for the authorized disposable fresh-install and synthetic-upgrade scope.

**Phase 2: FAILED** as a CI acceptance gate because the workflow’s configured coverage thresholds failed, despite all executed unit and integration assertions passing. It must not be relabeled green by suppressing coverage failure or reducing thresholds without an approved coverage-policy decision.

## Exact outstanding engineering actions

1. Decide whether the repository-wide 80–90% Jest thresholds are intended for split unit/integration jobs. If they are, add the required coverage; if not, redesign the coverage job explicitly and preserve functional test gates.
2. Rerun the Signup workflow after that approved coverage-policy correction and capture a successful run.
3. For any deployed upgrade, obtain the authorized sanitized schema and migration ledger, rehearse the forward-only upgrade, and obtain database-owner approval.
4. Keep live Google/Apple provider acceptance, production-compatible SMTP delivery, managed contact-HMAC activation, recovery acceptance, MFA release policy, managed secrets, rollback, and load evidence as separate release gates.

No production deployment is approved by this execution. Phase 2’s next run requires the coverage-policy decision plus the existing Node 20, disposable PostgreSQL 16, and Redis 7 CI services.
