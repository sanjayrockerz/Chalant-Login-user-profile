# Onboarding Service - Grafana Dashboard Configuration

This dashboard provides comprehensive monitoring for the onboarding service with focus on:
- Request patterns and performance
- Rate limiting effectiveness
- Validation error patterns  
- Audit event tracking
- SLO monitoring and alerting

## Dashboard JSON Configuration

```json
{
  "dashboard": {
    "id": null,
    "title": "Onboarding Service - Performance & Security",
    "tags": ["onboarding", "security", "performance"],
    "timezone": "browser",
    "refresh": "30s",
    "time": {
      "from": "now-1h",
      "to": "now"
    },
    "panels": [
      {
        "id": 1,
        "title": "Request Rate (RPS)",
        "type": "stat",
        "targets": [
          {
            "expr": "rate(onboarding_requests_total[5m])",
            "legendFormat": "{{endpoint}} - {{method}}",
            "interval": "30s"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "reqps",
            "thresholds": {
              "steps": [
                {"color": "green", "value": null},
                {"color": "yellow", "value": 100},
                {"color": "red", "value": 500}
              ]
            }
          }
        },
        "gridPos": {"h": 8, "w": 12, "x": 0, "y": 0}
      },
      {
        "id": 2,
        "title": "Response Time (P95)",
        "type": "stat",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(onboarding_requests_duration_seconds_bucket[5m]))",
            "legendFormat": "P95 Response Time",
            "interval": "30s"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "s",
            "thresholds": {
              "steps": [
                {"color": "green", "value": null},
                {"color": "yellow", "value": 0.5},
                {"color": "red", "value": 2.0}
              ]
            }
          }
        },
        "gridPos": {"h": 8, "w": 12, "x": 12, "y": 0}
      },
      {
        "id": 3,
        "title": "Error Rate by Endpoint",
        "type": "timeseries",
        "targets": [
          {
            "expr": "rate(onboarding_errors_total[5m]) / rate(onboarding_requests_total[5m]) * 100",
            "legendFormat": "{{endpoint}} Error Rate",
            "interval": "30s"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "percent",
            "max": 100
          }
        },
        "gridPos": {"h": 8, "w": 24, "x": 0, "y": 8}
      },
      {
        "id": 4,
        "title": "Rate Limit Violations",
        "type": "timeseries",
        "targets": [
          {
            "expr": "rate(onboarding_rate_limit_violations_total[5m])",
            "legendFormat": "{{rate_limit_dimension}} - {{endpoint}}",
            "interval": "30s"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "reqps"
          }
        },
        "gridPos": {"h": 8, "w": 12, "x": 0, "y": 16}
      },
      {
        "id": 5,
        "title": "Validation Errors",
        "type": "timeseries",
        "targets": [
          {
            "expr": "rate(onboarding_validation_errors_total[5m])",
            "legendFormat": "{{validation_field}} - {{error_type}}",
            "interval": "30s"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "reqps"
          }
        },
        "gridPos": {"h": 8, "w": 12, "x": 12, "y": 16}
      },
      {
        "id": 6,
        "title": "Active Requests",
        "type": "stat",
        "targets": [
          {
            "expr": "onboarding_active_requests",
            "legendFormat": "Active Requests",
            "interval": "10s"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "short",
            "thresholds": {
              "steps": [
                {"color": "green", "value": null},
                {"color": "yellow", "value": 100},
                {"color": "red", "value": 500}
              ]
            }
          }
        },
        "gridPos": {"h": 8, "w": 6, "x": 0, "y": 24}
      },
      {
        "id": 7,
        "title": "Audit Events Rate",
        "type": "stat",
        "targets": [
          {
            "expr": "rate(onboarding_audit_events_total[5m])",
            "legendFormat": "{{audit_event_type}}",
            "interval": "30s"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "reqps"
          }
        },
        "gridPos": {"h": 8, "w": 6, "x": 6, "y": 24}
      },
      {
        "id": 8,
        "title": "Username Operations",
        "type": "timeseries",
        "targets": [
          {
            "expr": "rate(onboarding_username_checks_total[5m])",
            "legendFormat": "Username Checks - {{operation_type}}",
            "interval": "30s"
          },
          {
            "expr": "rate(onboarding_username_updates_total[5m])",
            "legendFormat": "Username Updates - {{operation_type}}",
            "interval": "30s"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "reqps"
          }
        },
        "gridPos": {"h": 8, "w": 12, "x": 12, "y": 24}
      },
      {
        "id": 9,
        "title": "Registration Success Rate",
        "type": "stat",
        "targets": [
          {
            "expr": "(rate(onboarding_registrations_total[5m]) - rate(onboarding_errors_total{error_type=\"registration_failed\"}[5m])) / rate(onboarding_registrations_total[5m]) * 100",
            "legendFormat": "Registration Success Rate",
            "interval": "30s"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "percent",
            "thresholds": {
              "steps": [
                {"color": "red", "value": null},
                {"color": "yellow", "value": 95},
                {"color": "green", "value": 99}
              ]
            }
          }
        },
        "gridPos": {"h": 8, "w": 12, "x": 0, "y": 32}
      },
      {
        "id": 10,
        "title": "Response Time Distribution",
        "type": "heatmap",
        "targets": [
          {
            "expr": "rate(onboarding_requests_duration_seconds_bucket[5m])",
            "legendFormat": "{{le}}",
            "interval": "30s"
          }
        ],
        "gridPos": {"h": 8, "w": 12, "x": 12, "y": 32}
      }
    ],
    "templating": {
      "list": [
        {
          "name": "environment",
          "type": "query",
          "query": "label_values(onboarding_requests_total, environment)",
          "refresh": 1
        },
        {
          "name": "tenant",
          "type": "query",
          "query": "label_values(onboarding_requests_total{environment=\"$environment\"}, tenant_id)",
          "refresh": 1
        }
      ]
    }
  }
}
```

## SLO Alert Rules Configuration

```yaml
# onboarding-service-alerts.yml
groups:
  - name: onboarding-service-slo
    rules:
      # Availability SLO: 99.9% success rate
      - alert: OnboardingAvailabilitySLOViolation
        expr: |
          (
            rate(onboarding_requests_total[5m]) - 
            rate(onboarding_errors_total{error_type!~"validation.*"}[5m])
          ) / rate(onboarding_requests_total[5m]) < 0.999
        for: 2m
        labels:
          severity: critical
          service: onboarding
          slo: availability
        annotations:
          summary: "Onboarding service availability SLO violation"
          description: "Availability is {{ $value | humanizePercentage }} over the last 5 minutes, below 99.9% SLO"
          runbook: "https://wiki.company.com/runbooks/onboarding-availability"

      # Latency SLO: 95% of requests under 500ms
      - alert: OnboardingLatencySLOViolation
        expr: |
          histogram_quantile(0.95, rate(onboarding_requests_duration_seconds_bucket[5m])) > 0.5
        for: 2m
        labels:
          severity: warning
          service: onboarding
          slo: latency
        annotations:
          summary: "Onboarding service latency SLO violation"
          description: "P95 latency is {{ $value }}s over the last 5 minutes, above 500ms SLO"
          runbook: "https://wiki.company.com/runbooks/onboarding-latency"

      # Rate Limit Saturation Alert
      - alert: OnboardingRateLimitSaturation
        expr: |
          rate(onboarding_rate_limit_violations_total[5m]) > 10
        for: 1m
        labels:
          severity: warning
          service: onboarding
          slo: capacity
        annotations:
          summary: "High rate limit violations detected"
          description: "Rate limit violations at {{ $value }} req/s for {{ $labels.rate_limit_dimension }}"
          runbook: "https://wiki.company.com/runbooks/onboarding-rate-limits"

      # Username Enumeration Attack Detection
      - alert: OnboardingUsernameEnumerationAttack
        expr: |
          rate(onboarding_username_checks_total[1m]) > 100 and
          rate(onboarding_rate_limit_violations_total{rate_limit_dimension="ip"}[1m]) > 5
        for: 30s
        labels:
          severity: critical
          service: onboarding
          security: true
        annotations:
          summary: "Potential username enumeration attack detected"
          description: "High username check rate ({{ $value }} req/s) with rate limit violations"
          runbook: "https://wiki.company.com/runbooks/security-incidents"

      # Validation Error Spike
      - alert: OnboardingValidationErrorSpike
        expr: |
          rate(onboarding_validation_errors_total[5m]) > 50
        for: 2m
        labels:
          severity: warning
          service: onboarding
        annotations:
          summary: "High validation error rate detected"
          description: "Validation errors at {{ $value }} req/s, investigate client issues or attacks"

      # Audit Event Failure
      - alert: OnboardingAuditEventFailures
        expr: |
          rate(onboarding_audit_errors_total[5m]) > 1
        for: 1m
        labels:
          severity: warning
          service: onboarding
          compliance: true
        annotations:
          summary: "Audit event emission failures detected"
          description: "{{ $value }} audit events failing per second, compliance risk"
          runbook: "https://wiki.company.com/runbooks/audit-failures"

      # High Error Rate by Endpoint
      - alert: OnboardingEndpointErrorRate
        expr: |
          rate(onboarding_errors_total[5m]) / rate(onboarding_requests_total[5m]) > 0.1
        for: 2m
        labels:
          severity: warning
          service: onboarding
        annotations:
          summary: "High error rate on {{ $labels.endpoint }}"
          description: "Error rate is {{ $value | humanizePercentage }} on {{ $labels.endpoint }}"

      # Active Request Buildup
      - alert: OnboardingActiveRequestBuildup
        expr: |
          onboarding_active_requests > 1000
        for: 1m
        labels:
          severity: critical
          service: onboarding
        annotations:
          summary: "High number of active requests"
          description: "{{ $value }} active requests, potential performance degradation"

      # Registration Success Rate Drop
      - alert: OnboardingRegistrationSuccessRateDrop
        expr: |
          (
            rate(onboarding_registrations_total[5m]) - 
            rate(onboarding_errors_total{error_type="registration_failed"}[5m])
          ) / rate(onboarding_registrations_total[5m]) < 0.95
        for: 2m
        labels:
          severity: warning
          service: onboarding
          business_impact: true
        annotations:
          summary: "Registration success rate below 95%"
          description: "Registration success rate is {{ $value | humanizePercentage }}"
          runbook: "https://wiki.company.com/runbooks/registration-issues"

  - name: onboarding-service-capacity
    rules:
      # Capacity Planning Alerts
      - alert: OnboardingHighThroughput
        expr: |
          rate(onboarding_requests_total[5m]) > 1000
        for: 5m
        labels:
          severity: info
          service: onboarding
          capacity_planning: true
        annotations:
          summary: "High throughput detected - capacity planning required"
          description: "Request rate at {{ $value }} req/s, consider scaling"

      # Memory/Resource Usage (would require additional metrics)
      - alert: OnboardingHighMemoryUsage
        expr: |
          process_resident_memory_bytes{service="onboarding"} > 1000000000
        for: 2m
        labels:
          severity: warning
          service: onboarding
        annotations:
          summary: "High memory usage detected"
          description: "Memory usage at {{ $value | humanizeBytes }}"
```

## Loki Log-based Alerts

```yaml
# onboarding-service-log-alerts.yml
groups:
  - name: onboarding-service-logs
    rules:
      # Security Event Detection
      - alert: OnboardingSecurityEventDetected
        expr: |
          rate({service="onboarding"} |= "SECURITY" [5m]) > 0.1
        for: 30s
        labels:
          severity: critical
          service: onboarding
          security: true
        annotations:
          summary: "Security events detected in onboarding service logs"
          description: "{{ $value }} security events per second detected"

      # Failed Authentication Spike
      - alert: OnboardingAuthenticationFailureSpike
        expr: |
          rate({service="onboarding"} |= "authentication" |= "failed" [5m]) > 5
        for: 1m
        labels:
          severity: warning
          service: onboarding
          security: true
        annotations:
          summary: "High authentication failure rate"
          description: "{{ $value }} authentication failures per second"

      # Error Log Spike
      - alert: OnboardingErrorLogSpike
        expr: |
          rate({service="onboarding"} |= "ERROR" [5m]) > 10
        for: 2m
        labels:
          severity: warning
          service: onboarding
        annotations:
          summary: "High error log rate detected"
          description: "{{ $value }} errors per second in logs"

      # Audit Event Correlation ID Missing
      - alert: OnboardingMissingCorrelationId
        expr: |
          rate({service="onboarding"} |= "AUDIT_EVENT" !~ ".*correlation_id.*" [5m]) > 0.1
        for: 1m
        labels:
          severity: warning
          service: onboarding
          compliance: true
        annotations:
          summary: "Audit events missing correlation IDs"
          description: "Audit events without correlation IDs detected"
```

## SLO Configuration

```yaml
# onboarding-service-slo.yml
apiVersion: sloth.slok.dev/v1
kind: PrometheusServiceLevelObjective
metadata:
  name: onboarding-service-slo
  namespace: monitoring
spec:
  service: "onboarding"
  labels:
    team: "platform"
    tier: "critical"
  
  slos:
    - name: "availability"
      objective: 99.9
      description: "99.9% of requests should succeed"
      sli:
        events:
          error_query: |
            sum(rate(onboarding_errors_total{error_type!~"validation.*"}[5m]))
          total_query: |
            sum(rate(onboarding_requests_total[5m]))
      alerting:
        name: "OnboardingAvailability"
        labels:
          severity: "critical"
          category: "availability"
        annotations:
          summary: "Onboarding service availability SLO violation"
          runbook: "https://wiki.company.com/runbooks/onboarding-availability"
        page_alert:
          labels:
            severity: "critical"
            alert_type: "page"
        ticket_alert:
          labels:
            severity: "warning"
            alert_type: "ticket"

    - name: "latency"
      objective: 95.0
      description: "95% of requests should be served under 500ms"
      sli:
        events:
          error_query: |
            sum(rate(onboarding_requests_duration_seconds_bucket{le="0.5"}[5m]))
          total_query: |
            sum(rate(onboarding_requests_duration_seconds_count[5m]))
      alerting:
        name: "OnboardingLatency"
        labels:
          severity: "warning"
          category: "latency"
        annotations:
          summary: "Onboarding service latency SLO violation"
          runbook: "https://wiki.company.com/runbooks/onboarding-latency"
```

## Dashboard Installation Instructions

1. **Import Dashboard to Grafana:**
   ```bash
   curl -X POST \
     -H "Authorization: Bearer $GRAFANA_API_KEY" \
     -H "Content-Type: application/json" \
     -d @onboarding-dashboard.json \
     http://grafana.company.com/api/dashboards/db
   ```

2. **Deploy Alert Rules:**
   ```bash
   kubectl apply -f onboarding-service-alerts.yml -n monitoring
   kubectl apply -f onboarding-service-log-alerts.yml -n monitoring
   ```

3. **Configure SLO Monitoring:**
   ```bash
   kubectl apply -f onboarding-service-slo.yml -n monitoring
   ```

## Key Metrics to Monitor

### Business Metrics
- Registration conversion rate
- Username availability check patterns
- Legal acceptance completion rates
- Profile completion rates

### Security Metrics
- Rate limit violation patterns
- Authentication failure rates
- Audit event emission success
- Potential enumeration attacks

### Performance Metrics
- Request latency percentiles (P50, P95, P99)
- Error rates by endpoint and error type
- Throughput and capacity utilization
- Response time distribution

### Operational Metrics
- Active request counts
- Validation error patterns
- Service availability
- Resource utilization