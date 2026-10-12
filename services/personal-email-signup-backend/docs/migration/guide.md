# Migration Guide: Legacy to New Signup Service

## Overview

This guide helps migrate from the legacy authentication system to the new OTP-based email signup service.

## Migration Timeline

- **Week 1**: Dual-write mode (write to both systems)
- **Week 2-3**: Gradual traffic shift (10% → 50% → 100%)
- **Week 4**: Legacy system deprecation
- **Week 5**: Legacy system decommission

## Prerequisites

- New service deployed to production
- Database migrations applied
- Redis cache configured
- Monitoring dashboards created
- Rollback plan documented

## Step 1: Enable Dual-Write Mode

### Backend Changes

```typescript
// user.service.ts
async createUser(email: string, otp: string): Promise<User> {
  // Write to new system (primary)
  const newUser = await this.prisma.user.create({
    data: { email, otpHash: await bcrypt.hash(otp, 10) }
  });

  // Write to legacy system (backup)
  try {
    await this.legacyUserService.createUser({ email, password: otp });
  } catch (error) {
    this.logger.warn('Legacy write failed', { 
      email, 
      error: error.message,
      correlation_id: this.requestContext.correlationId 
    });
    // Don't fail request if legacy write fails
  }

  return newUser;
}
```

### Feature Flag Configuration

```json
{
  "migration_dual_write": {
    "enabled": true,
    "description": "Write to both new and legacy systems",
    "rollout_percentage": 100
  }
}
```

## Step 2: Data Backfill

Migrate existing users from legacy system to new database.

### Export Legacy Data

```bash
# Export users from legacy PostgreSQL
psql -h legacy-db.company.com -U user -d auth_db -c "
  COPY (
    SELECT id, email, created_at, verified 
    FROM legacy_users 
    WHERE created_at < '2024-01-01'
  ) TO STDOUT CSV HEADER
" > legacy_users.csv
```

### Import to New System

```bash
# Create migration script
cat > scripts/migrate-legacy-users.ts << 'EOF'
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as csv from 'csv-parser';

const prisma = new PrismaClient();

async function migrateLegacyUsers() {
  const users = [];
  
  fs.createReadStream('legacy_users.csv')
    .pipe(csv())
    .on('data', (row) => users.push(row))
    .on('end', async () => {
      console.log(`Migrating ${users.length} users...`);
      
      for (const user of users) {
        await prisma.user.create({
          data: {
            id: user.id,
            email: user.email,
            email_verified: user.verified === 'true',
            created_at: new Date(user.created_at),
            // Mark as migrated from legacy
            metadata: { migrated_from: 'legacy', migrated_at: new Date() }
          }
        });
      }
      
      console.log('Migration complete');
    });
}

migrateLegacyUsers();
EOF

# Run migration
npx ts-node scripts/migrate-legacy-users.ts
```

### Verify Data Integrity

```sql
-- Compare counts
SELECT 'legacy' AS source, COUNT(*) FROM legacy_users
UNION ALL
SELECT 'new' AS source, COUNT(*) FROM users;

-- Check for duplicates
SELECT email, COUNT(*) 
FROM users 
GROUP BY email 
HAVING COUNT(*) > 1;

-- Verify sample records
SELECT * FROM users WHERE metadata->>'migrated_from' = 'legacy' LIMIT 10;
```

## Step 3: Gradual Traffic Shift

### Phase 1: 10% Traffic to New Service

```typescript
// traffic-router.middleware.ts
export function routeTraffic(req: Request, res: Response, next: NextFunction) {
  const rolloutPercentage = 10; // Start with 10%
  const userId = req.headers['x-user-id'];
  
  // Deterministic routing based on user ID
  const hash = hashCode(userId);
  const useNewService = (hash % 100) < rolloutPercentage;
  
  req.headers['x-service-version'] = useNewService ? 'new' : 'legacy';
  
  this.logger.info('Traffic routed', {
    user_id: userId,
    service: useNewService ? 'new' : 'legacy',
    correlation_id: req.headers['x-correlation-id']
  });
  
  next();
}
```

### Monitor Key Metrics

```promql
# Error rate comparison
sum(rate(http_requests_total{status=~"5..", service="signup-backend-new"}[5m])) 
/ sum(rate(http_requests_total{service="signup-backend-new"}[5m]))
vs
sum(rate(http_requests_total{status=~"5..", service="signup-backend-legacy"}[5m])) 
/ sum(rate(http_requests_total{service="signup-backend-legacy"}[5m]))

# Latency comparison (p95)
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{service="signup-backend-new"}[5m]))
vs
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{service="signup-backend-legacy"}[5m]))
```

### Rollout Schedule

| Week | Traffic % | Success Criteria |
|------|-----------|------------------|
| 1 | 10% | Error rate < 0.1%, latency parity |
| 2 | 25% | No P0/P1 incidents for 3 days |
| 2 | 50% | User feedback positive |
| 3 | 75% | Performance within SLO |
| 3 | 100% | All metrics green for 48 hours |

### Rollback Trigger

Immediately rollback to 0% if:
- Error rate > 1% for 5 minutes
- p95 latency > 2x legacy service
- Critical functionality broken
- P0 incident declared

```bash
# Emergency rollback
kubectl set env deployment/traffic-router ROLLOUT_PERCENTAGE=0 -n production
```

## Step 4: Deprecate Legacy System

### Mark as Deprecated

```typescript
// legacy-service.ts
/**
 * @deprecated This service is deprecated. Use signup-backend instead.
 * Will be removed on 2024-03-01.
 */
export class LegacyAuthService {
  constructor() {
    this.logger.warn('LegacyAuthService is deprecated and will be removed soon');
  }
}
```

### Update Documentation

- Add deprecation notice to API docs
- Update client SDKs with migration guide
- Notify consumers via email/Slack
- Post announcement in developer portal

### Monitor Legacy Usage

```promql
# Track legacy API calls (should trend to zero)
sum(rate(http_requests_total{service="signup-backend-legacy"}[1h]))
```

## Step 5: Decommission Legacy System

**Prerequisites**:
- New service at 100% traffic for 2+ weeks
- Zero legacy API calls for 7 days
- All consumers migrated
- Stakeholder approval obtained

### Decommission Checklist

- [ ] Archive legacy database (full backup)
- [ ] Export audit logs
- [ ] Delete legacy deployment
  ```bash
  kubectl delete deployment signup-backend-legacy -n production
  ```
- [ ] Remove legacy database (after 90-day retention)
- [ ] Update DNS records
- [ ] Archive legacy code repository
- [ ] Update architecture diagrams
- [ ] Conduct post-mortem

## Rollback Plan

### Full Rollback to Legacy System

```bash
# 1. Set traffic to 0% new service
kubectl set env deployment/traffic-router ROLLOUT_PERCENTAGE=0 -n production

# 2. Verify legacy system handling all traffic
curl https://api.company.com/health

# 3. Monitor error rates
kubectl logs -f deployment/signup-backend-legacy -n production

# 4. Investigate issue with new service
kubectl logs deployment/signup-backend-new -n production --tail=500
```

### Partial Rollback

If specific endpoints fail, route only those to legacy:

```typescript
// traffic-router.middleware.ts
const LEGACY_ROUTES = ['/auth/verify-otp']; // Problematic endpoint

if (LEGACY_ROUTES.includes(req.path)) {
  req.headers['x-service-version'] = 'legacy';
}
```

## Testing Strategy

### Pre-Migration Testing

```bash
# Load test new service
k6 run --vus 100 --duration 30m load-tests/signup-flow.js

# Compare results with legacy
k6 run --vus 100 --duration 30m load-tests/legacy-signup-flow.js
```

### Smoke Tests (Post-Deployment)

```bash
# Test critical flows
npm run test:e2e -- --grep "signup flow"
npm run test:e2e -- --grep "OTP verification"
npm run test:e2e -- --grep "login flow"
```

### Data Validation

```sql
-- Verify all migrated users accessible
SELECT COUNT(*) FROM users WHERE metadata->>'migrated_from' = 'legacy';

-- Check for orphaned records
SELECT l.id, l.email 
FROM legacy_users l 
LEFT JOIN users u ON l.email = u.email 
WHERE u.id IS NULL;
```

## Troubleshooting

### Issue: Duplicate Users After Migration

**Cause**: User existed in both systems pre-migration

**Resolution**:
```sql
-- Merge duplicates (keep newer record)
WITH duplicates AS (
  SELECT email, array_agg(id ORDER BY created_at DESC) AS ids
  FROM users
  GROUP BY email
  HAVING COUNT(*) > 1
)
DELETE FROM users
WHERE id IN (
  SELECT unnest(ids[2:]) FROM duplicates
);
```

### Issue: Legacy API Still Receiving Traffic

**Cause**: Client-side caching, hardcoded endpoints

**Resolution**:
- Check client SDK versions
- Review DNS/load balancer configuration
- Add redirect from legacy to new endpoints

## Communication Plan

### Week -2: Announcement
- Email to all API consumers
- Post in #engineering Slack
- Update developer portal

### Week -1: Reminder
- Send migration guide to consumers
- Office hours for questions
- Final testing window

### Week 0: Migration Start
- Status page update
- Real-time monitoring channel (#migration-status)
- Oncall engineer assigned

### Week 4: Completion
- Success announcement
- Post-mortem review
- Thank consumers for cooperation

## Contact

- **Migration Lead**: [migration-lead@company.com](mailto:migration-lead@company.com)
- **Engineering**: #auth-team (Slack)
- **Questions**: [auth-support@company.com](mailto:auth-support@company.com)

## Related Documentation

- [Architecture Decision: Move to OTP-based Auth](../adr/002-otp-authentication.md)
- [API Migration Guide](../api/migration.md)
- [Production Runbook](../production-readiness/runbook.md)
