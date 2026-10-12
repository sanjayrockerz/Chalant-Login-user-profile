# Infrastructure Documentation

## Overview

This directory contains infrastructure-as-code, deployment manifests, and infrastructure documentation for the Personal Email Signup Backend service.

## Directory Structure

```
infra/
├── kubernetes/          # Kubernetes manifests
│   ├── base/           # Base configuration
│   ├── overlays/       # Environment-specific overlays (dev, staging, prod)
│   └── README.md
├── terraform/          # Infrastructure provisioning
│   ├── modules/        # Reusable Terraform modules
│   ├── environments/   # Environment-specific configs
│   └── README.md
├── docker/             # Docker configurations
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── .dockerignore
└── monitoring/         # Monitoring and observability configs
    ├── prometheus/     # Prometheus rules and config
    ├── grafana/        # Grafana dashboards
    └── loki/           # Log aggregation config
```

## Quick Start

### Local Development with Docker

```bash
# Build image
docker build -t signup-backend:local -f infra/docker/Dockerfile .

# Run with docker-compose
cd infra/docker
docker-compose up -d

# View logs
docker-compose logs -f signup-backend

# Stop services
docker-compose down
```

### Deploy to Kubernetes (Staging)

```bash
# Apply base configuration
kubectl apply -k infra/kubernetes/overlays/staging

# Verify deployment
kubectl get pods -n staging -l app=signup-backend

# Check logs
kubectl logs -f deployment/signup-backend -n staging
```

### Provision Infrastructure (Terraform)

```bash
# Initialize Terraform
cd infra/terraform/environments/staging
terraform init

# Plan changes
terraform plan -out=tfplan

# Apply changes
terraform apply tfplan
```

## Architecture

### High-Level Architecture

```
                         ┌─────────────────┐
                         │   Load Balancer │
                         │   (AWS ALB)     │
                         └────────┬────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
            ┌───────▼────────┐         ┌────────▼───────┐
            │  Signup Backend │         │  Signup Backend│
            │  Pod 1          │         │  Pod 2         │
            └───────┬────────┘         └────────┬───────┘
                    │                           │
        ┌───────────┴───────────────────────────┴──────────┐
        │                                                   │
┌───────▼────────┐                              ┌──────────▼─────┐
│   PostgreSQL   │                              │     Redis      │
│   (RDS)        │                              │   (ElastiCache)│
└────────────────┘                              └────────────────┘
```

### Technology Stack

- **Container Platform**: Kubernetes (EKS)
- **Container Runtime**: Docker
- **Load Balancer**: AWS ALB
- **Database**: PostgreSQL (RDS)
- **Cache**: Redis (ElastiCache)
- **Monitoring**: Prometheus + Grafana
- **Logging**: Loki + Grafana
- **Tracing**: OpenTelemetry + Jaeger
- **IaC**: Terraform
- **Secrets**: Kubernetes Secrets + AWS Secrets Manager

## Environment Configuration

### Development

**Purpose**: Local development and testing  
**URL**: http://localhost:3000  
**Database**: Local PostgreSQL (Docker)  
**Redis**: Local Redis (Docker)

### Staging

**Purpose**: Integration testing and QA  
**URL**: https://api-staging.company.com/v1  
**Database**: RDS (db.t3.small)  
**Redis**: ElastiCache (cache.t3.micro)  
**Replicas**: 2

### Production

**Purpose**: Live user traffic  
**URL**: https://api.company.com/v1  
**Database**: RDS (db.r6g.xlarge, Multi-AZ)  
**Redis**: ElastiCache (cache.r6g.large, cluster mode)  
**Replicas**: 3-10 (auto-scaling)

## Resource Requirements

### Development
- **CPU**: 0.5 cores
- **Memory**: 512 MB
- **Storage**: 10 GB

### Staging
- **CPU**: 1 core (request), 2 cores (limit)
- **Memory**: 1 GB (request), 2 GB (limit)
- **Storage**: 50 GB
- **Database**: 20 GB
- **Redis**: 1 GB

### Production
- **CPU**: 2 cores (request), 4 cores (limit)
- **Memory**: 2 GB (request), 4 GB (limit)
- **Storage**: 100 GB
- **Database**: 500 GB (auto-scaling)
- **Redis**: 10 GB

## Scaling Strategy

### Horizontal Pod Autoscaler (HPA)

```yaml
metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

**Scaling Thresholds**:
- Min Replicas: 3 (production), 2 (staging)
- Max Replicas: 10 (production), 3 (staging)
- Scale Up: CPU > 70% or Memory > 80% for 2 minutes
- Scale Down: CPU < 50% and Memory < 60% for 5 minutes

### Database Scaling

**Vertical Scaling**: Resize RDS instance during maintenance window  
**Read Replicas**: Add read replicas for read-heavy workloads  
**Connection Pooling**: Max connections = (RAM in GB) * 100

## Disaster Recovery

### Backup Strategy

**Database**:
- Automated daily snapshots (retained for 30 days)
- Point-in-time recovery (5-minute granularity)
- Cross-region replication (production only)

**Application**:
- Docker images stored in ECR with retention policy
- Git repository backed up to secondary remote

### Recovery Objectives

- **RTO (Recovery Time Objective)**: 1 hour
- **RPO (Recovery Point Objective)**: 5 minutes

### Failover Procedure

1. Detect failure (automated monitoring alerts)
2. Promote read replica to primary (RDS)
3. Update DNS/load balancer to point to failover region
4. Verify application health checks
5. Notify stakeholders

## Security

### Network Security

- **VPC**: Isolated VPC per environment
- **Security Groups**: Least privilege access
- **Network Policies**: Pod-to-pod traffic restricted
- **WAF**: AWS WAF rules for common attacks

### Secrets Management

- **Kubernetes Secrets**: Short-lived secrets (JWT keys)
- **AWS Secrets Manager**: Database credentials, API keys
- **Rotation**: Automatic rotation every 90 days

### Encryption

- **At Rest**: EBS volumes encrypted, RDS encryption enabled
- **In Transit**: TLS 1.3 for all external traffic, mTLS for pod-to-pod

### Compliance

- **GDPR**: Data residency in EU region for EU users
- **SOC 2**: Annual audit and certification
- **PCI DSS**: Not applicable (no payment card data)

## Monitoring & Alerting

### Key Metrics

| Metric | Threshold | Severity |
|--------|-----------|----------|
| Error Rate | > 1% | Critical |
| p95 Latency | > 200ms | Warning |
| p99 Latency | > 500ms | Critical |
| Pod Restarts | > 3/hour | Warning |
| Memory Usage | > 85% | Warning |
| CPU Usage | > 80% | Warning |

### Dashboards

- **Service Overview**: Request rate, error rate, latency
- **Infrastructure**: CPU, memory, disk, network
- **Database**: Connections, query performance, replication lag
- **Business Metrics**: Signups/hour, verification rate, user growth

### On-Call

- **Escalation**: PagerDuty integration
- **Response Time**: P0 (15 min), P1 (1 hour), P2 (4 hours)
- **Runbook**: See [Production Runbook](../docs/production-readiness/runbook.md)

## Cost Optimization

### Current Costs (Monthly)

**Staging**:
- EKS: $73
- RDS (db.t3.small): $35
- ElastiCache (cache.t3.micro): $15
- Total: ~$150/month

**Production**:
- EKS: $73
- RDS (db.r6g.xlarge): $350
- ElastiCache (cache.r6g.large): $150
- ALB: $20
- Data Transfer: $50
- Total: ~$650/month

### Optimization Strategies

- Use Spot Instances for non-critical workloads (50% savings)
- Right-size RDS instances based on actual usage
- Enable RDS autoscaling for storage
- Use S3 lifecycle policies for log retention
- Reserved Instances for predictable workloads (up to 72% savings)

## Maintenance Windows

**Staging**: Weekdays 10:00-12:00 UTC  
**Production**: Sundays 02:00-04:00 UTC

### Maintenance Procedures

1. Notify stakeholders 48 hours in advance
2. Create snapshot before changes
3. Apply changes during maintenance window
4. Run smoke tests
5. Monitor for 30 minutes post-deployment

## Troubleshooting

### Common Issues

#### Pods Stuck in CrashLoopBackOff
```bash
# Check pod events
kubectl describe pod <pod-name> -n <namespace>

# Check logs
kubectl logs <pod-name> -n <namespace> --previous
```

**Causes**: Database connection failure, missing secrets, OOM

#### High Database Connection Count
```bash
# Check active connections
psql -h <db-host> -U user -d db -c "SELECT count(*) FROM pg_stat_activity;"
```

**Fix**: Increase connection pool size, add read replicas

#### Redis Evictions
```bash
# Check eviction stats
redis-cli INFO stats | grep evicted_keys
```

**Fix**: Increase Redis memory, adjust eviction policy

## CI/CD Integration

### GitHub Actions Workflow

```yaml
# .github/workflows/deploy-staging.yml
on:
  push:
    branches: [main]
    paths:
      - 'services/personal-email-signup-backend/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Build Docker image
      - name: Push to ECR
      - name: Deploy to EKS
      - name: Run smoke tests
```

### Deployment Pipeline

1. **Build**: Docker image built and tagged
2. **Test**: Unit tests, integration tests, security scan
3. **Push**: Image pushed to ECR
4. **Deploy**: Kubernetes manifests applied
5. **Verify**: Health checks, smoke tests
6. **Rollback**: Automatic rollback if health checks fail

## Related Documentation

- [Production Runbook](../docs/production-readiness/runbook.md)
- [Kubernetes Manifests](./kubernetes/README.md)
- [Terraform Modules](./terraform/README.md)
- [Docker Configuration](./docker/README.md)

## Contact

- **Infrastructure Team**: #infrastructure (Slack)
- **DevOps**: devops@company.com
- **Oncall**: oncall@company.com
