# Rollout Rollback Playbook

Scope

This playbook covers rolling back enforcement changes (feature flags or policy activations) when canary or global rollout shows regressions. It is an operational checklist for Release Managers and on-call engineers.

Immediate criteria for rollback
- Critical alerts fired for signup/auth flows
- Signup success rate degradation beyond allowed threshold
- OTP latency regression beyond allowed threshold
- Sustained rate-limit saturation blocking legitimate users

Quick rollback steps (first 30 minutes)
1. Immediately set `REQUIRE_*` flags to the prior state for the affected slice (tenant list or percentage).
2. If feature flag manager supports targeted toggles, restrict to affected tenant(s) only.
3. If the change included a DB migration with destructive steps, follow DB rollback runbook (separate doc).
4. Notify stakeholders and create SEV ticket with correlation IDs and initial findings.
5. If the regression is severe (major outage), consider global flag revert and emergency change control.

Post-rollback investigations (next 24–72 hours)
1. Gather traces (correlation_ids), request logs, Prometheus ranges and alert histories.
2. Create a timeline of events and compare before/after metrics (baseline vs post-change).
3. Reproduce failure in staging if possible with a subset of traffic.
4. Consider temporary mitigations: relaxing rate-limits, disabling denylist enforcement, or relaxing password screening.

Automated rollback helpers
- Provide runbook scripts or CLI to toggle flags quickly (example: `ffctl set REQUIRE_USERNAME_DENYLIST false --env=prod --tenants=t1,t2`).
- Integrate flag toggles with CI/CD for audited changes.

Communications
- Use the SEV channel and notify on-call and release manager.
- Post an incident update with next steps and expected ETA.

Follow-up
- Do a postmortem within 72 hours and record findings in the changelog.
- Re-assess the rollout plan and adjust stability windows and thresholds.

