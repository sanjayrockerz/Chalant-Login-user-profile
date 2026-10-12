# Phone Contact Hashing Security Review Checklist

Use this checklist before releasing changes that touch contact hashing, ingestion, or matching subsystems.

## Implementation Validation
- [ ] `hash()` utility enforces E.164 input and produces 64-character lowercase SHA-256 digest.
- [ ] `verify()` performs timing-safe comparisons and rejects malformed digests.
- [ ] Unit tests cover canonical digests, invalid input rejection, and verification failure paths.
- [ ] Normalization pipeline guarantees E.164 formatting prior to hashing (server-side revalidation in place).
- [ ] Database schema stores hashed phones in `VARCHAR(64)` columns with appropriate indices.

## PII Handling Controls
- [ ] Logs, traces, and metrics redact or omit both raw phones and their hashes; only aggregate counts and correlation IDs remain.
- [ ] Contact upload endpoints clear raw phone data from memory after normalization.
- [ ] Data retention policies purge `hashed_contacts` rows and derived matches per consent window.
- [ ] Access controls restrict who can query hashed phone tables or matching APIs.

## Abuse and Enumeration Mitigations
- [ ] Per-user and global rate limits are enforced on contact upload endpoints; limits validated in staging.
- [ ] Anomaly detection alerts on sequential or dictionary-style uploads (e.g., +1234567890, +1234567891).
- [ ] Monitoring dashboards track upload failure rates, throttle events, and suspicious patterns.
- [ ] Incident response runbooks cover suspected enumeration attempts.

## Transport and Storage Security
- [ ] All contact upload routes require HTTPS/TLS with HSTS enabled at the edge.
- [ ] Secrets used for future peppering or key derivation reside in secure vaults (placeholder if not yet implemented).
- [ ] Database backups containing hashed phones are encrypted and access logged.

## Compliance Alignment
- [ ] GDPR/CCPA documentation states hashed phones are pseudonymized data subject to user rights.
- [ ] Records of Processing Activities (RoPA) updated with contact hashing purpose and retention.
- [ ] Data Subject Access Request (DSAR) flow includes hashed phone deletion and export handling.

## Release Gate
- [ ] Security and privacy teams sign off on the current release.
- [ ] Known limitations (e.g., rainbow table exposure) documented in release notes with mitigation reminders.
- [ ] Future roadmap (pepper, PSI, etc.) tracked in security backlog for quarterly review.

## 2025-10-17 Review Notes
- Rate limiting coverage verified: signup API enforces per-user (5/min), per-IP (60/hr), and device-ID (20/hr) thresholds; alert `rate_limit_breach_total` wired to on-call channel.
- Anomaly detection tuned: sequential phone submissions scored via abuse heuristics; events surfaced in `contacts_enumeration_suspect` dashboard with ≥3 consecutive increments raising PagerDuty warnings.
- Telemetry validation confirmed: no raw identifiers leave `contacts` service logs; only aggregate counters and correlation IDs recorded for throttling and anomaly investigations.
