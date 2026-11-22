import { createHash, createHmac, randomBytes } from "crypto";
import { ConfigService } from "../config/config.service";
import { SafetyServiceCredentialVerifier } from "./safety-service-credential-verifier";

describe("SafetyServiceCredentialVerifier", () => {
  const secret = "safety-coordinator-integration-key-at-least-32-bytes";
  const body = {
    operationId: "123e4567-e89b-42d3-a456-426614174000",
    type: "BLOCK",
    subjects: ["a", "b"],
  };
  let nonceCreate: jest.Mock;
  let verifier: SafetyServiceCredentialVerifier;

  const canonicalJson = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
        .join(",")}}`;
    }
    return JSON.stringify(value);
  };

  const signed = (
    input: {
      nonce?: string;
      body?: unknown;
      scope?: string;
    } = {},
  ) => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = input.nonce ?? randomBytes(32).toString("base64url");
    const signedBody = input.body ?? body;
    const scope = input.scope ?? "safety:operations:request";
    const digest = createHash("sha256")
      .update(canonicalJson(signedBody))
      .digest("hex");
    const canonical = JSON.stringify([
      2,
      Number(timestamp),
      "chat-backend-service",
      "POST",
      "/internal/v1/safety-operations",
      nonce,
      "auth-safety-ordering",
      scope,
      digest,
    ]);
    return {
      body: signedBody,
      headers: {
        serviceId: "chat-backend-service",
        keyId: "test-v1",
        timestamp,
        nonce,
        audience: "auth-safety-ordering",
        scope,
        signature: createHmac("sha256", secret).update(canonical).digest("hex"),
      },
    };
  };

  beforeEach(() => {
    nonceCreate = jest.fn().mockResolvedValue({});
    const config = {
      get: jest.fn().mockReturnValue({
        "chat-backend-service": {
          protocolVersions: ["v2"],
          keys: { "test-v1": secret },
          audiences: ["auth-safety-ordering"],
          scopes: ["safety:operations:request"],
        },
      }),
    } as unknown as ConfigService;
    const prisma = {
      $transaction: jest.fn(
        async (callback: (tx: unknown) => Promise<unknown>) =>
          callback({
            safetyServiceNonce: { create: nonceCreate },
            $executeRaw: jest.fn().mockResolvedValue(0),
          }),
      ),
    };
    verifier = new SafetyServiceCredentialVerifier(config, prisma as never);
  });

  it("accepts body-bound scoped credentials and durably reserves the nonce", async () => {
    const request = signed();
    await expect(
      verifier.verify(
        "POST",
        "/internal/v1/safety-operations",
        request.body,
        request.headers,
        "safety:operations:request",
      ),
    ).resolves.toMatchObject({
      id: "chat-backend-service",
      scope: "safety:operations:request",
    });
    expect(nonceCreate).toHaveBeenCalledTimes(1);
  });

  it("rejects a request whose body differs from the signed body", async () => {
    const request = signed();
    await expect(
      verifier.verify(
        "POST",
        "/internal/v1/safety-operations",
        { ...(request.body as Record<string, unknown>), type: "UNBLOCK" },
        request.headers,
        "safety:operations:request",
      ),
    ).rejects.toThrow(/credential/i);
    expect(nonceCreate).not.toHaveBeenCalled();
  });

  it("rejects a caller scope that is not configured", async () => {
    const request = signed({ scope: "safety:operations:finalize" });
    await expect(
      verifier.verify(
        "POST",
        "/internal/v1/safety-operations",
        request.body,
        request.headers,
        "safety:operations:request",
      ),
    ).rejects.toThrow(/scope/i);
    expect(nonceCreate).not.toHaveBeenCalled();
  });

  it("rejects replay when the durable nonce key already exists", async () => {
    nonceCreate.mockRejectedValue({ code: "P2002" });
    const request = signed();
    await expect(
      verifier.verify(
        "POST",
        "/internal/v1/safety-operations",
        request.body,
        request.headers,
        "safety:operations:request",
      ),
    ).rejects.toThrow(/replay/i);
  });
});
