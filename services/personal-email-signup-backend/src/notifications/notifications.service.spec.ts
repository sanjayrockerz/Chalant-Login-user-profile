import { NotificationsService } from "./notifications.service";
import { PushTokenService } from "../push-tokens/services/push-token.service";
import { NotificationTransport } from "./interfaces/notification-transport.interface";
import { PushPlatform, PushTokenType } from "../push-tokens/dto/push-token.dto";
import { PushToken } from "../push-tokens/entities/push-token.entity";
import { NotificationPayload } from "./dto/notification.dto";

const createMockToken = (overrides: Partial<PushToken> = {}): PushToken => ({
  id: overrides.id ?? "token-" + Math.random().toString(36).slice(2),
  userId: overrides.userId ?? "user-123",
  token: overrides.token ?? "device-token",
  tokenHash: overrides.tokenHash,
  platform: overrides.platform ?? PushPlatform.ANDROID,
  tokenType: overrides.tokenType ?? PushTokenType.FCM,
  deviceMetadata: overrides.deviceMetadata ?? {},
  createdAt: overrides.createdAt ?? new Date(),
  updatedAt: overrides.updatedAt ?? new Date(),
  lastValidatedAt: overrides.lastValidatedAt ?? new Date(),
  lastUsedAt: overrides.lastUsedAt,
  active: overrides.active ?? true,
  failureCount: overrides.failureCount ?? 0,
  lastFailureAt: overrides.lastFailureAt,
  failureReason: overrides.failureReason,
  tenantId: overrides.tenantId ?? "tenant-1",
  createdBy: overrides.createdBy,
  deletedAt: overrides.deletedAt,
});

describe("NotificationsService", () => {
  let service: NotificationsService;
  let pushTokenService: jest.Mocked<PushTokenService>;
  let fcmTransport: jest.Mocked<NotificationTransport>;
  let apnsTransport: jest.Mocked<NotificationTransport>;

  const payload: NotificationPayload = {
    title: "Test Title",
    body: "Test Body",
    notificationType: "test_notification",
  };

  beforeEach(() => {
    pushTokenService = {
      findActiveTokensForUser: jest.fn(),
      getActiveTokenById: jest.fn(),
      recordSuccess: jest.fn().mockResolvedValue(undefined),
      recordFailure: jest.fn().mockResolvedValue({
        deactivated: false,
        failureCount: 1,
        nextRetryMs: null,
        errorCode: "ERR",
      }),
    } as unknown as jest.Mocked<PushTokenService>;

    fcmTransport = {
      send: jest.fn(),
    } as unknown as jest.Mocked<NotificationTransport>;

    apnsTransport = {
      send: jest.fn(),
    } as unknown as jest.Mocked<NotificationTransport>;

    service = new NotificationsService(
      pushTokenService,
      fcmTransport,
      apnsTransport,
    );
  });

  it("delivers notification to all active user tokens and records success", async () => {
    const androidToken = createMockToken({
      id: "android-token",
      platform: PushPlatform.ANDROID,
      tokenType: PushTokenType.FCM,
    });
    const iosToken = createMockToken({
      id: "ios-token",
      platform: PushPlatform.IOS,
      tokenType: PushTokenType.APNS,
    });

    pushTokenService.findActiveTokensForUser.mockResolvedValue([
      androidToken,
      iosToken,
    ]);
    fcmTransport.send.mockResolvedValue({ success: true });
    apnsTransport.send.mockResolvedValue({ success: true });

    const result = await service.sendToUser("user-123", payload);

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    expect(pushTokenService.recordSuccess).toHaveBeenCalledTimes(2);
    expect(pushTokenService.recordFailure).not.toHaveBeenCalled();
    expect(fcmTransport.send).toHaveBeenCalledWith(
      androidToken.token,
      expect.objectContaining(payload),
      expect.objectContaining({ tokenId: "android-token" }),
    );
    expect(apnsTransport.send).toHaveBeenCalledWith(
      iosToken.token,
      expect.objectContaining(payload),
      expect.objectContaining({ tokenId: "ios-token" }),
    );
  });

  it("records failures without aborting other deliveries", async () => {
    const androidToken = createMockToken({
      id: "android-token",
      platform: PushPlatform.ANDROID,
      tokenType: PushTokenType.FCM,
    });
    const iosToken = createMockToken({
      id: "ios-token",
      platform: PushPlatform.IOS,
      tokenType: PushTokenType.APNS,
    });

    pushTokenService.findActiveTokensForUser.mockResolvedValue([
      androidToken,
      iosToken,
    ]);
    fcmTransport.send.mockResolvedValue({ success: true });
    apnsTransport.send.mockResolvedValue({ success: false, errorCode: "410" });

    const result = await service.sendToUser("user-123", payload);

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(pushTokenService.recordSuccess).toHaveBeenCalledTimes(1);
    expect(pushTokenService.recordFailure).toHaveBeenCalledWith(
      "ios-token",
      "410",
      1,
      expect.any(Object),
    );
  });

  it("skips missing tokens when sending directly to token", async () => {
    pushTokenService.getActiveTokenById.mockResolvedValue(null);

    const result = await service.sendToToken("missing-token", payload);

    expect(result.status).toBe("skipped");
    expect(pushTokenService.recordSuccess).not.toHaveBeenCalled();
    expect(pushTokenService.recordFailure).not.toHaveBeenCalled();
  });

  it("uses getActiveTokenById when sending to a specific token", async () => {
    const token = createMockToken({
      id: "token-1",
      platform: PushPlatform.ANDROID,
      tokenType: PushTokenType.FCM,
    });
    pushTokenService.getActiveTokenById.mockResolvedValue(token);
    fcmTransport.send.mockResolvedValue({ success: true });

    const result = await service.sendToToken("token-1", payload);

    expect(result.status).toBe("success");
    expect(pushTokenService.recordSuccess).toHaveBeenCalledWith(
      "token-1",
      expect.objectContaining({ notificationType: payload.notificationType }),
    );
  });
});
