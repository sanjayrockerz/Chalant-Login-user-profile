# Observability Infrastructure

This directory contains the complete observability stack deployment configurations for the auth-services-monorepo, extending the existing Prometheus metrics and Winston logging with Grafana Loki for centralized log aggregation and Grafana Tempo for distributed tracing.

## Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Auth Services │    │  Log Aggregation │    │ Trace Storage   │
│                 │    │                 │    │                 │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │ Signup Svc  │ │───▶│ │    Loki     │ │    │ │   Tempo     │ │
│ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │ Login Svc   │ │───▶│ │  Promtail   │ │    │ │ OTel Coll.  │ │◀─┘
│ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
│ ┌─────────────┐ │    └─────────────────┘    └─────────────────┘
│ │ Prometheus  │ │              │                        │
│ └─────────────┘ │              │                        │
└─────────────────┘              │                        │
         │                       │                        │
         └──────────────┬────────┴────────────────────────┘
                        │
┌─────────────────────────▼─────────────────────────┐
│                  Grafana                          │
│                                                   │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐  │
│ │ Metrics     │ │ Logs        │ │ Traces      │  │
│ │ Dashboards  │ │ Dashboards  │ │ Dashboards  │  │
│ └─────────────┘ └─────────────┘ └─────────────┘  │
│                                                   │
│ ┌─────────────────────────────────────────────┐  │
│ │        Unified Service Dashboards           │  │
│ │   (Metrics + Logs + Traces in one view)    │  │
│ └─────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────┘
```

## Components

### 1. Grafana Loki - Centralized Log Aggregation
- **Purpose**: Centralized storage and querying of structured JSON logs
- **Storage**: S3-compatible object storage with cost-effective retention
- **Ingestion**: Promtail and OpenTelemetry Collector agents
- **Features**: LogQL queries, correlation with traces, retention policies

### 2. Grafana Tempo - Distributed Tracing
- **Purpose**: Long-term trace storage and querying
- **Storage**: S3-compatible object storage for scalable trace retention
- **Ingestion**: OpenTelemetry Collector with OTLP protocol
- **Features**: TraceQL queries, metrics generation, span analysis

### 3. OpenTelemetry Collector - Unified Ingestion
- **Purpose**: Collect, process, and route telemetry data
- **Inputs**: OTLP traces, Prometheus metrics, log files
- **Outputs**: Tempo (traces), Loki (logs), Prometheus (metrics)
- **Features**: Data transformation, sampling, batching

### 4. Grafana Dashboards - Unified Observability
- **Purpose**: Single pane of glass for metrics, logs, and traces
- **Features**: Service-level dashboards, correlation, navigation
- **Organization**: By service and cross-cutting concerns

## Directory Structure

```
infrastructure/
└── observability/
    ├── README.md                          # This file
    ├── docker-compose.yml                 # Local development stack
    ├── kubernetes/                        # Production Kubernetes manifests
    │   ├── namespace.yaml
    │   ├── loki/
    │   │   ├── deployment.yaml
    │   │   ├── service.yaml
    │   │   ├── configmap.yaml
    │   │   └── storage-class.yaml
    │   ├── tempo/
    │   │   ├── deployment.yaml
    │   │   ├── service.yaml
    │   │   ├── configmap.yaml
    │   │   └── storage-class.yaml
    │   ├── promtail/
    │   │   ├── daemonset.yaml
    │   │   └── configmap.yaml
    │   ├── otel-collector/
    │   │   ├── deployment.yaml
    │   │   ├── service.yaml
    │   │   └── configmap.yaml
    │   └── grafana/
    │       ├── deployment.yaml
    │       ├── service.yaml
    │       ├── configmap.yaml
    │       └── dashboards/
    ├── configs/
    │   ├── loki.yaml                      # Loki configuration
    │   ├── tempo.yaml                     # Tempo configuration
    │   ├── promtail.yaml                  # Promtail configuration
    │   ├── otel-collector.yaml            # OpenTelemetry Collector config
    │   └── grafana/
    │       ├── datasources.yaml           # Data source configurations
    │       └── dashboard-providers.yaml   # Dashboard provisioning
    ├── dashboards/                        # Grafana dashboard JSON files
    │   ├── service-level/
    │   │   ├── signup-service.json
    │   │   └── login-service.json
    │   ├── cross-cutting/
    │   │   ├── authentication.json
    │   │   ├── rate-limiting.json
    │   │   └── audit-events.json
    │   └── infrastructure/
    │       ├── loki-logs.json
    │       ├── tempo-traces.json
    │       └── observability-overview.json
    ├── alerts/                            # Prometheus alert rules
    │   ├── service-alerts.yaml
    │   ├── infrastructure-alerts.yaml
    │   └── sla-alerts.yaml
    └── scripts/                           # Deployment and maintenance scripts
        ├── deploy-local.sh
        ├── deploy-k8s.sh
        ├── verify-ingestion.sh
        └── backup-configs.sh
```

## Quick Start

### Local Development (Docker Compose)
```bash
# Start the complete observability stack
cd infrastructure/observability
./scripts/deploy-local.sh

# Verify all services are running
docker-compose ps

# Access Grafana
open http://localhost:3000
# Default credentials: admin/admin
```

### Production Deployment (Kubernetes)
```bash
# Deploy to Kubernetes cluster
cd infrastructure/observability
./scripts/deploy-k8s.sh

# Verify deployment
kubectl get pods -n observability

# Access Grafana (replace with your ingress/LoadBalancer)
kubectl port-forward -n observability svc/grafana 3000:80
```

## Data Flow

### 1. Log Ingestion Pipeline
```
Auth Services → Winston (JSON) → Log Files → Promtail → Loki → Grafana
```

### 2. Trace Ingestion Pipeline
```
Auth Services → OpenTelemetry SDK → OTel Collector → Tempo → Grafana
```

### 3. Metrics Pipeline (Existing)
```
Auth Services → Prometheus Metrics → Prometheus → Grafana
```

## Key Features

### Correlation and Navigation
- **Correlation ID tracking**: All logs and traces include correlation_id for request tracing
- **Tenant ID isolation**: Multi-tenant observability with tenant_id filtering
- **Cross-signal navigation**: Click from metric spike → traces → logs seamlessly
- **Derived fields**: Automatic trace_id extraction from logs for one-click navigation

### Retention and Storage
- **Loki**: 30 days hot storage, 1 year cold storage in S3
- **Tempo**: 7 days hot storage, 90 days cold storage in S3
- **Prometheus**: 15 days local storage, long-term via remote write

### Security and Privacy
- **PII redaction**: Automatic removal of sensitive data in logs and traces
- **Access control**: Role-based access to observability data
- **Audit logging**: All access to observability data is logged

## Documentation

- [Deployment Guide](./docs/deployment.md)
- [Configuration Reference](./docs/configuration.md)
- [Dashboard Usage](./docs/dashboards.md)
- [Troubleshooting](./docs/troubleshooting.md)
- [PII Redaction Guide](./docs/pii-redaction.md)