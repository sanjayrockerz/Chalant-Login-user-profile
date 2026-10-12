# Contact Discovery Implementation Guide

## Overview

This guide provides step-by-step instructions for implementing the secure contact discovery system in your NestJS authentication service. The system uses privacy-by-design principles with cryptographic hashing to enable friend discovery without storing raw contact information.

## Quick Start

### 1. Environment Setup

Add the following environment variables to your `.env` file:

```bash
# Contact Discovery Configuration
CONTACT_SALT_PHONE=your_unique_phone_salt_here_change_in_production
CONTACT_SALT_EMAIL=your_unique_email_salt_here_change_in_production
CONTACT_USER_SALT_SECRET=your_user_salt_secret_here_change_in_production
CONTACT_MONTHLY_SALT_SECRET=your_monthly_salt_secret_here_change_in_production

# Optional: Override default retention periods
CONTACT_HASH_TTL_DAYS=90
DISCOVERY_TOKEN_TTL_DAYS=30
AUDIT_LOG_TTL_DAYS=365

# Optional: Override rate limits
CONTACT_IMPORT_RATE_LIMIT=10
CONTACT_DISCOVERY_RATE_LIMIT=100
```

### 2. Database Schema

Add these tables to your Prisma schema or SQL database:

```prisma
model ContactPrivacyPrefs {
  userId          String   @id
  allowDiscovery  Boolean  @default(false)
  discoveryMode   String   @default("mutual-only") // "mutual-only" | "one-sided" | "disabled"
  allowSuggestions Boolean @default(false)
  phoneDiscovery  Boolean  @default(false)
  emailDiscovery  Boolean  @default(false)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@map("contact_privacy_prefs")
}

model DiscoveryToken {
  id          String   @id @default(uuid())
  requesterId String
  targetId    String
  contactHash String   // Partial hash (first 8 chars only)
  platform    String   // "phone" | "email"
  status      String   @default("pending") // "pending" | "matched" | "expired"
  createdAt   DateTime @default(now())
  expiresAt   DateTime

  @@map("discovery_tokens")
  @@index([requesterId])
  @@index([targetId])
  @@index([expiresAt])
}

model CleanupAudit {
  id               String   @id @default(uuid())
  tableName        String
  deletedCount     Int
  cleanupTimestamp DateTime @default(now())

  @@map("cleanup_audit")
}
```

### 3. Integration with Existing NestJS Service

#### Option A: Direct Integration

```typescript
// In your existing auth module
import { ContactImportModule } from './contact-import/contact-import.module';

@Module({
  imports: [
    // ... your existing imports
  ],
  providers: [
    // ... your existing providers
    {
      provide: 'CONTACT_DISCOVERY',
      useFactory: (redis, prisma, configService) => {
        const logger = (level: string, message: string, context?: any) => {
          console.log(`[${level.toUpperCase()}] ${message}`, context);
        };
        
        return new ContactImportModule(redis, prisma, logger);
      },
      inject: [RedisService, PrismaService, ConfigService],
    },
  ],
})
export class AuthModule {}
```

#### Option B: Standalone Service

```typescript
// Create a new contact-discovery.service.ts
import { Injectable } from '@nestjs/common';
import { ContactImportModule } from './contact-import/contact-import.module';

@Injectable()
export class ContactDiscoveryService {
  private contactModule: ContactImportModule;

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {
    this.contactModule = new ContactImportModule(
      redis.getClient(),
      prisma,
      (level, message, context) => {
        // Integrate with your existing logger
        Logger.log(message, context, 'ContactDiscovery');
      }
    );
  }

  async importContacts(userId: string, contacts: any[]) {
    const controller = this.contactModule.getContactImportController();
    return controller.importContacts(userId, { contacts });
  }

  async getPreferences(userId: string) {
    const controller = this.contactModule.getContactImportController();
    return controller.getDiscoveryPreferences(userId);
  }

  async updatePreferences(userId: string, preferences: any) {
    const controller = this.contactModule.getContactImportController();
    return controller.updateDiscoveryPreferences(userId, preferences);
  }
}
```

### 4. API Endpoints

Add these routes to your existing controllers:

```typescript
// In your user or profile controller
@Controller('contacts')
export class ContactController {
  constructor(
    @Inject('CONTACT_DISCOVERY') private contactModule: ContactImportModule
  ) {}

  @Post('import')
  @UseGuards(JwtAuthGuard)
  async importContacts(@Request() req, @Body() body) {
    const controller = this.contactModule.getContactImportController();
    return controller.importContacts(req.user.id, body);
  }

  @Get('preferences')
  @UseGuards(JwtAuthGuard)
  async getPreferences(@Request() req) {
    const controller = this.contactModule.getContactImportController();
    return controller.getDiscoveryPreferences(req.user.id);
  }

  @Put('preferences')
  @UseGuards(JwtAuthGuard)
  async updatePreferences(@Request() req, @Body() body) {
    const controller = this.contactModule.getContactImportController();
    return controller.updateDiscoveryPreferences(req.user.id, body);
  }

  @Delete('data')
  @UseGuards(JwtAuthGuard)
  async deleteData(@Request() req) {
    const controller = this.contactModule.getContactImportController();
    return controller.deleteContactData(req.user.id);
  }
}

// Privacy endpoints
@Controller('privacy')
export class PrivacyController {
  constructor(
    @Inject('CONTACT_DISCOVERY') private contactModule: ContactImportModule
  ) {}

  @Get('contact-data-export')
  @UseGuards(JwtAuthGuard)
  async exportData(@Request() req) {
    const controller = this.contactModule.getContactPrivacyController();
    return controller.exportContactData(req.user.id);
  }

  @Get('transparency-report')
  @UseGuards(JwtAuthGuard)
  async getTransparencyReport(@Request() req) {
    const controller = this.contactModule.getContactPrivacyController();
    return controller.getTransparencyReport(req.user.id);
  }
}
```

### 5. Cleanup Jobs

Set up automated cleanup using your existing scheduler:

```typescript
// In your task scheduler service
@Injectable()
export class TaskSchedulerService {
  constructor(
    @Inject('CONTACT_DISCOVERY') private contactModule: ContactImportModule
  ) {}

  @Cron('0 2 * * *') // Daily at 2 AM
  async cleanupExpiredContactData() {
    const service = this.contactModule.getContactImportService();
    const result = await service.cleanupExpiredData();
    Logger.log(`Cleaned up ${result.cleaned} expired contact records`, 'ContactCleanup');
  }
}
```

## Usage Examples

### Frontend Implementation

```typescript
// Example React/TypeScript client code
class ContactDiscoveryAPI {
  async importContacts(contacts: Array<{type: 'phone' | 'email', value: string}>) {
    const response = await fetch('/api/contacts/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`,
      },
      body: JSON.stringify({ contacts }),
    });
    
    return response.json();
  }

  async updatePrivacyPreferences(preferences: {
    allowDiscovery: boolean;
    discoveryMode: 'mutual-only' | 'one-sided' | 'disabled';
    allowSuggestions: boolean;
  }) {
    const response = await fetch('/api/contacts/preferences', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`,
      },
      body: JSON.stringify(preferences),
    });
    
    return response.json();
  }

  async deleteAllContactData() {
    const response = await fetch('/api/contacts/data', {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${getAuthToken()}`,
      },
    });
    
    return response.json();
  }
}

// Usage in a React component
function ContactImportComponent() {
  const [contacts, setContacts] = useState([]);
  const [preferences, setPreferences] = useState(null);
  const api = new ContactDiscoveryAPI();

  const handleImport = async () => {
    try {
      const result = await api.importContacts(contacts);
      console.log(`Discovered ${result.data.discoveredCount} friends!`);
    } catch (error) {
      console.error('Import failed:', error);
    }
  };

  const updatePreferences = async (newPrefs) => {
    try {
      await api.updatePrivacyPreferences(newPrefs);
      setPreferences(newPrefs);
    } catch (error) {
      console.error('Failed to update preferences:', error);
    }
  };

  return (
    <div>
      <ContactImportForm onImport={handleImport} />
      <PrivacySettings 
        preferences={preferences} 
        onUpdate={updatePreferences} 
      />
    </div>
  );
}
```

### Mobile Implementation

```typescript
// React Native example
class MobileContactImport {
  async requestContactPermission() {
    const permission = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_CONTACTS
    );
    return permission === PermissionsAndroid.RESULTS.GRANTED;
  }

  async getDeviceContacts() {
    if (await this.requestContactPermission()) {
      const contacts = await Contacts.getAll();
      return contacts.map(contact => ({
        phones: contact.phoneNumbers.map(p => ({ type: 'phone', value: p.number })),
        emails: contact.emailAddresses.map(e => ({ type: 'email', value: e.email })),
      })).flat();
    }
    return [];
  }

  async importContactsSecurely() {
    const deviceContacts = await this.getDeviceContacts();
    
    // Process on device before sending
    const processedContacts = deviceContacts.map(contact => ({
      type: contact.type,
      value: contact.value.toLowerCase().trim(), // Normalize locally
    }));

    // Send to server
    const api = new ContactDiscoveryAPI();
    return api.importContacts(processedContacts);
  }
}
```

## Security Considerations

### Production Deployment

1. **Salt Generation**: Use cryptographically secure random salts:
   ```bash
   # Generate secure salts
   openssl rand -hex 32  # For each salt
   ```

2. **Environment Security**:
   ```bash
   # Use environment-specific salts
   CONTACT_SALT_PHONE_PROD=...
   CONTACT_SALT_PHONE_STAGING=...
   CONTACT_SALT_PHONE_DEV=...
   ```

3. **Redis Security**:
   ```bash
   # Enable Redis AUTH
   requirepass your_redis_password
   
   # Enable TLS
   tls-port 6380
   ```

4. **Rate Limiting**:
   ```typescript
   // Add stricter rate limiting in production
   @UseGuards(ThrottlerGuard)
   @Throttle(5, 3600) // 5 imports per hour
   async importContacts() { ... }
   ```

### Monitoring

Set up alerts for:
- Failed cleanup jobs
- Unusual discovery patterns
- High error rates
- PII detection in logs

```typescript
// Example monitoring setup
@Injectable()
export class ContactDiscoveryMonitoring {
  async checkSystemHealth() {
    const metrics = {
      redis_connectivity: await this.testRedisConnection(),
      database_connectivity: await this.testDatabaseConnection(),
      cleanup_job_status: await this.getLastCleanupStatus(),
      error_rate: await this.getErrorRate(),
    };
    
    // Alert if any metric fails
    if (Object.values(metrics).some(metric => !metric.healthy)) {
      await this.sendAlert('Contact discovery system health check failed', metrics);
    }
    
    return metrics;
  }
}
```

## Compliance

### GDPR Compliance

The system provides:
- ✅ **Right to Information**: Privacy documentation explains data handling
- ✅ **Right of Access**: Data export functionality
- ✅ **Right to Rectification**: Preference update functionality
- ✅ **Right to Erasure**: Complete data deletion
- ✅ **Right to Restrict Processing**: Discovery can be disabled
- ✅ **Right to Data Portability**: JSON export format
- ✅ **Right to Object**: Opt-out functionality

### CCPA Compliance

The system provides:
- ✅ **Right to Know**: Transparency reporting
- ✅ **Right to Delete**: Data deletion functionality
- ✅ **Right to Opt-Out**: No data "sale" (we don't sell data)
- ✅ **Right to Non-Discrimination**: Full functionality regardless of privacy choices

### Audit Requirements

Maintain these records:
- Data retention compliance reports
- User consent records
- Data processing activities
- Security incident logs
- Emergency action logs

## Testing

### Unit Tests

```typescript
describe('ContactImportService', () => {
  let service: ContactImportService;
  let mockRedis: any;
  let mockDatabase: any;

  beforeEach(() => {
    mockRedis = {
      setex: jest.fn(),
      get: jest.fn(),
      del: jest.fn(),
    };
    
    mockDatabase = {
      discoveryToken: {
        create: jest.fn(),
        deleteMany: jest.fn(),
      },
      contactPrivacyPrefs: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
    };

    service = new ContactImportService(mockRedis, mockDatabase);
  });

  it('should normalize phone numbers correctly', async () => {
    const result = await service.normalizePhoneNumber('+1-555-123-4567');
    expect(result).toBe('+15551234567');
  });

  it('should hash contacts securely', async () => {
    const hash1 = await service.hashContact('test@example.com', 'email', 'user1');
    const hash2 = await service.hashContact('test@example.com', 'email', 'user2');
    
    // Same contact, different users should produce different hashes
    expect(hash1).not.toBe(hash2);
  });
});
```

### Integration Tests

```typescript
describe('Contact Discovery Integration', () => {
  it('should perform mutual discovery correctly', async () => {
    // User A imports User B's contact
    await service.importContacts('userA', [
      { type: 'email', value: 'userb@example.com' }
    ]);
    
    // User B imports User A's contact
    const result = await service.importContacts('userB', [
      { type: 'email', value: 'usera@example.com' }
    ]);
    
    // Should discover mutual connection
    expect(result.discoveredCount).toBe(1);
    expect(result.discoveries[0].mutual).toBe(true);
  });
});
```

## Troubleshooting

### Common Issues

1. **No discoveries found**:
   - Check if both users have discovery enabled
   - Verify mutual-only mode requirements
   - Check contact normalization

2. **Hash mismatches**:
   - Verify salt configuration
   - Check monthly salt rotation
   - Validate contact normalization

3. **Cleanup not working**:
   - Check cron job configuration
   - Verify Redis TTL settings
   - Check database cleanup functions

4. **High memory usage**:
   - Monitor Redis memory usage
   - Check for TTL misconfiguration
   - Verify cleanup job execution

### Debug Commands

```bash
# Check Redis keys
redis-cli KEYS "contact:*" | wc -l

# Check discovery tokens
psql -c "SELECT COUNT(*) FROM discovery_tokens WHERE expires_at < NOW();"

# Check cleanup status
psql -c "SELECT * FROM cleanup_audit ORDER BY cleanup_timestamp DESC LIMIT 10;"
```

## Performance Optimization

### Redis Optimization

```bash
# Redis configuration for contact discovery
maxmemory 2gb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
save 60 10000
```

### Database Optimization

```sql
-- Indexes for better performance
CREATE INDEX CONCURRENTLY idx_discovery_tokens_expires_at ON discovery_tokens(expires_at);
CREATE INDEX CONCURRENTLY idx_discovery_tokens_requester_id ON discovery_tokens(requester_id);
CREATE INDEX CONCURRENTLY idx_discovery_tokens_target_id ON discovery_tokens(target_id);
```

### Monitoring Queries

```sql
-- Monitor system performance
SELECT 
  'discovery_tokens' as table_name,
  COUNT(*) as total_records,
  COUNT(*) FILTER (WHERE expires_at < NOW()) as expired_records,
  AVG(EXTRACT(EPOCH FROM (expires_at - created_at))) as avg_ttl_seconds
FROM discovery_tokens;
```

This implementation provides a complete, production-ready contact discovery system with comprehensive privacy protection, regulatory compliance, and security best practices.