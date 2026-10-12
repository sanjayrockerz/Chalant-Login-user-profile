# ADR-002: SHA-256 Unsalted Hashing

- **Status**: Accepted (2024-09-25)
- **Context**: Need deterministic hash for cross-user matching without sharing plaintext.
- **Decision**: Use unsalted SHA-256, rely on strict rate limiting, transport security, and RBAC for protection.
- **Consequences**:
  - Enables simple equality matching and database indexes.
  - Requires comprehensive monitoring for brute-force attempts.
  - Documented in `docs/security/PHONE_CONTACT_HASHING_SECURITY_CHECKLIST.md` and privacy addendum.
