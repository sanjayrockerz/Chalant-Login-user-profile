# Chalant Engineering Execution

## Phase 1 — Database migration repair and schema integrity

**Status: BLOCKED — real PostgreSQL acceptance and corrected CI execution are not authorized/available.**

**Revision tested:** local branch `main` at `9da0f96fa27636951e947db7c83f54635d3963c5`. `origin/main` is two documentation commits ahead (`ff339f4`, `abe21cfa`); the Phase 1 corrections below are uncommitted local changes and have not been tested by GitHub Actions.

### Decisions

- The reviewed Prisma schema and `20261009160000_canonical_schema` baseline remain authoritative for fresh installation.
- Fresh installation uses `npm run migration:fresh:init` only against an explicitly disposable `phase1_*` database. It does not replay historical Prisma migrations.
- Historical migration SQL is governed by normalized LF SHA-256 checksums. The checksum mismatch was substantive source drift, not CRLF/LF drift: `20241002000001` was changed by `f67a954` and then reduced to a post-bootstrap placeholder by `99437b1`; `20250521120000` was changed by `d139785` and `9da0f96`.
- The old UUID migration remains legacy evidence and is not used for fresh initialization or the upgrade rehearsal. Existing deployments still require an authorized schema snapshot and owner-approved forward plan.
- The reconciled hashes are a local, reviewed working-tree baseline, not an approved deployed baseline. No evidence was provided that the changed historical migrations were applied to an existing deployment; therefore they remain unsafe for production upgrade claims until the database owner supplies the migration ledger and schema snapshot.

### Implemented corrections

- Reconciled the governance manifest to the reviewed current migration files, including the intentionally relocated historical repair migration.
- Added `scripts/phase1-governance-check.test.js` covering valid checksums, substantive SQL tampering, CRLF-equivalent bytes, missing manifest entries, and missing files.
- Strengthened `phase1-fresh-init.js` to verify actual PostgreSQL UUID column types and all canonical User foreign keys through system catalogs.
- Changed signup CI and E2E CI from `prisma migrate deploy` to the explicit canonical fresh-install command with disposable `phase1_*` database names.
- Added an integer-backed synthetic legacy fixture and `scripts/phase1-legacy-uuid-upgrade.sql`/`phase1-legacy-upgrade.js`. The forward-only rehearsal creates the UUID mapping first, drops dependent FKs, converts child keys, swaps `User.id`, then recreates FKs.
- Updated Phase 0’s upgrade rehearsal to execute the new forward-only path before canonical identity/onboarding/policy migrations.

### Verification evidence

| Gate | Result | Evidence |
|---|---|---|
| Repository preservation | PASSED | No reset, clean, stash, commit, push, deploy, or live credential operation; pre-existing current-state document remains untracked and preserved. |
| Governance checker | PASSED | `npm run migration:governance:check` → `MIGRATION_GOVERNANCE_VALID`. |
| Governance regression tests | PASSED | `npm run test:migration-governance` → 4 passed, 0 failed. |
| JavaScript syntax/typecheck | PASSED | `node --check scripts/phase1-legacy-upgrade.js`; backend `npm run typecheck` passed. |
| Build | PASSED | Backend `npm run build` passed during this execution. |
| Prisma schema validation | PASSED | `DATABASE_URL_AUTH=postgresql://test:test@127.0.0.1:5432/phase1_validation npx prisma validate --schema=prisma/auth.schema.prisma` passed. |
| Workflow YAML/static contract | PASSED | Python YAML parsing passed for `.github/workflows/phase-0-quality.yml` and `.github/workflows/signup-service.yml`; Node 20, fresh-init, legacy-upgrade, provenance, and database URL wiring were inspected. |
| Static evidence capture | PASSED | Non-secret command summary stored under `artifacts/phase1/`; no credentials, tokens, private connection strings, production data, or generated database output was stored. |
| PostgreSQL 16 fresh install | BLOCKED | Docker Desktop is unavailable. A local PostgreSQL 17 service accepts connections but its password is not available; no unknown database was used. |
| PostgreSQL legacy rehearsal | BLOCKED | Same disposable database prerequisite; no database gate is reported as passed without execution. |
| GitHub Actions rerun | BLOCKED | Requires publishing/dispatching the uncommitted correction; no push or dispatch was authorized. |

### Phase 1 conclusion

The two reported failure mechanisms are corrected in source and CI contracts, but Phase 1 is **BLOCKED**, not accepted, because the mandatory PostgreSQL 16 fresh-install and synthetic-upgrade gates have not executed. The reconciled checksum manifest is not yet a published or deployment-approved baseline. The historical deployment upgrade path remains separately blocked pending an authorized sanitized schema snapshot and migration ledger.

### Phase 2 entry commands and prerequisites

On a disposable PostgreSQL 16 and Redis 7 CI runner, with Node 20 and dependencies installed:

```bash
cd services/personal-email-signup-backend
npm ci --ignore-scripts --legacy-peer-deps
npx prisma generate --schema=prisma/auth.schema.prisma
npm run migration:governance:check
npm run test:migration-governance
createdb -h 127.0.0.1 -U postgres phase1_fresh
createdb -h 127.0.0.1 -U postgres phase1_upgrade
export PHASE1_DATABASE_PROVENANCE=ci-service
export PHASE1_DATABASE_URL=postgresql://postgres:<disposable-password>@127.0.0.1:5432/phase1_fresh
export DATABASE_URL_AUTH="$PHASE1_DATABASE_URL"
npm run migration:fresh:init
export PHASE1_DATABASE_URL=postgresql://postgres:<disposable-password>@127.0.0.1:5432/phase1_upgrade
psql "$PHASE1_DATABASE_URL" -v ON_ERROR_STOP=1 -f ../../scripts/phase1-identity-test-baseline.sql
npm run migration:upgrade:legacy
```

Then apply the three canonical identity/onboarding/policy migrations from the Phase 0 workflow, run `npm run migration:upgrade:verify`, and execute the complete PostgreSQL/Redis integration matrix. Phase 2 requires the resulting logs and artifacts, not merely a successful schema generation.
