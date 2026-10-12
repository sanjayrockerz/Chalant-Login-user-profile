# Policy Activation Runbook

Purpose

This runbook describes the steps to activate a new policy_version (e.g., Terms & Privacy changes) and how to record evidence for audit purposes. It aligns with feature-flag based enforcement and the canary rollout plan in `policies/RUNBOOK_USERNAME_IDENTITY_ROLLOUT.md`.

Activation steps
1. Prepare the policy artifact
   - Ensure the new Terms & Privacy content is available at the canonical public URL.
   - Create a policy_version identifier (iso8601 date + short hash), e.g., `v2025-10-08-1`.
2. Create a PR with the policy files
   - Add the policy file in `policies/` and reference the policy_version in `policies/POLICY_REGISTER.md`.
   - Include acceptance migration notes if database fields change.
3. CI verification
   - Run unit tests, contract tests and policy-specific validators (linting, link checks) in CI.
4. Staging activation
   - Update the feature flag manager or staging config to set enforcement mode to `staging`.
   - Run staging smoke tests and capture traces and logs for a 30m window.
   - Record the acceptance event in the database where appropriate.
5. Canary activation
   - Follow the canary steps in `RUNBOOK_USERNAME_IDENTITY_ROLLOUT.md` to expand carefully.
6. Global activation
   - After successful canary and sign-offs, update `policies/POLICY_REGISTER.md` with the `active_policy_version` and mark `active_policy_is_material: true` if needed.
   - Set feature flags to `global` (or remove their gating in a separate PR following the feature flag removal checklist).

Evidence to capture
- Policy PR and merge details (PR id, commit sha)
- CI run logs and test artifacts
- Feature flag change events (who, when, previous value, new value)
- Acceptance DB records (timestamps, user IDs if applicable)
- Prometheus query outputs and dashboard screenshots for the stability windows
- Representative traces and correlation IDs for key flows
- Runbook sign-off signatures

Rollback considerations
- If policy activation triggers regressions per runbook thresholds, revert the flag and follow the Rollback Playbook `ROLLOUT_ROLLBACK_PLAYBOOK.md`.

