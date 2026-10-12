# Contact Sync API

## POST /contacts/upload

**Authentication:** JWT bearer token (handled by `JwtAuthGuard`). Requests are additionally throttled by `MultiDimThrottleGuard`.

**Rate limiting:**

- User dimension – 5 uploads per rolling 24 hours
- IP dimension – 100 contacts processed per 5 minutes
- Device dimension – 20 uploads per 24 hours (header `x-device-id`)
- Payload limit – 500 phone numbers per request body

**Request body (`UploadContactsDto`):**

```json
{
  "phones": ["+14155551234", "0044 20 7946 0958"],
  "client_batch_id": "ios-device-42"
}
```

- `phones` must contain at least one and at most 500 string values.
- A lightweight regex (`^[+0-9().\-\s]{4,32}$`) rejects obviously invalid numbers before normalization.
- `client_batch_id` is optional and can be used by clients for idempotency and audit trails.

**Response body (`UploadContactsResponseDto`):**

```json
{
  "success": true,
  "suggestions": [
    {
      "suggested_user": {
        "id": "a7f0d9d0-0f01-4e0d-a45f-9faae6be7d4e",
        "display_name": "Jordan Nguyen",
        "profile_image_url": "https://cdn.example.com/avatars/a7f0d9d0.png"
      },
      "match_type": "mutual",
      "match_strength": 0.87,
      "created_at": "2025-10-17T08:30:15.000Z",
      "is_new": true
    }
  ],
  "next_cursor": "page=2&limit=20",
  "metadata": {
    "total_uploaded": 42,
    "duplicates_skipped": 5,
    "invalid_phones": 3,
    "new_hashes_stored": 34,
    "suggestions_generated": 12
  },
  "errors": [
    { "phone": "12345", "reason": "Invalid format" }
  ],
  "correlation_id": "req-3f2a6d8f-4d20-4c8e-b83f-9c02b82a2c6d"
}
```

- `suggestions` is capped at 20 entries. When additional matches exist, `next_cursor` contains the opaque cursor for `GET /contacts/suggestions`.
- `errors` is optional and only present when the service surfaces per-phone validation feedback.
- `metadata.new_hashes_stored` reflects net new hashes written after deduplication and invalid filtering.

**Error catalog:**

| HTTP status | Example payload | Trigger | Recommended client action |
|-------------|-----------------|---------|---------------------------|
| 400 Bad Request | `{"statusCode":400,"message":["each phone number must resemble a valid international phone number"],"correlation_id":"req-123"}` | DTO validation failure (array shape, type, regex) | Correct the request body and retry immediately |
| 401 Unauthorized | Standard Nest auth response | Missing/expired JWT | Re-authenticate |
| 422 Unprocessable Entity | `{"statusCode":422,"message":"No valid contacts were processed","correlation_id":"req-456"}` | Every phone rejected during normalization/hashing | Inspect the optional `errors` array, resubmit valid numbers |
| 429 Too Many Requests | `{"statusCode":429,"message":"Rate limit exceeded","retry_after":120,"correlation_id":"req-789"}` | User/IP/device thresholds exceeded | Wait the indicated seconds before retrying |
| 500 Internal Server Error | `{"statusCode":500,"message":"An unexpected error occurred","correlation_id":"req-999"}` | Persistence failure or unexpected exception | Retry with backoff; escalate with correlation ID if persistent |

## GET /v1/contacts:suggestions
- **Query params**: `limit` (default 20, max 100), `matchType` (`mutual`, `one_sided`).
- **Response**: list ordered by `created_at DESC` with context metadata (`matchStrength`, `mutual`, `muted`).
- Index `idx_contact_suggestions_user` ensures constant-time pagination.

## DELETE /v1/contacts
- Deletes all hashed contacts for the caller.
- Triggers immediate cleanup job to respect privacy requests.

## Idempotency
- Clients provide `Idempotency-Key` header; server maps to Redis entry for 24h to dedupe uploads.

## Telemetry
- `contact_upload_duration_seconds` histogram captures processing latency.
- `contact_suggestion_delivery_total` counter tracks suggestions served, grouped by `match_type`.

## Error Codes
| Code | HTTP | Description |
| ---- | ---- | ----------- |
| `contact_upload_invalid_phone` | 400 | Normalization failed. |
| `contact_upload_too_many` | 429 | User exceeded rate limit. |
| `contact_upload_rejected` | 403 | Guardian restrictions (teen accounts). |
| `contact_suggestions_disabled` | 404 | Feature flag off for user cohort. |
