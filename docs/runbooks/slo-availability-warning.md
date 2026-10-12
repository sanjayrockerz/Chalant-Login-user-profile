# ⚠️ SLO Availability Warning Alert Runbook

## Alert Overview
**Alert Name**: `SLOAvailabilityWarning_*Service`  
**Severity**: Warning  
**Response Time**: Investigate within business hours (2-4 hours)  
**SLO Impact**: Medium - Gradual error budget consumption trend

## Alert Description
This alert fires when service availability shows a concerning burn rate trend over longer time windows (6 hours and 3 days), indicating potential degradation that could lead to SLO violation if not addressed.

### Trigger Conditions
- **Medium window burn rate** (6hr): > 3x normal consumption
- **Long window burn rate** (3d): > 1x normal consumption
- **Availability SLI**: Below SLO target for the time window

## 🔍 Investigation Workflow

### 1. Initial Assessment (First 30 minutes)

**Gather Context:**
- [ ] Review alert details and affected service
- [ ] Check if this is part of a larger pattern
- [ ] Verify current user impact (if any)

**Dashboard Review:**
- [ ] Open [Service Dashboard]({{ grafana_url }})
- [ ] Review 6-hour and 3-day availability trends
- [ ] Compare with historical patterns (same day last week)

**Quick Health Check:**
```promql
# Current vs baseline availability
sli:availability_6h{service="{{ service }}"}

# Error budget consumption rate
slo:burn_rate_availability_6h{service="{{ service }}"}

# Request volume trends
rate(http_requests_total{service="{{ service }}"}[6h])
```

### 2. Pattern Analysis (30-60 minutes)

**Trend Investigation:**
- [ ] Is this a gradual degradation or periodic issue?
- [ ] Correlate with business cycles (peak hours, batch jobs)
- [ ] Check for seasonal patterns or known events

**Error Categorization:**
```promql
# Error distribution by HTTP status
rate(http_requests_total{service="{{ service }}", status_code=~"5.."}[6h]) by (status_code)

# Error distribution by endpoint
rate(http_requests_total{service="{{ service }}", status_code=~"5.."}[6h]) by (endpoint)

# Top error-generating clients
topk(10, rate(http_requests_total{service="{{ service }}", status_code=~"5.."}[6h]) by (client_ip))
```

**Correlation Analysis:**
If `correlation_id` patterns available:
- [ ] Search for recurring correlation_ids with errors
- [ ] Identify common request patterns leading to failures
- [ ] Check for tenant-specific issues

## 🛠️ Root Cause Investigation

### Infrastructure Analysis

**Resource Utilization:**
```bash
# CPU and memory trends over 6 hours
kubectl top pods -l app={{ service }} --containers

# Check for resource constraints
kubectl describe pods -l app={{ service }} | grep -A5 -B5 "Limit\|Request"
```

**Performance Degradation:**
```promql
# Latency trends
histogram_quantile(0.95, 
  rate(http_request_duration_seconds_bucket{service="{{ service }}"}[6h])
)

# Throughput changes
rate(http_requests_total{service="{{ service }}"}[6h])
```

### Application-Level Investigation

**Log Pattern Analysis:**
```bash
# Search for error patterns in logs
curl -G "http://loki:3100/loki/api/v1/query_range" \
  --data-urlencode 'query={service="'$service'"} |~ "ERROR|WARN" | json' \
  --data-urlencode 'start=now-6h' \
  --data-urlencode 'end=now' | \
  jq '.data.result[] | .values[] | .[1]' | \
  grep -o '"message":"[^"]*"' | sort | uniq -c | sort -nr
```

**Database Performance:**
- [ ] Check slow query logs for the time period
- [ ] Review connection pool utilization
- [ ] Analyze query performance trends

**External Dependencies:**
- [ ] Review dependency health metrics
- [ ] Check for timeout increases
- [ ] Validate circuit breaker effectiveness

### Service-Specific Investigation

#### For personal-email-signup-backend:
**Registration Pipeline Analysis:**
```promql
# OTP success rates
rate(otp_verifications_total{status="success"}[6h]) / 
rate(otp_verifications_total[6h])

# Email delivery success rates  
rate(email_deliveries_total{status="success"}[6h]) /
rate(email_deliveries_total[6h])

# User validation failures
rate(validation_errors_total[6h]) by (field)
```

#### For login-page-back:
**Authentication Analysis:**
```promql
# Auth success rates by method
rate(auth_attempts_total{status="success"}[6h]) by (auth_method) /
rate(auth_attempts_total[6h]) by (auth_method)

# Session-related errors
rate(auth_errors_total{type="session"}[6h])

# Rate limiting impact
rate(http_requests_total{status_code="429"}[6h])
```

## 📊 Business Impact Assessment

### User Experience Impact
**Quantify Current Impact:**
- [ ] Calculate actual user-facing error rate
- [ ] Estimate number of affected users
- [ ] Assess impact on key user journeys

**Business Metrics:**
```promql
# Conversion rate impact (if applicable)
rate(successful_registrations_total[6h]) /
rate(registration_attempts_total[6h])

# Authentication success for returning users
rate(successful_logins_total[6h]) /
rate(login_attempts_total[6h])
```

### Risk Assessment
**Error Budget Analysis:**
- [ ] Current burn rate sustainability
- [ ] Time to SLO violation at current rate
- [ ] Impact on monthly/quarterly reliability targets

## 🔧 Remediation Planning

### Short-term Actions (Same Day)

**Performance Optimization:**
- [ ] Review and optimize slow database queries
- [ ] Adjust connection pool sizes if needed
- [ ] Implement caching for frequently accessed data
- [ ] Scale service replicas if resource-constrained

**Configuration Tuning:**
- [ ] Review timeout configurations
- [ ] Adjust retry policies for external dependencies
- [ ] Optimize garbage collection settings
- [ ] Update rate limiting rules if needed

### Medium-term Actions (Within Week)

**Code Quality:**
- [ ] Review recent code changes for performance regressions
- [ ] Implement additional error handling
- [ ] Add circuit breakers for unreliable dependencies
- [ ] Optimize resource-intensive operations

**Monitoring Improvements:**
- [ ] Add missing metrics for identified gaps
- [ ] Implement additional health checks
- [ ] Create alerts for early warning signals
- [ ] Enhance log structured data

### Long-term Actions (Within Month)

**Architecture Improvements:**
- [ ] Evaluate service architecture for reliability
- [ ] Implement graceful degradation patterns
- [ ] Add redundancy for critical components
- [ ] Plan capacity improvements

## 📈 Monitoring and Validation

### Progress Tracking
**Key Metrics to Monitor:**
```promql
# Availability improvement
sli:availability_1h{service="{{ service }}"}

# Error rate reduction
rate(http_requests_total{service="{{ service }}", status_code=~"5.."}[1h])

# Performance improvement
histogram_quantile(0.95, 
  rate(http_request_duration_seconds_bucket{service="{{ service }}"}[1h])
)
```

### Success Criteria
- [ ] 6-hour burn rate consistently < 2x for 24 hours
- [ ] 3-day availability trend showing improvement
- [ ] User-facing error rate within acceptable bounds
- [ ] No escalation to critical alerts

## 💬 Communication

### Team Updates
**Initial Investigation Summary:**
```
⚠️ SLO WARNING INVESTIGATION - {{ service }}

Status: Under investigation
Service: {{ service }}
Issue: Gradual availability degradation over 6h/3d windows
Current Impact: [None/Minimal/Moderate] user impact
Next Update: [Timeline]

Investigation Lead: @{{ your_name }}
Dashboard: {{ grafana_url }}
```

**Progress Updates (Every 4-8 hours):**
- Current findings
- Actions taken
- Expected timeline
- Escalation status

### Stakeholder Communication
**Product Team Notification:**
- Summary of potential user impact
- Expected resolution timeline
- Recommendations for feature releases

**Customer Success (if needed):**
- Talking points for customer inquiries
- Proactive communication plan
- Escalation triggers

## 📝 Documentation and Follow-up

### Investigation Notes
Document findings in incident tracking system:
- [ ] Root cause analysis results
- [ ] Contributing factors identified
- [ ] Actions taken and their effectiveness
- [ ] Lessons learned

### Process Improvements
- [ ] Update monitoring thresholds if needed
- [ ] Enhance runbooks based on investigation
- [ ] Identify proactive monitoring opportunities
- [ ] Plan team training if knowledge gaps found

### Prevention Planning
- [ ] Schedule reliability improvements
- [ ] Review deployment practices
- [ ] Plan capacity and performance improvements
- [ ] Update architecture documentation

## 🔗 Related Resources

### Dashboards and Tools
- [SLO Overview]({{ $externalURL }}/d/slo-dashboard/slo-overview?var-service={{ service }})
- [Error Budget Tracking]({{ $externalURL }}/d/error-budget/error-budget-dashboard)
- [Service Health]({{ grafana_url }})
- [Dependency Map]({{ $externalURL }}/d/tempo/tempo?view=serviceMap)

### Documentation
- [Performance Optimization Guide](../performance/optimization-guide.md)
- [Capacity Planning](../capacity/planning-guide.md)
- [Architecture Overview](../architecture/{{ service }}.md)

### Escalation Paths
- **L2 Support**: Senior Platform Engineer
- **Product Team**: For business impact assessment
- **Customer Success**: For external communication
- **Engineering Manager**: For resource allocation

---

**Runbook Version**: 1.0  
**Last Updated**: {{ date "2006-01-02" now }}  
**Next Review**: {{ date "2006-01-02" (time.Now.AddDate 0 3 0) }}  
**Owner**: Platform Engineering Team