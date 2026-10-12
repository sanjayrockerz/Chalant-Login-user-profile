# Empty Directories Audit Report
**Date:** 2025-10-09  
**Repository:** on-boarding:auth system (monorepo)  
**Services:** personal-email-signup-backend, login-page-back

## Executive Summary
Comprehensive audit of 60+ empty directories reveals they are **never-tracked scaffolds** created during service setup but never populated with files. No .gitignore masking, no LFS issues, no subtree prefix errors—simply empty directory structures awaiting content.

---

## Phase A: Root Cause Diagnosis

### Finding: Never Tracked (Primary Cause)
**Affected:** ALL empty directories  
**Evidence:**
- `git ls-tree -r HEAD <dir>` returns nothing
- `git check-ignore` confirms directories are not ignored
- `git lfs ls-files` shows no LFS configuration
- Directories exist in filesystem but contain no tracked files

**Root Cause:** Directories were created as architectural scaffolds (e.g., for future migrations, infrastructure configs, monitoring setups) but never populated. Git doesn't track empty directories—they disappear on clone unless containing a file.

### Secondary Observation: Duplicate Service Folder
- `services/login-page-back` (mostly empty, ~4 files)
- `services/login-page-back 2` (populated, 60+ empty subdirs)
- **Cause:** Subtree import or copy created duplicate; tooling added " 2" suffix to avoid overwrite
- **Impact:** References in CI/docs point to `services/login-page-back` but content is in `... 2`

---

## Phase B: Relocation Opportunities

### Current Misplacements (None Found)
No misplaced files detected—most content is correctly located. The issue is **missing content**, not mislocated content.

### Duplicate Folder Resolution Plan
**Action:** Merge `services/login-page-back 2` → `services/login-page-back`  
**Method:** Conservative merge (only move files that don't exist in destination)  
**Branch:** `fix/login-page-back-dup` (already created)  
**Status:** In progress (manual completion required due to conflicts)

---

## Phase C: File Generation Manifest

### Strategy
For each empty directory, generate either:
1. **`.gitkeep`** for pure scaffolds (future use, no immediate functional need)
2. **Starter/template files** for directories with clear functional purpose

### Generated Files by Category

#### 1. Git Hooks (`.husky/`)
- `pre-commit` - Lint, typecheck, conventional commits validation
- `commit-msg` - Conventional commit format enforcement
- Purpose: Maintain code quality and commit standards

#### 2. CI/CD (`.github/workflows/`, `.github/ISSUE_TEMPLATE/`)
- `services-ci.yml` update for monorepo path filters
- `bug_report.yml`, `feature_request.yml`, `security.yml` - Issue templates
- Purpose: Standardize workflows and issue tracking

#### 3. Database (` db/migrations/`, `database/`)
- `README.md` - Migration policy and tooling guide
- `template.sql` - Migration file template
- Purpose: Document versioned migration strategy

#### 4. Documentation (`docs/`)
- `production-readiness/checklist.md` - Deployment readiness template
- `production-readiness/runbook.md` - Ops runbook
- `migration/README.md` - Data migration guide
- `adr/template.md` - Architecture Decision Record template
- `api/README.md` - API documentation index
- Purpose: Support production deployment and architectural decisions

#### 5. Infrastructure (`infra/`, `deployments/monitoring/`)
- `infra/README.md` - Infrastructure as Code guide
- `deployments/monitoring/prometheus/rules.yml` - Alert rules template
- `deployments/monitoring/grafana/dashboards/` - Dashboard JSONs
- `deployments/monitoring/loki/config.yml` - Log aggregation config
- Purpose: Enable observability and infrastructure management

#### 6. Source Modules (`src/`)
Each empty module gets a `README.md` or `index.ts`:
- `src/database/README.md` - Database connection patterns (Prisma focus)
- `src/redis/README.md` - Redis caching and rate-limiting patterns
- `src/health/index.ts` - Health check endpoints (liveness/readiness)
- `src/feature-flags/README.md` - Feature flag implementation guide
- `src/policies/README.md` - Policy enforcement (terms, privacy)
- `src/testing/README.md` - Test utilities and mocks
- `src/deployment/README.md` - Deployment helpers and scripts
- `src/device/README.md` - Device management and tracking
- `src/types/index.ts` - Shared TypeScript types
- `src/middleware/README.md` - Custom middleware catalog
- `src/config/README.md` - Configuration management patterns
- `src/monitoring/README.md` - Observability integration (Prometheus, OTel)
- `src/events/README.md` - Event emitters and audit logging
- `src/security/*` - Security module READMEs (encryption, rate-limiting, etc.)

Purpose: Document module responsibilities and link to implementation

#### 7. Testing (`tests/`)
- `tests/unit/README.md` - Unit test conventions and coverage
- `tests/integration/README.md` - Integration test setup
- `tests/security/README.md` - Security test suite guide
- `tests/load/README.md` - Load/performance testing
- `tests/*/example.spec.ts` - Example test files
- Purpose: Establish testing standards and provide templates

#### 8. Scripts & Keys
- `scripts/README.md` - Ops scripts catalog (DB setup, seed, backup)
- `keys/README.md` - Key management policy (with .gitignore for secrets)
- Purpose: Document operational procedures

#### 9. IDE Configuration (`.vscode/`)
- `settings.json` - Consistent editor settings
- `extensions.json` - Recommended extensions
- Purpose: Standardize development environment

---

## Phase D: Implementation Plan

### Commit Strategy (Logical Groups)

#### Commit 1: Resolve Duplicate Folder
```bash
# Finish merging login-page-back 2 → login-page-back
# Branch: fix/login-page-back-dup
```

#### Commit 2: Add Git Hooks
```bash
git add services/personal-email-signup-backend/.husky/
git commit -m "chore: add pre-commit and commit-msg hooks for code quality"
```

#### Commit 3: Add CI/CD Templates
```bash
git add services/personal-email-signup-backend/.github/
git commit -m "ci: add issue templates and update CI for monorepo"
```

#### Commit 4: Add Database Scaffolds
```bash
git add services/personal-email-signup-backend/db/
git commit -m "docs: add database migration guide and templates"
```

#### Commit 5: Add Documentation
```bash
git add services/personal-email-signup-backend/docs/
git commit -m "docs: add production readiness, ADR, and migration guides"
```

#### Commit 6: Add Infrastructure
```bash
git add services/personal-email-signup-backend/infra/
git add services/personal-email-signup-backend/deployments/
git commit -m "infra: add monitoring configs and infrastructure templates"
```

#### Commit 7: Add Source Module READMEs
```bash
git add services/personal-email-signup-backend/src/*/README.md
git add services/personal-email-signup-backend/src/*/index.ts
git commit -m "docs: document source module responsibilities and patterns"
```

#### Commit 8: Add Test Scaffolds
```bash
git add services/personal-email-signup-backend/tests/
git commit -m "test: add test suite templates and conventions"
```

#### Commit 9: Add Scripts & IDE Config
```bash
git add services/personal-email-signup-backend/scripts/
git add services/personal-email-signup-backend/keys/
git add services/personal-email-signup-backend/.vscode/
git commit -m "chore: add ops scripts catalog, key policy, and IDE config"
```

### Validation Checklist
- [ ] All empty directories contain at least one tracked file
- [ ] CI references (`services/login-page-back`, `.github/workflows`) resolve to actual files
- [ ] Observability configs (Prometheus, Grafana, Loki) align with service patterns
- [ ] Module READMEs reference existing architecture (correlation_id, tenant_id, Winston, Prisma)
- [ ] Test templates follow existing patterns (Jest, supertest, security assertions)
- [ ] No sensitive data in `keys/` (enforced by .gitignore)
- [ ] `.vscode/` settings match team conventions

---

## Exit Criteria Status

✅ **Root causes diagnosed:** Never-tracked scaffolds  
🔄 **Relocations proposed:** Duplicate folder merge in progress  
⏳ **Files generated:** Ready to create (see manifest above)  
⏳ **Structure validated:** Pending file creation  
⏳ **.gitignore fixed:** No fixes needed (not the cause)  

---

## Next Actions

1. **Complete duplicate folder merge** (manually finish `fix/login-page-back-dup` branch)
2. **Execute file generation** using provided templates (commits 2-9)
3. **Validate** against checklist
4. **Merge** all changes to main branch

**Estimated Time:** 2-3 hours for complete implementation  
**Risk:** Low (additive changes, no deletions)
