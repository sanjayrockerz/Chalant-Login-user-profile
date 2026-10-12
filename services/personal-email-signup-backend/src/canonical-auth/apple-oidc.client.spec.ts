import { generateKeyPairSync } from "crypto";
import jwt from "jsonwebtoken";
import { AppleOidcClientAdapter } from "./apple-oidc.client";

describe("Apple OIDC client", () => {
  it("creates a short-lived ES256 client secret with Apple claims", () => {
    const { privateKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const config = {
      get: (key: string) =>
        ({
          APPLE_CLIENT_ID: "com.example.web",
          APPLE_TEAM_ID: "TEAM123456",
          APPLE_KEY_ID: "KEY1234567",
          APPLE_REDIRECT_URI: "https://auth.example.test/auth/apple/callback",
          APPLE_PRIVATE_KEY: privateKey
            .export({ type: "pkcs8", format: "pem" })
            .toString(),
        })[key],
    };
    const client = new AppleOidcClientAdapter(config as never);
    const secret = client.createClientSecret();
    const decoded = jwt.decode(secret, { complete: true });

    expect(decoded?.header).toMatchObject({ alg: "ES256", kid: "KEY1234567" });
    expect(decoded?.payload).toMatchObject({
      iss: "TEAM123456",
      aud: "https://appleid.apple.com",
      sub: "com.example.web",
    });
    expect((decoded?.payload as jwt.JwtPayload).exp).toBeGreaterThan(
      (decoded?.payload as jwt.JwtPayload).iat ?? 0,
    );
  });
});
