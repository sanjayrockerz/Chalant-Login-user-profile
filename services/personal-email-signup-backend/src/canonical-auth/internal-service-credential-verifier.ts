import {
  ForbiddenException,
  ServiceUnavailableException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { ConfigService } from "../config/config.service";
import { RedisService } from "../redis/redis.service";

const MAX_CLOCK_SKEW_SECONDS = 60;
const VALIDATION_PATH = "/internal/v1/auth/token/validate";
const VALIDATION_V2_PATH = "/internal/v2/auth/token/validate";
const REPLAY_TTL_SECONDS = 125;

export interface TokenValidationRequest {
  token: string;
  audience: string;
  scope: string;
}

export interface InternalServiceCaller {
  id: string;
  audience: string;
  scope: string;
}

export interface InternalServiceRequestHeaders {
  serviceId: string;
  keyId: string;
  timestamp: string;
  signature: string;
}

export interface InternalServiceV2RequestHeaders extends InternalServiceRequestHeaders {
  nonce: string;
}

interface IntrospectionClientConfiguration {
  keys: Record<string, string>;
  audiences: string[];
  scopes: string[];
}

@Injectable()
export class InternalServiceCredentialVerifier {
  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  verify(
    body: TokenValidationRequest,
    headers: InternalServiceRequestHeaders,
  ): InternalServiceCaller {
    const clients = this.config.get("AUTH_INTROSPECTION_CLIENTS") as Record<
      string,
      IntrospectionClientConfiguration
    >;
    const client = Object.prototype.hasOwnProperty.call(
      clients,
      headers.serviceId,
    )
      ? clients[headers.serviceId]
      : undefined;
    if (
      !client ||
      typeof client !== "object" ||
      !headers.keyId ||
      !Object.prototype.hasOwnProperty.call(client.keys, headers.keyId) ||
      typeof client.keys[headers.keyId] !== "string"
    ) {
      throw new UnauthorizedException("Invalid auth service credential");
    }

    if (
      !body.audience ||
      !client.audiences.includes(body.audience) ||
      !body.scope ||
      !client.scopes.includes(body.scope)
    ) {
      throw new ForbiddenException("Auth service scope is not allowed");
    }

    const timestampSeconds = Number(headers.timestamp);
    if (
      !/^\d{10}$/.test(headers.timestamp) ||
      !Number.isSafeInteger(timestampSeconds) ||
      Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) >
        MAX_CLOCK_SKEW_SECONDS ||
      !/^[a-f0-9]{64}$/i.test(headers.signature)
    ) {
      throw new UnauthorizedException("Invalid auth service credential");
    }

    const canonical = JSON.stringify([
      timestampSeconds,
      headers.serviceId,
      "POST",
      VALIDATION_PATH,
      body.audience,
      body.scope,
      body.token,
    ]);
    const expected = createHmac("sha256", client.keys[headers.keyId])
      .update(canonical)
      .digest();
    const received = Buffer.from(headers.signature, "hex");
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      throw new UnauthorizedException("Invalid auth service credential");
    }

    return {
      id: headers.serviceId,
      audience: body.audience,
      scope: body.scope,
    };
  }

  async verifyV2(
    body: TokenValidationRequest,
    headers: InternalServiceV2RequestHeaders,
  ): Promise<InternalServiceCaller> {
    const clients = this.config.get("AUTH_INTROSPECTION_CLIENTS") as Record<
      string,
      IntrospectionClientConfiguration
    >;
    const client = Object.prototype.hasOwnProperty.call(
      clients,
      headers.serviceId,
    )
      ? clients[headers.serviceId]
      : undefined;
    if (
      !client ||
      typeof client !== "object" ||
      !headers.keyId ||
      !Object.prototype.hasOwnProperty.call(client.keys, headers.keyId) ||
      typeof client.keys[headers.keyId] !== "string"
    ) {
      throw new UnauthorizedException("Invalid auth service credential");
    }

    if (
      !body.audience ||
      !client.audiences.includes(body.audience) ||
      !body.scope ||
      !client.scopes.includes(body.scope)
    ) {
      throw new ForbiddenException("Auth service scope is not allowed");
    }

    const timestampSeconds = Number(headers.timestamp);
    if (
      !/^\d{10}$/.test(headers.timestamp) ||
      !Number.isSafeInteger(timestampSeconds) ||
      Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) >
        MAX_CLOCK_SKEW_SECONDS ||
      !/^[A-Za-z0-9_-]{43}$/.test(headers.nonce) ||
      !/^[a-f0-9]{64}$/i.test(headers.signature)
    ) {
      throw new UnauthorizedException("Invalid auth service credential");
    }

    const canonicalBody = JSON.stringify({
      token: body.token,
      audience: body.audience,
      scope: body.scope,
    });
    const bodyDigest = createHash("sha256").update(canonicalBody).digest("hex");
    const canonical = JSON.stringify([
      2,
      timestampSeconds,
      headers.serviceId,
      "POST",
      VALIDATION_V2_PATH,
      "",
      headers.nonce,
      bodyDigest,
      body.audience,
      body.scope,
    ]);
    const expected = createHmac("sha256", client.keys[headers.keyId])
      .update(canonical)
      .digest();
    const received = Buffer.from(headers.signature, "hex");
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      throw new UnauthorizedException("Invalid auth service credential");
    }

    const replayKey = `auth:introspection:v2:nonce:${headers.serviceId}:${headers.keyId}:${createHash("sha256").update(headers.nonce).digest("hex")}`;
    let reserved: string | null;
    try {
      reserved = await this.redis
        .getClient()
        .set(replayKey, "1", "EX", REPLAY_TTL_SECONDS, "NX");
    } catch {
      throw new ServiceUnavailableException(
        "Auth service replay protection is unavailable",
      );
    }
    if (reserved !== "OK") {
      throw new UnauthorizedException("Auth service request replay detected");
    }

    return {
      id: headers.serviceId,
      audience: body.audience,
      scope: body.scope,
    };
  }
}
