# ADR-004: Email OTP for Phone-Only Users

- **Status**: Accepted (2024-10-12)
- **Context**: As KS users transition from phone-only to full account, we need lightweight verification to enable messaging features.
- **Decision**: Reuse existing email OTP issuance flow for onboarding once user adds email, avoiding dual verification systems.
- **Consequences**:
  - Phone-only accounts maintain OTP state in Redis for 10 minutes.
  - Minimal engineering effort; shares rate limiter + templates.
  - Requires UX note clarifying OTP will arrive via email once provided.
