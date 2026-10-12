import { readFileSync } from "fs";
import { createPublicKey, JsonWebKey } from "crypto";
import jwt, { JwtPayload } from "jsonwebtoken";
import { ConfigService } from "../config/config.service";
import { AppleIdTokenClaims, AppleOidcClient } from "./apple-oidc.types";

const APPLE_ISSUER = "https://appleid.apple.com";
const AUTHORIZATION_URL = `${APPLE_ISSUER}/auth/authorize`;
const TOKEN_URL = `${APPLE_ISSUER}/auth/token`;
const JWKS_URL = `${APPLE_ISSUER}/auth/keys`;
const CLIENT_SECRET_TTL_SECONDS = 5 * 60;

interface AppleJwk {
  kty: string;
  kid: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
}

interface AppleJwksResponse {
  keys: AppleJwk[];
}

function asAppleClaims(payload: string | JwtPayload): AppleIdTokenClaims {
  if (typeof payload === "string")
    throw new Error("Apple token payload is invalid");
  if (
    typeof payload.iss !== "string" ||
    typeof payload.sub !== "string" ||
    typeof payload.aud !== "string" ||
    typeof payload.exp !== "number"
  ) {
    throw new Error("Apple token claims are incomplete");
  }
  return payload as AppleIdTokenClaims;
}

export class AppleOidcClientAdapter implements AppleOidcClient {
  private cachedKeys: AppleJwk[] | null = null;
  private cachedKeysAt = 0;

  constructor(private readonly config: ConfigService) {}

  generateAuthUrl(options: Record<string, string>): string {
    const url = new URL(AUTHORIZATION_URL);
    for (const [key, value] of Object.entries(options))
      url.searchParams.set(key, value);
    return url.toString();
  }

  createClientSecret(): string {
    const settings = this.settings();
    const privateKey = this.privateKey();
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
      {
        iss: settings.teamId,
        iat: now,
        exp: now + CLIENT_SECRET_TTL_SECONDS,
        aud: APPLE_ISSUER,
        sub: settings.clientId,
      },
      privateKey,
      { algorithm: "ES256", keyid: settings.keyId },
    );
  }

  async exchangeCode(code: string): Promise<{ id_token: string }> {
    const settings = this.settings();
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: settings.clientId,
        client_secret: this.createClientSecret(),
        code,
        grant_type: "authorization_code",
        redirect_uri: settings.redirectUri,
      }),
    });
    if (!response.ok) throw new Error("Apple token exchange failed");
    const body = (await response.json()) as { id_token?: unknown };
    if (typeof body.id_token !== "string" || body.id_token.length === 0) {
      throw new Error("Apple token response is incomplete");
    }
    return { id_token: body.id_token };
  }

  async verifyIdToken(idToken: string): Promise<AppleIdTokenClaims> {
    const settings = this.settings();
    const decoded = jwt.decode(idToken, { complete: true });
    const header =
      decoded && typeof decoded === "object" ? decoded.header : null;
    if (!header || header.alg !== "ES256" || typeof header.kid !== "string") {
      throw new Error("Apple token header is invalid");
    }
    const keys = await this.getKeys();
    const jwk = keys.find(
      (key) => key.kid === header.kid && key.alg === "ES256",
    );
    if (!jwk) throw new Error("Apple signing key is unavailable");
    const publicKey = createPublicKey({
      key: jwk as unknown as JsonWebKey,
      format: "jwk",
    });
    const payload = jwt.verify(idToken, publicKey, {
      algorithms: ["ES256"],
      issuer: APPLE_ISSUER,
      audience: settings.clientId,
    });
    return asAppleClaims(payload);
  }

  private async getKeys(): Promise<AppleJwk[]> {
    if (this.cachedKeys && Date.now() - this.cachedKeysAt < 60 * 60 * 1000) {
      return this.cachedKeys;
    }
    const response = await fetch(JWKS_URL);
    if (!response.ok)
      throw new Error("Apple signing keys could not be fetched");
    const body = (await response.json()) as AppleJwksResponse;
    if (!Array.isArray(body.keys) || body.keys.length === 0) {
      throw new Error("Apple signing keys response is invalid");
    }
    this.cachedKeys = body.keys;
    this.cachedKeysAt = Date.now();
    return body.keys;
  }

  private settings(): {
    clientId: string;
    teamId: string;
    keyId: string;
    redirectUri: string;
  } {
    const clientId = this.config.get("APPLE_CLIENT_ID");
    const teamId = this.config.get("APPLE_TEAM_ID");
    const keyId = this.config.get("APPLE_KEY_ID");
    const redirectUri = this.config.get("APPLE_REDIRECT_URI");
    if (!clientId || !teamId || !keyId || !redirectUri) {
      throw new Error("Apple authentication is not configured");
    }
    return { clientId, teamId, keyId, redirectUri };
  }

  private privateKey(): string {
    const inline = this.config.get("APPLE_PRIVATE_KEY");
    const file = this.config.get("APPLE_PRIVATE_KEY_FILE");
    const key = inline || (file ? readFileSync(file, "utf8") : "");
    if (!key) throw new Error("Apple private key is unavailable");
    return key.replace(/\\n/g, "\n");
  }
}
