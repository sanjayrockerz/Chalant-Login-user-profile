# Runbook: Hashed Contact Cleanup

## Trigger
- Alert: `hashed_contact_cleanup_rows` below threshold for 3 runs.

## Diagnosis Steps
1. Check job logs in Kibana (`app=contact-cleanup`).
2. Verify index usage:
   - `SELECT * FROM pg_stat_user_indexes WHERE indexrelname = 'idx_hashed_contacts_expires_at';`
3. Inspect queue backlog table `cleanup_job_state` (rows pending?).
4. Validate DB health: `SELECT deadlocks, blks_hit FROM pg_stat_database WHERE datname = 'auth';`

## Remediation
- If index bloat: `REINDEX INDEX CONCURRENTLY idx_hashed_contacts_expires_at;`
- If rows missing `expires_at`: run script `scripts/fix-expired-contacts.ts` to backfill with 30-day default.
- Manually run job: `npm run job:prune-hashed-contacts -- --limit=20000`.

## Post-Mortem
- File incident in PagerDuty (SEV-2 template) if downtime > 30 min.
- Attach query plans to retrospective doc.
- Update `PERFORMANCE_SUMMARY.md` if thresholds need adjustment.
