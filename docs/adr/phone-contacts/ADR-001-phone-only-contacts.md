# ADR-001: Phone-Only Contacts

- **Status**: Accepted (2024-10-10)
- **Context**: Some user segments (teens, new markets) provide phone numbers before email.
- **Decision**: Allow contact uploads without verified email by gating on phone verification + parental consent for minors.
- **Consequences**:
  - Need fallback identifier to tie uploads to `users` record (phone-based auth token).
  - Additional abuse monitoring required; implemented per-runbook alerts.
  - Email-only accounts continue to see feature disabled until phone added.
