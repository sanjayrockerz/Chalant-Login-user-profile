# Production Runbook

## Service Overview

**Service**: Personal Email Signup Backend  
**Stack**: NestJS, Prisma, Redis, PostgreSQL  
**Purpose**: OTP-based email signup and authentication

## Quick Links

- **Metrics Dashboard**: [Grafana](https://grafana.company.com/d/signup-service)
- **Logs**: [Loki](https://loki.company.com/explore)
- **Alerts**: [Prometheus](https://prometheus.company.com/alerts)
- **Documentation**: [API Docs](../api/)
- **Repository**: [GitHub](https://github.com/org/on-boarding)

## Common Operations

### Deploy New Version

```bash
# 1. Verify CI/CD pipeline passed
gh workflow view deploy --yaml

# 2. Check current version
kubectl get deployment signup-backend -n production -o jsonpath='{.spec.template.spec.containers[0].image}'

# 3. Apply new deployment (CI/CD handles this)
# Monitor rollout:
kubectl rollout status deployment/signup-backend -n production

# 4. Verify health
curl https://api.company.com/health
```

### Rollback Deployment

```bash
# Quick rollback to previous version
kubectl rollout undo deployment/signup-backend -n production

# Rollback to specific revision
kubectl rollout history deployment/signup-backend -n production
kubectl rollout undo deployment/signup-backend -n production --to-revision=5

# Monitor rollback
kubectl rollout status deployment/signup-backend -n production
```

### Scale Service

```bash
# Manual scaling
kubectl scale deployment signup-backend -n production --replicas=5

# Check current replicas
kubectl get deployment signup-backend -n production

# HPA status (auto-scaling)
kubectl get hpa signup-backend -n production
```

### Restart Service

```bash
# Rolling restart (zero downtime)
kubectl rollout restart deployment/signup-backend -n production

# Force delete pods (use with caution)
kubectl delete pod -l app=signup-backend -n production
```

## Troubleshooting

### High Error Rate (5xx Errors)

**Symptoms**: Prometheus alert: `ErrorRate > 1%`

**Diagnosis**:
```bash
# Check pod status
kubectl get pods -n production -l app=signup-backend

# View recent errors in logs
kubectl logs -n production -l app=signup-backend --tail=100 | grep -i error

# Check specific pod
kubectl logs -n production signup-backend-xyz --tail=500
```

**Common Causes**:
1. **Database connection pool exhausted**
   ```bash
   # Check connection count
   psql -h db-host -U user -d signup_db -c "SELECT count(*) FROM pg_stat_activity WHERE datname='signup_db';"
   ```
   - **Fix**: Increase pool size in Prisma config, scale pods

2. **Redis connection failures**
   ```bash
   # Test Redis connectivity
   redis-cli -h redis-host ping
   ```
   - **Fix**: Verify Redis service, check network policies

3. **OOM (Out of Memory)**
   ```bash
   # Check memory usage
   kubectl top pods -n production -l app=signup-backend
   ```
   - **Fix**: Increase memory limits, investigate memory leaks

### High Latency (p95 > 200ms)

**Symptoms**: Slow API responses, Prometheus alert

**Diagnosis**:
```bash
# Check Prometheus metrics
# Query: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# View slow query logs (PostgreSQL)
psql -h db-host -U user -d signup_db -c "
SELECT query, mean_exec_time, calls 
FROM pg_stat_statements 
ORDER BY mean_exec_time DESC 
LIMIT 10;"
```

**Common Causes**:
1. **Database query performance**
   - **Fix**: Add indexes, optimize queries, use Redis caching

2. **External API delays** (email service, verification)
   - **Fix**: Increase timeouts, implement circuit breakers

3. **High CPU usage**
   ```bash
   kubectl top pods -n production -l app=signup-backend
   ```
   - **Fix**: Scale horizontally, optimize CPU-intensive operations

### Database Migration Issues

**Symptoms**: Migration fails, schema drift detected

**Diagnosis**:
```bash
# Check migration status
npx prisma migrate status --schema=./prisma/schema.prisma

# View applied migrations
psql -h db-host -U user -d signup_db -c "SELECT * FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 10;"
```

**Resolution**:
```bash
# Resolve migration conflicts (development only)
npx prisma migrate resolve --applied "20240115_migration_name"

# Manual rollback (if migration failed mid-way)
psql -h db-host -U user -d signup_db < db/migrations/rollback/20240115_rollback.sql

# Re-run migration
npx prisma migrate deploy
```

### Redis Cache Issues

**Symptoms**: Increased database load, cache misses

**Diagnosis**:
```bash
# Check Redis connection
redis-cli -h redis-host INFO

# Monitor cache hit rate
redis-cli -h redis-host INFO stats | grep keyspace_hits

# Check eviction policy
redis-cli -h redis-host CONFIG GET maxmemory-policy
```

**Resolution**:
- Verify Redis service health
- Check memory usage: `redis-cli INFO memory`
- Increase Redis memory limit if needed
- Review cache expiration policies

### Pod CrashLoopBackOff

**Symptoms**: Pods restarting continuously

**Diagnosis**:
```bash
# View pod events
kubectl describe pod signup-backend-xyz -n production

# Check container logs
kubectl logs signup-backend-xyz -n production --previous

# Check startup probes
kubectl get pod signup-backend-xyz -n production -o jsonpath='{.spec.containers[0].startupProbe}'
```

**Common Causes**:
1. **Database connection failure**: Check connection string, network policies
2. **Missing environment variables**: Verify ConfigMaps/Secrets
3. **Port conflict**: Ensure PORT env var matches container port
4. **Resource limits**: Increase CPU/memory requests

## Monitoring & Alerts

### Key Metrics to Monitor

| Metric | Threshold | Alert |
|--------|-----------|-------|
| Error Rate | > 1% | Critical |
| p95 Latency | > 200ms | Warning |
| p99 Latency | > 500ms | Critical |
| Pod Restarts | > 3/hour | Warning |
| Memory Usage | > 85% | Warning |
| CPU Usage | > 80% | Warning |
| Database Connections | > 90% pool | Critical |

### Prometheus Queries

```promql
# Error rate (5-minute window)
sum(rate(http_requests_total{status=~"5..", service="signup-backend"}[5m])) 
/ sum(rate(http_requests_total{service="signup-backend"}[5m]))

# p95 Latency
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{service="signup-backend"}[5m]))

# Request rate
sum(rate(http_requests_total{service="signup-backend"}[5m]))
```

## Incident Response

### Severity Levels

- **P0 (Critical)**: Service down, data loss, security breach → Page oncall immediately
- **P1 (High)**: Degraded performance, partial outage → Notify within 15 minutes
- **P2 (Medium)**: Non-critical feature broken → Address during business hours
- **P3 (Low)**: Minor bug, cosmetic issue → Backlog

### Escalation Path

1. **Oncall Engineer**: [rotation@company.com](mailto:rotation@company.com)
2. **Engineering Lead**: [lead@company.com](mailto:lead@company.com)
3. **VP Engineering**: [vp@company.com](mailto:vp@company.com)

### Communication Channels

- **Slack**: #incidents (status updates every 30 minutes)
- **Status Page**: [status.company.com](https://status.company.com)
- **Email**: incident-response@company.com

## Database Access

### Read-Only Access (Safe)

```bash
# Connect to read replica
psql -h db-replica.company.com -U readonly_user -d signup_db

# Example queries
SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL '1 day';
```

### Write Access (Requires Approval)

```bash
# Connect to primary (USE WITH CAUTION)
psql -h db-primary.company.com -U admin_user -d signup_db

# Always use transactions
BEGIN;
UPDATE users SET email_verified = true WHERE id = '123';
-- Verify change
SELECT * FROM users WHERE id = '123';
COMMIT; -- or ROLLBACK;
```

## Security Incidents

### Potential Security Issue Detected

1. **Isolate**: Scale down to 1 pod, block external traffic if needed
2. **Investigate**: Review logs for suspicious activity
3. **Notify**: Email security@company.com immediately
4. **Document**: Create incident report with timeline
5. **Patch**: Deploy fix, rotate secrets if compromised
6. **Post-Mortem**: Conduct blameless review

### Rotate Secrets

```bash
# Generate new JWT secret
openssl rand -base64 32

# Update Kubernetes secret
kubectl create secret generic signup-backend-secrets \
  --from-literal=JWT_SECRET='new-secret' \
  --dry-run=client -o yaml | kubectl apply -f -

# Rolling restart to pick up new secret
kubectl rollout restart deployment/signup-backend -n production
```

## Related Documentation

- [Production Readiness Checklist](./checklist.md)
- [Architecture Decision Records](../adr/)
- [API Documentation](../api/)
- [Database Migrations](../../db/migrations/README.md)
