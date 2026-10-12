# Contact Hashing Strategy Document

## Executive Summary

This document defines a privacy-first contact hashing strategy for secure friend discovery that prevents raw contact identifiers (phone numbers, emails) from ever persisting server-side while enabling mutual contact discovery and friend suggestions.

## Core Design Principles

### 1. Zero Server-Side PII Storage
- Raw contact data NEVER persists in databases, logs, or memory beyond immediate processing
- All identifiers are normalized and hashed before any storage or comparison operations
- Error messages and telemetry are sanitized to prevent accidental PII exposure

### 2. Client-Side Hashing with Server Validation
- **Decision:** Client-side hashing with server-side validation and re-hashing
- **Rationale:** Provides user control and reduces server-side PII exposure while maintaining normalization consistency
- **Implementation:** Client performs initial normalization and hashing, server validates format and applies additional security layers

## Hashing Algorithm Selection

### Primary Algorithm: Argon2id
```typescript
// Configuration for contact hashing
const ARGON2_CONFIG = {
  type: argon2.argon2id,
  memoryCost: 2 ** 16, // 64 MB
  timeCost: 3,         // 3 iterations
  parallelism: 1,      // Single thread
  saltLength: 32       // 256-bit salt
};
```

**Rationale:**
- **Argon2id** chosen over SHA-256 or bcrypt for superior resistance to rainbow table and GPU-based attacks
- Memory-hard function makes precomputation attacks economically infeasible
- Configurable cost parameters allow tuning for performance vs security trade-offs
- Industry standard for password hashing, proven security record

### Salt Strategy: Platform + User Specific
```typescript
// Salt composition for contact hashing
const salt = kdf(
  PLATFORM_MASTER_KEY,           // Platform-wide secret
  userId,                        // User-specific component
  'contact-discovery-v1',        // Domain separation
  currentDate.toISOString().slice(0, 7) // Monthly rotation (YYYY-MM)
);
```

**Benefits:**
- **Platform Master Key:** Prevents cross-platform hash correlation
- **User ID:** Ensures user-specific salts prevent cross-user enumeration
- **Domain Separation:** Prevents hash reuse across different features
- **Monthly Rotation:** Limits exposure window and enables proactive security

## Contact Normalization Rules

### Phone Number Normalization
```typescript
function normalizePhoneNumber(phone: string): string {
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '');
  
  // Convert to E.164 format
  if (digits.length === 10) {
    return `+1${digits}`; // US/Canada default
  } else if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  } else if (digits.length > 11) {
    return `+${digits}`;
  }
  
  throw new Error('Invalid phone number format');
}
```

### Email Address Normalization
```typescript
function normalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  
  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmed)) {
    throw new Error('Invalid email format');
  }
  
  // Remove Gmail/Google Workspace dots and plus addressing
  const [localPart, domain] = trimmed.split('@');
  
  if (domain === 'gmail.com' || domain.endsWith('.googlemail.com')) {
    const normalizedLocal = localPart.replace(/\./g, '').split('+')[0];
    return `${normalizedLocal}@gmail.com`;
  }
  
  return trimmed;
}
```

## Client-Side Implementation

### Contact Preprocessing Flow
```typescript
// Client-side contact processing
class ContactHasher {
  async hashContacts(rawContacts: RawContact[]): Promise<HashedContact[]> {
    const hashedContacts = [];
    
    for (const contact of rawContacts) {
      try {
        // Normalize identifier
        const normalized = contact.type === 'phone' 
          ? normalizePhoneNumber(contact.value)
          : normalizeEmail(contact.value);
        
        // Generate client-side hash with temporal salt
        const clientSalt = await this.generateClientSalt(contact.type);
        const clientHash = await argon2.hash(normalized, {
          salt: clientSalt,
          ...ARGON2_CONFIG
        });
        
        hashedContacts.push({
          type: contact.type,
          clientHash,
          timestamp: Date.now()
        });
        
        // Immediately clear raw data from memory
        contact.value = '[CLEARED]';
        
      } catch (error) {
        // Skip invalid contacts, never log raw values
        console.warn('Contact normalization failed', { 
          type: contact.type,
          error: error.message 
        });
      }
    }
    
    return hashedContacts;
  }
}
```

## Server-Side Validation and Re-Hashing

### Contact Processing Pipeline
```typescript
@Injectable()
export class ContactHashingService {
  
  async processClientHashes(
    userId: string,
    clientHashes: HashedContact[]
  ): Promise<ProcessedContact[]> {
    const processedContacts = [];
    
    for (const contact of clientHashes) {
      try {
        // Validate client hash format
        this.validateHashFormat(contact.clientHash);
        
        // Generate server-side salt with user-specific components
        const serverSalt = await this.generateServerSalt(userId, contact.type);
        
        // Re-hash the client hash for additional security layer
        const serverHash = await argon2.hash(contact.clientHash, {
          salt: serverSalt,
          ...ARGON2_CONFIG
        });
        
        // Create discovery token (for mutual discovery)
        const discoveryToken = await this.generateDiscoveryToken(
          serverHash, 
          userId, 
          contact.type
        );
        
        processedContacts.push({
          type: contact.type,
          serverHash,
          discoveryToken,
          userId,
          createdAt: new Date()
        });
        
      } catch (error) {
        // Log processing errors without exposing hashes
        this.logger.warn('Contact hash processing failed', {
          userId,
          contactType: contact.type,
          error: error.message,
          correlationId: randomUUID()
        });
      }
    }
    
    return processedContacts;
  }
}
```

## Rainbow Table Protection

### Multi-Layer Defense Strategy
1. **High Memory Cost:** Argon2id memory requirements make rainbow table generation expensive
2. **User-Specific Salts:** Each user has unique salt components preventing cross-user attacks
3. **Monthly Salt Rotation:** Regular rotation limits exposure window for any compromised salts
4. **Double Hashing:** Client + server hashing layers require compromise of both systems
5. **Platform-Specific Secrets:** Master key ensures hashes are platform-specific

### Cost-Benefit Analysis
```typescript
// Estimated attack costs (2025 pricing)
const RAINBOW_TABLE_COSTS = {
  memoryRequired: '64MB per hash computation',
  timeRequired: '~100ms per hash on modern hardware',
  economicCost: '$50,000+ for comprehensive phone number table',
  scalingFactor: 'Linear with user base size due to user-specific salts'
};
```

## Security Considerations

### Threat Model Resistance
- ✅ **Rainbow Table Attacks:** High memory cost + user-specific salts
- ✅ **Database Compromise:** No raw PII stored, hashes require additional salt knowledge
- ✅ **Log Analysis:** PII redaction prevents exposure in logs/telemetry
- ✅ **Internal Threats:** Minimal server-side PII exposure window
- ⚠️ **Client-Side Compromise:** Client devices could expose raw contacts before hashing
- ⚠️ **Timing Attacks:** Hash computation timing could theoretically reveal information

### Mitigation Strategies
1. **Client Hardening:** Encourage users to use secure devices and updated software
2. **Constant-Time Operations:** Use consistent timing for hash operations regardless of input
3. **Rate Limiting:** Multi-dimensional throttling prevents enumeration attacks
4. **Audit Logging:** Comprehensive logging of hash operations (without PII)

## Performance Characteristics

### Computational Requirements
```typescript
// Performance benchmarks (approximate)
const PERFORMANCE_METRICS = {
  clientHashTime: '50-100ms per contact',
  serverRehashTime: '50-100ms per contact',
  memoryUsage: '64MB per concurrent hash operation',
  batchProcessing: 'Recommended for >100 contacts',
  cachingStrategy: 'Redis TTL-based with cleanup'
};
```

### Scalability Considerations
- **Horizontal Scaling:** Hash operations are stateless and parallelizable
- **Resource Planning:** ~100ms CPU + 64MB RAM per contact processed
- **Batching Strategy:** Process contacts in batches of 50-100 to balance performance and memory
- **Cache Optimization:** Use Redis for temporary storage with aggressive TTL

## Implementation Roadmap

### Phase 1: Core Hashing Infrastructure
1. Implement normalization functions with comprehensive validation
2. Set up Argon2id hashing service with configurable parameters
3. Create salt generation and rotation mechanisms
4. Add PII redaction utilities for logging

### Phase 2: Client-Side Integration
1. Develop client-side hashing library (TypeScript/JavaScript)
2. Implement secure contact preprocessing pipeline
3. Add client-side validation and error handling
4. Create contact upload API endpoints

### Phase 3: Security Hardening
1. Implement timing attack mitigations
2. Add comprehensive audit logging (PII-free)
3. Set up monitoring and alerting for anomalous patterns
4. Conduct security review and penetration testing

## Compliance and Privacy

### Data Protection Principles
- **Data Minimization:** Only process necessary contact identifiers
- **Purpose Limitation:** Hashes used exclusively for friend discovery
- **Storage Limitation:** Aggressive TTL and automated cleanup
- **Transparency:** Clear documentation of data processing

### Regulatory Alignment
- **GDPR Article 25:** Privacy by design and default implementation
- **CCPA Section 1798.100:** Consumer right to know data collection practices
- **SOX Compliance:** Audit trails for data processing operations
- **Industry Standards:** Follows Signal, WhatsApp, and Snapchat best practices

---

**Document Version:** 1.0  
**Last Updated:** October 9, 2025  
**Review Date:** January 9, 2026  
**Owner:** Privacy Engineering Team