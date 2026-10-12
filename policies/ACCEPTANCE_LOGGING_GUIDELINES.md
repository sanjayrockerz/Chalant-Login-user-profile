# Acceptance Logging & Redaction Guidelines

Purpose: describe how to log policy acceptance events while minimizing PII exposure and keeping logs useful for operations and audit.

Guidelines

1. Minimal fields in logs
- Log only the following fields for acceptance events:
  - `user_id` (UUID or internal ID)
  - `policy_version` (string)
  - `accepted_at` (timestamp)
  - `event_id` (UUID) for traceability
  - `source` (optional, e.g., "web", "mobile", "api")

2. Never log PII
- Do not log email addresses, names, IP addresses, or other personal identifiers in policy acceptance logs.
- If an operational need arises (e.g., support ticket), redact PII before adding it to logs and restrict access to the logs.

3. Trace context and correlation
- Include tracing identifiers (trace_id/span_id) but avoid including full request headers with personal data.
- Use the `user_id` only as an internal identifier; treat it as PII in access controls but acceptable to store in logs if necessary.

4. Retention and access
- Keep acceptance logs and audit tables with a retention policy aligned with legal and compliance (e.g., 7 years or per legal requirement).
- Access to logs containing `user_id` must be limited to authorized personnel and audited.

5. Example log entry (structured JSON)

```json
{
  "event": "policy_acceptance",
  "event_id": "e7f3...",
  "user_id": "a3f3...",
  "policy_version": "v2025-10-07-1",
  "accepted_at": "2025-10-07T12:34:56Z",
  "source": "web",
  "trace_id": "abcd..."
}
```

6. If using external observability (SaaS), ensure logs are encrypted at rest and subject to data processing agreements.

7. Redaction examples
- Replace emails with `<redacted-email>` or omit entirely.
- When copying logs to external issue trackers, always scrub PII.
