# R3 Security and Runtime Engineering Record

Date: 2026-10-13  
Scope: local successor of `253e166`; no deployment, merge, or push performed.

## Confirmed defects

- The signup security job audited development tooling together with production dependencies. Its captured baseline was 141 advisories: 7 critical, 69 high, 59 moderate, and 6 low.
- `@nestjs-modules/ioredis` was not imported by the active application, but its optional Terminus tree installed Nest 10 packages beside the Nest 11 runtime. This was the observed Nest major-version peer conflict.
- Mongoose, Nest microservices, OpenTelemetry SDK/auto-instrumentation, and the TypeORM integration were not registered by `AppModule`; several were nevertheless production dependencies.
- GitLeaks was commented out. The remaining secret checks were non-blocking pattern searches and could report success without scanning repository history.
- The legacy `src/auth/auth.module.ts` is not registered. The `auth_cc` module registered by `AppModule` only exposed terms endpoints but was named `AuthModule`, obscuring ownership.
- `services/login-page-back` has no `package.json`, executable entrypoint, or runnable test harness. Its source tree is specification/scaffold material, not an operational backend.
- Startup configuration accepted `DATABASE_URL_AUTH` in Prisma but required `DATABASE_URL` in validation, so staging-style startup failed before Nest initialization.
- The real module graph had missing throttler/rate-limiter/terms dependencies, legacy Prisma token injection, inherited `ThrottlerGuard` injection metadata, and an unguarded unfinished `UserController` surface.
- Password registration had no canonical email-verification token route or Redis consumption path. Contact upload/suggestions did not enforce the HMAC cutover boundary.
- The production build emitted the entrypoint below `dist/personal-email-signup-backend/src/main.js` while `start` expected `dist/main.js`; compiled Prisma also used a source-relative generated-client path.
- A live username update returned HTTP 500 because the controller supplied a Prometheus `endpoint` label to a histogram declared with `route`.
- Health endpoints reported dependency success without querying PostgreSQL, Redis, or the configured email transport.

## Implemented fixes

- Removed unused production dependencies that created the Nest 10 subtree and moved the unregistered TypeORM path to development dependencies.
- Updated the active dependency set and lockfile, including Nest 11-compatible patch lines, Express, jsdom, Nodemailer, DOMPurify, uuid, jsonwebtoken, and class-validator.
- Kept jsdom on a Jest-compatible maintained line after reproducing and rejecting jsdom 30's ESM regression under Jest 29.
- Changed the active compatibility module to `TermsModule`; `CanonicalAuthModule` is the sole registered owner of `/auth`, Google, Apple, recovery, sessions, and provider-linking routes. The legacy AuthModule remains quarantined and unregistered.
- Replaced the mock secret scan with GitLeaks Action v3 pinned to its immutable release commit and full-history checkout. Tracked environment files now fail explicitly without printing their contents.
- Added CodeQL JavaScript/TypeScript analysis using the maintained GitHub action and security-events permissions.
- Changed dependency blocking to `npm audit --omit=dev`; the full development audit remains an artifact for remediation, while production reachability controls the release gate.
- Normalized `DATABASE_URL_AUTH`/`DATABASE_URL` at the configuration boundary and added configuration regression tests.
- Made the application module graph executable: wired throttler/rate-limiter dependencies, corrected Prisma service injection, removed the unsafe legacy user controller from runtime, and explicitly pinned the custom guard's configuration token.
- Added canonical `/auth/verify-email` with hashed, one-time Redis tokens and optional SMTP delivery; registration remains verification-required and never issues a pre-verification session.
- Routed legacy terms compatibility through canonical authentication and canonical policy persistence, and made contact upload/suggestions fail closed while `sha256-v1` is active.
- Repaired the active username write route to persist through `CanonicalProfileService`; replaced runtime UUID generation with Node `crypto.randomUUID()` to avoid an ESM-only dependency in the Nest/Jest path.
- Repaired monorepo runtime startup: shared phone-normalization imports now use its package boundary, Prisma uses `@prisma/client`, the service start scripts use the emitted entrypoint, and the shared package emits Node-compatible CommonJS.
- Corrected the username latency metric label and implemented real PostgreSQL, Redis, and email health checks; readiness now returns 503 when Redis is unavailable.
- Removed unused `winston-daily-rotate-file`, eliminating its reachable `moment` advisory. The remaining production advisories are the two moderate `js-yaml` findings nested under Nest Swagger 11; the available fix requires the unsupported Nest 12 major upgrade.
- Corrected the infrastructure test harness so its ConfigService mock reflects policy and HMAC environment values instead of silently using insecure/default settings. The contact integration fixture now derives candidate digests with the configured HMAC key, preserving the secure-mode cutover contract.
- Added `test:integration:real` and `scripts/run-real-integration.js`. It requires all six disposable database gates and `USE_REAL_REDIS=true`, regenerates Prisma, and executes the complete HTTP integration matrix without an in-memory Redis fallback.
- Added `scripts/measure-http-load.js` for repeatable authenticated HTTP measurements against a disposable runtime.
- Removed verification-token, email, and full-user debug logging from the quarantined compatibility service; its characterization test still passes without sensitive values appearing in output.

## Capability mapping

| Source capability | R3 authoritative implementation | Evidence |
|---|---|---|
| R1/R2 password auth and sessions | `src/canonical-auth`, `src/identity`, Prisma UUID identity/session models | canonical auth tests, identity persistence tests, active module graph |
| Google and Apple OIDC | `src/canonical-auth/google-*`, `src/canonical-auth/apple-*` | provider unit/integration suites; live credentials still pending |
| Profiles and onboarding | `src/user/profile.controller.ts`, canonical profile service, onboarding migrations | profile tests and canonical schema |
| Contacts and privacy | `src/contacts`, HMAC adapter and fail-closed service boundary | contact adapter/migration/security tests; secure key provisioning still pending |
| Policy acceptance | `src/policies/canonical-policy*`, policy migration | canonical policy tests |
| Login-page-back claims | No executable target; only scaffold files and README | no package manifest, build, or test entrypoint |

## Verification evidence

- Clean `npm ci --ignore-scripts --no-audit --no-fund` succeeds without legacy peer resolution.
- Prisma generation, build, typecheck, governed lint, and migration governance pass locally.
- Production audit: 0 critical, 0 high, 2 moderate findings remain; the remaining `js-yaml` advisory is transitive under `@nestjs/swagger` 11 and was not force-overridden.
- Full regression: 29 suites passed, 261 tests passed, 24 infrastructure-conditional tests skipped, 285 total.
- Focused runtime/security tests: 4 suites and 8 tests passed, including module compilation, HTTP protection, config normalization, email verification, and contact cutover.
- Build, typecheck, targeted lint, migration governance, and Phase 0 verification pass locally.
- Disposable infrastructure verification completed with Docker PostgreSQL 16, Redis 7, and Mailpit SMTP: fresh phase1 schema initialization passed; the real app booted and served HTTP; registration, SMTP verification, token replay rejection, login, profile, username, onboarding, policy, refresh rotation, logout, revoked-token rejection, HMAC contact upload/deletion, and Redis failure readiness behavior were exercised.
- The concurrent username check produced one 200 and one 409 for the same normalized name, confirming database uniqueness behavior under a race. Shared phone normalization passed 48 tests with 95.26% statement coverage.
- Real infrastructure integration command: 8 suites, 24 tests executed, 24 passed, 0 failed, against Docker PostgreSQL 16 and Redis 7 with `USE_REAL_REDIS=true`. The suites covered canonical password auth, Google, Apple, identity module/persistence, profile, contacts, and policy HTTP behavior.
- Real HTTP load baseline against the disposable app at concurrency 10 with 50 requests per route and zero errors: `/profile/me` p50 19.42 ms / p95 47.13 ms / p99 48.83 ms; `/contacts/suggestions` p50 33.42 ms / p95 59.62 ms / p99 60.34 ms; `/health/live` p50 7.88 ms / p95 9.47 ms / p99 10.05 ms. The harness observed a 6.60 MB process RSS delta; this is a startup-scale baseline, not a capacity claim.

## Remaining gaps

- Two moderate production advisories remain in `js-yaml` under `@nestjs/swagger` 11; removing them requires a supported Nest 12 upgrade batch.
- Live Google/Apple credentials, SMTP inbox delivery, managed HMAC key provisioning, staging HTTPS, and deployed-schema compatibility evidence remain unavailable.
- The normal unit regression command still reports 24 infrastructure-conditional skips by design; the new `test:integration:real` command executes those suites and currently passes all 24 tests locally. Remote CI execution remains unverified until the workflow changes are published.
- Gitleaks and CodeQL have not executed remotely because these changes remain uncommitted and unpushed.
- The login-page-back scaffold must not be treated as a deployable service until it receives an authorized implementation contract and executable build/test surface.

## Next batch

Unify API/data contracts and startup-scale reliability using this verified canonical runtime. Do not activate the quarantined legacy auth implementation or expose contact discovery until the external acceptance evidence above exists.
