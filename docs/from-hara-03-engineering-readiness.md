# Chalant Identity: Engineering Readiness and Improvement Roadmap

**Evidence snapshot:** `main` at `9da0f96fa27636951e947db7c83f54635d3963c5`, fetched and confirmed equal to `origin/main` on 2026-10-15. Local toolchain: Node `v22.23.1`, npm `10.9.8`; CI workflows pin Node 20. The local checkout already contained an untracked repository-context report; it was not changed. This file is a source-based readiness plan, not a formal audit, performance study, compliance attestation or go-live approval. No tests/builds/migrations or runtime environments were invoked.

Read [Document One](from-hara-01-identity-architecture.md) for current ownership and [Document Two](from-hara-02-security-and-lifecycle.md) for S-IDs, state transitions and adversarial test details. This document uses those stable IDs to avoid duplicating their full analysis.

## 1. Assessment summary

### Verified strengths

- Canonical auth paths are separated into `CanonicalAuthModule`; principal identity comes from verified claims plus a live DB session lookup.
- PostgreSQL uniqueness constraints cover email/username, provider issuer+subject, refresh digest, and source-qualified legacy mapping.
- Google OIDC uses one-time state, nonce and PKCE S256; social email collisions require explicit linking.
- Relational account/credential and reset/session revocation writes use transactions. Profile selects only a known field set and derives user ID from the auth principal.
- Contact matching stores digests, has owner deletion/opt-out controls and defaults contact-discovery permission false. Active discovery fails closed unless HMAC v2 is configured.
- A lockfile, unit/integration/e2e scripts, PostgreSQL/Redis CI service definitions, migration governance scripts, CodeQL workflow and health endpoints are present in source.

### Main readiness blockers and hypotheses

- Refresh rotation's committed revocation is separate from successor insertion (S-01); recent-session checks are age checks, not reauthentication (S-02); simultaneous provider unlinking may violate last-method invariant (S-03); verification/recovery challenge consumption precedes SQL completion (S-04).
- Canonical registration/login input classes are TypeScript interfaces with no global validation pipe; recovery DTO has no visible local validation pipe (S-05). The global throttler’s user key reads `req.user.id`, but canonical principal uses `subject`, and the global guard runs before route guards; per-user throttling likely collapses to one anonymous bucket (S-11), to be confirmed with an integration test. Measure runtime behavior and add explicit contracts.
- The current cross-service identity contract is incompatible by default with Community Group Chat's issuer/audience settings, and no deployed key-sharing evidence exists (S-06/S-07).
- Current guard DB reads, bcrypt cost 12, contact matching and provider calls have no inspected production load results. No throughput/latency/capacity claim can be made.
- Migration history is complex, includes old init files and recent UUID/FK repairs. CI contains fresh/upgrade rehearsal commands, but the current workflow run and target database state were not inspected.
- Repository checklists include numeric SLO and coverage targets, but their inclusion in docs is not evidence they are agreed, measured or achieved.

There is not enough verified runtime or deployment evidence to assign a defensible numeric quality/readiness score or GO/NO-GO. Use the evidence gates in §7.

## 2. Maintainability and design evaluation

**Modularity:** the module map is understandable at top level, and a single deployable Nest app is a sensible default for this scope. Splitting databases or services now would add distributed transactions and identity reconciliation burden without evidence of independent scaling/ownership need.

**Depth and test seams:** `IdentityRepositoryPort` is a useful seam; Google/Apple provider clients are injected. `CanonicalAuthService` currently owns request policy plus hashing compatibility, account queries, Redis verification, token/session lifecycle, JWT signing and logout/revocation. It coordinates appropriate collaborators, but its interface is broad and hides operationally important ordering/failure semantics. Deepen lifecycle operations behind a small explicit interface whose documented contract names idempotency, consume timing, retry, expiry and partial-failure behavior. Keep adapters replaceable in tests.

**Domain integrity:** separate `PasswordCredential` and `User.password`, `IdentitySession` and `RefreshToken`, `User` acceptance columns and `PolicyAcceptance` history are overlapping representations. They may be migration compatibility; neither duplication nor intended end-state is proven from existence alone. Before removal, identify every writer, historic row shape, backup/restore consumer and rollback requirement. Use one canonical state owner per invariant after migration.

**Input/error handling:** service code manually validates email/non-empty fields; canonical controller's input interfaces are erased at runtime. DTO validation is local and inconsistent across route families. Establish decorated DTOs, whitelist+forbid policy, type coercion only where intended, explicit JSON body limits, and stable error envelopes. Do not blanket-convert all historical controllers until ownership/route reachability is known.

**Stale and misleading artifacts:** `jwt-auth.guard.ts` retains a Phase 0 “no authoritative identity implementation” comment, while the module injects `CanonicalAuthService`; health service contains TODOs alongside working DB/Redis/email checks; legacy controllers/scaffolds are present but inactive. Update or mark obsolete comments during a later scoped cleanup after checking consumers. Treat docs' “stub” and “complete” labels as claims to reconcile, not ground truth.

**Testability:** current specs cover canonical auth, provider integrations, recovery, identity, contact hashing and persistence, but presence is not pass status or coverage evidence. Missing tests should target concurrency, failure boundaries, DTO validation, exact status/proxy trust, existing-row migration and cross-service token compatibility. Keep real DB/Redis suites isolated as CI already attempts; never run migration scripts against an unspecified target.

## 3. Efficiency and scalability work to measure

| Path | Source-level cost / hypothesis | Measure before optimization | Safe optimization direction |
|---|---|---|---|
| Protected HTTP request | JWT verification + session query + principal query per request (`authenticateAccessTokenContext` then `getPrincipal`). Revocation is prompt; DB is on request critical path. | Endpoint p50/p95/p99 by route, DB query count/latency, pool wait, error behavior when DB slow/down, concurrency. | Combine session+user reads in one indexed query first. Consider short bounded cache only if acceptable revocation lag is explicitly set and tested. |
| Password policy/login | bcrypt cost 12 for current hash; password evaluation runs zxcvbn and hashing on writes. Login hash verification is CPU/memory-expensive; attacker can consume capacity. | Safe isolated CPU/memory benchmark with representative concurrent requests; HPA saturation, queue and 429 behavior. | Tune cost against threat and production hardware; bounded concurrency/rate controls. If changing algorithm, encode parameters per hash, upgrade on successful login and prove no credential mismatch. |
| Contact upload | Up to 500 phones per request by DTO/docs; normalization/hash, DB dedupe and inserts, match, suggestion upserts occur in transaction. Query/result cardinality and transaction duration may grow with candidate set. | Batch-size curves, rows scanned/returned, query plans, lock duration, memory, duplicates and rate limits. | Confirm indexes/query plans and cap result/match work; use cursor/streaming or staged processing only if measured bottleneck and transaction/privacy behavior permit. |
| Provider login/recovery email | Network calls and provider key signing/exchange dominate and can fail after one-time state consumption. | Provider latency/error/timeout distributions; SMTP acceptance versus delivery signals; retry and callback abandonment. | Explicit timeouts, retry only idempotent operations, durable state/outbox if mail delivery guarantee requires it. Avoid blind retries after one-time code consumption. |
| Redis throttles/challenges | Shared remote state gives coordinated limits/one-use, adds availability dependency. | Redis latency/eviction/availability, cardinality/TTL, fail-open/closed paths, hot keys. | Keep security challenges fail closed; document limiter fallback; capacity-plan key TTL and clean-up. |
| User/profile and session listing | Indexed `userId`, `expiresAt`, `sessionHash`; list sessions filters unrevoked+unexpired. | Explain plans at representative data size and history retention. | Add cleanup/partitioning only if measured table growth or vacuum/query behavior warrants. |

No benchmark values are asserted. Existing script `scripts/measure-http-load.js` is tooling, not an executed or validated capacity result. Do not reuse sample throughput or SLO values as measured evidence.

## 4. Capability and ownership decision matrix

| Capability | Present source state | Initial classification / dependency |
|---|---|---|
| Email/password registration, verification, login | Implemented; email delivery defaults off | Release-critical if password signup is offered; prove SMTP and lost-verification recovery. |
| Social login/link | Google/Apple implemented but disabled by default | Release-critical only if product enables it; provider credentials/redirects and OIDC security validation are external gates. |
| Sessions/logout/revoke | Implemented in canonical service | Release-critical; resolve S-01 refresh recovery and prove client/session semantics. Device names/last-used management is optional UX, but revocation remains essential. |
| Password recovery | Implemented, default disabled | Release-critical if password auth launches; enable only after S-04 recoverability and rate-limit/delivery proof. |
| Password change | Existing endpoint only allows adding password to provider-only user; no existing-password change flow | Product/security decision; password-setting and account takeover recovery must use step-up proof S-02. |
| Email change | No canonical route found | Required if users must recover/address changes without support; needs dual-address proof, uniqueness, notifications and session policy. Otherwise support-process decision. |
| Phone verify/change | User fields exist, no canonical verification flow found | Optional unless phone is relied on for recovery/discovery or identity assurance; never imply an unverified phone is proven. |
| MFA/passkeys | Schema/provider path not found | Product assurance decision; not automatically a release defect for all consumer apps. If target risk requires stronger auth, model authenticator lifecycle and step-up. |
| Account deletion/export | No general user API found; contacts have delete flow | Define privacy/legal/product obligations, cross-service erasure, audit retention and backups before release commitment. |
| Public profile | Current authenticated profile includes email and policy fields | Public profile requires a distinct minimal response and privacy/permission decision. |
| Contact privacy/discovery | Opt-out/delete, expiry, HMAC gate implemented | Only launch with HMAC secret provisioning, reindex, privacy copy and abuse tests. |
| Cross-service identity | UUID schema/token claims exist; consumer mismatch by default | Blocking integration prerequisite for any service treating this JWT as canonical. Keep Community authorization local. |
| Notifications/audit | Email, push token and audit/metrics code exist | Verify actual delivery, retention, token cleanup and redaction according to enabled product surface. |

## 5. Dependency-ordered improvement roadmap

### WP-0: establish a reproducible baseline (before behavioral fixes)

**Problem:** current static inspection cannot establish tested code, CI result, migration compatibility or deployment config. **Paths:** `package-lock.json`, `package.json`, `.github/workflows/signup-service.yml`, `.github/workflows/phase-0-quality.yml`, migration scripts and `docs/production-readiness/`. **Method:** in an isolated environment, pin supported Node version and exact env; run lint/typecheck/unit tests, isolated PostgreSQL+Redis integration, fresh schema and representative upgrade migration rehearsal. Capture revision, commands, exit codes, DB source and artifacts. Audit workflows for path filters, skipped E2E, workflow protections and secret exposure. **Compatibility:** no behavior change. **Closure:** reproducible clean install/build/typecheck; scoped test results and migration reports tied to SHA; no use of a personal/live database.

### WP-1: make session rotation recoverable and step-up meaningful (S-01/S-02/S-03)

**Problem:** revoked refresh can be stranded before successor insert; session age is mistaken for authentication proof; last-method checks may race. **Paths:** `canonical-auth.service.ts`, `canonical-auth.controller.ts`, provider services, `identity.service.ts`, `identity.repository.ts`, schema. **Preferred design:** in one SQL transaction conditionally consume old refresh row and insert new session; return token after commit. Decide response-loss retry family/grace semantics and replay alerting. Store authenticated-at and method/assurance separately from session creation; add a deliberate step-up challenge bound to account, session, operation and callback. Re-check at use. Serialize provider unlinks around user credential state. **Alternatives:** pure idempotency key needs protected token-response replay storage; accepting old refresh indefinitely weakens theft detection. **Tests:** S-01 through S-03 matrix with barriers/fault injection, existing access token expectations and social callback replay. **Compatibility:** changes refresh rotation and client retry behavior; version client contract before rollout. **Migration:** may need auth-time/session lineage columns, nullable backfill with conservative reauthentication. **Operations:** define family retention and security audit events. **Closure:** one valid successor or explicitly supported recovery, no silent lockout in injected failures; old replay denied; sensitive action denied without verified step-up; concurrent unlink leaves an auth method.

### WP-2: durable verification/recovery lifecycle (S-04)

**Problem:** Redis GETDEL precedes SQL success and recovery policy evaluation. **Paths:** `canonical-auth.service.ts`, `canonical-recovery.service.ts`, Redis adapter, Prisma schema, email service. **Preferred method:** choose durable SQL challenge rows with hashed token, purpose, subject, expiry, consumed/attempt state; perform conditional consume and account mutation in one transaction. For mail delivery, write an outbox record transactionally, send asynchronously, track accepted/retry/dead-letter; expose a safe retry path. Keep challenges high entropy, purpose-bound, TTL-limited and single-use. **Alternative:** keep Redis for fast state plus durable SQL completion/idempotency protocol; more complex split ownership. **Tests:** fail SQL, Redis, SMTP, policy, lost response and duplicate request at each stage; generic response parity. **Compatibility:** email messages/links and API retries. **Migration:** new challenge/outbox tables plus cleanup and old Redis key expiry. **Operations:** delivery queue metrics, resend abuse controls and retention. **Closure:** account cannot be stranded without a usable safe verification/recovery route; one-time semantics under concurrent consume; no tokens in logs.

### WP-3: validate HTTP contracts, rate limits and transport trust (S-05/S-09/S-11)

**Problem:** inconsistent runtime DTO validation and unknown forwarded-header trust. **Paths:** canonical auth/recovery controllers, `main.ts`, `CustomThrottlerGuard`, `RedisThrottlerStorageService`, env schema and DTOs. **Method:** decorated request classes for every public body/query/path; select whitelist+forbid behavior and explicit string/array/range limits; configure JSON/form body limits; uniform error mapping. Confirm proxy count and ensure app limiter accepts only ingress-normalized IP. Pin credentialed CORS origins; test browser preflight. Separate login, verification, recovery, callback and authenticated route limits with privacy-preserving keys. **Tests:** wrong JSON types, oversized bodies, extra keys, no/forged/multi-hop forwarded header, CORS credentials, distributed Redis outage, credential stuffing simulation in isolated fixture. **Compatibility:** strict DTO validation may reject existing clients; schema/version and observed client payload inventory first. **Closure:** OpenAPI and runtime validation agree; limit and ingress spoof behavior proven in staging topology.

### WP-4: agree Chalant-wide identity authority and token contract (I-01/S-06/S-07)

**Problem:** signup token issuer/audience differ from Community defaults, and sharing a symmetric secret grants minting capability to verifiers. **Paths:** auth JWT config in both repositories, token service/guard, user schema and migration mapping. **Method:** service owners agree identity owner, subject mapping, audiences, role/authorization ownership, claims minimization, `kid`/algorithm, revocation/SLO, suspension/deletion propagation and migration. Prefer asymmetric signing + JWKS and key rotation if resource servers only verify; protected introspection if immediate revocation dominates and network dependency is acceptable. Avoid auto merge by email. Preserve local Community membership/ban/role authority. **Tests:** contract vectors for correct/incorrect issuer/aud/algorithm/kid/expiry/suspended user, mapping collision, key rollover and outage; consumer CI verifies tokens signed by isolated identity test key. **Compatibility:** current Community token issuer/role claims and clients likely require phased dual-acceptance migration with bounded deadline; never broad wildcard issuer/audience. **Closure:** versioned contract and matching staging proof in both repos plus named key/security owners; no shared-secret assumption.

### WP-5: contact-discovery operational privacy (S-08/S-12)

**Problem:** source default is SHA-256 for compatibility while endpoints require HMAC; old hashes cannot be transformed to HMAC without normalized source values. **Paths:** `contacts.service.ts`, hashing adapter, migration helper, retention/deletion repo, data governance docs. **Method:** choose versioned key IDs and HMAC lifecycle, configure secret through approved manager; inventory digest versions and TTL; force client re-upload or authorized reindex; verify deletion and suggestion cleanup. Review output fields, opt-out matching and connection exclusion placeholder. Test candidate probing, high-volume uploads, blocking, user deletion and key loss. **Compatibility:** digest equality changes, so gradual mixed-mode must label version and avoid cross-key false negatives. **Closure:** deployed mode/key version confirmed, complete reindex or explicit legacy expiry, measured query/privacy tests and deletion proof.

### WP-6: migration and credential reconciliation (D-01)

**Problem:** multiple init migrations, UUID/FK repairs, `User.password` mirror, `PasswordCredential`, legacy `RefreshToken`, policy fields/history. **Paths:** `auth.schema.prisma`, all migrations, baseline schema, migration governance scripts, user/auth writers. **Method:** build a row-level mapping and constraints inventory against sanitized representative schema/data; run clean-init plus upgrade on copies; compare IDs, nullability, indexes, FK target types, identity/session counts, duplicate credentials and policy acceptance. Establish expand/backfill/verify/contract rollout and forward recovery; never edit already-applied migrations without project policy. **Compatibility:** old binaries/schema coexistence and rollback. **Operations:** backup restore rehearsal, locks, statement duration, replica lag and deploy ordering. **Closure:** source DB migration table and schema match expected baseline; no lost rows/orphan FKs/duplicate hashes; restore and forward-fix evidence signed by DB owner.

### WP-7: measure performance, observability, resilience (S-13)

**Problem:** guards and password hashing create known work, but no credible capacity numbers exist. **Method:** establish per-operation latency, DB/Redis pool pressure, hash worker CPU, provider/email timeouts, rate-limit rejection, refresh replay, verification delivery and session-revocation metrics. Use trace IDs but never token/raw phone/password. Run workload tests against disposable staging-sized data after correctness gates. Decide timeouts, resource limits, autoscaling, backup/restore RTO/RPO and failure policy. Validate `/health/ready` semantics for optional email: health code treats non-`unhealthy` as acceptable; verify behavior when email is disabled. **Closure:** measured SLOs approved by service owner, alerts route to an on-call, runbooks exercised, load and outage results attached to release candidate.

### WP-8: release contract and product capability decisions

Decide which auth methods ship, recovery availability, email/phone change, MFA/passkey target, account export/deletion, public profile, retention/legal requirements, user-facing error copy and cross-service authorization contract. Then map each decision to API, client, migration, support, incident and acceptance tests. Missing features are not automatically defects without an intended user/release requirement.

## 6. CI, migrations and operations: what source proves

At inspected revision, `.github/workflows/signup-service.yml` describes Node 20 install/lint/typecheck/format, unit+integration with PostgreSQL/Redis services, optional/path-gated e2e, and deploy-related dispatch inputs. `.github/workflows/phase-0-quality.yml` describes build/typecheck/test and PostgreSQL/Redis fresh and upgrade checks, plus phone package checks. `.github/workflows/codeql.yml` configures CodeQL. These files establish intended workflow definitions only: no GitHub run status, protection settings, deploy success, secret values, artifact retention proof or production rollout was fetched.

Package scripts include `migration:deploy`, reset and real integration commands; do not confuse command existence with safe execution. The root package engines allow Node `>=20 <23`, while CI selects Node 20 and local version is Node 22.23.1. Confirm deterministic install/build on both supported runtime and CI's exact npm version, especially the local file dependency to the phone package. `PrismaService` still carries stale “stub” comments despite a live Prisma client connection; comments need reality review, not assumptions.

Existing production checklist documents 80% coverage and latency/availability/throughput objectives, but these are checklist aspirations in source, not approved SLOs or measured outcomes. Health endpoints run DB `SELECT 1`, Redis `PING` and email health check; `/health/live` is unconditional, `/health/ready` uses aggregate readiness. No runtime evidence validates probes, email optionality, graceful shutdown, DB pool sizing, Redis eviction, backup, secret-manager, ingress, alert ownership or rollback.

## 7. Measurable release acceptance gates

A release decision should require evidence for every applicable gate; “not applicable” needs a named owner and rationale.

1. **Source baseline:** exact SHA, clean isolated build input, dependency lock, source review, no untracked code artifacts in release package.
2. **Identity/session correctness:** concurrency and failure-injection suites for S-01..S-04 pass; account status, verification, access expiry and refresh replay behavior documented and client-compatible.
3. **HTTP/security:** DTO schema tests, body limits, proxy/IP, CORS, login/recovery per-user/IP/device bucket tests and provider callback security tests pass; no secret or credential leakage in logs.
4. **Data:** clean install and representative upgrade succeed on disposable DB; schema/row/FK/unique checks and backup restore succeed; no production migration occurs without explicit change control.
5. **Federation:** issuer/audience/algorithm/key distribution and revocation contract verified from both signup and Community sides; key rotation and consumer outage behavior demonstrated.
6. **Privacy:** contact HMAC mode/key version provisioned, old hash transition complete or retired, opt-out/delete/retention behavior proven, public response fields reviewed.
7. **Operational:** approved service SLOs have observed load results, resource/pool ceilings, alarms, runbooks, rollback/forward-fix, incident owner and RTO/RPO. No numbers copied from samples without measurement.
8. **Release scope:** enabled auth methods and lifecycle capabilities have owner sign-off, client compatibility, support/recovery path and external credentials confirmed.

A GO decision is justified only when applicable gates have attached, revision-specific evidence and the accountable identity/product/security/operations owners accept remaining risks. This document itself grants no approval.

## 8. Recommended audit-to-remediation sequence

1. Run a formal read-only runtime/repository audit at a pinned SHA and inspect current CI results, configuration without secret disclosure, ingress, deployment and target DB migration state.
2. Resolve identity owner/Community trust contract and product decisions for reauthentication, recovery, revocation, account deletion and enabled providers.
3. Design and verify session and challenge failure semantics with isolated PostgreSQL/Redis concurrency tests before changing implementation.
4. Implement correctness foundations in small, reviewable increments with migration expand/backfill/verify/contract sequencing and client compatibility gates.
5. Complete input/proxy/provider/contact privacy hardening and cross-service contract tests.
6. Run workload, outage, restore and deployment rehearsals; publish measured thresholds and operating runbooks.
7. Re-audit the exact candidate SHA, close findings only with repeatable evidence, then let named owners make the production release decision.
