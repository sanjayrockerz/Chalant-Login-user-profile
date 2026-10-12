# Policy Activation Procedure

Purpose: This procedure ensures the `active_policy_version` flips only after Terms and Privacy content are live and the activation is auditable.

Pre-activation checklist
1. Legal approves the content and publishes canonical URLs for Terms and Privacy (e.g., `https://example.com/terms/...`).
2. Engineering ensures the URLs are reachable and the content is served over HTTPS.
3. QA verifies that the rendered pages show the correct content and version identifier.

Activation steps
1. Legal creates the canonical `policy_version` string (e.g., `vYYYY-MM-DD-N`) and provides the canonical URLs.
2. Engineer runs the activation command (requires admin privileges on the monorepo):

```bash
# Update the policy register in repo and commit
# Edit policies/POLICY_REGISTER.md to set active_policy_version, canonical urls, activated_at and activated_by
git add policies/POLICY_REGISTER.md
git commit -m "Activate policy_version vYYYY-MM-DD-N: publish canonical terms & privacy"
git push origin main
```

3. After push, the engineer creates a changelog entry (see `POLICY_CHANGELOG.md` template).
4. Notify product, legal, ops, and release-engineering via the usual channels.

Post-activation verification
- Check the `policies/POLICY_REGISTER.md` file in the `main` branch is updated and accessible.
- Confirm public URLs return 200 OK and contain the `policy_version` string.
- Verify user-facing UIs reference the `active_policy_version`.

Observability & verification (canary)
- Deploy services to a canary environment with `REQUIRE_TERMS_ENFORCE_MODE=canary` and `REQUIRE_TERMS_CANARY_TENANTS` set to the small tenant list.
- Verify metrics are reporting for acceptance flows:
	- `terms_accepted_total` should increment when users accept.
	- `invalid_terms_version_total` should remain near zero.
	- `terms_accept_latency_seconds` histogram should show expected percentiles (p50/p95).
	- Use the service `/metrics` endpoint or Prometheus to query: `rate(terms_accepted_total[5m])`.
- Verify audit events are emitted for `legal.accept` and for `policy_enforcement_block` where applicable by searching the audit logs (Loki/Kafka) for `service="auth-service" action="legal.accept"` and `action="policy_enforcement_block"`.

Rollback steps (if canary shows elevated failures or mismatches)
1. Revert `policies/POLICY_REGISTER.md` to the previous `active_policy_version` and push the change:

```bash
# Edit policies/POLICY_REGISTER.md and set active_policy_version back to the previous value
git add policies/POLICY_REGISTER.md
git commit -m "Revert active_policy_version to vYYYY-MM-DD-M due to canary regression"
git push origin main
```

2. Create a changelog entry documenting the rollback (append to `policies/POLICY_CHANGELOG.md`) with `change_summary` explaining the reason and evidence.
3. Notify Legal/Prod/Ops and roll back any UI-side enforcement banners/messages if deployed.
4. Investigate root cause and prepare a corrected policy payload or fix to acceptance flow before re-attempting activation.

Rollback
- If activation was premature, create a new reverted activation commit pointing to the previous `active_policy_version` and add a changelog entry explaining the rollback.
