# Chalant — Current State and Target Gaps

**Evidence snapshot:** application source is local `main` at `9da0f96` and is unchanged in `origin/main` at `abe21cfa`. `origin/main` is two documentation commits ahead of the local branch: `ff339f4` and `abe21cfa`. The working tree was clean before this document was created. No production data, live provider, production SMTP, production database, credential rotation, deployment, commit, or push was performed.

This document reconciles the historical security audit and roadmap with executable R3 source, NestJS registration, Prisma schema, local checks, and GitHub Actions evidence. Historical documents remain useful context, not current-state authority.

## Executive assessment

- **Repository consolidation:** achieved at source-control and application-module level, but not yet proven as a release-ready operational system.
- **Canonical identity:** implemented in the R3 NestJS signup runtime. UUID `User` is the identity root; `UserIdentity`, `PasswordCredential`, `IdentitySession`, and `LegacyIdentityMapping` provide the canonical seams.
- **Frontend integration:** technically suitable for contract-level frontend integration in isolated development. The backend exposes canonical password, provider, session, profile, and recovery routes.
- **Staging verification:** not yet ready for a meaningful full-system staging sign-off because the clean migration chain fails and real PostgreSQL/Redis integration has not executed locally.
- **Public production:** **NO-GO**. Mandatory migration, secret-scan, provider, SMTP, recovery, contact-HMAC, schema-compatibility, managed-secret, rollback, and load evidence is incomplete.

## Current canonical architecture

`AppModule` registers `IdentityModule`, `CanonicalAuthModule`, `EmailModule`, `UserModule`, `ContactsModule`, and `CanonicalPolicyModule`. `CanonicalAuthModule` registers the password, Google, Apple, recovery, JWT, Redis, and email collaborators.

The active identity path is:

```text
HTTP client
  → CanonicalAuthController / GoogleAuthController / AppleAuthController
  → CanonicalAuthService or provider service
  → IdentityService / IdentityRepositoryPort
  → Prisma User + UserIdentity + PasswordCredential + IdentitySession
  → Redis for one-time OAuth/email/recovery state
```

Canonical access tokens use the fixed issuer `r3-canonical-identity`, audience `r3-api`, subject `User.id`, session ID `sid`, and type `canonical-access`. The guard verifies the JWT and reloads the session and principal from PostgreSQL.

## Historical claim reconciliation

| Capability | Current source evidence | Classification |
|---|---|---|
| UUID identity ownership | Prisma `User.id` is UUID; `IdentityService` creates canonical users; provider and legacy mapping tables use UUID FKs. | **Resolved in R3 source; migration execution still blocked.** |
| Password registration/login | `CanonicalAuthService` creates `PasswordCredential`, verifies bcrypt/Argon2-compatible hashes, requires active and verified accounts, and issues canonical sessions. | **Implemented; isolated unit evidence passed.** |
| Session issuance/refresh/logout | `IdentitySession` stores hashed refresh tokens; refresh uses conditional consumption; access token checks issuer, audience, type, session, account status, and expiry. | **Implemented; failure/concurrency hardening remains.** |
| Google OIDC | Authorization URL, state/nonce/PKCE S256, one-time Redis state, Google token exchange, issuer/audience/nonce checks, provider-subject persistence, explicit linking, and canonical session issuance exist. | **Implemented but disabled by config; live provider acceptance pending.** |
| Apple OIDC | Authorization/code exchange, ES256 client-secret generation, Apple JWKS verification, issuer/audience/nonce checks, relay-safe subject handling, explicit linking, and canonical session issuance exist. | **Implemented but disabled by config; adapter unit passed; live acceptance pending.** |
| Provider linking | `/auth/google/link` and `/auth/apple/link` require `JwtAuthGuard`; callback state binds the operation to the authenticated user/session; email equality does not auto-merge conflicting providers. | **Implemented; step-up semantics and race tests remain.** |
| JWT validation | `JwtAuthGuard` delegates to canonical access-token validation; issuer, audience, type, subject, session ownership, revocation, expiry, and account state are checked. | **Resolved for active canonical routes.** |
| Email verification | Registration creates a Redis-backed verification token and marks the UUID user verified through `POST /auth/verify-email`; delivery is controlled by `EMAIL_DELIVERY_ENABLED` and fails closed when disabled. | **Implemented; SMTP/inbox proof pending.** |
| Password recovery | `/auth/recovery/request` and `/auth/recovery/reset` exist with hashed Redis tokens, TTL, one-time consumption, policy checks, and session revocation. | **Implemented but disabled by config; real Redis/delivery acceptance pending.** |
| Active route registration | `AppModule` imports `CanonicalAuthModule`; app-module HTTP tests pass for protected canonical routes. `src/auth/auth.module.ts` is not imported by `AppModule`. `auth_cc` is used as a terms-compatibility module, not the authentication owner. | **Canonical path active; legacy stub isolated from this runtime graph.** |
| R1 legacy vulnerabilities | R1 source remains historical compatibility material. The unauthenticated request-body `userId` MFA setup issue is not reachable through the current R3 `AppModule` graph. | **Runtime-isolated, not deleted; keep quarantine and prove deployment entrypoint.** |

## Preserved functionality

- **R1:** password/MFA/recovery history and legacy compatibility context are preserved, but R1 is not allowed to mint canonical sessions in the R3 runtime.
- **R2:** NestJS signup/onboarding, OTP/email boundaries, profile/username, policy, Redis, observability, and migration history are retained. The old `src/auth` stub is not the active auth owner.
- **R3:** canonical UUID identity, provider identities, password credentials, sessions, profile projections, contact discovery, policy acceptance, recovery, provider adapters, and CI/migration governance are present in the consolidated tree.

## Current CI and local evidence

### GitHub Actions

- `38694462584` — **Phase 0 quality gates:** `identity-persistence` failed at `npm run migration:governance:check` with `Governed historical migration checksum changed: 20241002000001_add_performance_indexes`. Repository-contract, signup build/test, and phone build/test passed. Database tests were skipped after the governance failure.
- `38694462575` — signup workflow: install, typecheck, lint, and setup passed; both unit and integration matrix jobs failed at `Apply migrations`. PostgreSQL reported `RefreshToken_userId_fkey` incompatible column types: child `uuid`, parent `integer`. Tests never started.
- `38694846231` — security workflow: CodeQL/static analysis, dependency checks, compliance, and configuration jobs passed; Gitleaks failed with 24 findings. These appear largely to be sample/documentation/test values and schema-baseline strings, but each finding still requires explicit triage or a narrowly scoped allowlist.

The exact Phase 0 failure is therefore not dependency installation, Redis health, or test configuration. It is first a migration-governance checksum failure. The separately observed integration failure is a real SQL migration-order defect.

### Local checks executed

Against the current local application source:

- `npm run build` — **passed**.
- `npm run typecheck` — **passed**.
- targeted `npm run lint` — **passed with 6 warnings**, all `no-unsafe-argument` warnings in `canonical-auth.service.spec.ts`; no errors.
- `npx prisma validate --schema=prisma/auth.schema.prisma` — **passed**.
- `app.module.spec.ts` — **2 tests passed**, including real NestJS module compilation and protected canonical HTTP route checks.
- canonical auth/recovery/identity unit suites — **11 tests passed; 9 integration tests skipped** because disposable PostgreSQL/Redis variables were not provided.
- Apple OIDC client unit test — **passed**.
- `npm run migration:governance:check` — **failed**, reproducing the checksum mismatch locally.
- Docker daemon was unavailable locally; no disposable PostgreSQL/Redis integration run was possible.

The local Node version is `v26.8.1`, while the repository declares Node `>=20 <23` and CI uses Node 20. The passing local checks are useful but should be repeated on a supported Node version before release decisions.

## Genuine remaining gaps

1. **Migration governance:** decide whether the historical migration is actually changed, restored, or replaced by an authorized baseline/forward-fix policy. Do not silently rewrite a governed historical checksum.
2. **Fresh-install migration:** repair the UUID migration ordering in a governed migration strategy. Child UUID FKs must not reference integer `User.id`; all dependent FKs must be detached or deferred until the parent UUID key is authoritative.
3. **Real database/Redis acceptance:** run fresh install, representative upgrade, identity persistence, refresh replay, revocation, rate-limit, OAuth replay, linking, and recovery tests against disposable PostgreSQL and Redis.
4. **Google/Apple acceptance:** provide staging client IDs, redirect URIs, Apple signing configuration, test accounts, HTTPS callbacks, and verify invalid issuer/audience/signature/nonce/state/code-reuse cases. Source implementation is present; live acceptance is not.
5. **SMTP delivery:** verify a production-compatible provider, sender authentication, inbox receipt, bounce/failure behavior, timeout/retry semantics, verification delivery, and recovery delivery.
6. **Recovery lifecycle:** resolve Redis-first token consumption versus durable database/outbox semantics, then run HTTP-level recovery tests with real Redis, PostgreSQL, and delivery.
7. **Refresh/session lifecycle:** harden the failure window between refresh-token consumption and successor issuance; decide stable logical sessions versus rotating credential families, lost-response behavior, replay response, and concurrency semantics.
8. **Step-up and MFA policy:** MFA is not automatically mandatory. The release owner must decide whether it is in initial scope. If deferred, keep it disabled with no functional route or client-controlled enablement. Provider unlink/password changes still need a real proof-freshness contract rather than session age alone.
9. **Contact HMAC:** provide managed key ownership, key versioning, source-phone re-index procedure, rollback rehearsal, and confirmation that legacy low-entropy matching is not exposed during secure cutover.
10. **Secret scanning:** classify all 24 findings as dummy fixture, digest, documentation sample, or confirmed credential. Remove or allowlist only documented non-secrets; rotate confirmed credentials through the authorized owner.
11. **Deployed-schema compatibility:** obtain an authorized sanitized schema snapshot and `_prisma_migrations` metadata, or explicitly declare a fresh-install-only launch. Rehearse backup, restore, lock, forward migration, and rollback/forward-fix behavior.
12. **Operational proof:** replace mock-only deployment steps with real staging health, migration, rollout, smoke, rollback, observability, and alert evidence. Add reproducible load tests after correctness and infrastructure gates pass.

## Exact next engineering sequence

1. Freeze the current application revision and create an evidence branch without staging generated files.
2. Resolve the migration-policy decision with the database owner; preserve historical migration immutability unless explicitly authorized.
3. Implement and test the governed migration correction for the UUID/FK ordering; add a fresh-install regression test that fails on the old ordering.
4. Fix the Phase 0 workflow so governance, fresh install, and upgrade jobs report independently while retaining fail-closed gates.
5. Run the complete Phase 0 matrix on Node 20 with disposable PostgreSQL and Redis; publish logs and artifacts.
6. Triage Gitleaks findings and obtain a clean scan or approved, narrow false-positive record.
7. Execute staging provider and SMTP acceptance, then activate only the capabilities included in the approved release scope.
8. Complete recovery, refresh/session failure-injection, contact-HMAC, schema-compatibility, backup/restore, rollback, and load evidence.
9. Reassess frontend integration against the versioned route/error/principal contract and only then approve staged canary traffic.

## Final decision

The consolidated backend is a credible canonical R3 implementation and is suitable for frontend contract integration in isolated development. It is not yet suitable for claiming staging acceptance because the database migration chain and governance gate fail before the real integration suites run. Public production deployment has not passed its mandatory gates and remains **NO-GO**.

The next work is evidence closure and governed migration repair—not a restart of the historical Phase 0–12 implementation roadmap.
