# Hashed Contact Retention & Operations Policy

_Last updated: 2025-10-17_

This document codifies the retention rules, operational safeguards, and compliance controls for hashed phone contacts processed by the contact discovery platform. It aligns with GDPR/CCPA data minimization principles while preserving service utility for friend suggestions.

## 1. Retention Policy
- **Scope**: Rows stored in `hashed_contacts` (hashed address book entries) and dependent records in `contact_suggestions`.
- **TTL**: 30 days from `hashed_contacts.uploaded_at`.
  - Rationale: 30-day window allows users to re-open suggestions, capture newly joined matches, and retry uploads without persisting historical address books indefinitely.
- **Cascade behaviour**:
  - On expiry, hashed contact rows are deleted.
  - Associated `contact_suggestions` rows are soft-flagged `stale = true` immediately and removed after 7 additional days unless the suggestion has been acted upon (accept/ignore). This preserves short-term UX context while preventing long-lived derived data.
  - Client surfaces “Suggested 2 weeks ago” timestamp sourced from `contact_suggestions.created_at`.
- **User profile phone (`users.phone`)**:
  - Persisted for the life of the account to support OTP delivery, login recovery, and security notifications.
  - Hash stored in `users.hashed_phone` for deterministic matching and evaluated alongside uploaded contact hashes.
  - Users may update or clear their phone via profile settings; account deletion removes both raw and hashed values.

## 2. Automated Cleanup Job Specification
- **Schedule**: Daily cron at 03:00 UTC (`0 3 * * *`), executed by the contact discovery worker service.
- **Batching**: Deletes processed in chunks of 1,000 rows per transaction to minimize row-level locks (`DELETE ... LIMIT 1000` loop).
- **Cascade handling**:
  - Primary job deletes expired rows from `hashed_contacts`.
  - A follow-up pass sets `contact_suggestions.stale = true` for any suggestion referencing a now-deleted hash and schedules them for purge by a nightly suggestion-compaction job.
- **Safety checks**:
  - Job aborts if more than 15% of table would be deleted in a single run (guardrail against misconfigured clocks).
  - Retries with exponential backoff (up to 3 attempts) on transient database errors.
- **Observability**:
  - Metrics: `hashed_contacts_deleted_total`, `hashed_contacts_cleanup_duration_ms`, `hashed_contacts_cleanup_failures_total`.
  - Structured log (INFO) summarising `run_id`, `deleted_count`, `stale_suggestions_marked`, `duration_ms`, `correlation_id`.
  - No hashes or raw identifiers written to logs.

## 3. User-Initiated Deletion Controls
- **Endpoint**: `DELETE /contacts`
  - Authentication: user session or OAuth2 access token required.
  - Behaviour: removes all rows in `hashed_contacts` for the authenticated userID and flags related `contact_suggestions` as stale.
  - Idempotency: repeated calls return HTTP 204 once data is removed.
  - Rate limiting: shared threshold with upload API (5 deletions/hour) to mitigate automated churn but allow legitimate erasure requests.
  - Audit logging: emit `contacts.deleted` event containing `user_id`, `correlation_id`, `deleted_count`, `initiated_by = user`.
  - Metrics: `contacts_user_deleted_total{result="success|failure"}`.
  - Error handling: partial failures trigger rollback and HTTP 500 with correlation_id for support follow-up.

## 4. Account Deletion Integration
- Account removal transaction performs the following steps atomically:
  1. Delete from `hashed_contacts` where `user_id = <account>`.
  2. Delete from `contact_suggestions` where `user_id` or `suggested_user_id` equals the account.
  3. Delete primary `users` row (or mark as tombstoned per auth service policy).
- Backups: automated database backups honour 30-day TTL; point-in-time recovery excludes previously deleted hashed data once purge completes.
- Documentation: privacy notice and DSAR playbook reference that pseudonymized hashes are fully removed during account deletion.

## 5. Monitoring & Alerting
- **Dashboard widgets (Grafana)**:
  - Daily deletes vs. baseline (expected ~3% of table volume).
  - Cleanup job duration percentile chart (p50/p95).
  - Failure counter with annotations for on-call interventions.
  - Table size gauge (`hashed_contacts` total rows) with warning threshold at +20% growth week-over-week.
- **Alerts**:
  - PagerDuty warning if cleanup job fails twice consecutively (no `hashed_contacts_deleted_total` increment for >48h).
  - Critical alert if table row count exceeds expected threshold (20% growth) indicating purge backlog.
  - Info alert when job deletes >10% more rows than 7-day moving average (possible upstream re-upload storm).

## 6. Operational Runbook (Manual Cleanup)
1. **Pre-checks**
   - Confirm automated job failure in logs/alerts.
   - Verify replica lag < 5s to avoid acting on stale data.
2. **Dry-run sizing**
   - `SELECT COUNT(*) FROM hashed_contacts WHERE expires_at < NOW();`
   - Abort if result > 20% of total table without VP of Security approval.
3. **Manual deletion**
   - Execute batched deletes: `DELETE FROM hashed_contacts WHERE expires_at < NOW() LIMIT 1000;` loop until zero remaining.
   - For each batch, mark dependent suggestions: `UPDATE contact_suggestions SET stale = TRUE WHERE hashed_phone IN (<batch_hashes>);`
4. **Post-validation**
   - Re-run count query to ensure zero expired rows.
   - Check `contact_suggestions` for high stale count; schedule compaction job if >50k rows flagged.
5. **Reporting**
   - File incident ticket with metrics snapshot and `correlation_id`.
   - Update on-call handoff document with actions taken and any follow-up tasks.

## 7. Compliance & Approvals
- Records of Processing Activities updated to reflect 30-day retention and deletion controls (GDPR Art. 30).
- DSAR workflow ensures `DELETE /contacts` endpoint is invoked as part of automated erasure routines.
- Documentation shared with Legal & Compliance on 2025-10-17 for approval; sign-off tracked in governance tracker.
