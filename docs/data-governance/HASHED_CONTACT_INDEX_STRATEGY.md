# Hashed Contact Index Strategy

## Goals
- Keep contact upload dedupe queries and suggestion fan-out under 50 ms at p95 for a 10 M user install base.
- Maintain predictable cleanup backfills (<5 min per 1 M rows) to satisfy the 30-day retention policy.
- Avoid over-indexing that would slow high-volume inserts coming from the mobile contact importer.

## Workload Summary
- **Upload pipeline** writes ~3M hashed contacts per day across bursts of 10k/sec.
- **Deduplication** runs `SELECT id FROM users WHERE hashed_phone = $1 LIMIT 1` for each normalized number.
- **Suggestion generation** needs `SELECT * FROM hashed_contacts WHERE hashed_phone = ANY($1)` to compute matches.
- **Cleanup job** deletes expired contact hashes with `DELETE FROM hashed_contacts WHERE expires_at < now() LIMIT 5000` loops.
- **Analytics** uses rare scans grouped by `user_id`.

## Index Inventory

| Table | Index | Columns | Purpose | Notes |
| ----- | ----- | ------- | ------- | ----- |
| `users` | `idx_users_hashed_phone` | (`hashed_phone`) | Constant-time lookup when checking for direct matches. | Clustered hashed column remains nullable; coalesced queries handle `NULL`.
| `users` | `users_phone_key` | (`phone`) unique | Enforce single canonical phone per account to reduce duplicates. | Added with `IF NOT EXISTS` to keep migration idempotent.
| `hashed_contacts` | `uniq_hashed_contacts_user_phone` | (`user_id`, `hashed_phone`) unique | Prevents duplicate uploads from a single user; reduces noise in suggestion pipeline. | Also serves as natural PK for upsert operations.
| `hashed_contacts` | `idx_hashed_contacts_hashed_phone` | (`hashed_phone`) | Supports reverse lookup when cross-referencing uploaded contacts with existing accounts. | Covers the hot path query in <10 ms during testing.
| `hashed_contacts` | `idx_hashed_contacts_user_id` | (`user_id`) | Accelerates `DELETE` and analytics by owner. | Leveraged by per-user GDPR deletes.
| `hashed_contacts` | `idx_hashed_contacts_expires_at` | (`expires_at`) | Keeps TTL sweeps bounded; planner picks it for range scans. | Candidate for partial index (`WHERE expires_at <= now() + interval '1 day'`) if needed later.
| `contact_suggestions` | `uniq_contact_suggestions_pair` | (`user_id`, `suggested_user_id`) unique | Prevent duplicates in feed. | Supports idempotent writes from dedupe job.
| `contact_suggestions` | `idx_contact_suggestions_user` | (`user_id`) | Fetch suggestions for a viewer. | Primary serving query (`ORDER BY created_at DESC LIMIT 20`).
| `contact_suggestions` | `idx_contact_suggestions_user_match_type` | (`user_id`, `match_type`) | Supports in-app filters (e.g., "mutual matches"). | Avoids sequential scans when filters used.
| `contact_suggestions` | `idx_contact_suggestions_suggested_user` | (`suggested_user_id`) | Feed generation for reciprocal suggestions. | Also powers abuse investigations.

## Rationale and Trade-offs
- Single-column indexes match narrow predicates used by the API. Multicolumn indexes keep consistent prefix ordering (user first) which mirrors query filters.
- We avoided expression indexes because normalized phone hashes are deterministic pre-insert; we normalize in application code, so the DB sees final values.
- A partial index on `expires_at` offers marginal benefits for cleanup but breaks planner predictability when retention window is short; we documented it as a follow-up experiment.
- Low-cardinality `match_type` is only indexed as part of a composite to prevent skewed statistics.

## Monitoring
- Add index hit rate panels (via pg_stat_user_indexes) for each of the new indexes. Alert if hit rate < 95% for sustained 10 minutes, which indicates query plan drift.
- Track `idx_users_hashed_phone` bloat with `pgstattuple`. Trigger `REINDEX CONCURRENTLY` when bloat exceeds 20%.
- Cleanup job records rows deleted per second; alerts if more than 5 consecutive runs fall below 50k rows per minute (signals missing index usage).

## Testing
- Load tests (see `docs/phone-contacts/PERFORMANCE_SUMMARY.md`) executed using staging-sized dataset (5M hashed contacts). All key queries maintained p95 below target thresholds.
- Autovacuum remains within default thresholds; no tuning changes required post-index creation.
