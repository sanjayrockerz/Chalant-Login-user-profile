# Mutual Contact Discovery Design

## Overview

This document defines a bidirectional contact discovery system that prevents one-sided enumeration attacks while enabling privacy-preserving friend suggestions. The system ensures matches only resolve when both parties have each other in their contacts.

## Core Concept: Bidirectional Discovery Tokens

### Problem Statement
Traditional contact discovery systems allow one-sided enumeration:
- User A uploads contact for User B
- System reveals if User B is on the platform
- User B has no knowledge or consent for this discovery
- Creates privacy asymmetry and potential stalking vectors

### Solution: Mutual Discovery Requirement
```typescript
// Bidirectional token generation
function generateMutualDiscoveryToken(
  userAHash: string, 
  userBHash: string,
  contactType: 'phone' | 'email'
): string {
  // Sort hashes to ensure consistent token regardless of discovery direction
  const [hash1, hash2] = [userAHash, userBHash].sort();
  
  // Create bidirectional token
  const tokenData = {
    type: contactType,
    hash1,
    hash2,
    version: 'v1'
  };
  
  // Hash the combination to create discovery token
  return createHash('sha256')
    .update(JSON.stringify(tokenData))
    .digest('hex');
}
```

## Discovery Token Schema

### Token Structure
```typescript
interface DiscoveryToken {
  // Bidirectional identifier (same for both users)
  mutualToken: string;
  
  // User who uploaded this contact
  uploaderUserId: string;
  
  // Contact type (phone/email)
  contactType: 'phone' | 'email';
  
  // Token creation timestamp
  createdAt: Date;
  
  // TTL for automatic cleanup
  expiresAt: Date;
  
  // Privacy metadata
  metadata: {
    // Source of contact (addressbook, manual, etc.)
    source: string;
    
    // User consent level
    consentLevel: 'explicit' | 'implicit';
    
    // Processing context
    processingContext: string;
  };
}
```

### Database Schema (PostgreSQL)
```sql
CREATE TABLE contact_discovery_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mutual_token VARCHAR(64) NOT NULL,
  uploader_user_id UUID NOT NULL,
  contact_type contact_type_enum NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  source VARCHAR(50) NOT NULL,
  consent_level consent_level_enum NOT NULL,
  processing_context VARCHAR(100) NOT NULL,
  
  -- Indexes for efficient discovery
  INDEX idx_mutual_token (mutual_token),
  INDEX idx_uploader_user_id (uploader_user_id),
  INDEX idx_expires_at (expires_at),
  
  -- Constraints
  CONSTRAINT fk_uploader_user FOREIGN KEY (uploader_user_id) 
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_expires_future CHECK (expires_at > created_at)
);

-- Enum types
CREATE TYPE contact_type_enum AS ENUM ('phone', 'email');
CREATE TYPE consent_level_enum AS ENUM ('explicit', 'implicit');
```

## Discovery Modes Configuration

### Mode 1: Mutual-Only Discovery (Default - High Privacy)
```typescript
interface MutualOnlyConfig {
  mode: 'mutual-only';
  requireBidirectional: true;
  minimumMatches: 2; // Both users must have uploaded each other
  notificationPolicy: 'both-parties';
  
  // Privacy controls
  exposeMatchCount: false;
  enableSuggestions: false;
  allowPartialMatches: false;
}
```

**Benefits:**
- Highest privacy protection
- Prevents one-sided enumeration completely
- No stalking or unwanted discovery vectors
- GDPR-compliant by design

**Trade-offs:**
- Lower discovery rates
- Requires both users to upload contacts
- Less effective for user growth

### Mode 2: One-Sided Discovery (Optional - Growth Focused)
```typescript
interface OneSidedConfig {
  mode: 'one-sided';
  requireBidirectional: false;
  minimumMatches: 1; // Only one user needs to upload
  notificationPolicy: 'discoverer-only';
  
  // Privacy controls
  exposeMatchCount: false;
  enableSuggestions: true;
  allowPartialMatches: true;
  
  // Abuse prevention
  rateLimiting: {
    maxDiscoveriesPerHour: 50,
    maxDiscoveriesPerDay: 200,
    suspicionThreshold: 100
  };
}
```

**Benefits:**
- Higher discovery rates
- Better user growth metrics
- More effective friend suggestions

**Trade-offs:**
- Potential privacy concerns
- Requires robust abuse prevention
- May need additional consent mechanisms

### Mode 3: Hybrid Discovery (Balanced)
```typescript
interface HybridConfig {
  mode: 'hybrid';
  defaultMode: 'mutual-only';
  userOptIn: 'one-sided';
  
  // Graduated privacy
  newUserPeriod: 30; // Days to enforce mutual-only for new users
  trustedUserThreshold: 90; // Days to enable one-sided discovery
  
  // Consent management
  explicitConsentRequired: true;
  consentRenewalPeriod: 365; // Days
  granularControls: true;
}
```

## Implementation: Contact Discovery Service

### Core Discovery Service
```typescript
@Injectable()
export class ContactDiscoveryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly hashingService: ContactHashingService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
    private readonly metricsService: MetricsService
  ) {}

  async processContactUpload(
    userId: string,
    hashedContacts: HashedContact[],
    discoveryMode: DiscoveryMode = 'mutual-only'
  ): Promise<DiscoveryResult> {
    const span = tracer?.startSpan('contact-discovery.process-upload');
    const startTime = Date.now();
    
    try {
      // Validate user permissions
      await this.validateUserDiscoveryPermissions(userId, discoveryMode);
      
      // Process contacts and generate discovery tokens
      const tokens = await this.generateDiscoveryTokens(userId, hashedContacts);
      
      // Store tokens with TTL
      await this.storeDiscoveryTokens(tokens);
      
      // Perform discovery based on configured mode
      const discoveries = await this.performDiscovery(tokens, discoveryMode);
      
      // Log discovery attempt (PII-free)
      await this.auditService.logDiscoveryAttempt({
        userId,
        contactCount: hashedContacts.length,
        discoveryCount: discoveries.length,
        mode: discoveryMode,
        correlationId: randomUUID()
      });
      
      // Update metrics
      this.metricsService.contactDiscoveryProcessed.inc({
        mode: discoveryMode,
        result: 'success'
      });
      
      return {
        processedContacts: tokens.length,
        discoveries: discoveries,
        mode: discoveryMode
      };
      
    } catch (error) {
      span?.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      this.metricsService.contactDiscoveryErrors.inc({
        mode: discoveryMode,
        error: error.constructor.name
      });
      throw error;
      
    } finally {
      span?.end();
      this.metricsService.contactDiscoveryLatency.observe(
        { mode: discoveryMode },
        (Date.now() - startTime) / 1000
      );
    }
  }

  private async generateDiscoveryTokens(
    userId: string,
    hashedContacts: HashedContact[]
  ): Promise<DiscoveryToken[]> {
    const tokens: DiscoveryToken[] = [];
    
    for (const contact of hashedContacts) {
      // Generate server-side hash
      const serverHash = await this.hashingService.generateServerHash(
        contact.clientHash,
        userId,
        contact.type
      );
      
      // Create discovery token
      const token: DiscoveryToken = {
        mutualToken: this.generateMutualToken(serverHash, contact.type),
        uploaderUserId: userId,
        contactType: contact.type,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + this.getTokenTTL()),
        metadata: {
          source: 'address-book',
          consentLevel: 'implicit',
          processingContext: 'friend-discovery'
        }
      };
      
      tokens.push(token);
    }
    
    return tokens;
  }
  
  private async performDiscovery(
    tokens: DiscoveryToken[],
    mode: DiscoveryMode
  ): Promise<Discovery[]> {
    const discoveries: Discovery[] = [];
    
    for (const token of tokens) {
      // Look for existing tokens with same mutual token
      const existingTokens = await this.db.query(
        'SELECT * FROM contact_discovery_tokens WHERE mutual_token = $1 AND uploader_user_id != $2',
        [token.mutualToken, token.uploaderUserId]
      );
      
      if (mode === 'mutual-only') {
        // Require bidirectional upload
        if (existingTokens.length > 0) {
          discoveries.push({
            userId: token.uploaderUserId,
            matchedUserId: existingTokens[0].uploader_user_id,
            contactType: token.contactType,
            mutualMatch: true,
            confidence: 'high'
          });
        }
      } else if (mode === 'one-sided') {
        // Single-sided discovery allowed
        if (existingTokens.length > 0) {
          discoveries.push({
            userId: token.uploaderUserId,
            matchedUserId: existingTokens[0].uploader_user_id,
            contactType: token.contactType,
            mutualMatch: false,
            confidence: 'medium'
          });
        }
      }
    }
    
    return discoveries;
  }
}
```

## Privacy Controls and User Settings

### User Privacy Dashboard
```typescript
interface ContactPrivacySettings {
  // Discovery mode preference
  discoveryMode: 'mutual-only' | 'one-sided' | 'disabled';
  
  // Contact type preferences
  phoneDiscovery: boolean;
  emailDiscovery: boolean;
  
  // Notification preferences
  discoveryNotifications: boolean;
  suggestionNotifications: boolean;
  
  // Data retention preferences
  autoDeleteUploaded: boolean;
  retentionPeriodDays: number; // 30, 90, 365, or indefinite
  
  // Advanced privacy controls
  blockSuggestions: boolean;
  restrictToMutualFriends: boolean;
  requireExplicitConsent: boolean;
}
```

### API Endpoints for Privacy Control
```typescript
@Controller('privacy/contacts')
export class ContactPrivacyController {
  
  @Get('settings')
  async getPrivacySettings(@Req() req: AuthenticatedRequest) {
    return this.privacyService.getUserSettings(req.user.id);
  }
  
  @Put('settings')
  async updatePrivacySettings(
    @Req() req: AuthenticatedRequest,
    @Body() settings: ContactPrivacySettings
  ) {
    await this.privacyService.updateUserSettings(req.user.id, settings);
    
    // Audit the privacy settings change
    await this.auditService.logPrivacySettingsChange({
      userId: req.user.id,
      changes: settings,
      timestamp: new Date()
    });
    
    return { success: true };
  }
  
  @Delete('uploaded')
  async deleteUploadedContacts(@Req() req: AuthenticatedRequest) {
    const deletedCount = await this.discoveryService.deleteUserContacts(req.user.id);
    
    await this.auditService.logContactDeletion({
      userId: req.user.id,
      deletedCount,
      timestamp: new Date()
    });
    
    return { deletedCount };
  }
}
```

## Trade-offs Analysis

### Mutual-Only vs One-Sided Discovery

| Aspect | Mutual-Only | One-Sided | Hybrid |
|--------|-------------|-----------|---------|
| **Privacy Protection** | Highest | Medium | Configurable |
| **Discovery Rate** | Lower | Higher | Balanced |
| **User Growth Impact** | Negative | Positive | Neutral |
| **Stalking Risk** | Minimal | Higher | Controlled |
| **Compliance Complexity** | Simple | Complex | Moderate |
| **User Experience** | Restrictive | Permissive | Flexible |

### Configuration Recommendations

#### High-Privacy Organizations (Healthcare, Financial)
```typescript
const HIGH_PRIVACY_CONFIG: DiscoveryConfig = {
  defaultMode: 'mutual-only',
  allowOneSided: false,
  requireExplicitConsent: true,
  shortTTL: true, // 7 days
  restrictToVerifiedUsers: true
};
```

#### Growth-Focused Consumer Apps
```typescript
const GROWTH_FOCUSED_CONFIG: DiscoveryConfig = {
  defaultMode: 'hybrid',
  allowOneSided: true,
  newUserProtection: 30, // days
  requireExplicitConsent: false,
  standardTTL: true // 90 days
};
```

#### Enterprise/B2B Platforms
```typescript
const ENTERPRISE_CONFIG: DiscoveryConfig = {
  defaultMode: 'mutual-only',
  allowOneSided: false,
  requireExplicitConsent: true,
  auditLogging: 'comprehensive',
  adminOverrides: true
};
```

## Security Considerations

### Abuse Prevention
1. **Rate Limiting:** Multi-dimensional throttling on contact uploads
2. **Anomaly Detection:** Flag unusual discovery patterns
3. **User Reporting:** Allow users to report unwanted discoveries
4. **Account Restrictions:** Temporary suspension for abuse patterns

### Attack Vectors and Mitigations
- **Enumeration Attacks:** Prevented by mutual requirement and rate limiting
- **Social Engineering:** User education and explicit consent workflows
- **Data Mining:** PII redaction and audit logging
- **Cross-Platform Correlation:** Platform-specific salts prevent hash reuse

---

**Document Version:** 1.0  
**Last Updated:** October 9, 2025  
**Review Date:** January 9, 2026  
**Owner:** Privacy Engineering Team