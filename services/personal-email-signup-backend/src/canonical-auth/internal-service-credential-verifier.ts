import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { createHmac, timingSafeEqual } from "crypto";
import { ConfigService } from "../config/config.service";

const MAX_CLOCK_SKEW_SECONDS = 60;
const VALIDATION_PATH = "/internal/v1/auth/token/validate";

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

interface IntrospectionClientConfiguration {
  keys: Record<string, string>;
  audiences: string[];
  scopes: string[];
}

@Injectable()
export class InternalServiceCredentialVerifier {
  constructor(private readonly config: ConfigService) {}

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
}
