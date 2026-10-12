# Phone Contact Hashing Privacy Brief

## Scope
- Applies to phone identifiers processed by personal-email-signup-backend contact discovery APIs.
- Covers separation of duties between primary user profile phones (`users.phone`) and address book uploads (`hashed_contacts.hashed_phone`).

## Data Handling Model
### User Profile Phones
- Store raw E.164 number in `users.phone` (plaintext or database-native encryption) for OTP delivery and recovery flows.
- Derive and persist deterministic hash in `users.hashed_phone` using unsalted SHA-256 for lookup parity with uploaded contacts.
- Restrict access via least-privileged roles; auditing required for every read of `users.phone`.

### Uploaded Contacts
- Device clients MUST normalize phones to E.164 before upload; server re-validates format prior to hashing.
- Server computes unsalted SHA-256 digest (hex encoded) and stores only the 64-character hash in `hashed_contacts.hashed_phone`.
- Raw phone inputs are retained in memory only for the duration of normalization; they are never persisted, logged, or forwarded to analytics.
- Upload APIs reject payloads that bypass normalization or attempt to include plaintext phones.

## Cryptographic Approach
- Algorithm: SHA-256 without salt to enable cross-user deterministic matching.
- Output: Lowercase hexadecimal digest (length 64) suitable for existing `VARCHAR(64)` schema.
- Verification: Server recomputes digest from normalized input and performs timing-safe comparison.

## Risk Posture
### Rainbow Tables
- Unsalted SHA-256 is susceptible to precomputed rainbow tables, particularly for finite national numbering plans (e.g., all +1 NANP numbers).
- Decision: Accept risk for MVP to unlock deterministic matching; mitigate via operational controls enumerated below.

### Pseudonymization Status
- Hashes remain personal data under GDPR/CCPA because attackers can re-identify individuals using auxiliary information.
- Treat hashed phones as **pseudonymized**, not anonymized: subject to retention limits, DSAR fulfillment, and security safeguards.
- Incident response, breach notifications, and privacy notices must reference hashed phones as protected personal data.

## Security Safeguards
- **Rate Limiting**: Apply per-user and global throttles on contact uploads to constrain enumeration throughput.
- **Abuse Detection**: Flag sequential or dictionary-style phone submissions (e.g., monotonically increasing numbers) for manual review.
- **Transport Security**: Enforce TLS 1.2+ for all APIs; disallow plaintext transport of phone identifiers.
- **Telemetry Hygiene**: Mask or remove phone identifiers (raw and hashed) from logs, error traces, metrics, and APM providers; log counts and correlation identifiers only.
- **Access Controls**: Limit hash query interfaces to backend services with documented purpose; disable ad-hoc SQL access paths.

## Compliance Considerations
- Document hashing workflow in Records of Processing Activities (RoPA) specifying purpose: "contact discovery matching".
- Set retention window for `hashed_contacts` consistent with user consent (default 90 days unless user extends).
- Support data subject rights: deletion requests must purge contact hashes and their derived matches.
- Update privacy policy to explain that contact hashes enable matching but are not reversible to phone numbers under normal circumstances.

## Operational Requirements
- Maintain automated tests validating SHA-256 digests for representative country codes.
- Include privacy review checklist (see `PHONE_CONTACT_HASHING_SECURITY_CHECKLIST.md`) in release gates.
- Trigger security review before GA to evaluate potential adoption of peppering or advanced cryptographic matching schemes.

## Future Enhancements
1. **Application Pepper**: Introduce HMAC-SHA-256 with server-managed secret to defeat rainbow tables while retaining determinism (requires key rotation plan).
2. **Secure Computation**: Evaluate private set intersection (PSI) or homomorphic encryption to eliminate server visibility of hashes.
3. **Tiered Hashing**: Dual-mode hashing with unsalted baseline and optional peppered layer for higher risk cohorts.
4. **Client Hardening**: Expand mobile SDK to hash locally and transmit only digests, reducing exposure window on the wire.

## Decision Log Snapshot
- Current state: Unsalted SHA-256 with operational mitigations; aligned with product timeline for MVP launch.
- Reassessment trigger: Any contact discovery expansion beyond 1M users, detection of organized enumeration attempts, or regulatory feedback requiring stronger pseudonymization.

## Approval Workflow
- 2025-10-17: Privacy brief circulated to Legal & Compliance mailing list (`privacy-review@company.example`, `compliance@company.example`) with request for formal sign-off prior to GA.
- Pending actions: incorporate feedback in the next revision and record approval outcome in this section.
