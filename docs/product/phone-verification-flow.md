# Phone Number Verification Flow Design

## Product Narrative
After users complete email verification, they enter an identity capture step where we collect display name, declared age, username, and *optionally* a phone number. The phone unlocks friend discovery by matching hashed contacts; we communicate this purpose explicitly so the user understands why we ask for it.

### UX Principles
- **Transparency**: Plain-language copy explaining that phone numbers are used to help the user find friends already on the platform.
- **Control**: Prominent "Skip for now" button when phone capture is optional. If product decides it is required, show a tooltip with business rationale and link to privacy policy.
- **Trust**: Inline note about verification ("We’ll text you a 4‑digit code to verify this number").
- **Global readiness**: Country code selector defaulting to locale; input accepts local formatting but normalizes before submission.

## Wireframes (Textual)

### Screen 1 – Phone Collection (Optional)
```
+------------------------------------------------------+
| Find friends faster                                  |
| [icon: friends]                                      |
| We'll use your phone number to help you find         |
| friends who are already on the platform.             |
|                                                      |
| Country/Region: [ ▼ United States (+1) ]             |
| Phone number:   [ (___) ___-____          ]          |
|                                                      |
| [ ] Text me app tips and updates (optional)          |
|                                                      |
| [Continue →]                               [Skip]    |
|                                                      |
| Privacy: We never share your number. Learn more.     |
+------------------------------------------------------+
```
**Inline errors:**
- Invalid format → red highlight + helper text under field.
- Already registered → error banner at top plus inline helper text.

### Screen 2 – Enter Verification Code
```
+------------------------------------------------------+
| Verify your phone                                    |
| We sent a 4-digit code to +1 415 •• •• 1234.         |
| Didn't get it? [Resend code in 28s]                  |
|                                                      |
| [ ☐ ][ ☐ ][ ☐ ][ ☐ ] (single OTP input component)    |
|                                                      |
| Having trouble? [Change number]                      |
|                                                      |
| [Confirm]                                            |
|                                                      |
| Error states shown inline below the OTP component.   |
+------------------------------------------------------+
```
Error messaging mapped in catalog (see below). Countdown reflects cooldown logic; button re-enabled once allowed by rate limiter.

## API Contracts
All endpoints live under the authenticated user context. Apply existing middleware for session validation, correlation IDs, and multi-dimensional rate limiting (IP + user + device).

### POST `/users/me/phone`
Triggers OTP send via SMS.

**Request DTO**
```json
{
  "phone": "+14155552671",
  "country": "US",         // optional, for analytics
  "channel": "sms"         // reserved for future (sms, whatsapp)
}
```

**Validation Rules**
- Normalize with `libphonenumber-js` server-side to E.164.
- Reject if normalization fails (`400 INVALID_PHONE_FORMAT`).
- Enforce uniqueness (`409 PHONE_ALREADY_REGISTERED`).
- Respect rate limits: 5 attempts/hour per user, 3/minute per IP, cooldown escalates: 30s → 60s → 120s → 300s.
- Persist OTP in Redis using existing schema (`otp:{user_id}:phone`).

**Responses**
- `202 Accepted` on success (no body, or `{ "expires_in": 300, "cooldown": 30 }`).
- Error payload pattern:
```json
{
  "error": "PHONE_ALREADY_REGISTERED",
  "message": "This phone number is already in use. Please use a different number or log in.",
  "retry_after": 300
}
```
`retry_after` included for rate-limit responses.

### POST `/users/me/phone/verify`
Validates OTP and finalizes phone linkage.

**Request DTO**
```json
{
  "phone": "+14155552671", // optional if stored in state, but pass for server-side validation
  "code": "1234"
}
```

**Server Flow**
1. Normalize/validate phone matches pending request (prevent mismatch/fraud).
2. Read OTP payload from Redis (`otp:{user_id}:phone`). Validate code + TTL.
3. On success:
   - Set `users.phone = phone`.
   - Set `users.phone_verified_at = NOW()`.
   - Compute `hashed_phone = SHA256(phone)` (hex) and persist.
   - Clear Redis OTP entry.
   - Emit audit event `phone.verified` with `correlation_id`, `user_id`, `tenant_id`.
4. On failure return error (see catalog).

**Success Response**
```json
{
  "status": "verified",
  "phone": "+14155552671",
  "verified_at": "2025-10-17T18:30:12.345Z"
}
```

## SMS Delivery Integration

### Provider abstraction
Implement `SmsOtpSender` interface reusing OTP generator:
```typescript
interface SmsOtpSender {
  sendVerificationCode(params: {
    userId: string;
    phoneE164: string;
    code: string;
    correlationId: string;
  }): Promise<DeliveryResult>;
}
```

### Providers
1. **Primary**: Twilio Programmable SMS
   - Config: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`.
   - Use Messaging Service SID if we need smart routing.
   - Webhook for delivery receipts updates `phone_otp_delivery_status_total{status="delivered"}`.
2. **Failover**: AWS SNS or MessageBird
   - Circuit-breaker pattern: on 5 consecutive failures, switch to backup for 10 minutes.
   - Observability signals to revert when primary recovers.

### Delivery Tracking
- Publish traces (`sms.send`) with tags: `provider`, `country`, `status`.
- Persist best-effort delivery receipt statuses (delivered, failed, unknown) in in-memory metrics rather than DB.
- Store provider response IDs for debugging (redacted in user-visible logs).

### Operational Runbook
- Rotate API credentials quarterly.
- Implement health check job hitting provider status endpoint; integrate with PagerDuty if failures > threshold.
- Respect compliance: include opt-out instructions in markets requiring it.

## Error Message Catalog
| Scenario | API Error Code | User Message | Dev Notes |
|----------|----------------|--------------|-----------|
| Phone already registered | `PHONE_ALREADY_REGISTERED` | "This phone number is already in use. Please use a different number or log in." | Return HTTP 409. Include `existing_user_hint = true` when email exists. |
| Invalid format | `INVALID_PHONE_FORMAT` | "Please enter a valid phone number with country code." | HTTP 400. Provide `examples` in debug logs for QA. |
| OTP send failure | `OTP_DELIVERY_FAILED` | "Unable to send verification code. Please check your number and try again." | HTTP 502 if provider down; mark attempt for retriable queue. |
| Verification timeout | `OTP_EXPIRED` | "Verification code expired. Request a new code." | HTTP 410. Trigger re-issue flow. |
| Incorrect code | `OTP_INVALID` | "That code didn’t match. Try again." | HTTP 400. Increment error counter. |
| Rate limit hit | `RATE_LIMITED` | "Too many attempts. Please wait 120 seconds before trying again." | HTTP 429. Populate `retry_after`. |
| Internal error | `GENERIC_ERROR` | "Something went wrong. Please try again." | HTTP 500. Alert on >0.5% error rate. |

## Observability & Security

### Metrics
- `phone_otp_sent_total{provider,status}` – counts send attempts and outcomes.
- `phone_otp_verify_total{result}` – success, invalid_code, expired.
- `phone_verification_latency_ms` histogram – breakdown for send and verify paths.
- `rate_limit_throttle_total{endpoint}` – track when users hit limits.

### Tracing
- Span `phone.verify.send` (attributes: `correlation_id`, `provider`, `country`, `cooldown`, `user_id` hashed or redacted).
- Span `phone.verify.check` (attributes: `result`, `latency`, `retry_count`).

### Logging
- INFO: `phone.verify.send.success`, include `user_id`, `correlation_id`, `provider`. Redact phone except last 2 digits.
- WARN: `phone.verify.send.failure`, record provider error code, correlation.
- Audit event payload example:
```json
{
  "event": "phone.verified",
  "user_id": "uuid",
  "tenant_id": "tenant",
  "correlation_id": "corr-id",
  "metadata": {
    "phone_hash": "sha256..."
  },
  "occurred_at": "2025-10-17T18:30:12.345Z"
}
```

### Security Controls
- Never log raw OTP or full phone numbers.
- Redis keys expire in 5 minutes; TTL refreshed only on re-issue.
- Reuse HMAC signing of OTP payload before storing in Redis (consistency with email OTP service).
- Apply CAPTCHA on repeated failures (optional future hardening).

## Implementation Checklist
1. **Backend**
   - Extend OTP service to accept `channel: sms` and route via new provider abstraction.
   - Add endpoints described above in signup/login NestJS service.
   - Update Prisma service to persist phone metadata (re-use schema from migration).
   - Emit audit events and metrics.
2. **Frontend / Mobile**
   - Build phone collection & OTP screens; integrate countdown timer and error surface.
   - Use `libphonenumber-js` for client-side formatting; fallback to server validation.
   - Persist state across navigation (e.g. after app backgrounding).
3. **DevOps**
   - Configure provider credentials in secret manager.
   - Set up monitoring dashboards for metrics/traces.
   - Update data retention docs for phone numbers and hashed contacts.
4. **QA**
   - Test flows across locales (US, UK, India) and error scenarios.
   - Validate cooldown/rate limit messaging.
   - Ensure accessibility: screen reader labels, focus states.

This design reuses existing OTP architecture, introduces minimal new infrastructure, and provides the UX, API, and operational detail required to launch phone verification alongside contact discovery.  
