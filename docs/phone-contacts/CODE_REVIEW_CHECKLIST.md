# Code Review Checklist: Contact Discovery

- [ ] Normalization: inputs pass through `@colleging/phone-normalization` with country hints.
- [ ] Hashing: SHA-256 helper used; no plain phone numbers logged or stored.
- [ ] Rate limits: existing limiters respected or updated for new endpoints.
- [ ] Prisma migrations: indexes and constraints preserve dedupe guarantees.
- [ ] Privacy logging: ensure sensitive fields redacted before logging/telemetry.
- [ ] Tests: unit/integration tests cover new normalization or matching logic.
- [ ] Feature flags: new functionality behind `contactDiscoveryEnabled` gate.
- [ ] Cleanup: TTL semantics maintained (e.g., update `expires_at`).
