# Onboarding Master Plan Audit - Findings Report

**Generated**: 2025-10-08T10:00:00Z  
**Auditor**: Senior Backend Engineer  
**Repository**: personal-email-signup-backend  
**Architecture**: NestJS + PostgreSQL + Redis + JWT + OTP  

## Executive Summary

**OVERALL STATUS**: ❌ SIGNIFICANT GAPS FOUND  
**Risk Level**: HIGH  
**Critical Issues**: 6  
**Medium Issues**: 3  
**Low Issues**: 2  

The backend has partial implementation of the onboarding master plan but lacks critical enforcement mechanisms, proper password security, and comprehensive integration.

## Phase A: Terms Acceptance Audit

### ✅ PASS: Policy Infrastructure Present
- **Finding**: PolicyAcceptanceHistory entity and PoliciesService exist
- **Evidence**: `src/policies/policies.service.ts` implements acceptPolicy()
- **File References**: `src/policies/policies.controller.ts:29` - REQUIRE_TERMS_ENFORCE_MODE

### ❌ FAIL: Registration Terms Enforcement Missing
- **Risk**: HIGH
- **Finding**: Registration flow in AuthService.register() does not check or require terms acceptance
- **Evidence**: `src/auth_cc/auth.service.ts:127-200` - no terms validation
- **Expected**: Registration should validate user.termsVersion matches ACTIVE_POLICY_VERSION
- **File References**: `src/auth_cc/auth.service.ts:127`

### ❌ FAIL: Login/Session Gating Missing
- **Risk**: HIGH  
- **Finding**: No middleware or guard to gate API access based on policy version mismatch
- **Evidence**: No JWT middleware checks user.termsVersion vs ACTIVE_POLICY_VERSION
- **Expected**: Authenticated endpoints should return 403 if user.termsVersion < ACTIVE_POLICY_VERSION

### ✅ PASS: Observability Present
- **Finding**: Metrics and audit events implemented
- **Evidence**: `terms_accepted_total`, `invalid_terms_version_total` counters; `legal.accept` audit events
- **File References**: `src/policies/policies.controller.ts:12-14`

## Phase B: Identity Capture Audit

### ✅ PASS: Registration Fields Present
- **Finding**: CreateUserDto includes all required identity fields
- **Evidence**: display_name, declared_age, profile_image_url, pronouns in DTO
- **File References**: `src/auth_cc/dto/create-user.dto.ts:38-76`

### ✅ PASS: Age Validation Present
- **Finding**: AuthService.register() enforces MIN_DECLARED_AGE threshold
- **Evidence**: Deterministic underage rejection with metrics/audit
- **File References**: `src/auth_cc/auth.service.ts:131-152`

### ✅ PASS: Profile Image Pointer Storage
- **Finding**: profile_image_url stored as string pointer only
- **Evidence**: No binary storage in auth DB; URL validation present
- **File References**: `src/user/profile.controller.ts:44-77`

### ✅ PASS: Pronouns Handling
- **Finding**: Optional pronouns with length limits and redaction
- **Evidence**: Max 64 chars, audit redaction implemented
- **File References**: `src/user/profile.controller.ts:18-49`

### ✅ PASS: Identity Observability
- **Finding**: Metrics and audit events for identity operations
- **Evidence**: `identity_validation_failures_total`, `underage_denied_total`
- **File References**: `src/metrics/metrics.service.ts:140-156`

## Phase C: Username System Audit

### ✅ PASS: Unicode Normalization Present
- **Finding**: Username normalization implemented with NFKC
- **Evidence**: normalizeUsername() function with feature flag
- **File References**: `src/user/username-normalize.ts`, `src/user/username.controller.ts:34`

### ✅ PASS: Reserved Names Denylist
- **Finding**: RESERVED_USERNAMES set with enforcement
- **Evidence**: Denylist checking in availability and set endpoints
- **File References**: `src/user/username-denylist.ts`, `src/user/username.controller.ts:35`

### ✅ PASS: Username Endpoints Present
- **Finding**: Availability check and set/update endpoints implemented
- **Evidence**: Rate-limited endpoints with structured responses
- **File References**: `src/user/username.controller.ts:22-118`

### ❌ FAIL: Unique Index Missing
- **Risk**: MEDIUM
- **Finding**: No evidence of unique index on normalizedUsername in schema
- **Expected**: Database unique constraint to prevent race conditions
- **Remediation**: Add unique index in migration

### ✅ PASS: Username Observability
- **Finding**: Metrics and audit events implemented
- **Evidence**: `username_conflicts_total`, audit redaction
- **File References**: `src/metrics/metrics.service.ts:183-191`

## Phase D: Password Policy Audit

### ❌ FAIL: Argon2id Missing
- **Risk**: HIGH
- **Finding**: Using bcrypt instead of Argon2id for password hashing
- **Evidence**: `src/auth_cc/auth.service.ts:105-111` uses bcrypt
- **Expected**: Argon2id with documented parameters (memory, iterations, parallelism)
- **File References**: `src/auth_cc/bcrypt-adapter.ts` - fallback implementation

### ❌ FAIL: Password Policy Enforcement Missing
- **Risk**: MEDIUM
- **Finding**: Only MinLength(6) validation, no length-first policy
- **Evidence**: `src/auth_cc/dto/create-user.dto.ts:33-36`
- **Expected**: Configurable min/max length, no composition rules
- **Remediation**: Implement password policy service with feature flags

### ❌ FAIL: Breach Screening Missing
- **Risk**: HIGH
- **Finding**: No integration with compromised password databases
- **Expected**: Privacy-preserving breach check (k-anonymity or similar)
- **Remediation**: Integrate HaveIBeenPwned API or similar service

### ❌ FAIL: Rehash Strategy Missing
- **Risk**: MEDIUM
- **Finding**: No automatic rehashing on login for upgraded parameters
- **Expected**: Check password hash format, rehash if outdated
- **Remediation**: Add hash version detection and upgrade logic

### ❌ FAIL: Password Observability Missing
- **Risk**: LOW
- **Finding**: No metrics for password policy failures or breach blocking
- **Expected**: `password_policy_failures_total`, `password_breached_blocked_total`
- **Remediation**: Add metrics to password validation flow

## Phase E: Security & Observability Audit

### ✅ PASS: Multi-dimensional Rate Limiting
- **Finding**: IP, user, device rate limiting implemented
- **Evidence**: MultiDimThrottleGuard with structured 429 responses
- **File References**: `src/security/multi_dim_throttle.guard.ts:8-64`

### ✅ PASS: Structured Error Responses
- **Finding**: Consistent error format with correlation_id
- **Evidence**: All controllers return structured JSON with correlation_id
- **File References**: `src/user/username.controller.ts:30`, `src/user/profile.controller.ts:20`

### ✅ PASS: PII Redaction
- **Finding**: Audit events redact sensitive data
- **Evidence**: Username, pronouns redacted; profile URLs show host only
- **File References**: `src/user/username.controller.ts:102`, `src/user/profile.controller.ts:25`

### ✅ PASS: Metrics & Traces
- **Finding**: Prometheus metrics and OpenTelemetry spans implemented
- **Evidence**: Comprehensive metrics service with typed helpers
- **File References**: `src/metrics/metrics.service.ts:1-350`

### ❌ FAIL: Dashboards & Alerts Missing
- **Risk**: MEDIUM
- **Finding**: No Grafana dashboards or Prometheus alert rules in repo
- **Expected**: Dashboard JSON templates and PrometheusRule YAML files
- **Remediation**: Create monitoring artifacts from runbook specifications

## Summary of Critical Gaps

### Must Fix (High Risk)
1. **Registration Terms Enforcement** - Registration bypasses terms acceptance requirement
2. **Login/Session Gating** - No enforcement of policy version compliance on API access
3. **Argon2id Password Hashing** - Using weaker bcrypt instead of memory-hard Argon2id
4. **Password Breach Screening** - No protection against compromised passwords

### Should Fix (Medium Risk)  
5. **Username Unique Index** - Database constraint missing for race condition protection
6. **Password Policy Service** - Limited validation beyond minimum length
7. **Monitoring Artifacts** - No dashboards or alerts for operational visibility

### Nice to Fix (Low Risk)
8. **Password Metrics** - Missing observability for password operations
9. **Rehash Strategy** - No automatic upgrade path for password hashes

## Remediation Plan

### Phase 1: Critical Security (2-3 days)
1. Add terms enforcement to registration flow with feature flag
2. Implement session gating middleware for policy compliance
3. Replace bcrypt with Argon2id password hashing
4. Integrate password breach screening service

### Phase 2: Database & Policy (1-2 days)  
5. Add unique index migration for normalizedUsername
6. Implement comprehensive password policy service
7. Add password operation metrics

### Phase 3: Monitoring & Operations (1 day)
8. Create Grafana dashboard templates
9. Add Prometheus alert rules
10. Update documentation and runbooks

## Test Coverage Requirements

### Unit Tests
- Terms enforcement logic with feature flags
- Password policy validation boundaries  
- Username normalization edge cases
- Age threshold validation

### Integration Tests
- Registration with/without terms acceptance
- Username conflict detection
- Password breach screening integration
- Session gating on policy updates

### E2E Tests
- Complete signup → verify → login flow
- Observability assertions (metrics/spans present)
- Rate limiting behavior validation

## CI/CD Impact

- Feature flags required for safe rollout
- Database migrations for unique constraints
- New dependencies: argon2, password breach API
- Environment variable updates for thresholds

## Rollout Considerations

- Stage 1: Deploy with feature flags OFF, validate basic functionality
- Stage 2: Enable terms enforcement in staging with test data
- Stage 3: Canary rollout for password security improvements
- Stage 4: Full observability and monitoring activation

---

**Next Steps**: Proceed to remediation implementation based on prioritized gap analysis.
