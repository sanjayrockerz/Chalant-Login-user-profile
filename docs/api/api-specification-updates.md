# API Specification Updates: Onboarding Enhancements

## Overview

This document outlines the updated API specifications for new fields, endpoints, error semantics, and policy version activation procedures resulting from the onboarding service enhancements.

## New API Endpoints

### Terms & Policy Management

#### GET /api/policies/current
**Description**: Retrieve current active policy version and terms information

**Request**:
```http
GET /api/policies/current
Authorization: Bearer <jwt_token>
```

**Response**:
```json
{
  "policy_version": "v2025-10-08-1",
  "terms_url": "https://example.com/terms/v2025-10-08-1",
  "privacy_url": "https://example.com/privacy/v2025-10-08-1",
  "effective_date": "2025-10-08T00:00:00Z",
  "requires_acceptance": true,
  "acceptance_deadline": "2025-11-08T00:00:00Z",
  "enforcement_mode": "enforce"
}
```

#### POST /api/policies/accept
**Description**: Accept current terms and privacy policy

**Request**:
```http
POST /api/policies/accept
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "policy_version": "v2025-10-08-1",
  "accepted_terms": true,
  "accepted_privacy": true,
  "acceptance_timestamp": "2025-10-08T10:30:00Z",
  "user_agent": "Mozilla/5.0...",
  "ip_address_hash": "sha256:abc123..."
}
```

**Response**:
```json
{
  "success": true,
  "policy_version": "v2025-10-08-1",
  "accepted_at": "2025-10-08T10:30:00Z",
  "next_review_date": "2026-10-08T00:00:00Z",
  "audit_event_id": "evt_abc123"
}
```

### Identity & Profile Management

#### POST /api/identity/verify
**Description**: Submit identity information for verification

**Request**:
```http
POST /api/identity/verify
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "full_name": "Jane Smith",
  "date_of_birth": "1995-03-15",
  "declared_age": 28,
  "country_code": "US",
  "verification_documents": [
    {
      "type": "government_id",
      "document_url": "https://secure-cdn.example.com/doc/abc123",
      "expiry_date": "2030-03-15"
    }
  ]
}
```

**Response**:
```json
{
  "verification_id": "ver_abc123",
  "status": "pending",
  "estimated_completion": "2025-10-10T00:00:00Z",
  "next_steps": [
    "Document review in progress",
    "Additional verification may be required"
  ],
  "audit_event_id": "evt_def456"
}
```

#### PATCH /api/profile/pronouns
**Description**: Update user pronouns

**Request**:
```http
PATCH /api/profile/pronouns
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "pronouns": "they/them",
  "visibility": "public"
}
```

**Response**:
```json
{
  "success": true,
  "pronouns": "they/them",
  "visibility": "public",
  "updated_at": "2025-10-08T10:30:00Z",
  "audit_event_id": "evt_ghi789"
}
```

#### POST /api/profile/image
**Description**: Set profile image URL pointer

**Request**:
```http
POST /api/profile/image
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "image_url": "https://cdn.example.com/images/user123/avatar.jpg",
  "image_type": "avatar",
  "alt_text": "User profile picture"
}
```

**Response**:
```json
{
  "success": true,
  "image_url": "https://cdn.example.com/images/user123/avatar.jpg",
  "image_type": "avatar",
  "moderation_status": "pending",
  "uploaded_at": "2025-10-08T10:30:00Z",
  "audit_event_id": "evt_jkl012"
}
```

### Enhanced Username Management

#### GET /api/username/availability/{username}
**Description**: Check username availability with enhanced validation

**Request**:
```http
GET /api/username/availability/jane_doe_2025
Authorization: Bearer <jwt_token>
X-Correlation-ID: corr_abc123
```

**Response**:
```json
{
  "available": false,
  "canonical": "jane_doe_2025",
  "reason": "already_taken",
  "suggestions": [
    "jane_doe_2026",
    "jane_doe_official",
    "jane_doe_verified"
  ],
  "validation_results": {
    "length_valid": true,
    "character_valid": true,
    "instagram_rules_compliant": true,
    "not_reserved": true,
    "not_on_denylist": true
  },
  "rate_limit_info": {
    "remaining": 8,
    "reset_time": "2025-10-08T11:00:00Z",
    "window_seconds": 3600
  }
}
```

#### PUT /api/username
**Description**: Update username with enhanced validation and conflict resolution

**Request**:
```http
PUT /api/username
Authorization: Bearer <jwt_token>
Content-Type: application/json
X-Correlation-ID: corr_def456

{
  "username": "jane_doe_2025",
  "change_reason": "user_preference"
}
```

**Response**:
```json
{
  "success": true,
  "username": "jane_doe_2025",
  "canonical": "jane_doe_2025",
  "changed_at": "2025-10-08T10:30:00Z",
  "previous_username": "jane_doe",
  "next_change_allowed_at": "2025-10-15T10:30:00Z",
  "audit_event_id": "evt_mno345"
}
```

### Password Management Enhancements

#### POST /api/password/validate
**Description**: Validate password against security policies including breach checking

**Request**:
```http
POST /api/password/validate
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "password": "MySecurePassword123!",
  "check_breaches": true
}
```

**Response**:
```json
{
  "valid": true,
  "strength_score": 85,
  "validation_results": {
    "length_valid": true,
    "uppercase_present": true,
    "lowercase_present": true,
    "numbers_present": true,
    "symbols_present": true,
    "not_breached": true,
    "not_common": true
  },
  "recommendations": [
    "Consider using a longer password for increased security"
  ]
}
```

## Updated Existing Endpoints

### Enhanced Registration Endpoint

#### POST /api/register
**Enhanced with new validation and terms enforcement**

**Request**:
```http
POST /api/register
Content-Type: application/json
X-Correlation-ID: corr_registration_123

{
  "email": "jane.doe@example.com",
  "username": "jane_doe_2025",
  "password": "MySecurePassword123!",
  "date_of_birth": "1995-03-15",
  "declared_age": 28,
  "terms_accepted": true,
  "policy_version": "v2025-10-08-1",
  "privacy_accepted": true,
  "pronouns": "she/her",
  "country_code": "US"
}
```

**Response** (Success):
```json
{
  "success": true,
  "user_id": "usr_abc123",
  "email": "jane.doe@example.com",
  "username": "jane_doe_2025",
  "canonical_username": "jane_doe_2025",
  "verification_required": true,
  "verification_method": "email",
  "terms_accepted_version": "v2025-10-08-1",
  "identity_verification_required": true,
  "created_at": "2025-10-08T10:30:00Z",
  "audit_event_id": "evt_registration_456"
}
```

## Enhanced Error Semantics

### Standardized Error Response Format

All API endpoints now return standardized error responses with enhanced context:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Request validation failed",
    "details": "Username does not meet Instagram-style requirements",
    "correlation_id": "corr_abc123",
    "timestamp": "2025-10-08T10:30:00Z",
    "field_errors": [
      {
        "field": "username",
        "code": "INVALID_FORMAT",
        "message": "Username must start with a letter or number"
      }
    ],
    "retry_info": {
      "retryable": false,
      "retry_after_seconds": null
    }
  }
}
```

### New Error Codes

#### Terms & Policy Errors
- `TERMS_ACCEPTANCE_REQUIRED` - User must accept current terms
- `POLICY_VERSION_MISMATCH` - Submitted policy version is not current
- `TERMS_ENFORCEMENT_ENABLED` - Terms enforcement is active

#### Identity Verification Errors
- `IDENTITY_VERIFICATION_REQUIRED` - Identity verification needed
- `AGE_VERIFICATION_FAILED` - User does not meet minimum age requirement
- `IDENTITY_DOCUMENTS_INVALID` - Submitted documents are invalid

#### Username Validation Errors
- `USERNAME_INSTAGRAM_RULES_VIOLATION` - Username violates Instagram-style rules
- `USERNAME_RESERVED` - Username is reserved
- `USERNAME_ON_DENYLIST` - Username is on content policy denylist
- `USERNAME_CHANGE_TOO_SOON` - Username was changed too recently
- `USERNAME_CONFLICT_DETECTED` - Username conflicts with existing canonical form

#### Password Security Errors
- `PASSWORD_BREACHED` - Password found in breach database
- `PASSWORD_TOO_COMMON` - Password is commonly used
- `PASSWORD_SCREENING_FAILED` - Password failed security screening

#### Rate Limiting Errors
- `RATE_LIMIT_EXCEEDED_IP` - IP-based rate limit exceeded
- `RATE_LIMIT_EXCEEDED_USER` - User-based rate limit exceeded
- `RATE_LIMIT_EXCEEDED_DEVICE` - Device-based rate limit exceeded

### Rate Limiting Headers

All endpoints now include comprehensive rate limiting information:

```http
HTTP/1.1 200 OK
X-RateLimit-Limit-IP: 100
X-RateLimit-Remaining-IP: 95
X-RateLimit-Reset-IP: 2025-10-08T11:00:00Z
X-RateLimit-Limit-User: 50
X-RateLimit-Remaining-User: 48
X-RateLimit-Reset-User: 2025-10-08T11:00:00Z
X-RateLimit-Limit-Device: 30
X-RateLimit-Remaining-Device: 28
X-RateLimit-Reset-Device: 2025-10-08T11:00:00Z
X-Correlation-ID: corr_abc123
```

## Updated Request/Response Fields

### User Object Enhancements

```json
{
  "id": "usr_abc123",
  "email": "jane.doe@example.com",
  "username": "jane_doe_2025",
  "canonical_username": "jane_doe_2025",
  "display_name": "Jane Doe",
  "pronouns": "she/her",
  "profile_image_url": "https://cdn.example.com/images/user123/avatar.jpg",
  "created_at": "2025-10-08T10:30:00Z",
  "updated_at": "2025-10-08T10:30:00Z",
  "last_login_at": "2025-10-08T10:30:00Z",
  "is_verified": true,
  "verification_level": "government_id",
  "terms_accepted_version": "v2025-10-08-1",
  "terms_accepted_at": "2025-10-08T10:30:00Z",
  "identity_verification_status": "verified",
  "identity_verified_at": "2025-10-08T12:00:00Z",
  "last_username_change": "2025-10-08T10:30:00Z",
  "username_change_count": 1,
  "profile_image_updated_at": "2025-10-08T10:30:00Z"
}
```

### Registration Request Enhancements

```json
{
  "email": "jane.doe@example.com",
  "username": "jane_doe_2025",
  "password": "MySecurePassword123!",
  "date_of_birth": "1995-03-15",
  "declared_age": 28,
  "country_code": "US",
  "terms_accepted": true,
  "policy_version": "v2025-10-08-1",
  "privacy_accepted": true,
  "pronouns": "she/her",
  "referral_code": "REF123",
  "marketing_consent": false,
  "device_info": {
    "user_agent": "Mozilla/5.0...",
    "platform": "web",
    "app_version": "1.0.0"
  }
}
```

## Privacy & Retention Documentation

### Data Classification

#### Personal Identifiable Information (PII)
- **High Sensitivity**: `password`, `date_of_birth`, `verification_documents`
- **Medium Sensitivity**: `email`, `full_name`, `ip_address`
- **Low Sensitivity**: `username`, `pronouns`, `profile_image_url`

#### Retention Policies

```json
{
  "data_retention": {
    "user_account_data": {
      "retention_period": "7 years",
      "basis": "regulatory_compliance",
      "auto_deletion": true
    },
    "audit_events": {
      "retention_period": "10 years",
      "basis": "legal_requirement",
      "auto_deletion": false
    },
    "username_history": {
      "retention_period": "indefinite",
      "basis": "platform_integrity",
      "auto_deletion": false
    },
    "profile_images": {
      "retention_period": "2 years after account deletion",
      "basis": "content_policy",
      "auto_deletion": true
    },
    "identity_verification_data": {
      "retention_period": "5 years",
      "basis": "regulatory_compliance",
      "auto_deletion": true
    }
  }
}
```

#### Data Processing Purposes

```json
{
  "processing_purposes": {
    "username": ["platform_functionality", "user_identification"],
    "email": ["account_management", "security_communications"],
    "pronouns": ["personalization", "inclusive_experience"],
    "profile_image_url": ["user_expression", "platform_personalization"],
    "identity_verification_data": ["compliance", "fraud_prevention"],
    "password_hash": ["authentication", "security"],
    "audit_events": ["compliance", "security_monitoring"]
  }
}
```

### Privacy Controls

#### User Data Access API

```http
GET /api/privacy/data-export
Authorization: Bearer <jwt_token>

Response:
{
  "export_id": "exp_abc123",
  "status": "processing",
  "estimated_completion": "2025-10-08T15:00:00Z",
  "download_url": null,
  "expiry_date": "2025-10-15T15:00:00Z"
}
```

#### Data Deletion API

```http
DELETE /api/privacy/account-deletion
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "confirmation": "DELETE_ACCOUNT",
  "deletion_reason": "no_longer_needed",
  "password": "current_password"
}

Response:
{
  "deletion_id": "del_abc123",
  "scheduled_date": "2025-10-15T00:00:00Z",
  "cancellation_deadline": "2025-10-14T23:59:59Z",
  "data_retention_summary": {
    "immediate_deletion": ["profile_data", "preferences"],
    "delayed_deletion": ["audit_events", "legal_records"],
    "permanent_retention": ["username_reservations"]
  }
}
```

## Correlation ID Propagation

All API endpoints now support and propagate correlation IDs for end-to-end tracing:

### Request Headers
```http
X-Correlation-ID: corr_user_action_abc123
X-Request-ID: req_internal_def456
X-Session-ID: sess_browser_ghi789
```

### Response Headers
```http
X-Correlation-ID: corr_user_action_abc123
X-Request-ID: req_internal_def456
X-Trace-ID: trace_opentelemetry_jkl012
```

### Audit Event Correlation
```json
{
  "audit_event": {
    "event_id": "evt_abc123",
    "correlation_id": "corr_user_action_abc123",
    "request_id": "req_internal_def456",
    "session_id": "sess_browser_ghi789",
    "trace_id": "trace_opentelemetry_jkl012",
    "event_type": "username.set",
    "timestamp": "2025-10-08T10:30:00Z"
  }
}
```

This comprehensive API specification update ensures all new features are properly documented with clear privacy implications, retention policies, and enhanced error handling for production deployment.