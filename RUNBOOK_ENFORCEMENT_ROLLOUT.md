Staged Rollout Runbook: Require Terms Acceptance

Purpose

This runbook walks through staging, canary, and global enablement of server-side enforcement for policy acceptance (require_terms_acceptance). The enforcement is gated to reduce user disruption and allow monitoring of adoption, invalid attempts, and performance.

Enforcement configuration (environment variables)

- REQUIRE_TERMS_ENFORCE_MODE
  - off: enforcement disabled (default)
  - canary: enforcement enabled only for tenants listed in REQUIRE_TERMS_CANARY_TENANTS
  - global: enforcement enabled for all tenants

- REQUIRE_TERMS_CANARY_TENANTS
  - Comma-separated tenant identifiers to include in the canary group (e.g., "t-123,t-456").

Monitoring metrics to watch

- Prometheus:
  - terms_accepted_total — increases on successful acceptance
  - invalid_terms_version_total — increases when request contains wrong/missing policy_version
  - terms_accept_latency_seconds (histogram) — latency distribution of acceptance endpoint

- Audit events:
  - `legal.accept` events (success/failure) in audit logs. Each event contains: subject (user id), tenant_id, terms_version, outcome, correlation_id.

- Traces:
  - OpenTelemetry spans named `legal.accept` with attributes: correlation_id, tenant_id, subject_id, terms_version, outcome.

Staged rollout steps

1) Prepare
  - Ensure DB migrations are applied in staging. Confirm `terms_version` and `policy_acceptance_history` exist.
  - Ensure `prom-client` is installed or a metrics consumer is available to scrape metrics.
  - Ensure OpenTelemetry collector/Jaeger is configured for the environment.
  - Confirm audit pipeline (logs) available and indexed.

2) Stage: Developer/Staging environment
  - Set `REQUIRE_TERMS_ENFORCE_MODE=canary` and `REQUIRE_TERMS_CANARY_TENANTS` to one internal tenant (or leave empty to only collect metrics)
  - Run acceptance flow end-to-end in staging for tenant(s) in canary.
  - Validate: `terms_accepted_total` increases, `terms_accept_latency_seconds` is within expected ranges, and `legal.accept` audit entries are emitted.

3) Canary: Small subset of production tenants
  - Choose 1-5 low-risk tenants (support/test tenants) and add to `REQUIRE_TERMS_CANARY_TENANTS`.
  - Switch service env to `REQUIRE_TERMS_ENFORCE_MODE=canary` in canary deployment group.
  - Monitor for 24-72 hours:
    - Confirm `terms_accepted_total` and `invalid_terms_version_total` are reasonable (invalid ratio < threshold — agree threshold with legal/compliance teams)
    - Confirm latency histogram stable (no regressions vs baseline)
    - Look for increased error rates or 500s correlated with acceptance endpoint
    - Validate audit events and traces appear in SRE/Compliance dashboards

4) Expand canary
  - If stable, add more tenants progressively (10, then 50) and repeat monitoring window for each scale step.

5) Global enable
  - Set `REQUIRE_TERMS_ENFORCE_MODE=global` across all deployments.
  - Monitor closely for 72 hours for uptake and errors.

6) Removal of gating logic (cleanup)
  - After a stable period (e.g., 30 days) with low invalid ratio and stable latency, schedule a small code change to remove the flag checks to simplify code paths.
  - Include a short deprecation policy and keep the migration/revert plan in case rollback needed.

Rollback plan

- If canary or global rollout shows unacceptable errors:
  - Revert env to `REQUIRE_TERMS_ENFORCE_MODE=off` immediately for the affected deployment group.
  - Run targeted support scripts to revert partially-accepted users if necessary.
  - Open an incident with SRE/Legal to investigate audit logs and traces.

Validation checks (pre-flight)

- DB: users table has `terms_version` and `terms_accepted_at` columns and `policy_acceptance_history` table exists.
- Metrics: Prometheus scraping is configured and `terms_accepted_total` appears after a test acceptance.
- Traces: OpenTelemetry collector receives spans for a test acceptance.
- Logs: `legal.accept` appears in audit log with correct fields and correlation ids.

Contacts

- Backend lead
- SRE on-call
- Legal/compliance owner

Notes

- The enforcement gating returns 200 "enforcement: skipped" payloads for tenants not yet in the canary group to avoid blocking them while still emitting audit/metrics for visibility.
- Keep canary groups small and conservative and monitor adoption and error rates before increasing scope.

*** End of runbook
