# Operations Scripts

## Overview

This directory contains operational scripts for deployment, maintenance, monitoring, and troubleshooting of the signup backend service.

## Script Catalog

### Deployment Scripts

#### `deploy-staging.sh`
Deploy to staging environment with health checks.

```bash
./scripts/deploy-staging.sh

# Options
./scripts/deploy-staging.sh --skip-migrations
./scripts/deploy-staging.sh --rollback
```

**What it does**:
- Builds Docker image
- Pushes to ECR
- Applies Kubernetes manifests
- Runs database migrations
- Verifies health checks
- Rolls back on failure

---

#### `deploy-production.sh`
Production deployment with approval gates.

```bash
./scripts/deploy-production.sh

# Requires approval
./scripts/deploy-production.sh --version v1.2.3
```

**What it does**:
- Requires manual approval
- Creates backup before deployment
- Blue-green deployment
- Smoke tests
- Automatic rollback on failure

---

### Database Scripts

#### `db-migrate.sh`
Run Prisma migrations safely.

```bash
# Development
./scripts/db-migrate.sh dev --name add_user_metadata

# Production
./scripts/db-migrate.sh prod
```

**What it does**:
- Checks migration status
- Creates backup
- Applies migrations
- Validates schema
- Rolls back on error

---

#### `db-backup.sh`
Create database backup.

```bash
# Manual backup
./scripts/db-backup.sh

# Scheduled backup
./scripts/db-backup.sh --scheduled --retain-days 30
```

**What it does**:
- Dumps PostgreSQL database
- Compresses backup
- Uploads to S3
- Verifies backup integrity
- Cleans up old backups

---

#### `db-restore.sh`
Restore database from backup.

```bash
# List available backups
./scripts/db-restore.sh --list

# Restore specific backup
./scripts/db-restore.sh --backup-id 20240115-120000
```

**What it does**:
- Downloads backup from S3
- Verifies checksum
- Restores to database
- Validates data integrity
- Logs restore operation

---

### Monitoring Scripts

#### `health-check.sh`
Check service health across environments.

```bash
# Check all environments
./scripts/health-check.sh

# Specific environment
./scripts/health-check.sh --env production
```

**What it does**:
- Tests health endpoints
- Checks database connectivity
- Validates Redis connection
- Reports status summary

---

#### `performance-test.sh`
Run load tests against service.

```bash
# Quick test (100 VUs, 1 minute)
./scripts/performance-test.sh --quick

# Full test (1000 VUs, 30 minutes)
./scripts/performance-test.sh --full
```

**What it does**:
- Runs k6 load tests
- Measures latency (p50, p95, p99)
- Tracks error rates
- Generates performance report

---

### Maintenance Scripts

#### `cleanup-old-data.sh`
Archive and delete old data.

```bash
# Dry run
./scripts/cleanup-old-data.sh --dry-run

# Execute cleanup
./scripts/cleanup-old-data.sh --days 90
```

**What it does**:
- Soft-deletes old records
- Archives to S3
- Frees up disk space
- Logs deleted records

---

#### `rotate-secrets.sh`
Rotate application secrets.

```bash
# Rotate JWT secret
./scripts/rotate-secrets.sh --secret JWT_SECRET

# Rotate all secrets
./scripts/rotate-secrets.sh --all
```

**What it does**:
- Generates new secret
- Updates Kubernetes secrets
- Rolling restart pods
- Verifies connectivity

---

### Troubleshooting Scripts

#### `debug-pod.sh`
Debug Kubernetes pod issues.

```bash
# Debug specific pod
./scripts/debug-pod.sh signup-backend-abc123

# Debug latest failing pod
./scripts/debug-pod.sh --latest-failing
```

**What it does**:
- Shows pod logs
- Describes pod events
- Checks resource usage
- Tests network connectivity

---

#### `trace-request.sh`
Trace request through system.

```bash
# Trace by correlation ID
./scripts/trace-request.sh --correlation-id 550e8400-e29b-41d4-a716-446655440000
```

**What it does**:
- Searches logs for correlation ID
- Shows request flow
- Identifies bottlenecks
- Displays errors

---

### Development Scripts

#### `setup-local-env.sh`
Setup local development environment.

```bash
./scripts/setup-local-env.sh
```

**What it does**:
- Installs dependencies
- Starts Docker containers (PostgreSQL, Redis)
- Runs database migrations
- Seeds test data
- Configures environment variables

---

#### `run-tests.sh`
Run test suites with coverage.

```bash
# All tests
./scripts/run-tests.sh

# Unit tests only
./scripts/run-tests.sh --unit

# E2E tests
./scripts/run-tests.sh --e2e
```

**What it does**:
- Runs Jest tests
- Generates coverage report
- Fails if coverage < 80%
- Outputs JUnit report for CI

---

## Script Templates

### Deployment Script Template

```bash
#!/bin/bash
set -euo pipefail

# Configuration
ENVIRONMENT=${1:-staging}
VERSION=${2:-latest}

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

log_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# Pre-deployment checks
check_prerequisites() {
  log_info "Checking prerequisites..."
  command -v kubectl >/dev/null 2>&1 || { log_error "kubectl not installed"; exit 1; }
  command -v docker >/dev/null 2>&1 || { log_error "docker not installed"; exit 1; }
}

# Build and push image
build_and_push() {
  log_info "Building Docker image..."
  docker build -t signup-backend:${VERSION} .
  
  log_info "Pushing to ECR..."
  docker tag signup-backend:${VERSION} ${ECR_REPO}/signup-backend:${VERSION}
  docker push ${ECR_REPO}/signup-backend:${VERSION}
}

# Deploy to Kubernetes
deploy() {
  log_info "Deploying to ${ENVIRONMENT}..."
  kubectl apply -k infra/kubernetes/overlays/${ENVIRONMENT}
  
  log_info "Waiting for rollout..."
  kubectl rollout status deployment/signup-backend -n ${ENVIRONMENT}
}

# Health check
verify_health() {
  log_info "Verifying health..."
  
  for i in {1..10}; do
    if kubectl exec -n ${ENVIRONMENT} deployment/signup-backend -- curl -f http://localhost:3000/health >/dev/null 2>&1; then
      log_info "Health check passed"
      return 0
    fi
    sleep 5
  done
  
  log_error "Health check failed"
  return 1
}

# Rollback on failure
rollback() {
  log_error "Deployment failed, rolling back..."
  kubectl rollout undo deployment/signup-backend -n ${ENVIRONMENT}
}

# Main execution
main() {
  check_prerequisites
  build_and_push
  deploy
  
  if ! verify_health; then
    rollback
    exit 1
  fi
  
  log_info "Deployment successful!"
}

main "$@"
```

### Database Migration Script Template

```bash
#!/bin/bash
set -euo pipefail

ENVIRONMENT=${1:-development}
MIGRATION_NAME=${2:-}

# Configuration
case $ENVIRONMENT in
  development)
    DATABASE_URL="postgresql://user:pass@localhost:5432/signup_db"
    ;;
  staging)
    DATABASE_URL=$(kubectl get secret signup-backend-secrets -n staging -o jsonpath='{.data.DATABASE_URL}' | base64 -d)
    ;;
  production)
    DATABASE_URL=$(kubectl get secret signup-backend-secrets -n production -o jsonpath='{.data.DATABASE_URL}' | base64 -d)
    ;;
esac

# Create backup
create_backup() {
  echo "Creating backup..."
  BACKUP_FILE="backup_$(date +%Y%m%d_%H%M%S).sql"
  pg_dump $DATABASE_URL > $BACKUP_FILE
  echo "Backup created: $BACKUP_FILE"
}

# Run migration
run_migration() {
  if [ "$ENVIRONMENT" == "development" ] && [ -n "$MIGRATION_NAME" ]; then
    echo "Creating migration: $MIGRATION_NAME"
    npx prisma migrate dev --name "$MIGRATION_NAME"
  else
    echo "Applying migrations..."
    npx prisma migrate deploy
  fi
}

# Verify migration
verify_migration() {
  echo "Verifying migration status..."
  npx prisma migrate status
}

# Main
if [ "$ENVIRONMENT" != "development" ]; then
  create_backup
fi

run_migration
verify_migration

echo "Migration complete!"
```

## Best Practices

### Script Writing Guidelines

1. **Error Handling**: Use `set -euo pipefail` to exit on errors
2. **Logging**: Clear log messages with timestamps
3. **Dry Run**: Support `--dry-run` for safe testing
4. **Rollback**: Always have rollback mechanism
5. **Idempotency**: Scripts should be safe to run multiple times
6. **Documentation**: Include usage examples in comments

### Security

```bash
# DON'T hardcode secrets
DATABASE_URL="postgresql://user:password@localhost/db"  # ❌

# DO use environment variables or secret management
DATABASE_URL=${DATABASE_URL:-$(kubectl get secret...)}  # ✅
```

### Testing Scripts

```bash
# Test script with dry-run
./scripts/cleanup-old-data.sh --dry-run

# Test with verbose output
./scripts/deploy-staging.sh --verbose

# Test rollback scenario
./scripts/deploy-production.sh --test-rollback
```

## Scheduling Scripts

### Cron Jobs

```bash
# Crontab for scheduled operations
# Backup database daily at 2 AM
0 2 * * * /path/to/scripts/db-backup.sh --scheduled

# Cleanup old data weekly
0 3 * * 0 /path/to/scripts/cleanup-old-data.sh --days 90

# Health checks every 5 minutes
*/5 * * * * /path/to/scripts/health-check.sh >> /var/log/health-check.log 2>&1
```

### Kubernetes CronJobs

```yaml
# k8s-cronjob-backup.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: database-backup
spec:
  schedule: "0 2 * * *"  # Daily at 2 AM
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: backup
            image: signup-backend:latest
            command:
            - /bin/sh
            - -c
            - /app/scripts/db-backup.sh --scheduled
          restartPolicy: OnFailure
```

## Script Permissions

```bash
# Make scripts executable
chmod +x scripts/*.sh

# Restrict sensitive scripts
chmod 700 scripts/rotate-secrets.sh
```

## Monitoring Scripts

### Alert on Script Failures

```bash
# Send alert if script fails
./scripts/db-backup.sh || curl -X POST https://alerts.company.com/webhook \
  -d '{"message": "Database backup failed", "severity": "critical"}'
```

### Track Script Execution

```bash
# Log script execution
log_execution() {
  echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") - $1 - $2" >> /var/log/scripts.log
}

log_execution "db-backup.sh" "started"
# ... script logic ...
log_execution "db-backup.sh" "completed"
```

## Troubleshooting

### Common Issues

**Issue**: Script fails with "permission denied"
```bash
# Solution: Make script executable
chmod +x scripts/script-name.sh
```

**Issue**: Script can't find kubectl
```bash
# Solution: Add to PATH or use full path
export PATH=$PATH:/usr/local/bin
# or
/usr/local/bin/kubectl get pods
```

**Issue**: Database connection timeout
```bash
# Solution: Check network connectivity and credentials
psql $DATABASE_URL -c "SELECT 1"
```

## Related Documentation

- [Production Runbook](../docs/production-readiness/runbook.md)
- [Deployment Guide](../infra/README.md)
- [Database Migrations](../db/migrations/README.md)
