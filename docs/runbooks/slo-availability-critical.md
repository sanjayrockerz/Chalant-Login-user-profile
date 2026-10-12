# 🚨 SLO Availability Critical Alert Runbook

## Alert Overview
**Alert Name**: `SLOAvailabilityCritical_*Service`  
**Severity**: Critical  
**Response Time**: Immediate (Page On-Call)  
**SLO Impact**: High - Error budget consumption at unsustainable rate

## Alert Description
This alert fires when service availability is degrading at a critical burn rate, indicating that the error budget will be exhausted in approximately 6 hours if the current rate continues.

### Trigger Conditions
- **Short window burn rate** (5min): > 14.4x normal consumption
- **Medium window burn rate** (1hr): > 6x normal consumption
- **Availability SLI**: Below SLO target for the time window

### Services Covered
- **personal-email-signup-backend** (SLO: 99.9%)
- **login-page-back** (SLO: 99.95%)

## 🏃‍♂️ Immediate Response (First 5 minutes)

### 1. Alert Acknowledgment
- [ ] Acknowledge the alert in PagerDuty/Opsgenie
- [ ] Join the incident response channel (#incident-response)
- [ ] Declare incident severity based on business impact

### 2. Initial Assessment
Access the alert details to gather context:

```bash
# From alert payload, extract:
correlation_id="{{ correlation_id }}"
trace_id="{{ trace_id }}"
service="{{ service }}"
environment="{{ environment }}"
```

**Quick Status Check:**
- [ ] Open Grafana dashboard: [Service Dashboard]({{ grafana_url }})
- [ ] Check current availability metrics
- [ ] Verify if users are actually impacted (not just metrics anomaly)

### 3. User Impact Validation
**Critical Questions:**
- Are real users experiencing errors?
- Is this affecting all users or specific segments?
- Are there any ongoing deployments or maintenance?

**Quick Validation:**
```bash
# Check recent error patterns in Loki
# Use correlation_id from alert for targeted investigation
curl -G "http://loki:3100/loki/api/v1/query_range" \
  --data-urlencode 'query={service="'$service'"} |~ "ERROR|5.." | json' \
  --data-urlencode 'start=now-15m' \
  --data-urlencode 'end=now'
```

## 🔍 Detailed Investigation (5-15 minutes)

### 1. Root Cause Analysis with Correlation ID

If `correlation_id` is available from the alert:

**Trace Analysis:**
- [ ] Open [Tempo Traces]({{ $externalURL }}/d/tempo/tempo?var-correlation_id={{ correlation_id }})
- [ ] Search for trace: `{ .correlation_id = "{{ correlation_id }}" }`
- [ ] Identify failing spans and error patterns

**Log Correlation:**
- [ ] Search Loki: `{service="{{ service }}"} | json | correlation_id="{{ correlation_id }}"`
- [ ] Review complete request lifecycle
- [ ] Identify error messages and stack traces

### 2. Service Health Assessment

**Infrastructure Health:**
```bash
# Check service pods/containers health
kubectl get pods -l app={{ service }} -o wide

# Check resource utilization
kubectl top pods -l app={{ service }}

# Recent pod events
kubectl describe pods -l app={{ service }} | grep -A5 -B5 Warning
```

**Dependencies Check:**
- [ ] Database connectivity and performance
- [ ] External API dependencies
- [ ] Redis/Cache layer health
- [ ] Load balancer health

### 3. Error Pattern Analysis

**Prometheus Queries for Investigation:**
```promql
# Current error rate by endpoint
rate(http_requests_total{service="{{ service }}", status_code=~"5.."}[5m]) by (endpoint)

# Error rate compared to historical baseline
rate(http_requests_total{service="{{ service }}", status_code=~"5.."}[5m]) / 
rate(http_requests_total{service="{{ service }}", status_code=~"5.."}[1d] offset 1w)

# Request latency percentiles
histogram_quantile(0.95, 
  rate(http_request_duration_seconds_bucket{service="{{ service }}"}[5m])
)
```

## 🛠️ Remediation Actions

### Immediate Mitigations (Priority Order)

#### 1. Traffic Management
**If overload suspected:**
- [ ] Enable rate limiting: Check current limits in [Rate Limiting Dashboard]({{ $externalURL }}/d/rate-limiting-observability)
- [ ] Scale service horizontally:
  ```bash
  kubectl scale deployment {{ service }} --replicas=6
  ```
- [ ] Implement circuit breakers for external dependencies

#### 2. Recent Changes Rollback
**If deployment-related:**
- [ ] Check recent deployments:
  ```bash
  kubectl rollout history deployment/{{ service }}
  ```
- [ ] Rollback if recent deployment correlates with issue:
  ```bash
  kubectl rollout undo deployment/{{ service }}
  ```

#### 3. Database Issues
**If database-related errors:**
- [ ] Check database connection pool:
  ```promql
  database_connections_active{service="{{ service }}"}
  database_connections_max_open{service="{{ service }}"}
  ```
- [ ] Review slow query logs
- [ ] Consider read replica failover if applicable

#### 4. External Dependencies
**If external service failures:**
- [ ] Check dependency health in [Service Map]({{ $externalURL }}/d/tempo/tempo?view=serviceMap)
- [ ] Implement fallback mechanisms
- [ ] Consider disabling non-critical integrations

### Service-Specific Actions

#### For personal-email-signup-backend:
- [ ] Check email service provider status
- [ ] Verify OTP service functionality
- [ ] Review user validation pipeline
- [ ] Consider disabling non-essential signup features

#### For login-page-back:
- [ ] Check authentication provider health
- [ ] Verify session storage (Redis) connectivity
- [ ] Review rate limiting on auth endpoints
- [ ] Consider falling back to alternative auth methods

## 📊 Monitoring and Escalation

### Continuous Monitoring
During incident response, monitor these key metrics:

```promql
# Real-time availability
sli:availability_5m{service="{{ service }}"}

# Current burn rate
slo:burn_rate_availability_5m{service="{{ service }}"}

# User impact (request volume)
rate(http_requests_total{service="{{ service }}"}[5m])
```

### Escalation Triggers
Escalate immediately if:
- [ ] Availability drops below 95% for > 10 minutes
- [ ] User-visible impact confirmed and growing
- [ ] Initial mitigations are not effective within 15 minutes
- [ ] Multiple services affected (potential platform issue)

### Escalation Contacts
- **L2 Escalation**: Senior Platform Engineer (auto via PagerDuty)
- **L3 Escalation**: Engineering Manager (15min auto-escalation)
- **Customer Impact**: Customer Success team (for external users)
- **Executive**: VP Engineering (for major outages)

## 💬 Communication

### Internal Communication
**Incident Channel**: `#incident-response`

**Initial Status Update Template:**
```
🚨 INCIDENT DECLARED - {{ service }} Availability Critical

Service: {{ service }}
SLO Impact: Critical burn rate - {{ current_availability }}% availability
User Impact: [Investigating/Confirmed/Mitigated]
ETA: Investigating (next update in 15min)

Correlation ID: {{ correlation_id }}
Dashboard: {{ grafana_url }}
Incident Commander: @{{ your_name }}
```

### External Communication
**If user-facing impact confirmed:**

**Status Page Update:**
- Impact: "Investigating authentication/registration issues"
- Services: "{{ service_name }}"
- Timeline: "{{ incident_start_time }}"

**Customer Success Notification:**
- Alert customer success team immediately
- Provide talking points for customer inquiries
- Set up dedicated channel for customer communications

## 🧹 Post-Incident Activities

### Immediate Recovery Validation
Once availability returns to SLO target:
- [ ] Verify recovery metrics in dashboard
- [ ] Confirm user functionality restored
- [ ] Monitor for 30 minutes to ensure stability
- [ ] Send recovery notification

### Documentation
- [ ] Update incident tracking system with timeline
- [ ] Document root cause findings
- [ ] Record actions taken and their effectiveness
- [ ] Note any monitoring gaps discovered

### Follow-up Actions
- [ ] Schedule post-incident review within 48 hours
- [ ] Identify process improvements
- [ ] Update runbooks based on learnings
- [ ] Plan reliability improvements to prevent recurrence

## 📚 Additional Resources

### Dashboards
- [Service Overview]({{ grafana_url }})
- [SLO Dashboard]({{ $externalURL }}/d/slo-dashboard/slo-overview?var-service={{ service }})
- [Error Analysis]({{ $externalURL }}/d/error-analysis)
- [Dependency Health]({{ $externalURL }}/d/dependencies)

### Logs and Traces
- [Service Logs]({{ logs_url }})
- [Distributed Traces]({{ $externalURL }}/d/tempo/tempo)
- [Error Logs]({{ $externalURL }}/d/loki/logs?var-service={{ service }}&var-level=ERROR)

### Documentation
- [Service Architecture](../architecture/{{ service }}.md)
- [Deployment Guide](../deployment/{{ service }}.md)
- [Known Issues](../troubleshooting/{{ service }}-known-issues.md)

### Emergency Contacts
- **Platform Team**: `#platform-engineering`
- **On-Call Engineer**: See PagerDuty schedule
- **Database Team**: `#database-team`
- **Security Team**: `#security-team`

---

**Runbook Version**: 1.0  
**Last Updated**: {{ date "2006-01-02" now }}  
**Next Review**: {{ date "2006-01-02" (time.Now.AddDate 0 3 0) }}  
**Owner**: Platform Engineering Team