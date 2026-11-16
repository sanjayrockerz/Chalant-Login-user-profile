import { createHash, createHmac } from "crypto";
import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "../config/config.service";
import { InternalServiceCredentialVerifier } from "./internal-service-credential-verifier";

const serviceId = "community-profile-consumer";
const keyId = "consumer-key-2026";
const secret = "a-test-secret-with-at-least-32-characters";
const body = {
  token: "end-user-token",
  audience: "community-api",
  scope: "auth:token:validate",
};
const now = Math.floor(Date.now() / 1000);

function signedV1() {
  const canonical = JSON.stringify([
    now,
    serviceId,
    "POST",
    "/internal/v1/auth/token/validate",
    body.audience,
    body.scope,
    body.token,
  ]);
  return {
    ...body,
    headers: {
      serviceId,
      keyId,
      timestamp: String(now),
      signature: createHmac("sha256", secret).update(canonical).digest("hex"),
    },
  };
}

function signedV2(nonce: string) {
  const digest = createHash("sha256")
    .update(JSON.stringify(body))
    .digest("hex");
  const canonical = JSON.stringify([
    2,
    now,
    serviceId,
    "POST",
    "/internal/v2/auth/token/validate",
    "",
    nonce,
    digest,
    body.audience,
    body.scope,
  ]);
  return {
    ...body,
    headers: {
      serviceId,
      keyId,
      timestamp: String(now),
      nonce,
      signature: createHmac("sha256", secret).update(canonical).digest("hex"),
    },
  };
}

function config(protocolVersions: Array<"v1" | "v2">) {
  return {
    get: () => ({
      [serviceId]: {
        protocolVersions,
        keys: { [keyId]: secret },
        audiences: [body.audience],
        scopes: [body.scope],
      },
    }),
  } as unknown as ConfigService;
}

describe("InternalServiceCredentialVerifier protocol isolation", () => {
  it("rejects V1 credentials when the consumer is V2-only", () => {
    const verifier = new InternalServiceCredentialVerifier(
      config(["v2"]),
      {} as never,
    );
    const signed = signedV1();
    expect(() => verifier.verify(body, signed.headers)).toThrow(
      UnauthorizedException,
    );
  });

  it("rejects V2 credentials when a legacy consumer is explicitly V1-only", async () => {
    const verifier = new InternalServiceCredentialVerifier(
      config(["v1"]),
      {} as never,
    );
    const signed = signedV2(Buffer.alloc(32, 4).toString("base64url"));
    await expect(
      verifier.verifyV2(body, signed.headers),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("allows two Auth instances to reserve one nonce only once", async () => {
    const reservations = new Set<string>();
    const client = {
      set: (key: string) => {
        if (reservations.has(key)) return null;
        reservations.add(key);
        return "OK";
      },
    };
    const redis = { getClient: () => client } as never;
    const first = new InternalServiceCredentialVerifier(config(["v2"]), redis);
    const second = new InternalServiceCredentialVerifier(config(["v2"]), redis);
    const signed = signedV2(Buffer.alloc(32, 9).toString("base64url"));

    const results = await Promise.allSettled([
      first.verifyV2(body, signed.headers),
      second.verifyV2(body, signed.headers),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
  });
});
