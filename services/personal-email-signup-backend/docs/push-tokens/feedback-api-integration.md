# FCM/APNs Feedback API Integration

## Overview
Integration with FCM Management API and APNs feedback mechanisms to detect and invalidate stale push tokens proactively.

## FCM Feedback Integration

### API Endpoint
```
POST https://fcm.googleapis.com/v1/projects/{project_id}/installations:batchGetStates
```

### Authentication
- **Method**: OAuth 2.0 with service account
- **Scope**: `https://www.googleapis.com/auth/firebase.messaging`
- **Credential**: Service account JSON key file

#### Setup Service Account
```typescript
import { google } from 'googleapis';
import { readFileSync } from 'fs';

const serviceAccount = JSON.parse(
  readFileSync('/secrets/fcm-service-account.json', 'utf8')
);

const jwtClient = new google.auth.JWT(
  serviceAccount.client_email,
  undefined,
  serviceAccount.private_key,
  ['https://www.googleapis.com/auth/firebase.messaging']
);

await jwtClient.authorize();
const accessToken = jwtClient.credentials.access_token;
```

### Request Format
```typescript
interface BatchCheckRequest {
  registration_tokens: string[]; // Max 1000 tokens per request
}

// Example
const request: BatchCheckRequest = {
  registration_tokens: [
    'cXJq9_8sRK2wGhJ3vN5mLP:APA91bF...',
    'dYsR0_9tSL3xHiK4wO6nMQ:APA91bG...',
    // ... up to 1000 tokens
  ]
};
```

### Response Format
```typescript
interface BatchCheckResponse {
  results: Array<{
    registration_token: string;
    status: 'VALID' | 'INVALID' | 'UNREGISTERED' | 'INTERNAL_ERROR';
    error_code?: string;
  }>;
}
```

### Error Handling
- **429 Too Many Requests**: Exponential backoff (1s → 2s → 4s → 8s → 16s max)
- **401 Unauthorized**: Refresh access token and retry
- **500 Internal Server Error**: Log and retry after 30 seconds
- **Network Error**: Retry up to 3 times with 5-second delay

### Rate Limits
- **Quota**: 60,000 requests per minute per project
- **Batch Size**: Maximum 1000 tokens per request
- **Recommended**: 500 tokens per request to stay below limits

### Implementation Example
```typescript
import axios from 'axios';

async function checkFcmTokens(tokens: string[]): Promise<string[]> {
  const invalidTokens: string[] = [];
  const batchSize = 500;

  for (let i = 0; i < tokens.length; i += batchSize) {
    const batch = tokens.slice(i, i + batchSize);
    
    try {
      const response = await axios.post<BatchCheckResponse>(
        `https://fcm.googleapis.com/v1/projects/${projectId}/installations:batchGetStates`,
        { registration_tokens: batch },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      for (const result of response.data.results) {
        if (result.status === 'INVALID' || result.status === 'UNREGISTERED') {
          invalidTokens.push(result.registration_token);
        }
      }

      // Respect rate limits
      await sleep(200); // 200ms between batches
    } catch (error) {
      logger.error('FCM batch check failed', { error, batchStart: i });
      // Continue with next batch
    }
  }

  return invalidTokens;
}
```

### Schedule
- **Frequency**: Daily at 4:00 AM UTC (after cleanup job)
- **Cron**: `0 4 * * *`
- **Execution Time**: ~5 minutes for 100,000 tokens (200 batches × 1.5s per batch)

## APNs Feedback Integration

### Important Note
APNs no longer provides a dedicated feedback service (deprecated in 2020). Token invalidation detected via push delivery response codes.

### HTTP/2 Push Response Codes
```typescript
interface ApnsResponse {
  statusCode: number;
  reason?: string;
  apnsId: string;
  timestamp?: number;
}

// Status codes requiring token invalidation
const INVALID_TOKEN_CODES = {
  400: 'BadDeviceToken',       // Malformed token
  403: 'Forbidden',             // Certificate issue (investigate)
  410: 'Unregistered',          // Token no longer valid (INVALIDATE)
  413: 'PayloadTooLarge',       // Not token issue
};
```

### Detection Strategy
Monitor push send responses in NotificationsService:

```typescript
async function sendApnsPush(token: string, payload: any): Promise<void> {
  try {
    const response = await apnsClient.send(payload, token);
    
    // Update last_validated_at on success
    await prisma.pushToken.update({
      where: { token },
      data: { lastValidatedAt: new Date() },
    });
  } catch (error) {
    if (error.statusCode === 410) {
      // Token unregistered - mark inactive immediately
      await prisma.pushToken.update({
        where: { token },
        data: { active: false },
      });
      logger.warn('APNs token unregistered', { token: token.substring(0, 8) });
    } else if (error.statusCode === 400 && error.reason === 'BadDeviceToken') {
      // Malformed token - mark inactive
      await prisma.pushToken.update({
        where: { token },
        data: { active: false },
      });
      logger.error('APNs bad device token', { token: token.substring(0, 8) });
    } else {
      // Other errors - increment failure count
      await trackDeliveryFailure(token);
    }
  }
}
```

### No Scheduled Job Required
APNs feedback is real-time during push delivery. No separate scheduled check needed.

## Failure Tracking

### Failure Threshold Strategy
Track consecutive delivery failures to detect stale tokens not caught by feedback APIs.

```typescript
interface TokenFailureTracking {
  tokenId: string;
  consecutiveFailures: number;
  lastFailureAt: Date;
  firstFailureAt: Date;
}

async function trackDeliveryFailure(token: string): Promise<void> {
  const tracking = await getFailureTracking(token);
  
  tracking.consecutiveFailures++;
  tracking.lastFailureAt = new Date();
  
  if (tracking.consecutiveFailures === 1) {
    tracking.firstFailureAt = new Date();
  }
  
  // Check if within 7-day window
  const daysSinceFirst = 
    (Date.now() - tracking.firstFailureAt.getTime()) / (1000 * 60 * 60 * 24);
  
  if (tracking.consecutiveFailures >= 3 && daysSinceFirst <= 7) {
    // Invalidate token after 3 failures within 7 days
    await prisma.pushToken.update({
      where: { token },
      data: { active: false },
    });
    logger.warn('Token invalidated due to repeated failures', {
      token: token.substring(0, 8),
      failures: tracking.consecutiveFailures,
    });
  }
  
  await saveFailureTracking(tracking);
}

async function trackDeliverySuccess(token: string): Promise<void> {
  // Reset failure counter on successful delivery
  await prisma.pushToken.update({
    where: { token },
    data: { 
      lastValidatedAt: new Date(),
      // Reset failure tracking if stored in token record
    },
  });
  await clearFailureTracking(token);
}
```

### Exponential Backoff for Retries
```typescript
const RETRY_DELAYS = [
  1 * 60 * 60 * 1000,  // 1 hour after first failure
  6 * 60 * 60 * 1000,  // 6 hours after second failure
  // After 3rd failure: mark inactive (no retry)
];

function getNextRetryTime(failureCount: number): Date | null {
  if (failureCount >= 3) return null; // No more retries
  
  const delay = RETRY_DELAYS[failureCount - 1];
  return new Date(Date.now() + delay);
}
```

## Scheduled Job Implementation

### FCM Feedback Check Service
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class FcmFeedbackService {
  private readonly logger = new Logger(FcmFeedbackService.name);
  private readonly BATCH_SIZE = 500;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly fcmClient: FcmClient,
  ) {}

  /**
   * Check FCM tokens daily at 4 AM UTC (after cleanup job)
   */
  @Cron('0 4 * * *', { timeZone: 'UTC' })
  async scheduledFcmCheck(): Promise<void> {
    this.logger.log('Starting FCM token validation check');
    
    try {
      // Get all active Android tokens
      const androidTokens = await this.prisma.pushToken.findMany({
        where: {
          platform: 'android',
          active: true,
        },
        select: {
          id: true,
          token: true,
        },
      });

      this.logger.log(`Checking ${androidTokens.length} FCM tokens`);

      const tokenList = androidTokens.map(t => t.token);
      const invalidTokens = await this.checkFcmTokens(tokenList);

      if (invalidTokens.length > 0) {
        // Mark invalid tokens as inactive
        await this.prisma.pushToken.updateMany({
          where: {
            token: { in: invalidTokens },
          },
          data: {
            active: false,
            updatedAt: new Date(),
          },
        });

        this.logger.warn(
          `Marked ${invalidTokens.length} FCM tokens as inactive via feedback API`
        );
      } else {
        this.logger.log('No invalid FCM tokens found');
      }
    } catch (error) {
      this.logger.error(
        'FCM feedback check failed',
        error instanceof Error ? error.stack : undefined
      );
    }
  }

  private async checkFcmTokens(tokens: string[]): Promise<string[]> {
    // Implementation from example above
    // ...
  }
}
```

## Monitoring and Metrics

### Metrics to Track
```typescript
// Prometheus metrics
fcm_feedback_tokens_checked_total: Counter
fcm_feedback_invalid_tokens_total: Counter
fcm_feedback_api_errors_total: Counter
fcm_feedback_check_duration_seconds: Histogram

apns_delivery_failures_total: Counter<{ reason: string }>
apns_invalid_tokens_total: Counter
```

### Dashboard Panels
1. **FCM Feedback Results**: Bar chart of invalid tokens found per day
2. **APNs Status Codes**: Pie chart of 410/400/403 responses
3. **Token Invalidation Rate**: Line graph of tokens marked inactive daily
4. **API Error Rate**: FCM API call success vs failure

## Security Considerations

### Service Account Key Storage
- **Location**: Kubernetes secret or cloud secret manager
- **Rotation**: Every 90 days
- **Access**: Read-only by auth-service pods only
- **Audit**: Log all authentication attempts

### Token Logging
- **Never log**: Full FCM/APNs tokens
- **Safe to log**: First 8 characters + "..." (e.g., `cXJq9_8s...`)
- **Correlation**: Use push_tokens.id (UUID) for tracing

### Rate Limit Protection
- **Circuit Breaker**: Stop FCM checks after 5 consecutive API failures
- **Backoff**: Increase delay between batches if 429 received
- **Fallback**: Skip feedback check if API unreachable; rely on delivery failures

## Testing

### Staging Environment Tests
```bash
# Test FCM feedback with known invalid token
curl -X POST \
  https://staging-api.example.com/admin/push-tokens/fcm-feedback-check \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Verify invalid tokens marked inactive
psql -h staging-db -U auth_service -c \
  "SELECT COUNT(*) FROM push_tokens WHERE active=false AND updated_at > NOW() - INTERVAL '10 minutes';"
```

### Mock Invalid Token Response
```typescript
// In test suite
jest.mock('./fcm-client', () => ({
  batchCheckTokens: jest.fn().mockResolvedValue({
    results: [
      { registration_token: 'token1', status: 'VALID' },
      { registration_token: 'token2', status: 'INVALID' },
      { registration_token: 'token3', status: 'UNREGISTERED' },
    ],
  }),
}));
```

---

**References**:
- FCM Management API: https://firebase.google.com/docs/cloud-messaging/manage-tokens
- APNs Provider API: https://developer.apple.com/documentation/usernotifications/setting_up_a_remote_notification_server
- OAuth 2.0 Service Accounts: https://developers.google.com/identity/protocols/oauth2/service-account
