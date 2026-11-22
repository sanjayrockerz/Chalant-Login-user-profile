import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from "@nestjs/common";
import { CanonicalAuthService } from "./canonical-auth.service";
import {
  InternalServiceCredentialVerifier,
  TokenValidationRequest,
} from "./internal-service-credential-verifier";

@Controller("internal")
export class InternalTokenValidationController {
  constructor(
    private readonly auth: CanonicalAuthService,
    private readonly credentials: InternalServiceCredentialVerifier,
  ) {}

  @Post("v1/auth/token/validate")
  @HttpCode(HttpStatus.OK)
  async validate(
    @Body() body: TokenValidationRequest,
    @Headers("x-auth-service-id") serviceId: string,
    @Headers("x-auth-key-id") keyId: string,
    @Headers("x-auth-timestamp") timestamp: string,
    @Headers("x-auth-signature") signature: string,
  ) {
    if (
      !body ||
      typeof body.token !== "string" ||
      body.token.length === 0 ||
      body.token.length > 8192 ||
      body.token.trim() !== body.token ||
      typeof body.audience !== "string" ||
      typeof body.scope !== "string"
    ) {
      throw new BadRequestException("Invalid token validation request");
    }

    const service = this.credentials.verify(body, {
      serviceId,
      keyId,
      timestamp,
      signature,
    });
    const verified = await this.auth.authenticateAccessTokenContext(body.token);

    return {
      contractVersion: 1 as const,
      subject: verified.principal.subject,
      sessionId: verified.sessionId,
      accountStatus: verified.principal.accountStatus,
      emailVerified: verified.principal.emailVerified,
      accessTokenExpiresAt: verified.accessTokenExpiresAt,
      service,
    };
  }

  @Post("v2/auth/token/validate")
  @HttpCode(HttpStatus.OK)
  async validateV2(
    @Body() body: TokenValidationRequest,
    @Headers("x-auth-service-id") serviceId: string,
    @Headers("x-auth-key-id") keyId: string,
    @Headers("x-auth-timestamp") timestamp: string,
    @Headers("x-auth-nonce") nonce: string,
    @Headers("x-auth-signature") signature: string,
  ) {
    if (
      !body ||
      typeof body.token !== "string" ||
      body.token.length === 0 ||
      body.token.length > 8192 ||
      body.token.trim() !== body.token ||
      typeof body.audience !== "string" ||
      typeof body.scope !== "string" ||
      Object.keys(body).some(
        (key) => !["token", "audience", "scope"].includes(key),
      )
    ) {
      throw new BadRequestException("Invalid token validation request");
    }

    const service = await this.credentials.verifyV2(body, {
      serviceId,
      keyId,
      timestamp,
      nonce,
      signature,
    });
    const verified =
      body.audience === "chat-backend"
        ? await this.auth.authenticateChatAccessTokenContext(body.token)
        : await this.auth.authenticateAccessTokenContext(body.token);

    return {
      contractVersion: 2 as const,
      subject: verified.principal.subject,
      sessionId: verified.sessionId,
      accountStatus: verified.principal.accountStatus,
      emailVerified: verified.principal.emailVerified,
      accessTokenExpiresAt: verified.accessTokenExpiresAt,
      ...("tokenId" in verified ? { tokenId: verified.tokenId } : {}),
      service,
    };
  }
}
