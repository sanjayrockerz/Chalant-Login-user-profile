# Push Token Cleanup Manual Runbook

## Purpose
Manual execution guide for push token cleanup when automated job fails or needs immediate execution.

## When to Use
- Automated cron job fails 2+ consecutive days
- Database connection issues preventing scheduled execution
- Process crash or container restart during cleanup
- Need to preview stale token count before automated cleanup
- Emergency cleanup required (e.g., storage constraints)

## Prerequisites
- Database access credentials (PostgreSQL)
- Admin privileges for push_tokens table
- Monitoring dashboard access to verify results

## Safety Checks

### Before Execution
1. **Verify Current Time**: Avoid running during peak hours (8 AM - 8 PM user timezone)
2. **Check Active Token Count**: Baseline metric before cleanup
   ```sql
   SELECT platform, COUNT(*) as active_count
   FROM push_tokens
   WHERE active = true
   GROUP BY platform;
   ```
3. **Verify WHERE Clause**: Ensure `active = true` filter present to avoid re-processing

## Execution Steps

### Step 1: Preview Stale Token Count
```sql
-- Check how many tokens will be affected
SELECT COUNT(*) as stale_count
FROM push_tokens
WHERE active = true 
  AND (
    last_validated_at < NOW() - INTERVAL '30 days'
    OR last_validated_at IS NULL
  );
```

**Expected Range**: 1,000 - 50,000 tokens for typical workload  
**Alert Threshold**: >100,000 tokens suggests data quality issue - investigate before proceeding

### Step 2: Preview by Platform
```sql
-- Break down stale tokens by platform
SELECT 
  platform,
  COUNT(*) as stale_count,
  MIN(last_validated_at) as oldest_validation,
  MAX(last_validated_at) as newest_validation
FROM push_tokens
WHERE active = true 
  AND (
    last_validated_at < NOW() - INTERVAL '30 days'
    OR last_validated_at IS NULL
  )
GROUP BY platform;
```

### Step 3: Test Cleanup in Transaction (Dry Run)
```sql
-- Start transaction for safe testing
BEGIN;

-- Execute cleanup update
UPDATE push_tokens
SET active = false, updated_at = NOW()
WHERE active = true 
  AND (
    last_validated_at < NOW() - INTERVAL '30 days'
    OR last_validated_at IS NULL
  );

-- Verify affected rows
SELECT COUNT(*) as updated_count
FROM push_tokens
WHERE active = false 
  AND updated_at > NOW() - INTERVAL '5 minutes';

-- ROLLBACK to undo changes (dry run)
ROLLBACK;
```

**Validation**: Confirm `updated_count` matches preview count from Step 1

### Step 4: Execute Cleanup (Production)
```sql
-- Start transaction for atomic execution
BEGIN;

-- Execute cleanup in batches to avoid lock contention
-- Batch 1 (first 1000 tokens)
UPDATE push_tokens
SET active = false, updated_at = NOW()
WHERE id IN (
  SELECT id 
  FROM push_tokens
  WHERE active = true 
    AND (
      last_validated_at < NOW() - INTERVAL '30 days'
      OR last_validated_at IS NULL
    )
  LIMIT 1000
);

-- Check rows affected
-- Repeat UPDATE statement until 0 rows affected

-- Commit when complete
COMMIT;
```

**Batch Processing**: Execute multiple times with 1-second delay between batches to reduce DB load

### Alternative: Single Batch Execution
```sql
-- For smaller cleanups (<5000 tokens), single batch acceptable
BEGIN;

UPDATE push_tokens
SET active = false, updated_at = NOW()
WHERE active = true 
  AND (
    last_validated_at < NOW() - INTERVAL '30 days'
    OR last_validated_at IS NULL
  );

COMMIT;
```

## Verification

### Post-Cleanup Checks
1. **Verify Update Count**
   ```sql
   SELECT COUNT(*) as newly_inactive_count
   FROM push_tokens
   WHERE active = false 
     AND updated_at > NOW() - INTERVAL '1 hour';
   ```

2. **Check Active Token Distribution**
   ```sql
   SELECT platform, COUNT(*) as active_count
   FROM push_tokens
   WHERE active = true
   GROUP BY platform;
   ```

3. **Monitor Dashboard**: Check Grafana for metric updates
   - `active_tokens_count{platform="ios"}` should decrease
   - `active_tokens_count{platform="android"}` should decrease
   - `stale_tokens_cleaned_total` should increment

4. **Verify No Active Stale Tokens Remain**
   ```sql
   SELECT COUNT(*) as remaining_stale
   FROM push_tokens
   WHERE active = true 
     AND (
       last_validated_at < NOW() - INTERVAL '30 days'
       OR last_validated_at IS NULL
     );
   ```
   **Expected**: 0 tokens remaining

## Rollback Procedure

### If Cleanup Executed Incorrectly
```sql
-- Reactivate tokens cleaned in last hour (if needed)
BEGIN;

UPDATE push_tokens
SET active = true, updated_at = NOW()
WHERE active = false 
  AND updated_at > NOW() - INTERVAL '1 hour'
  AND updated_at < NOW(); -- Ensure time window

-- Verify rollback count
SELECT COUNT(*) as reactivated_count
FROM push_tokens
WHERE active = true 
  AND updated_at > NOW() - INTERVAL '1 minute';

COMMIT;
```

**Use Case**: Accidental cleanup during test or wrong WHERE clause

## Monitoring After Execution

### Alert Conditions
- **Success**: `stale_tokens_cleaned_total` incremented correctly
- **Failure**: Active token count drops >20% unexpectedly
- **Anomaly**: Same tokens marked stale again within 7 days (indicates validation issue)

### Dashboard Panels to Check
1. Active token count trend (30-day view)
2. Daily cleanup count bar chart
3. Cleanup job duration histogram
4. Token validation success rate

## Troubleshooting

### Issue: No Tokens Cleaned (0 rows affected)
**Cause**: All tokens validated recently  
**Action**: Verify `last_validated_at` timestamps; check notification delivery service health

### Issue: Excessive Tokens Cleaned (>100k)
**Cause**: Notification delivery service down for extended period  
**Action**: Investigate delivery service logs; check FCM/APNs API health

### Issue: Transaction Timeout
**Cause**: Batch size too large or table lock contention  
**Action**: Reduce batch size to 500; add 2-second delay between batches

### Issue: Cleanup Job Failing Repeatedly
**Cause**: Database connectivity, insufficient permissions, or code bug  
**Action**: 
1. Check DB connection pool health
2. Verify `push_tokens` table permissions (UPDATE, SELECT)
3. Review application logs for stack traces
4. Restart application container if memory leak suspected

## Escalation

### When to Escalate
- Manual cleanup fails after 3 attempts
- Active token count drops >50% unexpectedly
- Database performance degrades during cleanup
- Data integrity violations (constraint errors)

### Escalation Contacts
- **Primary**: Platform Engineering Lead
- **Secondary**: Database Administrator
- **Emergency**: On-call SRE (PagerDuty)

## Documentation Links
- Monitoring Dashboard: `https://grafana.example.com/d/push-tokens`
- Cron Job Logs: `kubectl logs -n prod -l app=auth-service --tail=1000 | grep cleanup`
- Database Schema: `docs/schema/push_tokens.md`

## Testing in Staging

### Before Using in Production
```bash
# Connect to staging database
psql -h staging-db.example.com -U auth_service -d auth_db

# Execute preview query (Step 1)
# Execute dry run transaction (Step 3)
# Verify rollback works correctly
```

---

**Last Updated**: 2025-10-18  
**Tested By**: Platform Engineering Team  
**Review Frequency**: Quarterly
