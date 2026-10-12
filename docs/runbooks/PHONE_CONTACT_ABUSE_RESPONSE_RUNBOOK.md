# Runbook: Abuse Response (Contact Discovery)

## Incident Signals
- Spike in contact upload errors flagged by Security Ops.
- Alert on `contact_upload_rate_limited_total` > 10k/hour.
- Reports of unsolicited connection spam.

## Investigation
1. Review suspicious accounts via `SELECT user_id, count(*) FROM hashed_contacts WHERE uploaded_at > now() - interval '1 hour' GROUP BY 1 ORDER BY 2 DESC LIMIT 20;`
2. Cross-check with Trust & Safety reports.
3. Inspect logs for IP/device clustering (ELK search `abuse.contact`).

## Mitigation
- Temporarily disable feature flag for affected segment using LaunchDarkly key `contactDiscoveryEnabled`.
- Increase per-user rate limiter via config `CONTACT_UPLOAD_RATE` (e.g., from 5/hr to 2/hr).
- Block offending accounts: `UPDATE users SET is_verified = false WHERE id IN (...);`
- If necessary, rotate Kafka consumer API keys.

## Post-Incident
- File RCA within 48 h.
- Add detection rules to `Security > Contact Discovery` dashboard.
- Coordinate with Comms for user messaging if abuse impacted >1k users.
