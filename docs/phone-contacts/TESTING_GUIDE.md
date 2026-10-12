# Testing Guide

## Unit Tests
- `npm run test -- packages/phone-normalization`
- `npm run test -- packages/phone-hashing`
- `npm run test -- services/personal-email-signup-backend/src/contacts`

## Integration Tests
1. Start local stack (`docker compose up` for Postgres, Redis, Kafka).
2. Run `npm run test:integration -- services/personal-email-signup-backend`.
3. Focus cases: upload -> suggestion pipeline, cleanup job TTL enforcement, GDPR delete flow.

## Load Testing
- Tooling: k6 script `scripts/load/contact-upload.js`.
- Targets: 10k requests/min, p95 < 100 ms.
- Run in staging before release; capture metrics in `PERFORMANCE_SUMMARY.md`.

## Manual QA
- Toggle feature flag via admin panel.
- Upload sample contacts from test device; confirm suggestions appear only for mutual matches.
- Trigger "Delete contacts" action; verify `hashed_contacts` rows removed and suggestions cleared.

## Release Checklist
- Ensure migrations applied (`npm run prisma:migrate deploy`).
- Confirm Grafana alerts green for 48 h in staging.
- Privacy sign-off recorded (see `PRIVACY_AND_COMPLIANCE.md`).
