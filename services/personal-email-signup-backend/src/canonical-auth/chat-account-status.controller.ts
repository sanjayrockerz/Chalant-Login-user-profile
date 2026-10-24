import { createHmac, timingSafeEqual } from "crypto";
import {
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "../config/config.service";
import { CanonicalAuthService } from "./canonical-auth.service";

const MAX_CLOCK_SKEW_SECONDS = 60;

@Controller("internal/v1/chat-account-status")
export class ChatAccountStatusController {
  constructor(
    private readonly auth: CanonicalAuthService,
    private readonly config: ConfigService,
  ) {}

  @Get(":authUserId")
  async getStatus(
    @Param("authUserId", new ParseUUIDPipe()) authUserId: string,
    @Headers("x-chat-status-timestamp") timestamp: string,
    @Headers("x-chat-status-signature") signature: string,
  ) {
    const secret = this.config.get("CHAT_PROFILE_PROVISIONING_HMAC_SECRET");
    const timestampSeconds = Number(timestamp);
    if (
      !secret ||
      secret.length < 32 ||
      !Number.isSafeInteger(timestampSeconds) ||
      Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) >
        MAX_CLOCK_SKEW_SECONDS
    ) {
      throw new UnauthorizedException("Invalid Chat status request");
    }

    const path = `/internal/v1/chat-account-status/${authUserId}`;
    const expected = createHmac("sha256", secret)
      .update(`${timestampSeconds}.GET.${path}`)
      .digest();
    let received: Buffer;
    try {
      received = Buffer.from(signature, "hex");
    } catch {
      throw new UnauthorizedException("Invalid Chat status request");
    }
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      throw new UnauthorizedException("Invalid Chat status request");
    }

    return this.auth.getAccountStatusForChat(authUserId);
  }
}
