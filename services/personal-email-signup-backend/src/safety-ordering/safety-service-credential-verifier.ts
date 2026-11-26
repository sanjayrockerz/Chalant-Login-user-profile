import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { AuthSafetyPrismaService } from "../../prisma/prisma.module";
import { ConfigService } from "../config/config.service";
import { SafetyCaller } from "./safety-ordering.service";

const MAX_CLOCK_SKEW_SECONDS = 60;
const NONCE_RETENTION_SECONDS = 125;

export interface SafetyRequestHeaders {
  serviceId: string;
  keyId: string;
  timestamp: string;
  nonce: string;
  audience: string;
  scope: string;
  signature: string;
}

@Injectable()
export class SafetyServiceCredentialVerifier {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: AuthSafetyPrismaService,
  ) {}

  async verify(
    method: string,
    path: string,
    body: unknown,
    headers: SafetyRequestHeaders,
    requiredScope: string,
  ): Promise<SafetyCaller> {
    const clients = this.config.get("AUTH_INTROSPECTION_CLIENTS") as Record<
      string,
      {
        protocolVersions: Array<"v1" | "v2">;
        keys: Record<string, string>;
        audiences: string[];
        scopes: string[];
      }
    >;
    const client =
      clients &&
      Object.prototype.hasOwnProperty.call(clients, headers.serviceId)
        ? clients[headers.serviceId]
        : undefined;
    if (
      !client ||
      !client.protocolVersions?.includes("v2") ||
      !Object.prototype.hasOwnProperty.call(client.keys, headers.keyId)
    ) {
      throw new UnauthorizedException("Invalid safety service credential");
    }
    if (
      headers.scope !== requiredScope ||
      !client.scopes.includes(requiredScope) ||
      !headers.audience ||
      !client.audiences.includes(headers.audience)
    ) {
      throw new ForbiddenException("Safety service scope is not allowed");
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
      throw new UnauthorizedException("Invalid safety service credential");
    }

    const bodyDigest = createHash("sha256")
      .update(this.canonicalJson(body ?? null))
      .digest("hex");
    const canonical = JSON.stringify([
      2,
      timestampSeconds,
      headers.serviceId,
      method.toUpperCase(),
      path,
      headers.nonce,
      headers.audience,
      headers.scope,
      bodyDigest,
    ]);
    const expected = createHmac("sha256", client.keys[headers.keyId])
      .update(canonical)
      .digest();
    const received = Buffer.from(headers.signature, "hex");
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      throw new UnauthorizedException("Invalid safety service credential");
    }

    const nonceHash = createHash("sha256").update(headers.nonce).digest("hex");
    try {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.safetyServiceNonce.create({
            data: {
              serviceId: headers.serviceId,
              keyId: headers.keyId,
              nonceHash,
              expiresAt: new Date(
                (timestampSeconds + NONCE_RETENTION_SECONDS) * 1000,
              ),
            },
          });
          await tx.$executeRaw`
          DELETE FROM safety_service_nonces
          WHERE (service_id, key_id, nonce_hash) IN (
            SELECT service_id, key_id, nonce_hash
            FROM safety_service_nonces
            WHERE expires_at < CURRENT_TIMESTAMP
            ORDER BY expires_at ASC
            LIMIT 250
          )
        `;
        },
        { maxWait: 1_000, timeout: 3_000 },
      );
    } catch (error) {
      const errorCode =
        error && typeof error === "object"
          ? (error as Record<string, unknown>).code
          : undefined;
      if (errorCode === "P2002") {
        throw new UnauthorizedException("Safety request replay detected");
      }
      throw new ServiceUnavailableException(
        "Safety request replay protection is unavailable",
      );
    }

    return {
      id: headers.serviceId,
      audience: headers.audience,
      scope: headers.scope,
    };
  }

  private canonicalJson(value: unknown): string {
    if (Array.isArray(value))
      return `[${value.map((entry) => this.canonicalJson(entry)).join(",")}]`;
    if (value && typeof value === "object") {
      const object = value as Record<string, unknown>;
      const keys = Object.keys(object).sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${this.canonicalJson(object[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }
}
