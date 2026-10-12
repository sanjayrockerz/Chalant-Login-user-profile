import { Inject, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import { PushTokenService } from "../push-tokens/services/push-token.service";
import { PushToken } from "../push-tokens/entities/push-token.entity";
import { PushPlatform, PushTokenType } from "../push-tokens/dto/push-token.dto";
import { NotificationPayload } from "./dto/notification.dto";
import { NotificationTransport } from "./interfaces/notification-transport.interface";
import { APNS_TRANSPORT, FCM_TRANSPORT } from "./notification.constants";

export interface TokenDeliveryResult {
  tokenId: string;
  platform?: PushPlatform;
  tokenType?: PushTokenType;
  status: "success" | "failed" | "skipped";
  errorCode?: string;
}

export interface UserDeliveryResult {
  userId: string;
  correlationId: string;
  attempted: number;
  succeeded: number;
  failed: number;
  results: TokenDeliveryResult[];
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly pushTokenService: PushTokenService,
    @Inject(FCM_TRANSPORT) private readonly fcmTransport: NotificationTransport,
    @Inject(APNS_TRANSPORT)
    private readonly apnsTransport: NotificationTransport,
  ) {}

  async sendToUser(
    userId: string,
    notification: NotificationPayload,
  ): Promise<UserDeliveryResult> {
    const correlationId = notification.correlationId ?? randomUUID();
    const tokens = await this.pushTokenService.findActiveTokensForUser(userId);

    if (!tokens.length) {
      this.logger.warn({
        message: "No active tokens for user",
        userId,
        correlationId,
      });

      return {
        userId,
        correlationId,
        attempted: 0,
        succeeded: 0,
        failed: 0,
        results: [],
      };
    }

    const results = await Promise.all(
      tokens.map((token) =>
        this.deliverToToken(token, notification, correlationId),
      ),
    );

    const succeeded = results.filter(
      (result) => result.status === "success",
    ).length;
    const failed = results.filter(
      (result) => result.status === "failed",
    ).length;
    const attempted = results.filter(
      (result) => result.status !== "skipped",
    ).length;

    return {
      userId,
      correlationId,
      attempted,
      succeeded,
      failed,
      results,
    };
  }

  async sendToToken(
    tokenId: string,
    notification: NotificationPayload,
  ): Promise<TokenDeliveryResult> {
    const correlationId = notification.correlationId ?? randomUUID();
    const token = await this.pushTokenService.getActiveTokenById(tokenId);

    if (!token) {
      this.logger.warn({
        message: "Token not found for notification send",
        tokenId,
        correlationId,
      });

      return {
        tokenId,
        status: "skipped",
      };
    }

    return this.deliverToToken(token, notification, correlationId);
  }

  async sendBulk(
    userIds: string[],
    notification: NotificationPayload,
  ): Promise<UserDeliveryResult[]> {
    const results = await Promise.all(
      userIds.map((userId) => this.sendToUser(userId, notification)),
    );

    return results;
  }

  private async deliverToToken(
    token: PushToken,
    notification: NotificationPayload,
    correlationId: string,
  ): Promise<TokenDeliveryResult> {
    if (!token.active) {
      this.logger.debug({
        message: "Skipping inactive token",
        tokenId: token.id,
        correlationId,
      });

      return {
        tokenId: token.id,
        platform: token.platform,
        tokenType: token.tokenType,
        status: "skipped",
      };
    }

    const transport = this.resolveTransport(token.platform, token.tokenType);

    if (!transport) {
      this.logger.error({
        message: "No transport available for token",
        tokenId: token.id,
        platform: token.platform,
        tokenType: token.tokenType,
        correlationId,
      });

      await this.pushTokenService.recordFailure(
        token.id,
        "UNSUPPORTED_PLATFORM",
        1,
        {
          correlationId,
        },
      );

      return {
        tokenId: token.id,
        platform: token.platform,
        tokenType: token.tokenType,
        status: "failed",
        errorCode: "UNSUPPORTED_PLATFORM",
      };
    }

    try {
      const response = await transport.send(token.token, notification, {
        tokenId: token.id,
        userId: token.userId,
        platform: token.platform,
        tokenType: token.tokenType,
        correlationId,
        notificationType: notification.notificationType,
      });

      if (response.success) {
        await this.pushTokenService.recordSuccess(token.id, {
          correlationId,
          notificationType: notification.notificationType,
        });

        return {
          tokenId: token.id,
          platform: token.platform,
          tokenType: token.tokenType,
          status: "success",
        };
      }

      const errorCode = response.errorCode ?? "UNKNOWN_DELIVERY_ERROR";

      await this.pushTokenService.recordFailure(token.id, errorCode, 1, {
        correlationId,
      });

      return {
        tokenId: token.id,
        platform: token.platform,
        tokenType: token.tokenType,
        status: "failed",
        errorCode,
      };
    } catch (error) {
      const errorCode = (error as Error)?.message || "NOTIFICATION_SEND_ERROR";

      await this.pushTokenService.recordFailure(token.id, errorCode, 1, {
        correlationId,
      });

      this.logger.error({
        message: "Notification send threw exception",
        tokenId: token.id,
        error: errorCode,
        correlationId,
      });

      return {
        tokenId: token.id,
        platform: token.platform,
        tokenType: token.tokenType,
        status: "failed",
        errorCode,
      };
    }
  }

  private resolveTransport(
    platform: PushPlatform,
    tokenType: PushTokenType,
  ): NotificationTransport | null {
    if (platform === PushPlatform.ANDROID && tokenType === PushTokenType.FCM) {
      return this.fcmTransport;
    }

    if (platform === PushPlatform.IOS && tokenType === PushTokenType.APNS) {
      return this.apnsTransport;
    }

    return null;
  }
}
