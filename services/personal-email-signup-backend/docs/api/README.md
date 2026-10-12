# API Documentation

## Overview

Personal Email Signup Backend provides OTP-based authentication and user management APIs.

**Base URL**: `https://api.company.com/v1`  
**Authentication**: Bearer token (JWT)  
**Content-Type**: `application/json`

## Quick Start

### 1. Request OTP

```bash
curl -X POST https://api.company.com/v1/auth/request-otp \
  -H "Content-Type: application/json" \
  -H "X-Correlation-ID: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{
    "email": "user@example.com",
    "tenant_id": "acme-corp"
  }'
```

**Response**:
```json
{
  "success": true,
  "message": "OTP sent to email",
  "expires_in": 600
}
```

### 2. Verify OTP

```bash
curl -X POST https://api.company.com/v1/auth/verify-otp \
  -H "Content-Type: application/json" \
  -H "X-Correlation-ID: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{
    "email": "user@example.com",
    "otp": "123456",
    "tenant_id": "acme-corp"
  }'
```

**Response**:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
  "expires_in": 3600,
  "user": {
    "id": "usr_abc123",
    "email": "user@example.com",
    "email_verified": true,
    "created_at": "2024-01-15T10:30:00Z"
  }
}
```

### 3. Access Protected Resource

```bash
curl -X GET https://api.company.com/v1/users/me \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..." \
  -H "X-Correlation-ID: 550e8400-e29b-41d4-a716-446655440000"
```

## Core Endpoints

### Authentication

#### POST /auth/request-otp
Request a one-time password for email verification.

**Request**:
```json
{
  "email": "user@example.com",
  "tenant_id": "acme-corp"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "OTP sent to email",
  "expires_in": 600
}
```

**Rate Limit**: 3 requests per email per 15 minutes

**Errors**:
- `400`: Invalid email format
- `429`: Rate limit exceeded
- `500`: Email service error

---

#### POST /auth/verify-otp
Verify OTP and obtain access token.

**Request**:
```json
{
  "email": "user@example.com",
  "otp": "123456",
  "tenant_id": "acme-corp"
}
```

**Response** (200 OK):
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
  "expires_in": 3600,
  "user": { ... }
}
```

**Errors**:
- `400`: Invalid OTP
- `401`: OTP expired
- `404`: OTP not found
- `429`: Too many verification attempts

---

#### POST /auth/refresh
Refresh access token using refresh token.

**Request**:
```json
{
  "refresh_token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Response** (200 OK):
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "expires_in": 3600
}
```

---

#### POST /auth/logout
Invalidate current session.

**Headers**: `Authorization: Bearer <token>`

**Response** (204 No Content)

---

### User Management

#### GET /users/me
Get current authenticated user profile.

**Headers**: `Authorization: Bearer <token>`

**Response** (200 OK):
```json
{
  "id": "usr_abc123",
  "email": "user@example.com",
  "email_verified": true,
  "tenant_id": "acme-corp",
  "created_at": "2024-01-15T10:30:00Z",
  "updated_at": "2024-01-15T10:30:00Z",
  "metadata": {
    "last_login": "2024-01-15T12:00:00Z"
  }
}
```

---

#### PATCH /users/me
Update current user profile.

**Headers**: `Authorization: Bearer <token>`

**Request**:
```json
{
  "metadata": {
    "display_name": "John Doe",
    "timezone": "America/New_York"
  }
}
```

**Response** (200 OK): Updated user object

---

#### DELETE /users/me
Delete current user account (soft delete).

**Headers**: `Authorization: Bearer <token>`

**Response** (204 No Content)

---

### Health & Monitoring

#### GET /health
Service health check (no auth required).

**Response** (200 OK):
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T12:00:00Z",
  "version": "1.2.3",
  "checks": {
    "database": "healthy",
    "redis": "healthy",
    "email_service": "healthy"
  }
}
```

---

#### GET /metrics
Prometheus metrics endpoint (no auth required).

**Response**: Prometheus text format
```
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="POST",route="/auth/request-otp",status="200"} 1543
...
```

---

## Request Headers

### Required Headers

| Header | Description | Example |
|--------|-------------|---------|
| `Content-Type` | Request content type | `application/json` |
| `X-Correlation-ID` | Request tracking ID (UUID v4) | `550e8400-e29b-41d4-a716-446655440000` |

### Optional Headers

| Header | Description | Example |
|--------|-------------|---------|
| `X-Tenant-ID` | Multi-tenancy identifier | `acme-corp` |
| `X-Request-ID` | Client-generated request ID | `req_abc123` |
| `Accept-Language` | Preferred language | `en-US` |

### Authentication Headers

| Header | Description | Example |
|--------|-------------|---------|
| `Authorization` | Bearer token | `Bearer eyJhbGciOiJIUzI1NiIs...` |

## Response Format

### Success Response

```json
{
  "data": { ... },
  "metadata": {
    "correlation_id": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": "2024-01-15T12:00:00Z"
  }
}
```

### Error Response

```json
{
  "error": {
    "code": "INVALID_OTP",
    "message": "The provided OTP is invalid or expired",
    "details": {
      "field": "otp",
      "reason": "expired"
    }
  },
  "metadata": {
    "correlation_id": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": "2024-01-15T12:00:00Z"
  }
}
```

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `INVALID_EMAIL` | 400 | Email format is invalid |
| `INVALID_OTP` | 400 | OTP is invalid or malformed |
| `OTP_EXPIRED` | 401 | OTP has expired |
| `OTP_NOT_FOUND` | 404 | No OTP found for email |
| `UNAUTHORIZED` | 401 | Invalid or missing token |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `EMAIL_SERVICE_ERROR` | 500 | Email delivery failed |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

## Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/auth/request-otp` | 3 requests per email | 15 minutes |
| `/auth/verify-otp` | 5 attempts per OTP | 10 minutes |
| `/auth/refresh` | 10 requests | 1 minute |
| All other endpoints | 100 requests | 1 minute |

**Rate Limit Headers**:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1705324800
```

## Authentication

### JWT Token Structure

**Header**:
```json
{
  "alg": "HS256",
  "typ": "JWT"
}
```

**Payload**:
```json
{
  "sub": "usr_abc123",
  "email": "user@example.com",
  "tenant_id": "acme-corp",
  "iat": 1705320000,
  "exp": 1705323600
}
```

**Token Lifetime**:
- Access Token: 1 hour
- Refresh Token: 30 days

### Token Refresh Flow

1. Access token expires (401 response)
2. Client calls `/auth/refresh` with refresh token
3. Server returns new access token
4. Client retries original request with new token

## Pagination

For list endpoints (future):

**Request**:
```
GET /users?page=2&limit=20
```

**Response**:
```json
{
  "data": [...],
  "pagination": {
    "page": 2,
    "limit": 20,
    "total": 150,
    "total_pages": 8
  }
}
```

## Webhooks (Future)

Events that can trigger webhooks:

- `user.created`: New user signed up
- `user.verified`: Email verified
- `user.deleted`: Account deleted
- `auth.failed`: Authentication failed (security monitoring)

## SDKs

### JavaScript/TypeScript

```bash
npm install @company/auth-sdk
```

```typescript
import { AuthClient } from '@company/auth-sdk';

const client = new AuthClient({
  baseURL: 'https://api.company.com/v1',
  tenantId: 'acme-corp'
});

// Request OTP
await client.requestOTP({ email: 'user@example.com' });

// Verify OTP
const { accessToken, user } = await client.verifyOTP({
  email: 'user@example.com',
  otp: '123456'
});

// Get current user
const currentUser = await client.getCurrentUser(accessToken);
```

## Testing

### Swagger/OpenAPI

Interactive API documentation available at:
- **Development**: http://localhost:3000/api/docs
- **Staging**: https://api-staging.company.com/v1/docs
- **Production**: https://api.company.com/v1/docs

### Postman Collection

Download: [Signup API Postman Collection](./postman_collection.json)

### Test Accounts (Staging Only)

Use these test emails (OTP will always be `123456`):
- `test@example.com`
- `demo@example.com`

## Changelog

### v1.2.0 (2024-01-15)
- Added refresh token endpoint
- Improved error messages
- Added correlation ID support

### v1.1.0 (2024-01-01)
- Initial OTP authentication
- User profile endpoints
- Health check endpoint

## Support

- **Documentation**: https://docs.company.com
- **API Status**: https://status.company.com
- **Support Email**: api-support@company.com
- **Slack**: #api-help

## Related Documentation

- [Authentication Architecture](../adr/002-otp-authentication.md)
- [Migration Guide](../migration/guide.md)
- [Production Runbook](../production-readiness/runbook.md)
