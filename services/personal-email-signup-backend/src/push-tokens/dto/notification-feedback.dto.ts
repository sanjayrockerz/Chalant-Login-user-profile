import { PushPlatform } from "./push-token.dto";

export type DeliveryStatus =
  | "sent"
  | "queued"
  | "delivered"
  | "failed"
  | "expired"
  | "unregistered"
  | "invalid"
  | "throttled";

export interface NotificationDeliveryFeedbackDto {
  tokenId: string;
  platform?: PushPlatform;
  tenantId?: string;
  notificationId?: string;
  status: DeliveryStatus;
  errorCode?: string;
  provider?: string;
  providerResponseCode?: number;
  attemptNumber?: number;
  correlationId?: string;
  latencyMs?: number;
  notificationType?: string;
  metadata?: Record<string, unknown>;
}
