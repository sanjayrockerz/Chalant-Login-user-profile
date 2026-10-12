import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  PushTokenPlatformEnum,
  RegisterTokenDto,
  normalizeDeviceMetadata,
} from "./register-token.dto";

describe("RegisterTokenDto", () => {
  const validFcmToken = "a".repeat(120);
  const validApnsToken =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  it("accepts a valid Android token with snake_case metadata", async () => {
    const dto = plainToInstance(RegisterTokenDto, {
      token: validFcmToken,
      platform: "ANDROID",
      device_metadata: {
        model: "Pixel 9",
        os_version: "14.1.0",
        app_version: "2.3.4",
        device_id: "abc-123",
      },
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("accepts a valid iOS token", async () => {
    const dto = plainToInstance(RegisterTokenDto, {
      token: validApnsToken,
      platform: "ios",
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("rejects FCM token that is too short", async () => {
    const dto = plainToInstance(RegisterTokenDto, {
      token: "short",
      platform: PushTokenPlatformEnum.ANDROID,
    });

    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "token")).toBe(true);
  });

  it("rejects APNs token with invalid characters", async () => {
    const dto = plainToInstance(RegisterTokenDto, {
      token: `${validApnsToken.slice(0, 63)}g`,
      platform: PushTokenPlatformEnum.IOS,
    });

    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "token")).toBe(true);
  });

  it("rejects missing platform", async () => {
    const dto = plainToInstance(RegisterTokenDto, {
      token: validFcmToken,
    });

    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "platform")).toBe(true);
  });

  it("rejects unsupported platform value", async () => {
    const dto = plainToInstance(RegisterTokenDto, {
      token: validFcmToken,
      platform: "windows",
    });

    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "platform")).toBe(true);
  });

  it("trims token input before validation", async () => {
    const dto = plainToInstance(RegisterTokenDto, {
      token: ` ${validFcmToken} \n`,
      platform: PushTokenPlatformEnum.ANDROID,
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.token).toBe(validFcmToken);
  });
});

describe("normalizeDeviceMetadata", () => {
  it("returns undefined for empty objects", () => {
    expect(normalizeDeviceMetadata({})).toBeUndefined();
  });

  it("normalizes camelCase keys", () => {
    expect(
      normalizeDeviceMetadata({
        osVersion: "14.0",
        appVersion: "3.1.2",
        deviceId: "device-123",
      }),
    ).toEqual({
      os_version: "14.0",
      app_version: "3.1.2",
      device_id: "device-123",
    });
  });

  it("filters out undefined metadata values", () => {
    expect(
      normalizeDeviceMetadata({
        model: undefined,
        osVersion: "14.0",
        deviceId: "device-789",
      }),
    ).toEqual({
      os_version: "14.0",
      device_id: "device-789",
    });
  });
});
