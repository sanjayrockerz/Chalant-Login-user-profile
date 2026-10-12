# Production Readiness Checklist

## Pre-Deployment Requirements

### 1. Code Quality & Security
- [ ] All tests passing (unit, integration, security)
- [ ] Code coverage ≥ 80%
- [ ] Security scan passed (Snyk/SonarQube)
- [ ] Dependency audit clean (`npm audit`)
- [ ] No hardcoded secrets or credentials
- [ ] Rate limiting configured
- [ ] Input validation comprehensive
- [ ] SQL injection protection verified
- [ ] XSS/CSRF protection enabled

### 2. Observability & Monitoring
- [ ] Prometheus metrics exposed (`/metrics`)
- [ ] Correlation IDs flowing through all requests
- [ ] Tenant IDs tracked for multi-tenancy
- [ ] Winston logging configured (JSON format)
- [ ] Log levels appropriate (INFO for production)
- [ ] Distributed tracing enabled (OpenTelemetry)
- [ ] Grafana dashboards created
- [ ] Alert rules configured (Prometheus/Grafana)
- [ ] Log aggregation configured (Loki)

### 3. Database & Data
- [ ] Migrations tested on production-like data
- [ ] Rollback plan documented
- [ ] Database backups automated
- [ ] Connection pooling optimized
- [ ] Indexes reviewed for performance
- [ ] Data retention policy defined
- [ ] PII handling compliant (GDPR/CCPA)

### 4. Infrastructure & Deployment
- [ ] Docker image built and scanned
- [ ] Kubernetes manifests validated
- [ ] Resource limits configured (CPU/memory)
- [ ] Health checks implemented (liveness/readiness)
- [ ] Horizontal pod autoscaling configured
- [ ] Network policies defined
- [ ] Secrets managed via Kubernetes Secrets/Vault
- [ ] CI/CD pipeline tested
- [ ] Blue-green or canary deployment strategy defined

### 5. Performance & Scalability
- [ ] Load testing completed
- [ ] Performance benchmarks met (p95 latency, throughput)
- [ ] Redis caching strategy validated
- [ ] Database query performance optimized
- [ ] API response times acceptable
- [ ] Connection pooling tuned
- [ ] Rate limiting thresholds set

### 6. Resilience & Reliability
- [ ] Circuit breakers configured
- [ ] Retry logic implemented with backoff
- [ ] Timeout values set appropriately
- [ ] Graceful shutdown implemented
- [ ] Error handling comprehensive
- [ ] Failover scenarios tested
- [ ] Disaster recovery plan documented

### 7. Documentation
- [ ] API documentation complete (OpenAPI/Swagger)
- [ ] Runbook created (see `runbook.md`)
- [ ] Architecture Decision Records updated
- [ ] Deployment guide current
- [ ] Troubleshooting guide available
- [ ] Oncall playbook ready

### 8. Compliance & Legal
- [ ] Terms of service acceptance enforced
- [ ] Privacy policy acceptance tracked
- [ ] User consent logged
- [ ] Audit logging enabled
- [ ] Data residency requirements met
- [ ] Compliance review approved

## Deployment Day Checklist

### Pre-Deployment
- [ ] Change request approved
- [ ] Stakeholders notified
- [ ] Rollback plan reviewed
- [ ] Backup taken
- [ ] Monitoring dashboards open
- [ ] Oncall engineer available

### During Deployment
- [ ] Database migrations applied
- [ ] Application deployed
- [ ] Health checks passing
- [ ] Smoke tests executed
- [ ] Metrics baseline captured

### Post-Deployment
- [ ] Error rates normal
- [ ] Latency within SLO
- [ ] User flows validated
- [ ] Logs reviewed (no critical errors)
- [ ] Alerts silent
- [ ] Stakeholders notified of completion
- [ ] Post-mortem scheduled (if issues)

## SLOs (Service Level Objectives)

| Metric | Target | Measurement |
|--------|--------|-------------|
| Availability | 99.9% | Uptime over 30 days |
| Latency (p95) | < 200ms | API response time |
| Latency (p99) | < 500ms | API response time |
| Error Rate | < 0.1% | 5xx errors per total requests |
| Throughput | 1000 req/s | Concurrent requests |

## Rollback Criteria

Initiate rollback if:
- Error rate > 1% for 5 minutes
- p95 latency > 500ms for 5 minutes
- Critical functionality broken
- Data corruption detected
- Security vulnerability discovered

## Contact Information

- **Oncall Engineer**: [rotation@company.com](mailto:rotation@company.com)
- **Engineering Lead**: [lead@company.com](mailto:lead@company.com)
- **DevOps**: [devops@company.com](mailto:devops@company.com)
- **Incident Channel**: #incidents (Slack)

## Related Documentation

- [Deployment Runbook](./runbook.md)
- [Architecture Decisions](../adr/)
- [API Documentation](../api/)
- [Troubleshooting Guide](../../README.md#troubleshooting)
