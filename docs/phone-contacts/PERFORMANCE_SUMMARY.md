# Staging Performance Summary

Test date: 2024-10-15
Environment: staging (5M users, 50M hashed contacts synthetic dataset)

| Scenario | Target p95 | Observed p95 | Notes |
| -------- | --------- | ------------ | ----- |
| Upload pipeline (API) | <100 ms | 68 ms | Includes normalization + Kafka enqueue. |
| Worker upsert batch (500 contacts) | <150 ms | 110 ms | `INSERT ... ON CONFLICT DO NOTHING` using `uniq_hashed_contacts_user_phone`. |
| Suggestion lookup (`hashed_contacts` by hash) | <50 ms | 27 ms | Index `idx_hashed_contacts_hashed_phone`. |
| Suggestion feed (`GET /v1/contacts:suggestions`) | <150 ms | 94 ms | Query uses `idx_contact_suggestions_user`. |
| Cleanup sweep (5k rows per chunk) | <1 s | 420 ms | Loop completes 600k rows/min.

Resource usage: PostgreSQL CPU < 35%, worker pods memory 300 MiB average.

No blocking locks recorded. Autovacuum triggered on `hashed_contacts` every 30 min as expected.
