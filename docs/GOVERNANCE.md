# Repository Governance Framework

## Purpose

This document codifies how the `auth-services-monorepo` is administered. It defines ownership, decision authority, guardrails, and review cadences that keep the repository secure, compliant, and predictable as teams collaborate across services.

## Roles And Access Levels

| Access Tier | GitHub Role | Typical Members | Capabilities | Time-Bound Elevation |
|-------------|-------------|-----------------|--------------|----------------------|
| **Platform Admin** | Admin | `@org/devops-infra` leads, product security lead | Manage repository settings, branch protection, secrets, GitHub Apps | Approved via on-call ticket; auto-revoked after 24h |
| **Domain Maintainer** | Maintain | Service tech leads in `@org/identity-platform`, `@org/session-platform`, `@org/authn-authz` | Merge to protected branches during incidents, manage environments, approve dependency upgrades | Incident ticket required; reviewed next business day |
| **Core Contributor** | Write | Engineers in platform, identity, session, data, docs teams | Create branches, open PRs, approve within scope, trigger staging deploys | Not applicable |
| **Issue Steward** | Triage | Product, support, QA partners | Label/assign issues, manage discussions | Not applicable |
| **Stakeholder** | Read | Finance, audit, partner teams | Read-only access, pull artifacts | Renewed quarterly via access review |

All members must enable organization-enforced MFA and pass annual secure coding training. Violations suspend repository access until remediated.

## Team Topology And Ownership

- `@org/platform-core` – Monorepo architecture, shared libraries, cross-cutting engineering standards. Primary contact: platform-core@company.com
- `@org/identity-platform` – Personal-email signup service and onboarding flows. Contact: identity-platform@company.com
- `@org/session-platform` – Login/session management service. Contact: session-platform@company.com
- `@org/authn-authz` – Authentication protocol specialists managing shared auth libraries. Contact: authn-authz@company.com
- `@org/data-platform` – Database schemas, migrations, data retention controls. Contact: data-platform@company.com
- `@org/devops-infra` – CI/CD, infrastructure, secrets, observability. Contact: platform-ops@company.com
- `@org/security-guild` – Product security, compliance attestations, incident response. Contact: security-incident@company.com
- `@org/tech-docs` – Contributor docs, runbooks, ADR facilitation. Contact: docs@company.com

Ownership rules in `.github/CODEOWNERS` mirror this topology and require approvals from the teams listed above for their respective paths.

## Branch Protection Policy

**main**
- Required checks: `lint`, `unit-tests`, `integration-tests`, `e2e-smoke`, `codecov`, `trivy-scan`, `iac-validate`.
- Required reviewers: 2 approvals including responsible domain team and either `@org/platform-core` or `@org/security-guild` for security-touching changes.
- Status checks must pass and commits must be signed + verified.
- Force pushes disabled; delete branch disabled.

**release/* (temporary)**
- Required checks: `lint`, `unit-tests`, `integration-tests`, `code-sign`.
- Minimum 1 approval from the domain maintainer and sign-off from release manager.
- Auto-delete on merge enabled; release branches expire after 30 days.

**develop** (if enabled)
- Protects integration testing. Requires `lint`, `unit-tests` and at least one approval from any core contributor outside the authoring team.

**feature/*, bugfix/*, hotfix/**
- Not protected to support iteration, but must be kept current with `main` via rebase/merge before opening PRs. Hotfix branches may be escalated to `main` with expedited review following the incident policy below.

## Change Management Workflow

1. **Planning** – Changes affecting another domain require an RFC or ADR logged in `docs/adr/`. Notify impacted CODEOWNERS.
2. **Pull Request** – Reference Jira/Linear ticket, document rollout steps, and note any configuration or schema migrations.
3. **Testing** – All PRs must attach CI evidence. For schema changes, include backward-compatibility notes and migration plan signed by `@org/data-platform`.
4. **Approvals** – Follow CODEOWNERS. Security-relevant changes must ping `@org/security-guild`.
5. **Deploy** – Stage via GitHub Actions workflows. Production deploys require change record in Incident/Change (IC) tool referenced in PR.
6. **Post-Deploy Verification** – Within 30 minutes, verify dashboards and attach summary as PR comment. Failures trigger auto-rollback job and incident escalation.

## Access Provisioning And Reviews

- **Joiners** – Team lead files access request; `@org/devops-infra` grants GitHub team membership within 1 business day after HR confirmation.
- **Leavers** – Access revoked within 4 business hours of departure notification; audit captured in access ledger.
- **Quarterly Review** – First Monday of March/June/September/December. `@org/security-guild` chairs review, `@org/devops-infra` executes removals and documents evidence for compliance.
- **Temporary Access** – Use the `access-temp` GitHub team with automatic expiration via scheduled job. Extensions require new approval cycle.

## Incident And Hotfix Protocol

- Paging path: app alerts -> `@org/devops-infra` on-call -> escalate to domain owning team.
- During Severity 1 incidents, Maintainers may bypass review to push hotfix to `main` using GitHub's bypass flag. Action must be documented in the incident report and retroactively reviewed within 24 hours.
- Post-incident review identifies missing tests or automation and assigns follow-up tasks with due dates.

## Repository Archival And Decommissioning

1. Domain team proposes archival with rationale, dependencies, and handover plan.
2. `@org/platform-core`, `@org/security-guild`, and product leadership review and sign off.
3. `@org/devops-infra` creates read-only tag, disables write access, and moves repository to `archived` GitHub org folder.
4. Documentation updated (README, service catalog). Retention requirements enforced by `@org/data-platform`.
5. Review outcome logged in governance tracker.

## Governance Review Cadence

- **Monthly** – `@org/platform-core` sync with domain leads to review open governance actions, CODEOWNERS accuracy, and upcoming cross-domain work.
- **Quarterly** – Access review plus policy gap check led by `@org/security-guild`.
- **Biannual** – Full framework audit; confirm branch protections, workflow lists, and escalation contacts. Updates published in this document and announced in `#platform-announcements`.

## Contact Directory

| Responsibility | Team / Contact | Channel |
|----------------|----------------|---------|
| Platform operations | `@org/devops-infra` | platform-ops@company.com |
| Security incidents | `@org/security-guild` | security-incident@company.com |
| Architecture decisions | `@org/platform-core` | platform-core@company.com |
| Documentation | `@org/tech-docs` | docs@company.com |
| Data governance | `@org/data-platform` | data-platform@company.com |

## Document Control

**Last Updated:** 7 February 2026  
**Next Scheduled Review:** 7 May 2026  
**Document Owners:** `@org/platform-core` (primary), `@org/devops-infra` (co-owner)