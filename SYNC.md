# Monorepo Upstream Sync Workflow

This document establishes a repeatable process for syncing upstream changes from the original repositories into the auth-services monorepo using git subtree, while preserving history and maintaining monorepo-specific customizations.

## Table of Contents
- [Overview](#overview)
- [Current Sync Policy (2025-10)](#current-sync-policy-2025-10)
- [Repository Configuration](#repository-configuration)
- [Sync Process](#sync-process)
- [Conflict Resolution](#conflict-resolution)
- [Testing and Validation](#testing-and-validation)
- [Sync Cadence and Triggers](#sync-cadence-and-triggers)
- [Upstream Contribution Workflow](#upstream-contribution-workflow)
- [Troubleshooting](#troubleshooting)
- [Maintenance](#maintenance)

## Overview

The auth-services monorepo contains two services imported via git subtree:

- **services/personal-email-signup-backend/** - From [Harishraghave-07/personal-email-signup-backend](https://github.com/Harishraghave-07/personal-email-signup-backend)
- **services/login-page-back/** - From [jaidevms/login-page-back](https://github.com/jaidevms/login-page-back)

### Monorepo-Specific Customizations
The following customizations have been added to the monorepo and must be preserved during syncs:
- Observability instrumentation (OpenTelemetry, Prometheus)
- Shared CI/CD workflows in `.github/`
- Cross-service configuration in `scripts/`
- Monorepo-wide documentation
- Push token management system (services/personal-email-signup-backend)
- Shared policies and security configurations

## Current Sync Policy (2025-10)

This section supersedes earlier guidance and captures the agreed policy, cadence, and conflict strategy through the upstream freeze window.

### Remote setup (current baseline)

```bash
# one-time configuration
git remote add signup-upstream https://github.com/org/personal-email-signup-backend.git
git remote add login-upstream  https://github.com/org/login-page-back.git

# routine fetch
git fetch signup-upstream
git fetch login-upstream
```

> Replace the placeholder URLs with the actual upstream locations if ownership changes. The commands above have been executed in this repository; `git remote -v` will confirm.

### Subtree audit trail

Initial imports were executed with:

```bash
git subtree add --prefix=services/personal-email-signup-backend signup-upstream main --squash
git subtree add --prefix=services/login-page-back          login-upstream  main --squash
```

Use `ls services/<service>` to sanity-check directory contents and `git log --oneline -- services/<service>` to review prior subtree merges.

### Sync cadence policy

- **Weekly sync:** Every Monday at 10:00 UTC the automation checks both upstreams. Initiate a sync when more than five commits landed since the previous sync, a dependency update references a security advisory, or manual review deems changes material.
- **Release-based sync:** When upstream tags a release (for example `v1.2.3`) open a sync branch and merge within 24 hours to leverage vetted drops.
- **Security patch sync:** Immediately prioritise any upstream fix tied to a CVE or security bulletin. Announce intent in `#engineering` before pulling.
- **Freeze policy:** If an upstream repo shows no commits for 30 consecutive days, record the freeze date in `sync_history.md`, mark the service as monorepo-owned in this runbook, and archive the upstream per Master Prompt 4.

### Standard sync procedure

1. **Create sync branch** – `git checkout -b sync/<service>-YYYY-MM-DD`
2. **Fetch upstream** – `git fetch <service>-upstream`
3. **Preview commits** – `git log --oneline <service>-upstream/main ^HEAD -- services/<service-directory>`
4. **Pull via subtree** – `git subtree pull --prefix=services/<service-directory> <service>-upstream main --squash`
5. **Resolve conflicts** – Apply the strategy below and document decisions in the commit message.
6. **Run CI** – Push the branch and wait for unit, integration, contract, and E2E pipelines to pass.
7. **Manual QA** – Deploy to staging and smoke test signup, OTP, JWT, login, and password reset flows.
8. **Merge** – Open PR titled `Sync: <service> upstream vX.Y.Z`, secure two lead approvals, merge after CI + QA success.
9. **Tag & log** – `git tag sync/<service>-vX.Y.Z -m "Synced with upstream <service> vX.Y.Z on YYYY-MM-DD"` then append an entry to `sync_history.md`.

### Conflict resolution strategy

- **Observability & telemetry (correlation IDs, audit events, metrics):** retain monorepo implementation; upstream lacks the shared stack.
- **Configuration (.env templates, infra manifests, feature flags):** keep monorepo values to preserve shared environments.
- **Business logic (controllers, services, DTOs):** default to upstream fixes/features unless they break monorepo architecture—review carefully and add compensating adapters if required.
- **Dependencies:** merge consciously, prefer patched / newer secure versions, run `npm install`, `npm audit`, and snyk scans as applicable.
- **Database migrations:** coordinate with upstream owners; adapt migration paths to monorepo schema namespaces and test against local snapshots.
- **Tests:** accept upstream test updates, adjusting fixtures to match monorepo layout and ensuring coverage remains meaningful.

### Testing & release gating

- All CI suites (unit, integration, contract, E2E) green.
- Staging smoke tests covering signup, OTP, JWT, login, password reset succeed.
- `npm audit` (and snyk, where enabled) reports no new critical issues.
- Database migrations apply cleanly in staging; capture drift reports if any.

### Automation & notifications

- `.github/workflows/upstream-sync-check.yml` runs every Monday at 10:00 UTC (and on-demand) to detect new commits and posts Slack notifications when action is required.
- The same workflow emits a Friday 17:00 UTC digest email summarising outstanding syncs and referenced security advisories.
- Dashboard widget (see `sync_history.md`) surfaces last-sync date, commit lag, and pending sync count per service.
- Configure repository variables/secrets for the automation:
  - `SIGNUP_UPSTREAM_URL`, `LOGIN_UPSTREAM_URL` (repository variables) when upstream URLs differ from defaults.
  - `SLACK_WEBHOOK_URL` (secret) for Monday alerts.
  - `UPSTREAM_SYNC_DIGEST_TO`, `UPSTREAM_SYNC_DIGEST_FROM`, `UPSTREAM_SYNC_SMTP_SERVER`, `UPSTREAM_SYNC_SMTP_PORT`, `UPSTREAM_SYNC_SMTP_USERNAME`, `UPSTREAM_SYNC_SMTP_PASSWORD` (secrets) for the Friday digest.

### Freeze transition checklist

1. Confirm inactivity window ≥30 days via `git log` against the upstream remote.
2. Update `sync_history.md` with the freeze date and status change.
3. Remove the service from the automation notification matrix once archived.
4. Announce the transition to the engineering channel and hand ownership to monorepo maintainers.

## Repository Configuration

### Current Subtree Setup

The monorepo was created using the following subtree commands:

```bash
# Initial subtree add commands (for reference only)
git subtree add --prefix=services/login-page-back \
  https://github.com/jaidevms/login-page-back.git main \
  --squash

git subtree add --prefix=services/personal-email-signup-backend \
  https://github.com/Harishraghave-07/personal-email-signup-backend.git main \
  --squash
```

### Remote Configuration

Ensure the upstream remotes are configured:

```bash
# Add upstream remotes (run once or when remotes are missing)
git remote add login-upstream  https://github.com/org/login-page-back.git
git remote add signup-upstream https://github.com/org/personal-email-signup-backend.git

# Verify remotes
git remote -v | grep -E "(login-upstream|signup-upstream|origin)"
```

> The `org` placeholder reflects the current upstream owners. Update the URL if upstream hosting changes.

## Sync Process

Refer to the [Standard sync procedure](#standard-sync-procedure) for the authoritative steps. Legacy helper scripts are retained in git history if required for audit.

## Sync Cadence and Triggers

The following matrix complements the policy in [Sync cadence policy](#sync-cadence-policy).

### Scheduled activities

- **Weekly sync:** Mondays at 10:00 UTC. Platform duty engineer reviews the automation report and starts a sync when thresholds are met (≥5 commits, tagged release, or flagged dependency patch).
- **Release-based sync:** Service owners coordinate within 24 hours of an upstream tag (for example `v1.2.3`).
- **Security sync:** Trigger immediately on CVEs or advisories; security lead coordinates and posts status in `#engineering`.
- **Freeze review:** On day 30 of inactivity, log the freeze in `sync_history.md` and begin monorepo-only development.

### Responsibilities

| Service | Primary | Backup | Notes |
|---------|---------|--------|-------|
| login-page-back | Auth platform team | Service owners | Follow conflict strategy for observability/config overrides. |
| personal-email-signup-backend | Auth platform team | Service owners | Coordinate Prisma migration impacts before merging. |

## Upstream Contribution Workflow

### Contributing Monorepo Improvements Back to Upstream

When monorepo improvements should benefit upstream projects:

#### 1. Extract Changes Using Subtree Split

```bash
# Create a clean branch with only service-specific changes
git subtree split --prefix=services/personal-email-signup-backend \
  --branch=contrib/signup-improvements

# Create a patch series
git format-patch signup-upstream/main..contrib/signup-improvements \
  --output-directory=patches/signup-contrib/

# Review patches to ensure no monorepo-specific code
ls patches/signup-contrib/
```

#### 2. Prepare Upstream Contribution

```bash
# Clone upstream repository
git clone https://github.com/Harishraghave-07/personal-email-signup-backend.git \
  /tmp/signup-upstream

cd /tmp/signup-upstream

# Create contribution branch
git checkout -b feature/monorepo-improvements

# Apply patches (review each one)
git am /path/to/patches/signup-contrib/*.patch

# Test changes in upstream context
npm test
```

#### 3. Submit Upstream PR

1. Push contribution branch to your fork
2. Open PR against upstream repository
3. Coordinate with upstream maintainers
4. Address review feedback

# Common fixes:
# Check merge commit details
```bash
# Revert last merge commit
## Sync Process

Refer to the [Standard sync procedure](#standard-sync-procedure) for the authoritative steps. Legacy helper scripts are retained in git history if required for audit.

# Push emergency rollback
git push origin main
```

#### Full Rollback to Previous Sync
```bash
# Find last good sync tag
git tag -l "sync/*" | sort -V | tail -5

# Reset to previous sync
git reset --hard sync/2025-10-09
git push origin main --force-with-lease
```

## Maintenance

### Regular Maintenance Tasks

#### Monthly
- [ ] Review sync process effectiveness
- [ ] Update documentation
- [ ] Check for new upstream repositories
- [ ] Review conflict resolution patterns

#### Quarterly  
- [ ] Audit monorepo customizations
- [ ] Review sync cadence appropriateness
- [ ] Update contact information
- [ ] Performance review of sync process

### Metrics and Monitoring

Track the following metrics:
- Sync frequency and success rate
- Time to resolve conflicts
- CI failure rate post-sync
- Manual intervention frequency

### Documentation Updates

Keep this document updated when:
- New services are added to monorepo
- Upstream repositories change location
- New customizations are added
- Conflict resolution patterns evolve

### Contact Information

| Role | Contact | Backup |
|------|---------|---------|
| Platform Team Lead | platform@company.com | @platform-team |
| Login Service Owner | @jaidevms | @backend-team |
| Signup Service Owner | @Harishraghave-07 | @backend-team |
| Security Team | security@company.com | @security-team |

---

**Last Updated**: October 10, 2025  
**Version**: 1.0  
**Next Review**: November 10, 2025

## Quick Reference

### Essential Commands
```bash
# Setup remotes
git remote add login-upstream  https://github.com/jaidevms/login-page-back.git
git remote add signup-upstream https://github.com/Harishraghave-07/personal-email-signup-backend.git

# Quick sync
SYNC_DATE=$(date +%Y-%m-%d)
git checkout -b sync/upstream-changes-${SYNC_DATE}
git subtree pull --prefix=services/login-page-back login-upstream main
git subtree pull --prefix=services/personal-email-signup-backend signup-upstream main

# Test and validate
npm run test && npm run type-check && npm run lint

# Merge when ready
git checkout main
git merge sync/upstream-changes-${SYNC_DATE}
git tag -a "sync/${SYNC_DATE}" -m "Upstream sync ${SYNC_DATE}"
git push origin main --tags
```