# Runbook: Rollout for Username, Identity, Terms Enforcement, and Password Screening Feature Flags

This runbook documents the safe rollout process for enabling enforcement features that affect onboarding flows: Terms enforcement, identity gating (declared age / profile fields), username normalization/denylist enforcement, and password screening. Follow this plan to roll out in Staging, then Canary slices in Production, and finally Global enablement.

Owners
- Release Manager: <name>
- On-call Service Owner: auth-backend-team
- Observability Lead: infra-observability
- Privacy / Legal contact: privacy-team

Feature flags involved (example names)
- REQUIRE_TERMS_ENFORCE_MODE (values: off, staging, canary, global)
- REQUIRE_USERNAME_NORMALIZATION (boolean)
- REQUIRE_USERNAME_DENYLIST (boolean)
- REQUIRE_IDENTITY_VALIDATION (boolean)
- REQUIRE_PASSWORD_SCREEN (boolean)
- CANARY_TENANTS (list) - tenant ids allowed in canary

Goals & Constraints
- No regression in overall signup success rate, OTP latency, or login success.
- Monitor and limit username enumeration and spoofing vectors.
- Enforce privacy-preserving audits (redacted values) and avoid logging secrets.
- Keep feature flags enabled in a canary slice until stability windows pass, then remove flags after global enablement.

Prerequisites
- CI pipelines updated to run unit, contract, e2e and smoke tests with the feature flags toggled on (staging/canary config sets).
- Monitoring dashboards are available: Signup Overview, Identity Validation, Username Flows, Auth Latency, Rate Limiting.
- Alerts pre-created (see section "Suggested Prometheus Alerts").
- Backups and database migration runbooks available (for Prisma schema changes).

Staging Validation (smoke & functional)
1. Enable all flags in the Staging environment. Use the same rolling mechanism as production feature flags manager.
2. Run CI: unit tests, contract tests and full backend e2e smoke tests (tests must pass in staging with flags on). Record run ids and test outputs.
3. Validate basic flows manually or via automated smoke suite for a 30‑minute window:
   - New registration with and without optional identity fields.
   - Username availability checks and set/update.
   - Pronoun/profile image set operations.
   - Email OTP issuance and verification.
   - Login flow (token issuance, cookie placement).
4. Collect evidence (attach artifacts): CI run logs, e2e test artifacts, example request traces (correlation_id), audit events and registries.
5. If any test fails, revert flags in staging and open a bug with failure evidence. Do not proceed to canary until resolved.

Canary Rollout (Production slices)
Overview: Roll out to narrow slices (by tenant or percentage) and expand progressively if monitoring metrics are stable.

Slice definitions (prioritized):
- Tenant-based canary: add up to N tenants (e.g., 5 tenants) in CANARY_TENANTS list.
- Percentage canary (if supported by flags platform): 0.5% → 2% → 10% → 50% → 100%.

Canary Step Template
- Step 0: Preflight (baseline capture)
  - Capture 1h baseline for key metrics (see Monitoring section). Save queries & values.
- Step 1: Enable flags for first canary slice (tenant-based or 0.5% traffic) at T0.
- Step 2: Immediate smoke validation (0–15 minutes): run smoke tests and verify no 500s for critical endpoints.
- Step 3: Short-window verification (15–60 minutes): verify no alerts and metrics within acceptable thresholds.
- Step 4: Expand slice (if stable) to next percentage / tenant group and repeat Step 0–3.

Stability windows
- After each expansion, keep a monitoring window of 60 minutes for short checks and 4 hours for sustained stability before larger expansions.
- For larger expansion steps (e.g., 10% → 50%) require 24‑hour stability and SLO checks.

Monitoring — Key Metrics and PromQL examples
Capture and monitor these during canary and staging. Store query results in run evidence (screenshots, Query output, timestamps). Replace labels as appropriate for your metrics naming conventions.

- Signup success rate (rolling 5m)
  promql: (sum(rate(signups_total[5m])) / sum(rate(http_requests_total{route=~"/api/register|/register"}[5m]))) * 100
  target: <= 1% relative drop vs baseline

- Identity validation failures (absolute and rate)
  promql: sum(rate(identity_validation_failures_total[5m]))
  target: no spike > 3x baseline

- Username conflicts
  promql: sum(rate(username_conflicts_total[5m]))
  target: no sustained increase > 5x baseline; short bursts may be investigated

- Password screening failures
  promql: sum(rate(password_policy_failures_total[5m]))
  target: expected increases if policy tightened; investigate user impact if signup success drops >1% absolute

- OTP issuance latency
  promql: histogram_quantile(0.95, sum(rate(otp_operation_duration_ms_bucket[5m])) by (le))
  target: 95th percentile under 2s (or within 25% of baseline)

- Login success rate
  promql: (sum(rate(login_success_total[5m])) / sum(rate(login_attempts_total[5m]))) * 100
  target: no regression >1% absolute

- Route latency heatmap (example for username endpoints)
  promql: histogram_quantile(0.95, sum(rate(request_latency_seconds_bucket{route=~"/username.*"}[5m])) by (le))
  target: 95th percentile under 500ms

- Rate-limit saturation
  promql: sum(rate(http_errors_total{type=~"rate_limited_.*"}[5m]))
  target: low; investigate spikes (could be expected if enforcement is strict)

- Correlation-trace sampling: collect representative traces for registration, username set, and profile update flows (with correlation_id). Verify spans exist and have no internal errors.

SLOs and graduation criteria
- No alert firing for any critical alert during the stability window.
- Signup success rate within 1% relative of baseline for the 4h window (for >10% traffic) or 24h for large expansions.
- OTP 95th percentile latency within 25% of baseline for the stability window.
- Username_conflicts_total not exceeding 5x baseline for more than 15 minutes.

Rollback triggers (immediate)
- Any critical alert firing (severity=critical) related to signup, authentication, or email delivery.
- Signup success rate drops by >1.5% absolute in a 30-minute window (unless explained by expected policy tighten that was pre-approved).
- OTP 95th percentile latency > 2x baseline for more than 15 minutes.
- Sustained increase in rate-limited errors suggesting denial of service on legitimate users.

Rollback procedure
1. Immediately revert the feature flag to previous state for the affected slice (turn off or set to staging as appropriate).
2. Create a SEV ticket and notify on-call and release manager via paging channel.
3. Collect diagnostics: recent traces (correlation_id), alerts, logs, and request samples.
4. Apply mitigations (increase rate limits for short-term, disable denylist, or relax password policy) if safe and iterate.
5. After root cause is identified and fixed, retry canary from the step where it failed.

Evidence capture & audit trail
- For each canary step, collect and store:
  - Feature flag change event (who, when, previous value, new value)
  - CI run ids and test artifacts
  - Prometheus query outputs (baseline and after change) for the key metrics above
  - Representative OpenTelemetry traces (with correlation_id)
  - Audit events showing the enforcement (counts, sample events with redaction)
  - Runbook sign-off by Release Manager & Service Owner

Post-global enablement
- After global enablement and satisfactory stability, schedule a task to remove the feature flags from code/config to simplify runtime (see "Feature Flag Removal Checklist" below).
- Keep archived evidence in a canonical audit folder with run id and a short findings summary.

Feature Flag Removal Checklist
- Ensure code paths guarded by flags have tests asserting behavior with feature flag on/off.
- Remove conditional branches guarded by flags in a single follow-up PR and run full CI including contract/e2e.
- Keep a short feature-flag removal checklist in the PR description and link to runbook evidence.

Example Runbook entry (template to fill each canary step)
- Step number & slice: 1 — Tenant IDs: [t-a, t-b]
- Start time: 2025-10-08T10:00:00Z
- Flag changes: REQUIRE_USERNAME_NORMALIZATION: false -> true (staging->canary)
- CI runs: [link], status: passed
- PromQL baselines: [attach outputs]
- Observed after 60m: signup success delta: +0.1%, username_conflicts_total: 12 (baseline 4), otp_95p: +0.03s
- Decision: expand to next slice (yes/no): yes
- Notes: ...

Suggested Prometheus Alerts (examples)
- ALERT: HighSignupFailureRate
  expr: (1 - (sum(rate(signups_total[5m])) / sum(rate(http_requests_total{route=~"/api/register|/register"}[5m])))) > 0.015
  for: 5m
  labels: severity=critical
  annotations: summary, runbook link

- ALERT: OTPLatencyRegression
  expr: histogram_quantile(0.95, sum(rate(otp_operation_duration_ms_bucket[5m])) by (le)) > (baseline_otp_95p * 2)
  for: 10m
  labels: severity=critical

- ALERT: UsernameConflictsSpike
  expr: sum(rate(username_conflicts_total[1m])) > (5 * avg_over_time(sum(rate(username_conflicts_total[1m]))[1h:1m]))
  for: 5m
  labels: severity=warning

- ALERT: RateLimitSaturation
  expr: increase(http_errors_total{type=~"rate_limited_.*"}[5m]) > 50
  for: 2m
  labels: severity=warning

Runbook Sign-off
- Release Manager signature: ____________________
- Service Owner signature: ____________________
- Observability Lead signature: ____________________
- Date/time: ____________________

Appendix: Useful queries & dashboards
- Signup overview dashboard panels: signup success rate, signup latency histogram, signups by tenant
- Username flows dashboard: availability latency, set latency, conflicts per minute, denylist hits
- Identity validation dashboard: validation failure reasons, underage rejects
- Audit event dashboard: counts per event type (username.set, pronouns.set, profile_image.set, identity.validation)

Notes
- Adjust thresholds to reflect historical baselines for your production environment.
- Keep legal and privacy teams in the loop when making policy changes that affect user identity fields.

