# Contact Discovery Privacy Documentation

## Overview

This document provides comprehensive privacy documentation for the secure contact discovery system, designed for user transparency, compliance with GDPR and CCPA requirements, and clear communication of privacy controls.

## Executive Summary

Our contact discovery system is built with privacy-by-design principles, using advanced cryptographic hashing to protect your contact information while enabling friend discovery. **We never store your raw contact data on our servers** - only irreversible cryptographic hashes that cannot be used to reconstruct your original contacts.

### Key Privacy Guarantees

✅ **Zero Raw Contact Storage**: Your email addresses and phone numbers are never stored on our servers  
✅ **One-Way Hashing**: Contact identifiers are converted to irreversible cryptographic hashes  
✅ **Mutual Discovery Only**: Friends can only be discovered if both parties have each other's contacts  
✅ **User Control**: Complete control over discovery settings and data deletion  
✅ **Automatic Cleanup**: All discovery data automatically expires and is deleted  
✅ **No Cross-Platform Tracking**: Separate hashing per platform prevents correlation  

## How Contact Discovery Works

### 1. Client-Side Processing (Your Device)
```
Your Contacts → Normalization → Hashing → Encrypted Upload
    ↓              ↓              ↓            ↓
Raw emails/    Standardized   Argon2id     Secure transmission
phone numbers  format         hash         to our servers
```

**What happens on your device:**
- Contacts are normalized (e.g., "+1-555-123-4567" becomes "+15551234567")
- Each contact is hashed using Argon2id with a platform-specific salt
- Only the hash is sent to our servers - **raw contacts never leave your device**

### 2. Server-Side Matching (Our Servers)
```
Your Hashes → Discovery Tokens → Mutual Matching → Friend Suggestions
     ↓             ↓                  ↓                ↓
Compare with   Bidirectional      Only mutual       Notify both
other users'   discovery          matches           users
hashes         system             revealed
```

**What happens on our servers:**
- We compare your hashes with other users' hashes
- Matches are only revealed if both users have each other's contacts
- Discovery tokens expire automatically (7-30 days)
- No reverse lookup of original contacts is possible

## Privacy Controls

### Discovery Settings

Users have complete control over their contact discovery preferences:

```typescript
interface PrivacyControls {
  // Main discovery toggle
  allowDiscovery: boolean;
  
  // Discovery modes
  discoveryMode: 'mutual-only' | 'one-sided' | 'disabled';
  
  // Friend suggestions
  allowSuggestions: boolean;
  
  // Platform-specific controls
  phoneDiscovery: boolean;
  emailDiscovery: boolean;
}
```

#### Discovery Modes Explained

**Mutual-Only (Recommended)**
- ✅ You can only be discovered by people who are in your contacts
- ✅ You can only discover people who have your contact information
- ✅ Maximum privacy protection
- ✅ Prevents unwanted discovery

**One-Sided (Less Private)**
- ⚠️ You can be discovered by anyone who has your contact information
- ⚠️ You can discover anyone, even if they don't have your contacts
- ⚠️ Reduces privacy protection
- ⚠️ May enable unwanted contact

**Disabled**
- 🚫 No contact discovery in either direction
- 🚫 No friend suggestions
- ✅ Complete privacy isolation

### Data Control APIs

Users can manage their privacy through these endpoints:

```typescript
// Update privacy preferences
PUT /api/privacy/contact-discovery
{
  "allowDiscovery": true,
  "discoveryMode": "mutual-only",
  "allowSuggestions": false,
  "phoneDiscovery": true,
  "emailDiscovery": false
}

// View current privacy settings
GET /api/privacy/contact-discovery

// Delete all contact discovery data
DELETE /api/privacy/contact-discovery

// Download privacy data report
GET /api/privacy/data-export
```

## Data Collection and Usage

### What We Collect

| Data Type | What It Is | Why We Need It | How Long We Keep It |
|-----------|------------|----------------|-------------------|
| **Contact Hashes** | Cryptographic hashes of your contacts | Enable friend discovery | 90 days maximum |
| **Discovery Tokens** | Matching records between users | Track mutual discoveries | 7-30 days |
| **Privacy Preferences** | Your discovery settings | Respect your privacy choices | Until account deletion |
| **Discovery Events** | Anonymous matching events | System monitoring and improvement | 1 year (anonymized) |

### What We DON'T Collect

❌ **Raw Contact Information**: Never stored on our servers  
❌ **Contact Names**: We don't need or store contact names  
❌ **Contact Relationships**: We don't know who your contacts are  
❌ **Contact Frequency**: We don't track how often you contact people  
❌ **Contact Metadata**: No photos, addresses, or other contact details  

### How We Use Your Data

1. **Friend Discovery**: Match you with mutual contacts who are also users
2. **Friend Suggestions**: Suggest people you might know (if enabled)
3. **Privacy Enforcement**: Ensure only authorized discoveries occur
4. **System Security**: Detect and prevent abuse or spam
5. **Service Improvement**: Anonymous analytics to improve matching accuracy

### How We DON'T Use Your Data

❌ **Advertising**: We never use contact data for ads  
❌ **Selling**: We never sell or share contact data with third parties  
❌ **Profiling**: We don't build profiles based on your contacts  
❌ **Cross-Service Tracking**: Contact data stays within our service  
❌ **Reverse Lookups**: We cannot determine who your contacts are  

## Data Retention and Deletion

### Automatic Data Expiration

All contact discovery data has built-in expiration dates:

```typescript
const dataRetention = {
  contactHashes: '90 days',      // Automatically deleted
  discoveryTokens: '7-30 days',  // Automatically deleted
  auditLogs: '1 year',          // Anonymized, for security monitoring
  preferences: 'User lifetime'   // Deleted when account is deleted
};
```

### User-Initiated Deletion

**Immediate Deletion Options:**
- Delete all contact discovery data: Available in privacy settings
- Delete specific discovery matches: Available in friend suggestions
- Disable discovery entirely: Stops all future matching

**Account Deletion:**
- All contact discovery data is permanently deleted within 30 days
- Discovery tokens involving you are immediately invalidated
- Your hashes are removed from all matching systems

### Data Minimization

We automatically minimize data retention:

1. **Expired Hashes**: Automatically deleted after 90 days
2. **Failed Discoveries**: Tokens deleted after 7 days if no match
3. **Successful Discoveries**: Tokens deleted after 30 days
4. **Log Anonymization**: Personal identifiers removed after processing

## Technical Privacy Protections

### Cryptographic Security

**Argon2id Hashing**
- Industry-standard, memory-hard hashing function
- Resistant to rainbow table attacks
- Platform-specific salts prevent cross-platform correlation
- Monthly salt rotation for additional security

**Hash Properties**
```typescript
// Example hash generation (simplified)
const contactHash = argon2id({
  input: normalizedContact,
  salt: platformSalt + userSalt + monthlySalt,
  iterations: 3,
  memory: 65536,  // 64MB
  parallelism: 4
});

// Properties:
// - Irreversible: Cannot recover original contact
// - Unique: Same contact produces different hashes per user/platform
// - Collision-resistant: Different contacts won't produce same hash
```

### Network Security

- **TLS 1.3**: All data transmission encrypted
- **Certificate Pinning**: Prevents man-in-the-middle attacks
- **Request Signing**: API requests are cryptographically signed
- **Rate Limiting**: Prevents brute-force attacks

### Server Security

- **Zero-Knowledge Architecture**: Servers cannot reconstruct original contacts
- **Encrypted Storage**: All data encrypted at rest
- **Access Controls**: Strict employee access limitations
- **Audit Logging**: All access is logged and monitored

## Compliance and Rights

### GDPR Rights (European Users)

Under GDPR, you have the following rights:

1. **Right to Information**: This document fulfills your right to know how we process your data
2. **Right of Access**: You can request a copy of your data via `/api/privacy/data-export`
3. **Right to Rectification**: You can update your privacy preferences anytime
4. **Right to Erasure**: You can delete all your data via `/api/privacy/contact-discovery`
5. **Right to Restrict Processing**: You can disable discovery while keeping your account
6. **Right to Data Portability**: You can export your discovery preferences
7. **Right to Object**: You can opt out of discovery entirely

### CCPA Rights (California Users)

Under CCPA, you have the following rights:

1. **Right to Know**: We disclose what data we collect and how we use it
2. **Right to Delete**: You can request deletion of your personal information
3. **Right to Opt-Out**: You can opt out of any "sale" of personal information (we don't sell data)
4. **Right to Non-Discrimination**: We won't discriminate against you for exercising these rights

### International Users

We provide the same privacy protections to all users globally, regardless of location.

## Privacy by Design Implementation

### Proactive Privacy Protection

Our system is designed to protect privacy by default:

```typescript
// Default privacy settings (most restrictive)
const defaultPrivacySettings = {
  allowDiscovery: false,           // Opt-in required
  discoveryMode: 'mutual-only',    // Most private mode
  allowSuggestions: false,         // No suggestions by default
  phoneDiscovery: false,           // Opt-in required
  emailDiscovery: false            // Opt-in required
};
```

### Privacy-Preserving Architecture

1. **Client-Side Processing**: Sensitive operations happen on your device
2. **Minimal Server Data**: Servers only see irreversible hashes
3. **Automatic Expiration**: All data has built-in expiration dates
4. **Mutual Consent**: Discoveries require consent from both parties
5. **Purpose Limitation**: Data only used for stated purposes

### Transparency Measures

1. **Open Documentation**: This document explains exactly how the system works
2. **Clear Consent**: Explicit opt-in for all discovery features
3. **Granular Controls**: Fine-grained privacy settings
4. **Regular Updates**: We notify users of any privacy policy changes
5. **Contact Options**: Multiple ways to contact us about privacy concerns

## Frequently Asked Questions

### Q: Can you see my actual contacts?
**A: No.** We only receive irreversible cryptographic hashes. We cannot determine who your contacts are or reconstruct your contact list.

### Q: Can other users see my contact list?
**A: No.** Other users can only discover you if they already have your contact information AND you have theirs (in mutual-only mode).

### Q: What happens if I delete my account?
**A: All your contact discovery data is permanently deleted within 30 days.** Discovery tokens involving you are immediately invalidated.

### Q: Can you track me across different platforms?
**A: No.** We use different cryptographic salts for each platform, making cross-platform correlation impossible.

### Q: How do you prevent spam or abuse?
**A:** We use rate limiting, require mutual consent for discovery, and monitor for unusual patterns. Users can block unwanted discoveries.

### Q: Do you share data with third parties?
**A: No.** We never sell, rent, or share contact discovery data with third parties. We may share anonymized usage statistics for security research.

### Q: Can law enforcement access my contact data?
**A:** We can only provide hashed data, which cannot reveal your actual contacts. We follow legal processes and notify users when legally permitted.

### Q: How do I know my data is secure?
**A:** We use industry-standard encryption, undergo regular security audits, and publish transparency reports. Our zero-knowledge architecture means even we cannot access your raw contacts.

## Contact and Support

### Privacy Questions
For privacy-related questions or concerns:
- Email: privacy@yourapp.com
- Privacy Portal: https://yourapp.com/privacy
- Support Chat: Available in app settings

### Data Requests
For GDPR/CCPA data requests:
- Email: data-requests@yourapp.com
- Online Form: https://yourapp.com/data-requests
- Response Time: Within 30 days

### Security Issues
For security concerns:
- Email: security@yourapp.com
- Bug Bounty: https://yourapp.com/security/bug-bounty

### Emergency Contact
For urgent privacy or security issues:
- Emergency Hotline: +1-555-PRIVACY
- 24/7 Response Team: emergency@yourapp.com

## Updates and Changes

We will notify you of any material changes to this privacy documentation through:
- In-app notifications
- Email notifications (if you've provided an email)
- Updates posted at https://yourapp.com/privacy/contact-discovery

### Change Log

| Date | Change | Impact |
|------|--------|--------|
| 2024-01-15 | Initial release | N/A |
| TBD | Future updates | Will be documented here |

---

*Last updated: January 15, 2024*  
*Version: 1.0*  
*Contact: privacy@yourapp.com*

This document is part of our commitment to transparency and privacy protection. We believe users should understand exactly how their data is handled and have complete control over their privacy.