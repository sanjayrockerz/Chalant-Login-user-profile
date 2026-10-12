# Phone Contact Sync Overview

## Architecture Diagram
```mermaid
digraph G {
  rankdir=LR;
  Mobile["Mobile App\n(E.164 Normalization)"];
  API["Contact Sync API\n(REST /v1/contacts:upload)"];
  Queue["Kafka Topic\ncontact_uploads"];
  Worker["Contact Worker\n(Node.js)"];
  Prisma["Prisma Client"];
  DB["PostgreSQL\nusers / hashed_contacts / contact_suggestions"];
  Cache["Redis\nOTP + Rate Limits"];

  Mobile -> API -> Queue -> Worker -> Prisma -> DB;
  API -> Cache;
  Worker -> Cache;
}
```

## Lifecycle
1. **Mobile upload** bundles phone numbers after local consent, normalizes to E.164, and batches (max 500 contacts per request).
2. **API** validates rate limits, applies secondary normalization, hashes each number, and publishes the payload into `contact_uploads` Kafka topic.
3. **Worker** consumes the topic, performs idempotent upserts into `hashed_contacts`, and triggers suggestion generation jobs.
4. **Suggestion service** compares incoming hashes with `users.hashed_phone` and existing `hashed_contacts` to create `contact_suggestions` records.
5. **Cleanup job** runs daily, deleting expired hashes older than 30 days and pruning stale suggestions after acceptance or expiration.

## Key Components
- `packages/phone-normalization`: shared library providing strict E.164 formatting.
- `packages/phone-hashing`: SHA-256 hashing + timing-safe comparison helpers.
- `services/personal-email-signup-backend`: houses API routes, Prisma models, and background workers.
- PostgreSQL schema: `users`, `hashed_contacts`, and `contact_suggestions` tables with dedicated indexes for dedupe, feed, and TTL flows.
- Contact matching pipeline chunks hashed lookups in batches of 100 to keep database fan-out predictable, classifies matches as mutual vs. one-sided based on reciprocal hashes, honors block lists in either direction, and emits Prometheus metrics (`contacts_matches_found_total`, `contacts_matching_duration_seconds`) for observability.

## Data Retention
- Hashed contact rows expire after 30 days via cleanup job (`jobs/prune-hashed-contacts.ts`).
- Contact suggestions promote user discovery; suggestions marked `stale = true` are deleted after 14 days to limit exposure.
- Raw phone numbers never persist server-side; only SHA-256 hashes and metadata are stored.

## Dependencies & Versioning
- Node.js 20 LTS.
- Prisma 5.x with PostgreSQL 15.
- Kafka 3.4 (managed) for ingestion buffering.
- Redis 7 for OTP verification and rate limited tokens.

## Failure Modes & Mitigations
- **Kafka lag**: autoscaler increases consumer replicas; alert triggers at 5-minute lag threshold.
- **Index regressions**: `pg_stat_statements` tracked via Grafana alerts if contact queries exceed 100 ms p95.
- **Cache outages**: API falls back to DB-driven rate limits with stricter thresholds; contact uploads degrade gracefully.
- **Hash collision risk**: SHA-256 collisions are negligible; additional user scope unique constraint prevents row duplication.
