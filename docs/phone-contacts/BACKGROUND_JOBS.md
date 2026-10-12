# Background Jobs

| Job | Schedule | Purpose | Key Queries | Alerts |
| --- | -------- | ------- | ----------- | ------ |
| `contact-upload-worker` | Continuous | Consume Kafka topic and upsert `hashed_contacts` rows. | `INSERT ... ON CONFLICT DO NOTHING` on `uniq_hashed_contacts_user_phone`. | Lag > 5 min. |
| `contact-suggestion-builder` | Continuous | Identify matches and insert into `contact_suggestions`. | `SELECT id FROM users WHERE hashed_phone = $1`. | Queue depth > 50k. |
| `prune-hashed-contacts` | Hourly | Delete expired hashes (`expires_at < now()`). | `DELETE ... WHERE expires_at < now() LIMIT 5000`. | Rows deleted < 5k for 3 runs. |
| `prune-stale-suggestions` | Daily | Mark suggestions `stale = true` after expiration window. | `UPDATE contact_suggestions SET stale = true WHERE created_at < now() - interval '14 days'`. | Stale backlog > 1M. |
| `contact-match-backfill` | Ad hoc | Recompute suggestions when algorithm updates. | Batch queries on `idx_hashed_contacts_hashed_phone`. | Manual runbook. |

## Implementation Notes
- Jobs live under `services/personal-email-signup-backend/src/jobs/`.
- All jobs share `PrismaClient` connection pooling through `withPrisma()` helper; ensures `max` 20 connections.
- Use `JOB_MAX_RUNTIME` env var to abort long-running cleanup loops.
- `prune-hashed-contacts` relies on `idx_hashed_contacts_expires_at`; monitor hit rate to guarantee sub-minute sweeps.
