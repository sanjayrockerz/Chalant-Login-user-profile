# Instagram-Style Username Migration and Backfill Strategy

## Overview
This document outlines the comprehensive strategy for migrating existing usernames to Instagram-style rules with case-insensitive uniqueness while ensuring zero-downtime deployment and handling edge cases.

## Migration Phases

### Phase 1: Database Schema Migration (Zero-Downtime)
**Timeline**: 1-2 hours  
**Risk**: Low  

1. **Enable citext extension**
   ```sql
   CREATE EXTENSION IF NOT EXISTS citext;
   ```

2. **Add new columns without constraints**
   ```sql
   ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "username_canonical" citext;
   ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "username_last_changed_at" timestamptz;
   ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "username_change_count" integer DEFAULT 0;
   ```

3. **Backfill canonical usernames**
   - Use batch processing (1000 records per batch)
   - Populate `username_canonical` with `LOWER(username)`
   - Monitor for violations of new format rules

4. **Add constraints gradually**
   ```sql
   -- First add NOT NULL after backfill
   ALTER TABLE "User" ALTER COLUMN "username_canonical" SET NOT NULL;
   
   -- Add format constraints
   ALTER TABLE "User" ADD CONSTRAINT check_username_format 
   CHECK ("username" ~ '^[a-zA-Z0-9_.]{1,30}$');
   
   -- Add uniqueness constraints
   CREATE UNIQUE INDEX CONCURRENTLY "User_username_canonical_unique" 
   ON "User"("username_canonical");
   ```

### Phase 2: Conflict Resolution (Managed Rollout)
**Timeline**: 1-3 days  
**Risk**: Medium  

1. **Identify conflicts**
   ```sql
   -- Find case-insensitive duplicates
   SELECT LOWER(username) as canonical, COUNT(*) as count
   FROM "User" 
   GROUP BY LOWER(username) 
   HAVING COUNT(*) > 1;
   ```

2. **Conflict resolution strategies**
   - **Preserve first registration**: Keep earliest `createdAt` user unchanged
   - **Append numbers**: Add sequential numbers to duplicate usernames
   - **Email notification**: Inform affected users of automatic changes
   - **Grace period**: Allow manual resolution before automatic changes

3. **Rollback plan**
   - Maintain backup of original usernames
   - Provide rollback script to restore original state
   - Monitor user complaints and engagement metrics

### Phase 3: Application Code Deployment
**Timeline**: 2-4 hours  
**Risk**: Medium  

1. **Feature flag deployment**
   ```typescript
   // Configuration flags
   ENABLE_INSTAGRAM_USERNAME_RULES=true
   ENABLE_CASE_INSENSITIVE_LOOKUP=true
   ENABLE_USERNAME_VALIDATION=warn // warn -> enforce
   ```

2. **Gradual rollout**
   - **Stage 1**: Enable for new registrations only
   - **Stage 2**: Enable for username changes
   - **Stage 3**: Full enforcement for all operations

3. **Monitoring**
   - Username validation failures
   - Case-insensitive lookup performance
   - User experience metrics
   - Error rates and latency

## Conflict Resolution Detailed Strategy

### Automatic Resolution Process

1. **Duplicate Detection**
   ```sql
   WITH duplicates AS (
     SELECT 
       username_canonical,
       array_agg(id ORDER BY "createdAt") as user_ids,
       COUNT(*) as duplicate_count
     FROM "User" 
     WHERE username_canonical IS NOT NULL
     GROUP BY username_canonical 
     HAVING COUNT(*) > 1
   )
   SELECT * FROM duplicates;
   ```

2. **Resolution Algorithm**
   ```typescript
   async function resolveUsernameDuplicates() {
     const conflicts = await findDuplicateUsernames();
     
     for (const conflict of conflicts) {
       const [keepUserId, ...duplicateIds] = conflict.user_ids;
       
       for (let i = 0; i < duplicateIds.length; i++) {
         const newUsername = `${conflict.username_canonical}${i + 1}`;
         await updateUsername(duplicateIds[i], newUsername);
         await notifyUserOfUsernameChange(duplicateIds[i], newUsername);
       }
     }
   }
   ```

3. **Reserved Names Conflict**
   ```typescript
   async function resolveReservedConflicts() {
     const reserved = await findUsersWithReservedUsernames();
     
     for (const user of reserved) {
       const suggestions = generateSuggestions(user.username);
       const newUsername = await selectBestSuggestion(suggestions);
       await updateUsername(user.id, newUsername);
       await notifyUserOfReservedConflict(user.id, newUsername);
     }
   }
   ```

## Data Validation and Quality Assurance

### Pre-Migration Validation
```sql
-- Check current username format compliance
SELECT 
  COUNT(*) as total_users,
  COUNT(CASE WHEN username ~ '^[a-zA-Z0-9_.]{1,30}$' THEN 1 END) as compliant_users,
  COUNT(CASE WHEN username !~ '^[a-zA-Z0-9_.]{1,30}$' THEN 1 END) as non_compliant_users
FROM "User";

-- Check for case-insensitive duplicates
SELECT 
  LOWER(username) as canonical,
  COUNT(*) as duplicate_count,
  array_agg(username) as original_usernames
FROM "User" 
GROUP BY LOWER(username) 
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;

-- Check for reserved name conflicts
SELECT username, id 
FROM "User" 
WHERE LOWER(username) IN (
  'admin', 'support', 'api', 'root', 'system'
  -- Add full reserved list
);
```

### Post-Migration Validation
```sql
-- Verify uniqueness constraint
SELECT 
  username_canonical, 
  COUNT(*) 
FROM "User" 
GROUP BY username_canonical 
HAVING COUNT(*) > 1;

-- Verify format compliance
SELECT COUNT(*) FROM "User" 
WHERE username !~ '^[a-zA-Z0-9_.]{1,30}$';

-- Verify canonical consistency
SELECT COUNT(*) FROM "User" 
WHERE username_canonical != LOWER(username);
```

## Performance Optimization

### Index Strategy
```sql
-- Primary uniqueness index
CREATE UNIQUE INDEX CONCURRENTLY "User_username_canonical_unique" 
ON "User"("username_canonical");

-- Fallback functional index
CREATE UNIQUE INDEX CONCURRENTLY "User_username_lower_unique" 
ON "User"(LOWER("username"));

-- Performance indexes
CREATE INDEX CONCURRENTLY "User_username_last_changed_at_idx" 
ON "User"("username_last_changed_at") 
WHERE "username_last_changed_at" IS NOT NULL;

-- Partial index for recent changes (rate limiting optimization)
CREATE INDEX CONCURRENTLY "User_recent_username_changes_idx" 
ON "User"("id", "username_last_changed_at") 
WHERE "username_last_changed_at" > NOW() - INTERVAL '30 days';
```

### Query Optimization
```sql
-- Before: Case-sensitive lookup
SELECT * FROM "User" WHERE username = 'JohnDoe';

-- After: Case-insensitive lookup (optimized)
SELECT * FROM "User" WHERE username_canonical = LOWER('JohnDoe');
```

## Rollback Strategy

### Emergency Rollback (< 4 hours)
1. **Disable new username rules**
   ```bash
   kubectl set env deployment/api ENABLE_INSTAGRAM_USERNAME_RULES=false
   ```

2. **Restore original lookup behavior**
   ```sql
   -- Temporarily disable canonical lookup
   CREATE INDEX CONCURRENTLY "User_username_original_idx" ON "User"("username");
   ```

3. **Monitor and assess**
   - Check error rates return to baseline
   - Verify user experience metrics
   - Plan gradual re-enablement

### Data Rollback (24-48 hours)
1. **Restore original usernames from backup**
   ```sql
   -- Restore from backup table
   UPDATE "User" SET 
     username = backup.original_username,
     username_canonical = NULL
   FROM username_backup backup 
   WHERE "User".id = backup.user_id;
   ```

2. **Remove new schema elements**
   ```sql
   DROP INDEX "User_username_canonical_unique";
   DROP INDEX "User_username_lower_unique";
   ALTER TABLE "User" DROP COLUMN "username_canonical";
   ALTER TABLE "User" DROP COLUMN "username_last_changed_at";
   ALTER TABLE "User" DROP COLUMN "username_change_count";
   ```

## Monitoring and Alerting

### Key Metrics
- Username validation failure rate
- Case-insensitive lookup performance
- Duplicate detection rate
- User complaints/support tickets
- Registration success rate
- Username change frequency

### Alerting Thresholds
```yaml
alerts:
  - name: username_validation_failures
    threshold: > 5% failure rate
    action: immediate_investigation
  
  - name: duplicate_usernames_detected
    threshold: > 0 duplicates
    action: automatic_resolution
  
  - name: lookup_latency_degradation
    threshold: > 200ms p95
    action: performance_investigation
```

## Communication Plan

### User Notifications
1. **Pre-migration announcement** (1 week before)
   - Email to all users explaining changes
   - In-app notification about upcoming improvements
   - FAQ about username rules

2. **During migration** (real-time)
   - Status page updates
   - Automatic username change notifications
   - Support channel staffing

3. **Post-migration** (1 week after)
   - Success announcement
   - New feature education
   - Feedback collection

### Developer Communication
1. **API documentation updates**
2. **Breaking changes changelog**
3. **Integration testing guidelines**
4. **Performance impact assessment**

## Testing Strategy

### Pre-Production Testing
1. **Load testing** with realistic username patterns
2. **Edge case testing** with special characters
3. **Conflict resolution testing** with known duplicates
4. **Performance benchmarking** of new indexes

### Production Monitoring
1. **Canary deployment** to 1% of traffic
2. **Gradual rollout** with automatic rollback triggers
3. **Real-time metrics** monitoring
4. **User feedback** collection and analysis

## Success Criteria

### Technical Metrics
- Zero data loss during migration
- < 1% increase in lookup latency
- 100% uniqueness constraint enforcement
- < 0.1% username conflict rate

### Business Metrics
- No significant drop in registration rate
- Positive user feedback score
- Reduced support tickets for username issues
- Improved system security posture

### Compliance
- PII protection maintained throughout process
- Audit trail for all username changes
- GDPR compliance for user notifications
- Security review sign-off

## Risk Mitigation

### High-Risk Scenarios
1. **Mass duplicate conflicts** → Staged conflict resolution
2. **Performance degradation** → Index optimization + caching
3. **User confusion** → Clear communication + support
4. **Data corruption** → Comprehensive backups + testing

### Contingency Plans
1. **Immediate rollback** procedures documented
2. **Support team** training on new rules
3. **Engineering on-call** during migration
4. **Executive escalation** path defined