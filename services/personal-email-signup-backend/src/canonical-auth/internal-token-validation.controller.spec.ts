import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { createHmac } from "crypto";
import { ConfigService } from "../config/config.service";
import { CanonicalAuthService } from "./canonical-auth.service";
import { InternalServiceCredentialVerifier } from "./internal-service-credential-verifier";
import { InternalTokenValidationController } from "./internal-token-validation.controller";

const serviceId = "community-service";
const keyId = "community-key-v1";
const secret = "community-service-auth-secret-for-tests-32-bytes";
const path = "/internal/v1/auth/token/validate";
const token = "canonical-user-access-token";
const body = {
  token,
  audience: "community-api",
  scope: "auth:token:validate",
};

function signRequest(nowSeconds = Math.floor(Date.now() / 1000)) {
  const canonical = JSON.stringify([
    nowSeconds,
    serviceId,
    "POST",
    path,
    body.audience,
    body.scope,
    body.token,
  ]);
  return {
    serviceId,
    keyId,
    timestamp: String(nowSeconds),
    signature: createHmac("sha256", secret).update(canonical).digest("hex"),
  };
}

function invoke(
  controller: InternalTokenValidationController,
  requestBody: typeof body,
  headers: ReturnType<typeof signRequest>,
) {
  return controller.validate(
    requestBody,
    headers.serviceId,
    headers.keyId,
    headers.timestamp,
    headers.signature,
  );
}

describe("InternalTokenValidationController", () => {
  let controller: InternalTokenValidationController;
  let auth: jest.Mocked<
    Pick<CanonicalAuthService, "authenticateAccessTokenContext">
  >;

  beforeEach(() => {
    auth = {
      authenticateAccessTokenContext: jest.fn().mockResolvedValue({
        principal: {
          subject: "9b2c5d6e-1a5f-4cc4-9be3-5d8c5268b114",
          accountStatus: "ACTIVE",
          email: "private@example.test",
          username: "private-name",
          emailVerified: true,
        },
        sessionId: "871bb1fc-3fc5-4aec-8a61-9d57c93c591c",
        accessTokenExpiresAt: 1_900_000_000,
      }),
    } as jest.Mocked<
      Pick<CanonicalAuthService, "authenticateAccessTokenContext">
    >;
    const config = {
      get: jest.fn((key: string) =>
        key === "AUTH_INTROSPECTION_CLIENTS"
          ? {
              [serviceId]: {
                keys: { [keyId]: secret },
                audiences: [body.audience],
                scopes: [body.scope],
              },
            }
          : undefined,
      ),
    } as unknown as ConfigService;
    controller = new InternalTokenValidationController(
      auth as unknown as CanonicalAuthService,
      new InternalServiceCredentialVerifier(config),
    );
  });

  it("returns only the verified canonical principal and scoped caller context", async () => {
    const result = await invoke(controller, body, signRequest());

    expect(result).toEqual({
      contractVersion: 1,
      subject: "9b2c5d6e-1a5f-4cc4-9be3-5d8c5268b114",
      sessionId: "871bb1fc-3fc5-4aec-8a61-9d57c93c591c",
      accountStatus: "ACTIVE",
      emailVerified: true,
      accessTokenExpiresAt: 1_900_000_000,
      service: {
        id: serviceId,
        audience: body.audience,
        scope: body.scope,
      },
    });
    expect(result).not.toHaveProperty("email");
    expect(result).not.toHaveProperty("username");
    expect(result).not.toHaveProperty("token");
    expect(auth.authenticateAccessTokenContext).toHaveBeenCalledWith(token);
  });

  it("rejects an audience not explicitly allowed for the caller", async () => {
    await expect(
      invoke(controller, { ...body, audience: "messaging-api" }, signRequest()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(auth.authenticateAccessTokenContext).not.toHaveBeenCalled();
  });

  it("rejects a scope not explicitly allowed for the caller", async () => {
    await expect(
      invoke(controller, { ...body, scope: "auth:admin" }, signRequest()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(auth.authenticateAccessTokenContext).not.toHaveBeenCalled();
  });

  it("rejects an altered or forged service signature", async () => {
    const headers = signRequest();
    headers.signature = "0".repeat(64);
    await expect(invoke(controller, body, headers)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(auth.authenticateAccessTokenContext).not.toHaveBeenCalled();
  });

  it("rejects prototype property names as service identities", async () => {
    for (const serviceName of ["constructor", "toString", "__proto__"]) {
      const headers = signRequest();
      headers.serviceId = serviceName;
      await expect(invoke(controller, body, headers)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }
    expect(auth.authenticateAccessTokenContext).not.toHaveBeenCalled();
  });

  it("rejects stale service credentials without validating the user token", async () => {
    await expect(
      invoke(controller, body, signRequest(Math.floor(Date.now() / 1000) - 61)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(auth.authenticateAccessTokenContext).not.toHaveBeenCalled();
  });

  it("preserves authentication denial for an invalid or expired end-user token", async () => {
    auth.authenticateAccessTokenContext.mockRejectedValue(
      new UnauthorizedException("Invalid access token"),
    );
    await expect(
      invoke(controller, body, signRequest()),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
