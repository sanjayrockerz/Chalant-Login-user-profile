# Oncall Procedures — Auth & Identity

Purpose

This document outlines oncall steps for incidents related to signup, identity, username flows, and related alerts. It assumes dashboards and alerts described in the runbook are in place and that correlation_id tracing is present in logs.

Pager response
- Owner: auth-backend-team oncall
- Pager channel: #pager-auth

Initial triage
1. Acknowledge the alert and post an initial triage note in the SEV channel including the alert name, time, and any immediate symptoms.
2. Gather recent alert context and correlate with feature flag changes (who changed what and when).
3. Identify a few representative correlation_ids from logs to trace full request lifecycle.

Tracing and diagnostics
- Use correlation_id to pull traces from the OpenTelemetry collector or APM UI.
- Inspect request logs for the same correlation_id to find any error stack traces, audit events, or downstream failures (email provider, DB latency).
- Check Prometheus panels: signup success rate, OTP latency, username_conflicts_total, http_errors_total.

Mitigation steps
- If the issue aligns with a recent flag change, perform an immediate flag revert for the affected tenants.
- Consider temporarily increasing rate limits in a controlled manner.
- If email delivery is impacted, switch to a backup provider or pause email verification step and escalate to infra.

Post-incident
- Record timeline, actions taken, and outcome in SEV ticket.
- Add evidence (traces, logs, Prometheus snapshots) and link to the policy changelog entry.
- Follow up with a postmortem and update the runbook or alert thresholds if needed.

