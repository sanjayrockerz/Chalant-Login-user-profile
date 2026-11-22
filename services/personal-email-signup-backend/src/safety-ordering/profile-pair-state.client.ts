import {
  Injectable,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import * as jwt from "jsonwebtoken";
import { ConfigService } from "../config/config.service";

export interface AuthoritativeProfilePairState {
  userA: string;
  userB: string;
  aBlockedB: boolean;
  bBlockedA: boolean;
  pairRevision: string;
  readConsistency: "PRIMARY";
  mappingIdentityHash: string;
}

@Injectable()
export class ProfilePairStateClient {
  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async readPairState(
    subjectA: string,
    subjectB: string,
  ): Promise<AuthoritativeProfilePairState> {
    const userA = subjectA.toLowerCase();
    const userB = subjectB.toLowerCase();
    const baseUrl = this.config.get("PROFILE_PAIR_STATE_URL")?.trim();
    const privateKey = this.config
      .get("PROFILE_PAIR_STATE_JWT_PRIVATE_KEY")
      ?.replace(/\\n/g, "\n")
      .trim();
    if (!baseUrl || !privateKey || userA === userB) {
      throw new ServiceUnavailableException(
        "Authoritative Profile pair-state access is not configured",
      );
    }

    const url = new URL("/api/v1/internal/v1/blocks/pair-state", baseUrl);
    url.searchParams.set("userA", userA);
    url.searchParams.set("userB", userB);
    const token = jwt.sign(
      {
        act: userA,
        scope: ["blocks:state:read"],
      },
      privateKey,
      {
        algorithm: "RS256",
        issuer: "chalant-service-auth",
        audience: "user-profile-social",
        subject: "auth-safety-ordering",
        expiresIn: 60,
        jwtid: randomUUID(),
      },
    );

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      throw new ServiceUnavailableException(
        "Authoritative Profile pair-state read failed",
      );
    }
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Authoritative Profile pair-state returned HTTP ${response.status}`,
      );
    }

    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new ServiceUnavailableException(
        "Authoritative Profile pair-state response is invalid",
      );
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ServiceUnavailableException(
        "Authoritative Profile pair-state response is invalid",
      );
    }
    const state = value as Record<string, unknown>;
    if (
      state.userA !== userA ||
      state.userB !== userB ||
      typeof state.aBlockedB !== "boolean" ||
      typeof state.bBlockedA !== "boolean" ||
      typeof state.pairRevision !== "string" ||
      !/^\d+$/.test(state.pairRevision) ||
      state.readConsistency !== "PRIMARY" ||
      typeof state.mappingIdentityHash !== "string" ||
      !/^[a-f0-9]{64}$/i.test(state.mappingIdentityHash)
    ) {
      throw new ServiceUnavailableException(
        "Authoritative Profile pair-state or identity mapping is incomplete",
      );
    }
    return state as unknown as AuthoritativeProfilePairState;
  }
}
