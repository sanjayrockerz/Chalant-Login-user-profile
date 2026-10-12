# Phone Hashing Overview

## Algorithm
- SHA-256 with hex encoding (`crypto.createHash('sha256')`).
- Input string: lowercased E.164 number (no spaces, punctuation).
- Output: 64-character hexadecimal digest.

## Functions
- `hashPhone(input: string): string`
- `verifyHash(input: string, digest: string): boolean` (timing-safe comparison)
- Source: `packages/phone-hashing/index.ts`

## Rationale
- SHA-256 balances collision resistance and library availability.
- Salt omitted to allow matching across uploads; protected through strict rate limits, TLS, and hashing privacy controls documented in `docs/security/PHONE_CONTACT_HASHING_SECURITY_CHECKLIST.md`.

## Usage
- API layer hashes incoming contacts before persistence.
- Backfill job (`jobs/backfill-user-hashed-phone.ts`) recomputes user `hashed_phone` values after normalization changes.

## Storage
- `users.hashed_phone` used for direct match queries.
- `hashed_contacts.hashed_phone` stores imported contact hashes with TTL metadata.

## Security
- Rate limits throttle uploads per-user and per-device to reduce brute force attempts.
- Hashes never leave secure network; analytics exports aggregate counts only.
- Access to hashed data is restricted via RBAC group `contact-discovery-readonly`.
