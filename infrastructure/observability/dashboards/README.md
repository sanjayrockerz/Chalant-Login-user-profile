# 📊 SLO Dashboard Deployment Guide

## Overview
This guide covers the deployment and configuration of Grafana dashboards for SLO monitoring, error budget tracking, and reliability reporting.

## Dashboard Architecture

### Dashboard Hierarchy
```
SLO Monitoring Platform
├── SLO Overview Dashboard          # Real-time monitoring
├── Error Budget Dashboard          # Budget consumption tracking  
└── Monthly SLO Report             # Compliance and reporting
```

### Data Flow
```
Prometheus Metrics → Recording Rules → Grafana Dashboards → Alerts & Reports
```

## Dashboard Components

### 1. SLO Overview Dashboard (`slo-overview.json`)

**Purpose**: Real-time operational monitoring of SLO compliance and service health

**Key Panels**:
- **SLO Compliance Status**: Current availability vs targets with color-coded thresholds
- **Error Budget Status**: Remaining error budget visualization with risk indicators
- **Current Burn Rate**: Real-time burn rate monitoring with alert thresholds
- **7-Day Availability Trend**: Historical availability with SLO target lines
- **Error Rate by Service**: Service-specific error rate trends
- **Request Volume**: Traffic patterns and volume trends
- **P99 Latency**: Latency performance vs SLO targets
- **Authentication Success Rate**: Auth-specific SLI monitoring
- **Alert Status**: Current SLO alert states in tabular format

**Variables**:
- `$service`: Multi-select service filter
- `$environment`: Environment filter (production, staging, etc.)

**Refresh**: 1 minute (real-time monitoring)

### 2. Error Budget Dashboard (`error-budget-dashboard.json`)

**Purpose**: Focused error budget management and consumption analysis

**Key Panels**:
- **Error Budget Summary**: High-level budget status across services
- **30-Day Error Budget Consumption**: Historical consumption trends
- **Daily Error Budget Burn Rate**: Daily consumption with sustainable thresholds
- **Error Budget Velocity**: Rate of change in budget consumption
- **Error Budget Forecast**: Predictive analysis for budget exhaustion
- **Current Month Status**: Tabular summary of budget metrics
- **Risk Assessment**: Color-coded risk levels based on consumption patterns

**Features**:
- Predictive analytics for budget exhaustion
- Sustainable burn rate comparisons
- Risk-based color coding
- Historical pattern analysis

**Refresh**: 5 minutes

### 3. Monthly SLO Report (`monthly-slo-report.json`)

**Purpose**: Executive reporting and compliance tracking

**Key Panels**:
- **Monthly SLO Compliance Summary**: Comprehensive compliance table
- **90-Day SLO Compliance Trend**: Long-term reliability trends
- **Monthly Error Budget Consumption**: Historical budget usage patterns
- **Incident Impact on SLOs**: Incident correlation with SLO violations
- **Service Performance Metrics**: P95/P99 latency over 90 days
- **Request Volume Trends**: Traffic pattern analysis
- **SLO Compliance Score**: Overall compliance gauge
- **Key Performance Indicators**: Executive summary statistics

**Features**:
- Extended time ranges (90 days)
- Executive-friendly visualizations
- Compliance scoring
- Incident correlation

**Refresh**: 1 hour

## Deployment Instructions

### 1. Prerequisites

**Grafana Setup**:
```bash
# Ensure Grafana is running
kubectl get pods -n monitoring -l app=grafana

# Verify Prometheus datasource
curl -X GET "http://grafana:3000/api/datasources" \
  -H "Authorization: Bearer $GRAFANA_API_KEY"
```

**Required Prometheus Metrics**:
- Recording rules from `slo-recording-rules.yml`
- Base metrics: `http_requests_total`, `http_request_duration_seconds`
- Alert metrics: `ALERTS` with SLO alert names

### 2. Dashboard Import

**Option A: Grafana UI Import**
1. Navigate to Grafana UI → Dashboards → Import
2. Upload each JSON file individually
3. Configure datasource (Prometheus)
4. Set folder organization

**Option B: API Import**
```bash
# Import SLO Overview Dashboard
curl -X POST \
  "http://grafana:3000/api/dashboards/db" \
  -H "Authorization: Bearer $GRAFANA_API_KEY" \
  -H "Content-Type: application/json" \
  -d @infrastructure/observability/dashboards/slo-overview.json

# Import Error Budget Dashboard  
curl -X POST \
  "http://grafana:3000/api/dashboards/db" \
  -H "Authorization: Bearer $GRAFANA_API_KEY" \
  -H "Content-Type: application/json" \
  -d @infrastructure/observability/dashboards/error-budget-dashboard.json

# Import Monthly Report Dashboard
curl -X POST \
  "http://grafana:3000/api/dashboards/db" \
  -H "Authorization: Bearer $GRAFANA_API_KEY" \
  -H "Content-Type: application/json" \
  -d @infrastructure/observability/dashboards/monthly-slo-report.json
```

**Option C: GitOps Deployment**
```bash
# Add to ArgoCD/Flux configuration
kubectl apply -f infrastructure/observability/dashboards/
```

### 3. Dashboard Configuration

**Datasource Configuration**:
```json
{
  "name": "Prometheus",
  "type": "prometheus", 
  "url": "http://prometheus:9090",
  "access": "proxy",
  "isDefault": true
}
```

**Variable Configuration**:
- Ensure service labels match your metric labels
- Configure environment values for your deployment
- Adjust time ranges based on data retention

### 4. Permissions and Access

**Role-Based Access**:
```bash
# Create SLO Viewer role
curl -X POST \
  "http://grafana:3000/api/orgs/1/users" \
  -H "Authorization: Bearer $GRAFANA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "loginOrEmail": "slo-viewer@company.com",
    "role": "Viewer"
  }'

# Create SLO Admin role
curl -X POST \
  "http://grafana:3000/api/orgs/1/users" \
  -H "Authorization: Bearer $GRAFANA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "loginOrEmail": "slo-admin@company.com", 
    "role": "Admin"
  }'
```

**Dashboard Permissions**:
- **Viewers**: Read-only access to all SLO dashboards
- **Editors**: Can modify dashboards and variables
- **Admins**: Full access including permissions management

### 5. Integration with Alerting

**Dashboard Links in Alerts**:
```yaml
# In alerting rules annotations
annotations:
  dashboard: "{{ $externalURL }}/d/slo-overview/slo-overview?var-service={{ $labels.service }}"
  error_budget: "{{ $externalURL }}/d/error-budget/error-budget-dashboard?var-service={{ $labels.service }}"
```

**Alert Annotations on Dashboards**:
- SLO alerts automatically appear as annotations
- Color-coded by severity
- Clickable for alert details

## Customization

### Service-Specific Customization

**Adding New Services**:
1. Ensure recording rules include new service labels
2. Update dashboard variable queries
3. Add service-specific panels if needed
4. Configure alert correlation

**Custom Metrics Integration**:
```json
{
  "expr": "your_custom_sli_metric{service=~\"$service\"}",
  "legendFormat": "{{service}} - Custom SLI"
}
```

### Visual Customization

**Thresholds**:
- Green: Meeting SLO targets
- Yellow: Warning levels (75-90% of targets)
- Red: Critical levels (below targets)

**Color Schemes**:
- Availability: Red < 99.9%, Yellow 99.9-99.95%, Green > 99.95%
- Error Budget: Red < 25%, Yellow 25-50%, Green > 50%
- Latency: Red > 500ms, Yellow 300-500ms, Green < 300ms

### Time Range Configuration

**Default Ranges**:
- SLO Overview: 7 days (operational focus)
- Error Budget: 30 days (monthly budget cycle)
- Monthly Report: 90 days (trend analysis)

**Custom Ranges**:
```json
{
  "time": {
    "from": "now-7d",
    "to": "now"
  },
  "timepicker": {
    "refresh_intervals": ["1m", "5m", "15m", "30m", "1h"]
  }
}
```

## Maintenance

### Regular Updates

**Monthly Reviews**:
- Verify dashboard accuracy with actual SLO compliance
- Update thresholds based on service evolution
- Review variable configurations
- Check panel query performance

**Quarterly Updates**:
- Review dashboard user feedback
- Update visualizations for new requirements
- Optimize query performance
- Plan new features

### Performance Optimization

**Query Optimization**:
```promql
# Use recording rules instead of complex queries
sli:availability_1h{service="login-page-back"}

# Instead of:
(
  sum(rate(http_requests_total{service="login-page-back",status_code!~"5.."}[1h])) /
  sum(rate(http_requests_total{service="login-page-back"}[1h]))
)
```

**Panel Optimization**:
- Use appropriate visualization types
- Limit time series cardinality
- Configure reasonable refresh intervals
- Use template variables effectively

### Troubleshooting

**Common Issues**:

1. **No Data in Panels**:
   - Verify Prometheus datasource connectivity
   - Check metric label alignment
   - Validate recording rule execution

2. **Slow Dashboard Loading**:
   - Optimize query time ranges
   - Reduce panel query complexity
   - Check Prometheus performance

3. **Incorrect Variable Values**:
   - Verify label_values() queries
   - Check metric label consistency
   - Update variable refresh settings

**Debugging Queries**:
```bash
# Test Prometheus queries directly
curl -G "http://prometheus:9090/api/v1/query" \
  --data-urlencode "query=sli:availability_1h{service=\"login-page-back\"}"

# Check recording rule execution
curl -G "http://prometheus:9090/api/v1/query" \
  --data-urlencode "query=prometheus_rule_evaluation_duration_seconds"
```

## Documentation and Training

### User Guide Creation
- Dashboard navigation training
- Interpretation of SLO metrics
- How to use filters and time ranges
- Alert correlation workflows

### Operational Procedures
- Daily SLO review process
- Weekly error budget assessments
- Monthly compliance reporting
- Quarterly target reviews

---

**Documentation Version**: 1.0  
**Last Updated**: {{ date "2006-01-02" now }}  
**Next Review**: {{ date "2006-01-02" (time.Now.AddDate 0 1 0) }}  
**Owner**: Platform Engineering Team