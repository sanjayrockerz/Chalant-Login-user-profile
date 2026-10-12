# Upstream Sync Policy & Procedures

## Sync Cadence and Ownership

### Regular Sync Schedule

| Schedule | Frequency | Owner | Scope |
|----------|-----------|-------|-------|
| **Weekly Maintenance** | Every Monday 09:00 UTC | Platform Team (rotating) | Check and sync any upstream changes |
| **Release-Based** | Within 24h of upstream release | Service Owner + Platform Team | Sync specific release versions |
| **Security Patches** | Immediate (within 4h) | Security Team + Service Owner | Critical security updates |

### Trigger Criteria

#### Priority 1: Immediate Sync (< 4 hours)
- Security vulnerabilities (CVE patches)
- Critical production bugs
- Data corruption fixes
- Authentication/authorization fixes

#### Priority 2: Scheduled Sync (< 24 hours)
- Feature releases with user impact
- Performance improvements
- Breaking dependency updates
- API changes affecting integration

#### Priority 3: Routine Sync (weekly)
- Documentation updates
- Non-breaking dependency updates
- Code quality improvements
- Test suite enhancements

### Sync Ownership Matrix

| Service | Primary Owner | GitHub | Backup Owner | Escalation |
|---------|---------------|---------|--------------|-------------|
| **login-page-back** | @jaidevms | [jaidevms/login-page-back](https://github.com/jaidevms/login-page-back) | Platform Team | Security Team |
| **personal-email-signup-backend** | @Harishraghave-07 | [Harishraghave-07/personal-email-signup-backend](https://github.com/Harishraghave-07/personal-email-signup-backend) | Platform Team | Security Team |

## Sync Execution Procedures

### 1. Automated Sync (Recommended)

```bash
# Weekly maintenance sync
./scripts/sync-upstream.sh

# Preview changes only
./scripts/sync-upstream.sh --dry-run

# Emergency sync without full testing
./scripts/sync-upstream.sh --skip-tests
```

### 2. Manual Sync Process

#### Step 1: Preparation
```bash
# Ensure clean working directory
git status --porcelain  # Must be empty

# Switch to main and pull latest
git checkout main
git pull origin main

# Create dated sync branch
SYNC_DATE=$(date +%Y-%m-%d)
git checkout -b sync/upstream-changes-${SYNC_DATE}
```

#### Step 2: Fetch and Preview
```bash
# Fetch upstream changes
git fetch upstream-login main
git fetch upstream-signup main

# Preview changes
git log --oneline main..upstream-login/main --max-count=10
git log --oneline main..upstream-signup/main --max-count=10
```

#### Step 3: Execute Sync
```bash
# Sync login service
git subtree pull --prefix=services/login-page-back \
  upstream-login main \
  --strategy=recursive -X ours \
  -m "Sync upstream login-page-back changes (${SYNC_DATE})"

# Sync signup service  
git subtree pull --prefix=services/personal-email-signup-backend \
  upstream-signup main \
  --strategy=recursive -X ours \
  -m "Sync upstream personal-email-signup-backend changes (${SYNC_DATE})"
```

#### Step 4: Validation
```bash
# Run comprehensive tests
npm run type-check
npm run lint
npm run test
npm run test:integration

# Service-specific validation
cd services/login-page-back && npm test
cd services/personal-email-signup-backend && npm test
```

#### Step 5: Finalization
```bash
# Create sync tag
git tag -a "sync/${SYNC_DATE}" -m "Upstream sync ${SYNC_DATE}"

# Push for review
git push origin sync/upstream-changes-${SYNC_DATE}
git push origin --tags
```

## Conflict Resolution Procedures

### Conflict Classification

#### Class A: Configuration Conflicts
**Examples**: package.json, tsconfig.json, environment files
**Resolution**: Preserve monorepo-specific settings, merge upstream changes

```bash
# Example: package.json conflict
git checkout --ours package.json           # Keep monorepo dependencies
# Manually merge upstream version updates and new scripts
git add package.json
```

#### Class B: Source Code Conflicts  
**Examples**: Business logic changes, API modifications
**Resolution**: Preserve monorepo customizations, adopt upstream fixes

```bash
# Example: Service file with observability conflict
# 1. Keep observability imports and instrumentation
# 2. Adopt upstream business logic changes
# 3. Merge API modifications carefully
```

#### Class C: Infrastructure Conflicts
**Examples**: CI/CD files, Docker configurations
**Resolution**: Favor monorepo infrastructure, document differences

### Conflict Resolution Workflow

1. **Identify Conflict Type**
   ```bash
   git status                    # See conflicted files
   git diff --name-only --diff-filter=U  # List conflict files
   ```

2. **Manual Resolution**
   ```bash
   # Open conflict files in editor
   # Resolve conflicts following classification rules
   git add <resolved-files>
   git commit -m "Resolve sync conflicts: preserve monorepo customizations"
   ```

3. **Validation**
   ```bash
   # Ensure resolution doesn't break functionality
   npm run type-check
   npm test
   ```

### Preserving Monorepo Customizations

#### Always Preserve
- OpenTelemetry/Prometheus instrumentation
- Shared configuration imports
- Cross-service communication patterns
- Monorepo-specific environment variables
- Security policies and middleware

#### Carefully Merge
- Package dependencies (keep monorepo versions)
- API route definitions (preserve observability)
- Database configurations (keep shared settings)
- Error handling (preserve correlation IDs)

#### Adopt from Upstream
- Bug fixes in business logic
- Security patches
- Performance improvements
- Test additions and improvements

## Post-Sync Validation

### Automated Validation Checklist

- [ ] TypeScript compilation passes
- [ ] All linting rules pass
- [ ] Unit tests pass (100% existing tests)
- [ ] Integration tests pass
- [ ] Service startup tests pass
- [ ] Database migration tests pass

### Manual Validation Checklist

#### Login Service Validation
- [ ] User authentication flow works
- [ ] JWT token generation/validation
- [ ] Password reset functionality
- [ ] Session management
- [ ] Rate limiting functions correctly

#### Signup Service Validation  
- [ ] User registration flow works
- [ ] Email verification process
- [ ] OTP generation and validation
- [ ] Push token registration (new feature)
- [ ] Database operations complete

#### Cross-Service Integration
- [ ] Shared JWT validation
- [ ] Database connectivity from both services
- [ ] Observability metrics collection
- [ ] Shared middleware functionality
- [ ] Error correlation across services

### Performance Validation

```bash
# Basic performance check
time curl -X POST localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test"}'

# Load test (if tools available)
# artillery run load-test-config.yml
```

## Rollback Procedures

### Quick Rollback (< 5 minutes)

```bash
# Revert last merge commit on main
git checkout main
git revert -m 1 HEAD
git push origin main

# Notify team
echo "Sync rollback completed - investigating issues"
```

### Full Rollback to Previous Sync

```bash
# Find last good sync tag
git tag -l "sync/*" | sort -V | tail -5

# Reset to previous sync (destructive)
git reset --hard sync/2025-10-09
git push origin main --force-with-lease

# Create rollback tag
git tag -a "rollback/$(date +%Y-%m-%d)" -m "Emergency rollback from sync issues"
git push origin --tags
```

### Hotfix Process During Rollback

1. **Apply hotfix to monorepo main**
2. **Coordinate with upstream maintainers**
3. **Create upstream PR for the fix**
4. **Re-attempt sync after upstream release**

## Monitoring and Alerting

### Sync Success Metrics

- Sync completion rate (target: >95%)
- Time to sync (target: <30 minutes)
- Conflict resolution time (target: <2 hours)
- Post-sync incident rate (target: <5%)

### Alerting Triggers

- Sync failure after 3 attempts
- Sync process taking >60 minutes
- Post-sync test failures
- Performance degradation >20%

### Monitoring Dashboard

Track the following metrics:
- Last sync date per service
- Sync success/failure rate
- Conflict frequency by service
- Time to resolution for conflicts
- Post-sync incident correlation

## Documentation Maintenance

### Update Triggers

- New service added to monorepo
- Upstream repository changes location
- New monorepo customizations added
- Conflict resolution patterns change
- Team ownership changes

### Review Schedule

- **Monthly**: Review sync effectiveness and conflict patterns
- **Quarterly**: Update contact information and procedures
- **Annually**: Full procedure review and optimization

### Documentation Location

- **Primary**: `/SYNC.md` (this document)
- **Scripts**: `/scripts/sync-upstream.sh`
- **Policies**: `/policies/upstream-sync-policy.md` (this document)
- **Runbooks**: `/docs/runbooks/emergency-sync-procedures.md`

## Emergency Contacts

### Business Hours (9 AM - 6 PM UTC)
- **Platform Team**: platform@company.com
- **Security Team**: security@company.com
- **Service Owners**: Direct GitHub handles

### After Hours / Weekends
- **On-Call Engineer**: oncall@company.com
- **Security Hotline**: security-emergency@company.com
- **Escalation Manager**: escalation@company.com

### Communication Channels
- **Slack**: #platform-team, #security-alerts
- **Email**: All emergency contacts
- **Status Page**: status.company.com

---

**Document Version**: 1.0  
**Last Updated**: October 10, 2025  
**Next Review**: January 10, 2026  
**Owner**: Platform Team  
**Approvers**: Security Team, Engineering Leadership