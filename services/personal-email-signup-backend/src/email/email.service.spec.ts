import { ServiceUnavailableException } from "@nestjs/common";
import { EmailService } from "./email.service";

describe("EmailService", () => {
  it("fails closed when delivery is disabled", async () => {
    const service = new EmailService({
      get: (key: string) =>
        ({
          EMAIL_DELIVERY_ENABLED: false,
          NODE_ENV: "test",
        })[key],
    } as never);

    await expect(
      service.sendOTP({
        email: "test@example.com",
        otp: "123456",
        expirationMinutes: 5,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.healthCheck()).resolves.toEqual({
      status: "disabled",
      details: "Email delivery is disabled",
    });
  });

  it("uses deterministic JSON transport only in test mode", async () => {
    const service = new EmailService({
      get: (key: string) =>
        ({
          EMAIL_DELIVERY_ENABLED: true,
          EMAIL_PROVIDER: "test",
          EMAIL_FROM: "no-reply@example.test",
          NODE_ENV: "test",
        })[key],
    } as never);

    await expect(
      service.sendVerificationEmail("test@example.com", "opaque-token"),
    ).resolves.toMatchObject({ accepted: true });
    await expect(service.healthCheck()).resolves.toMatchObject({
      status: "configured",
    });
  });

  it("rejects test transport outside test mode", () => {
    expect(
      () =>
        new EmailService({
          get: (key: string) =>
            ({
              EMAIL_DELIVERY_ENABLED: true,
              EMAIL_PROVIDER: "test",
              NODE_ENV: "production",
            })[key],
        } as never),
    ).toThrow("Test email transport is only permitted in test mode");
  });
});
