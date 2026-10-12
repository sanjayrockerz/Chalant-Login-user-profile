# Engineering Onboarding: Contact Discovery

## Week 1
- Read `docs/phone-contacts/TECHNICAL_OVERVIEW.md`, `HASHING_OVERVIEW.md`, `NORMALIZATION_GUIDE.md`.
- Set up local env: `npm install`, `cp .env.example .env`, fill Kafka/Redis creds.
- Run `npm run prisma:migrate dev` to provision local DB tables.
- Execute unit tests: `npm run test -- packages/phone-hashing` and `packages/phone-normalization`.

## Week 2
- Shadow on-call engineer for cleanup job monitoring.
- Pair on a small bug (e.g., normalization edge case) and open PR with review checklist.
- Attend privacy training module "Contact discovery safeguards".

## Access
- Request `contact-discovery-dev` IAM role (Jira access ticket).
- Kafka topic read/write via `platform-secrets` vault entry.
- Grafana dashboard access group `contact-discovery-observers`.

## Key Contacts
- Tech Lead: jordan.nguyen@colleging.com
- Product Manager: amy.cho@colleging.com
- Privacy Lead: priya.singh@colleging.com
