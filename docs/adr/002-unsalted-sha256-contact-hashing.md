# ADR-002: Unsalted SHA-256 for Contact Hashing MVP

## Status
- **Status**: Accepted (MVP scope)
- **Date**: 2025-10-17
- **Decision Makers**: @privacy-eng-lead, @security-architect, @signup-pm
- **Consulted**: @infra-team, @compliance-counsel
- **Informed**: Contact discovery feature crew

## Context
- Contact discovery requires deterministic hashes across all users to enable phone number matching.
- Platform must minimize persistence of raw phone numbers while supporting OTP flows that need plaintext storage for the primary user phone.
- Time-to-market constraint for MVP release is six weeks; complex cryptographic protocols (PSI, HMAC peppering) exceed available engineering bandwidth.
- Existing database schema provisions `hashed_contacts.hashed_phone` as `VARCHAR(64)`.

## Decision
- Use unsalted SHA-256 hashing on E.164-normalized phone numbers for uploaded contacts and `users.hashed_phone`.
- Expose a shared utility (`hash`, `verify`) enforcing E.164 inputs and timing-safe comparisons.
- Document rainbow table exposure risk and compensating operational controls (rate limiting, anomaly detection).
- Plan formal security review before GA to evaluate migration to peppered or PSI-based schemes.

## Rationale
1. **Deterministic Matching**: Unsalted hashing ensures identical phone numbers across users hash to the same digest, enabling direct joins without per-user salt reconciliation.
2. **Implementation Simplicity**: SHA-256 is available in Node.js core, reducing dependencies and complexity under compressed timeline.
3. **Schema Compatibility**: 64-character hex digest fits existing columns without migration.
4. **Operational Mitigations**: Rate limits and anomaly detection reduce feasibility of large-scale rainbow table exploitation.
5. **Transparency**: Clear privacy documentation acknowledges pseudonymized status and residual risks.

## Alternatives Considered
### Per-User Salted Argon2id
- **Pros**: Strong rainbow table resistance, slower brute-force attacks.
- **Cons**: Breaks deterministic matching; requires salt exchange between users; higher compute cost.
- **Verdict**: Deferred for future redesign once secure multi-party matching is feasible.

### HMAC-SHA-256 with Platform Pepper
- **Pros**: Maintains determinism while thwarting precomputed tables if pepper remains secret.
- **Cons**: Introduces key management, rotation procedures, and increases blast radius of key compromise.
- **Verdict**: Logged as upgrade path after secret management enhancements are delivered.

### Private Set Intersection (PSI)
- **Pros**: Best privacy; server never sees raw identifiers or hashes.
- **Cons**: Significant protocol complexity, requires client and server changes, challenging to audit.
- **Verdict**: Long-term goal; out of scope for MVP timeline.

## Consequences
### Positive
- Accelerated delivery of contact discovery MVP.
- Reusable hashing utility with unit tests improves developer ergonomics.
- Clear documentation streamlines compliance review.

### Negative
- Accepts rainbow table vulnerability for public numbering plans.
- Requires ongoing monitoring to detect enumeration attempts.
- Hashes remain personal data under GDPR/CCPA; no reduction in regulatory obligations.

### Neutral
- Future migrations may necessitate backfilling hashes if peppering is later introduced.
- Additional secrets infrastructure work deferred to future quarter.

## Acceptance Criteria for Re-Evaluation
- Evidence of attempted or successful enumeration attacks.
- Launch readiness review for GA or user base exceeding 1 million active users.
- Availability of managed secret rotation service supporting low-latency HMAC operations.
- Regulatory guidance mandating stronger pseudonymization for phone identifiers.

## Follow-Up Actions
- Track upgrade options in security backlog: peppered HMAC, PSI proof-of-concept, client-side hashing.
- Schedule quarterly review with privacy and security stakeholders to reassess risk posture.
- Ensure rate limiting and anomaly detection telemetry is available to security operations.

## Approvals
- 2025-10-17: ADR shared with Legal & Compliance for acknowledgment alongside privacy brief; approval status pending.
- Owners: @privacy-eng-lead to capture formal sign-off in decision log once received.
