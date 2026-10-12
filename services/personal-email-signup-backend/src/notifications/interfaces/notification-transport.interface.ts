import { NotificationPayload } from "../dto/notification.dto";
import {
  PushPlatform,
  PushTokenType,
} from "../../push-tokens/dto/push-token.dto";

export interface NotificationTransportContext {
  tokenId: string;
  userId: string;
  platform: PushPlatform;
  tokenType: PushTokenType;
  correlationId: string;
  notificationType?: string;
}

export interface NotificationTransportResponse {
  success: boolean;
  errorCode?: string;
  retryable?: boolean;
}

export interface NotificationTransport {
  send(
    deviceToken: string,
    payload: NotificationPayload,
    context: NotificationTransportContext,
  ): Promise<NotificationTransportResponse>;
}
