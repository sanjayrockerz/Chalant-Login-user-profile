import { generateKeyPairSync } from "crypto";
import * as jwt from "jsonwebtoken";
import { ConfigService } from "../config/config.service";
import { ProfilePairStateClient } from "./profile-pair-state.client";

describe("ProfilePairStateClient", () => {
  const subjectA = "11111111-1111-4111-8111-111111111111";
  const subjectB = "22222222-2222-4222-8222-222222222222";
  const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKey = keyPair.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
  const publicKey = keyPair.publicKey
    .export({ type: "spki", format: "pem" })
    .toString();

  it("uses a short-lived scoped Auth service JWT and validates the primary mapped pair response", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        userA: subjectA,
        userB: subjectB,
        aBlockedB: false,
        bBlockedA: false,
        pairRevision: "12",
        readConsistency: "PRIMARY",
        mappingIdentityHash: "a".repeat(64),
      }),
    });
    const config = {
      get: (key: string) =>
        ({
          PROFILE_PAIR_STATE_URL: "http://127.0.0.1:3100",
          PROFILE_PAIR_STATE_JWT_PRIVATE_KEY: privateKey,
          NODE_ENV: "test",
        })[key],
    } as ConfigService;
    const client = new ProfilePairStateClient(config, fetchMock as never);

    await expect(
      client.readPairState(subjectA, subjectB),
    ).resolves.toMatchObject({
      aBlockedB: false,
      bBlockedA: false,
      pairRevision: "12",
      readConsistency: "PRIMARY",
      mappingIdentityHash: "a".repeat(64),
    });

    const [url, request] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe(
      `http://127.0.0.1:3100/api/v1/internal/v1/blocks/pair-state?userA=${subjectA}&userB=${subjectB}`,
    );
    const token = (
      request.headers as Record<string, string>
    ).authorization.replace(/^Bearer /, "");
    const claims = jwt.verify(token, publicKey, {
      algorithms: ["RS256"],
      issuer: "chalant-service-auth",
      audience: "user-profile-social",
    }) as jwt.JwtPayload;
    expect(claims).toMatchObject({
      sub: "auth-safety-ordering",
      act: subjectA,
      scope: ["blocks:state:read"],
    });
    expect((claims.exp as number) - (claims.iat as number)).toBeLessThanOrEqual(
      60,
    );
  });

  it("fails closed when Profile omits a verified identity mapping", async () => {
    const client = new ProfilePairStateClient(
      {
        get: (key: string) =>
          ({
            PROFILE_PAIR_STATE_URL: "http://127.0.0.1:3100",
            PROFILE_PAIR_STATE_JWT_PRIVATE_KEY: privateKey,
            NODE_ENV: "test",
          })[key],
      } as ConfigService,
      jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          userA: subjectA,
          userB: subjectB,
          aBlockedB: false,
          bBlockedA: false,
          pairRevision: "12",
          readConsistency: "PRIMARY",
        }),
      }) as never,
    );

    await expect(client.readPairState(subjectA, subjectB)).rejects.toThrow();
  });
});
