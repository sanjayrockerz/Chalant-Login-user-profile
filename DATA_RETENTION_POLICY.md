# Data Retention Policy for Contact Discovery System

## Executive Summary

This document defines comprehensive data retention policies for the contact discovery system to minimize PII surface area, ensure compliance with privacy regulations (GDPR, CCPA), and implement automated cleanup mechanisms. The policy follows a privacy-by-design approach with aggressive retention limits and automatic purging.

## Core Principles

1. **Minimal Retention**: Store only what's necessary, for as short as possible
2. **Automated Cleanup**: No manual intervention required for routine cleanup
3. **PII Redaction**: Comprehensive removal of PII from all logging and telemetry
4. **Transparency**: Clear data lifecycle documentation for compliance audits

## Data Categories and Retention Schedules

### Contact Hash Data
```typescript
// Redis storage with automatic expiration
interface ContactHashEntry {
  hash: string;                    // Argon2id hash
  userId: string;                  // User identifier
  platform: 'phone' | 'email';    // Contact type
  createdAt: Date;                 // Timestamp
  ttl: number;                     // Time to live in seconds
}

// Retention: 90 days maximum
const CONTACT_HASH_TTL = 90 * 24 * 60 * 60; // 90 days in seconds
```

### Discovery Tokens
```typescript
// Bidirectional discovery tokens
interface DiscoveryToken {
  tokenId: string;                 // UUID
  requesterHash: string;           // Hashed identifier
  targetHash: string;              // Hashed identifier
  status: 'pending' | 'matched' | 'expired';
  createdAt: Date;
  expiresAt: Date;
}

// Retention: 7 days for pending, 30 days for matched
const DISCOVERY_TOKEN_TTL = {
  pending: 7 * 24 * 60 * 60,      // 7 days
  matched: 30 * 24 * 60 * 60,     // 30 days
  expired: 0                       // Immediate deletion
};
```

### User Preferences
```typescript
// Privacy preferences with indefinite retention until user deletion
interface ContactPrivacyPrefs {
  userId: string;
  allowDiscovery: boolean;
  discoveryMode: 'mutual-only' | 'one-sided' | 'disabled';
  allowSuggestions: boolean;
  updatedAt: Date;
}

// Retention: Until user account deletion
// No automatic cleanup - tied to user lifecycle
```

### Audit Logs
```typescript
// Privacy-compliant audit logging
interface ContactAuditLog {
  eventId: string;                 // UUID
  userId: string;                  // User identifier (retained)
  action: string;                  // Action type
  hashedContact: string;           // First 8 chars of hash (for debugging)
  metadata: Record<string, any>;   // PII-free metadata
  timestamp: Date;
  ttl: number;
}

// Retention: 1 year for compliance
const AUDIT_LOG_TTL = 365 * 24 * 60 * 60; // 1 year
```

## TTL Implementation Strategy

### Redis-Based Automatic Expiration
```typescript
// Contact hash storage with automatic cleanup
@Injectable()
export class ContactHashStore {
  async storeContactHash(userId: string, hash: string, platform: string): Promise<void> {
    const key = `contact:${platform}:${hash}`;
    const value = JSON.stringify({
      userId,
      platform,
      createdAt: new Date(),
      hash
    });
    
    // Set with TTL - Redis handles automatic deletion
    await this.redis.setex(key, CONTACT_HASH_TTL, value);
    
    // Track in sorted set for manual cleanup if needed
    await this.redis.zadd(
      'contact:expiry',
      Date.now() + (CONTACT_HASH_TTL * 1000),
      key
    );
  }
  
  async cleanupExpiredHashes(): Promise<number> {
    const now = Date.now();
    const expiredKeys = await this.redis.zrangebyscore(
      'contact:expiry',
      0,
      now
    );
    
    if (expiredKeys.length === 0) return 0;
    
    // Remove expired entries
    await this.redis.del(...expiredKeys);
    await this.redis.zremrangebyscore('contact:expiry', 0, now);
    
    return expiredKeys.length;
  }
}
```

### PostgreSQL Cleanup Jobs
```sql
-- Discovery tokens cleanup function
CREATE OR REPLACE FUNCTION cleanup_expired_discovery_tokens()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM discovery_tokens
  WHERE expires_at < NOW();
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  INSERT INTO cleanup_audit (
    table_name,
    deleted_count,
    cleanup_timestamp
  ) VALUES (
    'discovery_tokens',
    deleted_count,
    NOW()
  );
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Audit logs cleanup (keep 1 year)
CREATE OR REPLACE FUNCTION cleanup_old_audit_logs()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM contact_audit_logs
  WHERE created_at < NOW() - INTERVAL '1 year';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  INSERT INTO cleanup_audit (
    table_name,
    deleted_count,
    cleanup_timestamp
  ) VALUES (
    'contact_audit_logs',
    deleted_count,
    NOW()
  );
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Schedule cleanup jobs (run daily at 2 AM)
SELECT cron.schedule('cleanup-discovery-tokens', '0 2 * * *', 'SELECT cleanup_expired_discovery_tokens();');
SELECT cron.schedule('cleanup-audit-logs', '0 2 * * *', 'SELECT cleanup_old_audit_logs();');
```

## PII Redaction Rules

### Logging Configuration
```typescript
// Custom logger with PII redaction
@Injectable()
export class PrivacyAwareLogger {
  private readonly piiPatterns = [
    /\b[\w._%+-]+@[\w.-]+\.[A-Z]{2,}\b/gi,           // Email addresses
    /\b\+?[\d\s\-\(\)]{10,}\b/g,                     // Phone numbers
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi  // Email patterns
  ];
  
  private redactPII(message: string): string {
    let redacted = message;
    
    this.piiPatterns.forEach(pattern => {
      redacted = redacted.replace(pattern, '[REDACTED]');
    });
    
    // Redact long strings that might be raw contacts
    redacted = redacted.replace(/\b[\w._%+-]{15,}\b/g, '[REDACTED_LONG]');
    
    return redacted;
  }
  
  log(level: string, message: string, metadata?: any): void {
    const redactedMessage = this.redactPII(message);
    const redactedMetadata = this.redactMetadata(metadata);
    
    this.logger.log(level, redactedMessage, redactedMetadata);
  }
  
  private redactMetadata(metadata: any): any {
    if (!metadata) return metadata;
    
    const redacted = { ...metadata };
    
    // Redact known PII fields
    const piiFields = ['email', 'phone', 'contact', 'rawContact', 'identifier'];
    piiFields.forEach(field => {
      if (redacted[field]) {
        redacted[field] = '[REDACTED]';
      }
    });
    
    // Redact any field containing hash-like strings
    Object.keys(redacted).forEach(key => {
      if (typeof redacted[key] === 'string' && redacted[key].length > 32) {
        redacted[key] = redacted[key].substring(0, 8) + '...[REDACTED]';
      }
    });
    
    return redacted;
  }
}
```

### Error Handling PII Protection
```typescript
// Custom error handler with PII scrubbing
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    
    // Scrub PII from error messages
    const safaErrorMessage = this.scrubPII(exception.toString());
    
    // Log error with redacted information
    this.logger.error('Contact discovery error', {
      path: request.url,
      method: request.method,
      userId: request.user?.id,
      errorType: exception.constructor.name,
      safaErrorMessage,
      timestamp: new Date().toISOString(),
      // Note: Original error details are NOT logged
    });
    
    // Return generic error to client
    response.status(500).json({
      statusCode: 500,
      message: 'Internal server error',
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
  
  private scrubPII(text: string): string {
    return text
      .replace(/[\w._%+-]+@[\w.-]+\.[A-Z]{2,}/gi, '[EMAIL_REDACTED]')
      .replace(/\+?[\d\s\-\(\)]{10,}/g, '[PHONE_REDACTED]')
      .replace(/[a-fA-F0-9]{32,}/g, '[HASH_REDACTED]');
  }
}
```

## User Data Deletion

### Complete User Deletion
```typescript
@Injectable()
export class UserDeletionService {
  async deleteUserContactData(userId: string): Promise<void> {
    // 1. Remove all contact hashes
    const userHashes = await this.redis.keys(`contact:*:${userId}`);
    if (userHashes.length > 0) {
      await this.redis.del(...userHashes);
    }
    
    // 2. Remove from discovery tokens
    await this.db.discoveryTokens.deleteMany({
      OR: [
        { requesterUserId: userId },
        { targetUserId: userId }
      ]
    });
    
    // 3. Remove privacy preferences
    await this.db.contactPrivacyPrefs.delete({
      where: { userId }
    });
    
    // 4. Anonymize audit logs (keep for compliance but remove user link)
    await this.db.contactAuditLogs.updateMany({
      where: { userId },
      data: {
        userId: 'DELETED_USER',
        metadata: {}
      }
    });
    
    // 5. Log deletion for audit
    await this.auditLogger.log('user_data_deleted', {
      deletedUserId: userId.substring(0, 8) + '...[REDACTED]',
      deletionTimestamp: new Date(),
      dataTypesDeleted: ['contacts', 'discovery_tokens', 'preferences']
    });
  }
}
```

## Monitoring and Compliance

### Cleanup Monitoring
```typescript
@Injectable()
export class RetentionMonitoringService {
  @Cron('0 3 * * *') // Daily at 3 AM
  async generateCleanupReport(): Promise<void> {
    const report = {
      date: new Date().toISOString().split('T')[0],
      contactHashesExpired: await this.countExpiredHashes(),
      discoveryTokensCleanedUp: await this.countCleanedTokens(),
      auditLogsRetained: await this.countAuditLogs(),
      complianceStatus: 'COMPLIANT'
    };
    
    // Store in compliance database (separate from user data)
    await this.complianceDb.retentionReports.create({
      data: report
    });
    
    // Alert if cleanup is not working
    if (report.contactHashesExpired === 0 && await this.shouldHaveExpiredHashes()) {
      await this.alertingService.send('CLEANUP_FAILURE', {
        service: 'contact_discovery',
        issue: 'Hash cleanup not running',
        severity: 'HIGH'
      });
    }
  }
  
  async generateComplianceReport(): Promise<RetentionComplianceReport> {
    return {
      reportDate: new Date(),
      dataCategories: [
        {
          category: 'contact_hashes',
          retentionPeriod: '90 days',
          currentCount: await this.redis.dbsize(),
          oldestEntry: await this.getOldestHashDate(),
          complianceStatus: 'COMPLIANT'
        },
        {
          category: 'discovery_tokens',
          retentionPeriod: '7-30 days',
          currentCount: await this.db.discoveryTokens.count(),
          oldestEntry: await this.getOldestTokenDate(),
          complianceStatus: 'COMPLIANT'
        },
        {
          category: 'audit_logs',
          retentionPeriod: '1 year',
          currentCount: await this.db.contactAuditLogs.count(),
          oldestEntry: await this.getOldestAuditDate(),
          complianceStatus: 'COMPLIANT'
        }
      ],
      nextScheduledCleanup: await this.getNextCleanupTime(),
      piiRedactionStatus: 'ACTIVE'
    };
  }
}
```

### Configuration Management
```typescript
// Environment-based retention configuration
export const retentionConfig = {
  development: {
    contactHashTtl: 7 * 24 * 60 * 60,      // 7 days
    discoveryTokenTtl: 24 * 60 * 60,       // 1 day
    auditLogTtl: 30 * 24 * 60 * 60,        // 30 days
    enablePiiRedaction: true
  },
  staging: {
    contactHashTtl: 30 * 24 * 60 * 60,     // 30 days
    discoveryTokenTtl: 7 * 24 * 60 * 60,   // 7 days
    auditLogTtl: 90 * 24 * 60 * 60,        // 90 days
    enablePiiRedaction: true
  },
  production: {
    contactHashTtl: 90 * 24 * 60 * 60,     // 90 days
    discoveryTokenTtl: 30 * 24 * 60 * 60,  // 30 days
    auditLogTtl: 365 * 24 * 60 * 60,       // 1 year
    enablePiiRedaction: true
  }
};
```

## Emergency Data Purge

### Immediate Data Removal
```typescript
@Injectable()
export class EmergencyPurgeService {
  async executeEmergencyPurge(reason: string, requestedBy: string): Promise<void> {
    const purgeId = uuidv4();
    
    try {
      // 1. Immediate Redis flush of all contact data
      await this.redis.flushdb();
      
      // 2. Truncate discovery tokens
      await this.db.discoveryTokens.deleteMany({});
      
      // 3. Anonymize all audit logs
      await this.db.contactAuditLogs.updateMany({
        data: {
          userId: 'EMERGENCY_PURGED',
          metadata: { purgeId, reason: 'emergency_purge' }
        }
      });
      
      // 4. Log emergency action
      await this.complianceDb.emergencyActions.create({
        data: {
          actionId: purgeId,
          actionType: 'EMERGENCY_PURGE',
          reason,
          requestedBy,
          executedAt: new Date(),
          affectedSystems: ['redis', 'discovery_tokens', 'audit_logs'],
          status: 'COMPLETED'
        }
      });
      
      await this.alertingService.send('EMERGENCY_PURGE_COMPLETED', {
        purgeId,
        reason,
        executedBy: requestedBy
      });
      
    } catch (error) {
      await this.complianceDb.emergencyActions.create({
        data: {
          actionId: purgeId,
          actionType: 'EMERGENCY_PURGE',
          reason,
          requestedBy,
          executedAt: new Date(),
          status: 'FAILED',
          errorDetails: error.message
        }
      });
      
      throw new Error(`Emergency purge failed: ${error.message}`);
    }
  }
}
```

## Compliance Validation

### Regular Compliance Checks
```typescript
@Injectable()
export class ComplianceValidator {
  async validateRetentionCompliance(): Promise<ComplianceValidationResult> {
    const issues: string[] = [];
    
    // Check if any data exceeds retention limits
    const oldHashes = await this.findHashesOlderThan(CONTACT_HASH_TTL);
    if (oldHashes.length > 0) {
      issues.push(`${oldHashes.length} contact hashes exceed retention limit`);
    }
    
    const oldTokens = await this.db.discoveryTokens.count({
      where: {
        createdAt: {
          lt: new Date(Date.now() - (DISCOVERY_TOKEN_TTL.matched * 1000))
        }
      }
    });
    if (oldTokens > 0) {
      issues.push(`${oldTokens} discovery tokens exceed retention limit`);
    }
    
    // Validate PII redaction is working
    const recentLogs = await this.db.contactAuditLogs.findMany({
      where: {
        createdAt: {
          gte: new Date(Date.now() - (24 * 60 * 60 * 1000)) // Last 24 hours
        }
      },
      take: 100
    });
    
    const piiFound = recentLogs.some(log => 
      this.containsPII(log.message) || this.containsPII(JSON.stringify(log.metadata))
    );
    
    if (piiFound) {
      issues.push('PII detected in recent audit logs');
    }
    
    return {
      isCompliant: issues.length === 0,
      issues,
      checkedAt: new Date(),
      nextCheckDue: new Date(Date.now() + (24 * 60 * 60 * 1000))
    };
  }
  
  private containsPII(text: string): boolean {
    const piiPatterns = [
      /[\w._%+-]+@[\w.-]+\.[A-Z]{2,}/gi,
      /\+?[\d\s\-\(\)]{10,}/g
    ];
    
    return piiPatterns.some(pattern => pattern.test(text));
  }
}
```

## Documentation and Training

### Data Retention Summary for Teams

| Data Type | Retention Period | Storage | Cleanup Method | PII Risk |
|-----------|------------------|---------|----------------|----------|
| Contact Hashes | 90 days | Redis | TTL + Manual | Low (hashed) |
| Discovery Tokens | 7-30 days | PostgreSQL | Cron Job | Low (hashed) |
| Privacy Preferences | User Lifetime | PostgreSQL | User Deletion | None |
| Audit Logs | 1 year | PostgreSQL | Cron Job | None (redacted) |
| Error Logs | 30 days | File System | Log Rotation | None (scrubbed) |

### Implementation Checklist

- [ ] Redis TTL configuration deployed
- [ ] PostgreSQL cleanup functions installed
- [ ] Cron jobs scheduled and tested
- [ ] PII redaction middleware active
- [ ] Error handler PII scrubbing enabled
- [ ] User deletion service tested
- [ ] Monitoring alerts configured
- [ ] Compliance reporting scheduled
- [ ] Emergency purge procedures documented
- [ ] Team training completed

This data retention policy ensures minimal PII exposure while maintaining necessary functionality for the contact discovery system. Regular monitoring and automated cleanup reduce compliance risk and protect user privacy.