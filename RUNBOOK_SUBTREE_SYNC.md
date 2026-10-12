# Subtree Sync & Cutover Runbook

This runbook documents the process to keep upstream services in sync via `git subtree` while transitioning to the monorepo. It includes commands, conflict resolution guidance, branch policies, freeze timeline, and a post-freeze checklist.

## Overview
We are running a transition where two existing repositories are imported into this monorepo under:

- `services/login-page-back/` (imported from the original `login-page-back` repo)
- `services/personal-email-signup-backend/` (imported from the original `personal-email-signup-backend` repo)

Both remotes have been added to the monorepo as:

- `login-page-back` -> original repository (local path or remote URL)
- `personal-email-signup-backend` -> original repository (local path or remote URL)

During the transition window, teams continue to push to their original repos. The release engineering team runs periodic `git subtree pull` operations into the monorepo to sync upstream changes while preserving full history.

## Run Cadence
- Frequency: Twice daily (09:00 and 17:00 local time) during business days. Increase cadence during active migration weeks to 3-4 times/day.
- Responsible: Release engineering on-call (primary) and service maintainers (backup).
- Command template for pulling updates (monorepo root):

```bash
# Pull latest from login-page-back main into monorepo
git fetch login-page-back main
git subtree pull --prefix=services/login-page-back login-page-back main

# Pull latest from personal-email-signup-backend main into monorepo
git fetch personal-email-signup-backend main
git subtree pull --prefix=services/personal-email-signup-backend personal-email-signup-backend main
```

> Note: If upstream uses a different default branch, replace `main` with the correct branch.

## Pre-Pull Checklist
1. Ensure working tree is clean: `git status --porcelain`. Abort if dirty.
2. Ensure you are on the monorepo integration branch, e.g. `integration/subtree-sync`: `git checkout integration/subtree-sync`.
3. Fetch and inspect upstream changes without merging: `git fetch <remote> <branch> --dry-run` (or just `git fetch <remote> <branch>` then `git log <remote>/<branch> --not --branches` to preview new commits).

## Pull Procedure (detailed)
1. Start from a clean working tree and on the integration branch:

```bash
git checkout -B integration/subtree-sync origin/main || git checkout -B integration/subtree-sync main
git status --porcelain # must be clean
```

2. For each service remote:

```bash
# Example for login-page-back
git fetch login-page-back main
# Preview incoming commits
git log --oneline --no-merges main..login-page-back/main

# Run the subtree pull
git subtree pull --prefix=services/login-page-back login-page-back main
```

3. If the subtree pull applies cleanly, run tests, linting, and quick smoke checks.
4. Commit and push the integration branch to the monorepo remote for review:

```bash
git push origin integration/subtree-sync
```

5. Open or update an integration PR for the monorepo with the subtree changes and request review from service owners.

## Conflict Resolution
Subtree pulls can fail when identical paths in the monorepo were edited in parallel or when renames occurred upstream. Use this guidance to resolve conflicts safely:

1. Inspect the failing subtree pull output; it will indicate files with conflicts.
2. Recreate the subtree merge manually to get better control:

```bash
# Create a temporary branch at the fetched upstream HEAD
git checkout -b tmp/login-upstream login-page-back/main
# Use git read-tree to merge into the prefix
git read-tree --prefix=services/login-page-back/ -u HEAD tmp/login-upstream
# If conflicts appear, resolve them using standard git conflict tools
# After resolving, commit the merge
git commit -m "Merge login-page-back into services/login-page-back (manual conflict resolution)"
# Return to integration branch and merge the temp branch
git checkout integration/subtree-sync
git merge --no-ff tmp/login-upstream -m "Integrate login-page-back after manual conflict resolution"
```

3. Policy for conflict resolution:
- Prefer upstream (original repo) changes for service-local files (e.g., files under `services/login-page-back/src/`) unless there is a documented reason to keep the monorepo edits.
- Prefer monorepo-level changes for cross-cutting files (CI, global scripts). If upstream changed how the service expects CI to run, coordinate with service owners.
- For sensitive or policy-related conflicts (security, keys), stop and escalate to security and service owners.

4. After resolving conflicts, run the pre-merge test suite. If tests fail, fix or roll back and notify service owners.

## Branch Policies During Transition
- All subtree pulls and fixes are landed in `integration/subtree-sync` (or similar) and must be code-reviewed by the service owner(s) before merging to `main`.
- Hotfixes to the services should still be applied to the original repositories; then they will be pulled into the monorepo as part of the cadence. Emergency fixes that must be applied directly in the monorepo require a parallel PR to the upstream repo or a coordination meeting to backport.
- Tagging: Upstream releases should be mirrored with annotated tags in the monorepo using `git tag -a` if needed for release tracking.

## Freeze Date & Cutover Plan
- Freeze date (no more upstream pushes): set to: **2025-10-21 23:59 UTC**. (Two weeks from now; adjust if you prefer a different window.)
- During the final week before freeze:
  - Increase subtree pull cadence to 4x/day.
  - Run a full integration test daily on `integration/subtree-sync`.
  - Notify all maintainers 72 hours, 24 hours, and 1 hour before freeze.
- At freeze time:
  1. Stop accepting PRs to upstream repos (create a notice and a branch protection change where possible).
  2. On the monorepo, perform a final pull for each service and fully test:

```bash
git checkout integration/subtree-sync
git subtree pull --prefix=services/login-page-back login-page-back main
git subtree pull --prefix=services/personal-email-signup-backend personal-email-signup-backend main
# Run CI and smoke tests
```

  3. Merge `integration/subtree-sync` to `main` after successful verification and tag the monorepo release (e.g., `auth-monorepo-v1.0.0`).

## Post-Freeze Actions (Stability Window)
- Stability window: 2 weeks after freeze. During this period:
  - Monitor errors and quickly patch in the monorepo. Backport patches to upstream only if needed to keep upstreams usable for any remaining tasks.
  - Keep upstream repos read-only if possible (create a repo notice + branch protection rules).

- After stability window (2 weeks post-freeze):
  - Update upstream `README.md` files to point to the monorepo and mark them as archived/deprecated.
  - Optionally archive the upstream repos on the hosting provider.

## README Update Template for Upstream Repos
Add this short note in the root `README.md` of the upstream repos (commit and push upstream):

> This repository has been migrated into the monorepo at: `https://github.com/<org>/<monorepo>`
> The active canonical source is now the monorepo under `services/<name>/`.
> For development, open PRs against the monorepo. This repo will be archived after a 2-week stability window following the migration freeze.

Example patch to apply upstream (run in upstream repo):

```bash
git checkout -b doc/migration-to-monorepo
# edit README.md to add migration note
git add README.md
git commit -m "Document migration to monorepo and deprecate upstream"
git push origin doc/migration-to-monorepo
# Open PR to main with the doc change
```

## Archiving & CI Cutover Checklist
- Before archiving upstreams:
  - Ensure the monorepo's CI runs all service test suites and pipelines.
  - Update all external links, docs, and deployment manifests to reference the monorepo path `services/<name>`.
  - Notify downstream teams and update any webhook integrations.

- Archive steps (optional):
  1. Add migration note and switch default branch to `main` if not already.
  2. Make repository read-only (GitHub: Archive repository or change permissions).
  3. Remove CI triggers (optional) and close open issues/PRs with pointers to the monorepo.

## Verification Commands
- Verify subtree pulls applied:

```bash
# Show recent commits touching the service folder
git log --oneline -- services/login-page-back | head -20

# Verify a file's history across the rename (follow)
git log --follow -- services/login-page-back/src/index.ts
```

- Verify remotes still present:

```bash
git remote -v
```

## Escalation & Rollback
- If merge breaks production-critical workflows, revert the monorepo merge commit:

```bash
git revert -m 1 <merge-commit-sha>
# push and notify teams
```

- For complex rollbacks, coordinate with service owners to apply hotfixes upstream and re-run subtree pulls.

## Contacts & Ownership
- Release engineering: ops@example.com
- Service owners: `@login-team`, `@signup-team`

---

End of runbook.
