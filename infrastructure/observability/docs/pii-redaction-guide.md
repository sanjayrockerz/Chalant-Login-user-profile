# 📋 PII Redaction and Logging Standards

## Overview
This document outlines the Personal Identifiable Information (PII) redaction policies, logging standards, and validation procedures for the authentication services observability platform.

## 🔒 PII Redaction Policies

### Sensitive Data Categories

#### ❌ Prohibited Data (Must be Redacted)
- **Personal Information**
  - Email addresses
  - Phone numbers
  - Full names
  - Addresses
  - Social Security Numbers
  - Driver's License Numbers

- **Authentication Data**
  - Passwords (plaintext or hashed)
  - API keys
  - Session tokens
  - JWT tokens (full tokens)
  - OAuth tokens
  - Refresh tokens

- **Financial Information**
  - Credit card numbers
  - Bank account numbers
  - Payment processor IDs

- **Device Information**
  - Full IP addresses (last octet must be masked)
  - Device serial numbers
  - Hardware identifiers

#### ✅ Allowed Data (Safe for Logging)
- **Request Metadata**
  - HTTP status codes
  - Request methods
  - Response times
  - User agents (sanitized)
  - Correlation IDs
  - Tenant IDs
  - Request sizes

- **Business Metrics**
  - Authentication success/failure counts
  - Service response times
  - Rate limiting metrics
  - Error counts by type

- **Masked Identifiers**
  - Hashed user IDs
  - Masked IP addresses (e.g., 192.168.1.xxx)
  - Token prefixes (first 8 characters)

## 🛠️ Implementation Layers

### Layer 1: Application Level
```javascript
// Winston Logger Configuration
const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
    winston.format.printf((info) => {
      // PII redaction at source
      return JSON.stringify(sanitizeLogEntry(info));
    })
  ),
  transports: [
    new winston.transports.File({ 
      filename: '/var/log/auth-service/app.log',
      maxsize: 10485760, // 10MB
      maxFiles: 5
    })
  ]
});

function sanitizeLogEntry(logEntry) {
  const sanitized = { ...logEntry };
  
  // Redact email addresses
  if (sanitized.message) {
    sanitized.message = sanitized.message.replace(
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      '[EMAIL_REDACTED]'
    );
  }
  
  // Redact passwords
  if (sanitized.password) {
    sanitized.password = '[PASSWORD_REDACTED]';
  }
  
  // Mask IP addresses
  if (sanitized.ip) {
    sanitized.ip = sanitized.ip.replace(/\.\d+$/, '.xxx');
  }
  
  return sanitized;
}
```

### Layer 2: Promtail Configuration
Located at: `infrastructure/observability/configs/promtail.yaml`

```yaml
# PII Redaction Pipeline Stages
pipeline_stages:
  # Email redaction
  - regex:
      expression: '(?P<before>.*?)(?P<email>\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b)(?P<after>.*)'
  - template:
      source: redacted_line
      template: '{{ .before }}[EMAIL_REDACTED]{{ .after }}'
  
  # Password field redaction
  - regex:
      expression: '(?P<before>.*?"password"\s*:\s*")(?P<password>[^"]+)(?P<after>".*)'
  - template:
      source: redacted_line
      template: '{{ .before }}[PASSWORD_REDACTED]{{ .after }}'
  
  # IP address masking
  - regex:
      expression: '(?P<before>.*?)(?P<ip>\b\d{1,3}\.\d{1,3}\.\d{1,3}\.)(?P<last_octet>\d{1,3})(?P<after>.*)'
  - template:
      source: redacted_line
      template: '{{ .before }}{{ .ip }}xxx{{ .after }}'
```

### Layer 3: OpenTelemetry Collector
Located at: `infrastructure/observability/configs/otel-collector.yaml`

```yaml
processors:
  transform:
    log_statements:
      - context: log
        statements:
          # Redact email addresses in log body
          - replace_pattern(body, "\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b", "[EMAIL_REDACTED]")
          # Redact password fields
          - replace_pattern(body, "\"password\"\\s*:\\s*\"[^\"]+\"", "\"password\":\"[PASSWORD_REDACTED]\"")
          # Mask IP addresses
          - replace_pattern(body, "\\b(\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.)\\d{1,3}\\b", "${1}xxx")
```

## 📊 Logging Standards

### Structured Logging Format
All services must use structured JSON logging with the following required fields:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "info|warn|error|debug",
  "service": "personal-email-signup-backend|login-page-back",
  "correlation_id": "uuid-v4-format",
  "tenant_id": "tenant-identifier",
  "message": "Human readable message",
  "metadata": {
    "request_id": "unique-request-identifier",
    "user_id": "hashed-user-identifier",
    "endpoint": "/api/auth/login",
    "method": "POST",
    "status_code": 200,
    "response_time_ms": 150,
    "ip_address": "192.168.1.xxx"
  },
  "error": {
    "name": "ValidationError",
    "message": "Invalid input provided",
    "stack": "Error stack trace (in development only)"
  }
}
```

### Log Levels

#### DEBUG
- Detailed application flow
- Variable values (redacted)
- Function entry/exit points
- **Environment**: Development only

#### INFO
- Successful operations
- Business events
- Authentication successes
- **Environment**: All environments

#### WARN
- Recoverable errors
- Deprecated API usage
- Rate limiting warnings
- **Environment**: All environments

#### ERROR
- Application errors
- Authentication failures
- External service failures
- **Environment**: All environments

### Correlation Standards

#### Request Correlation
Every request must include a `correlation_id` that flows through:
1. HTTP headers (`X-Correlation-ID`)
2. Log entries
3. Distributed traces
4. Metrics labels

#### Multi-Tenant Correlation
Services supporting multiple tenants must include:
1. `tenant_id` in all log entries
2. Tenant-specific metrics labeling
3. Trace span attributes for tenant isolation

## 🔍 Validation Procedures

### Automated Validation

#### 1. Log Analysis Script
```bash
#!/bin/bash
# Script: validate-pii-redaction.sh
# Purpose: Scan log files for potential PII leaks

LOG_DIR="/var/log/auth-service"
REPORT_FILE="/tmp/pii-scan-report.txt"

echo "PII Validation Report - $(date)" > $REPORT_FILE
echo "=======================================" >> $REPORT_FILE

# Check for email patterns
EMAIL_COUNT=$(grep -r -E '\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b' $LOG_DIR | wc -l)
if [ $EMAIL_COUNT -gt 0 ]; then
    echo "❌ ALERT: $EMAIL_COUNT potential email addresses found" >> $REPORT_FILE
    grep -r -E '\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b' $LOG_DIR >> $REPORT_FILE
else
    echo "✅ No email addresses detected" >> $REPORT_FILE
fi

# Check for password fields
PASSWORD_COUNT=$(grep -r -i '"password".*:.*"[^"]' $LOG_DIR | grep -v '\[PASSWORD_REDACTED\]' | wc -l)
if [ $PASSWORD_COUNT -gt 0 ]; then
    echo "❌ ALERT: $PASSWORD_COUNT potential password leaks found" >> $REPORT_FILE
    grep -r -i '"password".*:.*"[^"]' $LOG_DIR | grep -v '\[PASSWORD_REDACTED\]' >> $REPORT_FILE
else
    echo "✅ No password leaks detected" >> $REPORT_FILE
fi

# Check for unmasked IP addresses
IP_COUNT=$(grep -r -E '\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b' $LOG_DIR | grep -v '\.xxx' | wc -l)
if [ $IP_COUNT -gt 0 ]; then
    echo "❌ ALERT: $IP_COUNT unmasked IP addresses found" >> $REPORT_FILE
    grep -r -E '\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b' $LOG_DIR | grep -v '\.xxx' | head -10 >> $REPORT_FILE
else
    echo "✅ All IP addresses properly masked" >> $REPORT_FILE
fi

echo "Report generated: $REPORT_FILE"
cat $REPORT_FILE
```

#### 2. Prometheus Alert Rules
```yaml
# File: infrastructure/observability/alerts/pii-alerts.yml
groups:
  - name: pii_redaction_alerts
    rules:
      - alert: PotentialPIILeak
        expr: increase(loki_lines_total{job="promtail"}[5m]) > 100 and on() loki_query_duration_seconds{query=~".*@.*"} > 0
        for: 1m
        labels:
          severity: critical
          category: security
        annotations:
          summary: "Potential PII leak detected in logs"
          description: "Log analysis indicates potential PII data in log streams"
          
      - alert: RedactionPipelineFailure
        expr: rate(promtail_file_bytes_total[5m]) > 0 and rate(promtail_lines_total[5m]) == 0
        for: 2m
        labels:
          severity: warning
          category: observability
        annotations:
          summary: "Log redaction pipeline failure"
          description: "Promtail is reading log files but not forwarding processed logs"
```

### Manual Validation

#### 1. Weekly Log Audit
- Sample 1% of log entries across all services
- Manually review for PII compliance
- Document findings in compliance report

#### 2. Quarterly Security Review
- Review all PII redaction configurations
- Test redaction effectiveness with synthetic data
- Update patterns based on new data types

#### 3. Incident Response
When PII leak is detected:

1. **Immediate Response** (within 1 hour)
   - Stop log ingestion if necessary
   - Identify scope of leak
   - Implement emergency redaction

2. **Investigation** (within 24 hours)
   - Determine root cause
   - Identify affected log entries
   - Assess compliance impact

3. **Remediation** (within 72 hours)
   - Update redaction patterns
   - Purge affected log entries
   - Document lessons learned

## 🔧 Testing and Validation

### Synthetic Test Data
```json
{
  "test_cases": [
    {
      "name": "email_redaction",
      "input": "User john.doe@example.com logged in successfully",
      "expected": "User [EMAIL_REDACTED] logged in successfully"
    },
    {
      "name": "password_redaction", 
      "input": "{\"username\":\"user\",\"password\":\"secret123\"}",
      "expected": "{\"username\":\"user\",\"password\":\"[PASSWORD_REDACTED]\"}"
    },
    {
      "name": "ip_masking",
      "input": "Request from 192.168.1.100 processed",
      "expected": "Request from 192.168.1.xxx processed"
    }
  ]
}
```

### Validation Commands
```bash
# Test Promtail redaction
echo '{"user": "test@example.com", "password": "secret"}' | \
  docker exec -i promtail /usr/bin/promtail \
  --config.file=/etc/promtail/config.yml \
  --dry-run

# Test OpenTelemetry processor
curl -X POST http://localhost:4318/v1/logs \
  -H "Content-Type: application/json" \
  -d '{"resourceLogs":[{"resource":{"attributes":[]},"scopeLogs":[{"scope":{},"logRecords":[{"body":{"stringValue":"User admin@company.com failed login"},"timeUnixNano":"1640995200000000000"}]}]}]}'
```

## 📈 Compliance Monitoring

### Key Metrics
- `pii_redaction_errors_total`: Failed redaction attempts
- `sensitive_data_detected_total`: PII pattern matches
- `log_processing_latency`: Impact of redaction on performance
- `compliance_violations_total`: Manual audit findings

### Compliance Dashboard
Located at: Grafana → Dashboards → Security → PII Compliance

### Retention Policies
- **Raw Logs**: 7 days maximum (before redaction)
- **Processed Logs**: 31 days (Loki retention)
- **Compliance Reports**: 2 years
- **Security Audit Logs**: 7 years

## 🚨 Incident Escalation

### Severity Levels

#### Critical (P0)
- PII data exposed in production logs
- Compliance violation with legal implications
- **Response**: Immediate escalation to security team

#### High (P1)
- Redaction pipeline failure
- Automated compliance alerts triggered
- **Response**: Fix within 4 hours

#### Medium (P2)
- Performance impact from redaction
- Non-critical pattern updates needed
- **Response**: Fix within 24 hours

#### Low (P3)
- Documentation updates
- Pattern optimization opportunities
- **Response**: Fix within 1 week

## 📞 Contact Information

- **Security Team**: security@company.com
- **Compliance Officer**: compliance@company.com
- **On-call Engineering**: oncall@company.com
- **Emergency Escalation**: +1-555-SECURITY

---

**Document Version**: 1.0  
**Last Updated**: 2024-01-15  
**Next Review**: 2024-04-15  
**Owner**: Platform Engineering Team