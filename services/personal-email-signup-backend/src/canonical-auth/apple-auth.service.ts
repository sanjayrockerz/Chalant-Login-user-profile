import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { IdentityProvider } from "@prisma/client";
import { createHash, randomBytes } from "crypto";
import { ConfigService } from "../config/config.service";
import { IdentityService } from "../identity/identity.service";
import { IdentityConflictError } from "../identity/identity.errors";
import { RedisService } from "../redis/redis.service";
import { CanonicalAuthService } from "./canonical-auth.service";
import { usernameForProvider } from "./provider-user.util";
import { toCanonicalUserId } from "../identity/identity.types";
import {
  APPLE_OIDC_CLIENT,
  AppleIdTokenClaims,
  AppleOAuthState,
  AppleOidcClient,
  AppleUserPayload,
} from "./apple-oidc.types";

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_STATE_PREFIX = "oauth:apple:state:";

function stateKey(state: string): string {
  return `${APPLE_STATE_PREFIX}${createHash("sha256").update(state).digest("hex")}`;
}

function verifiedEmail(claims: AppleIdTokenClaims): string | undefined {
  const verified =
    claims.email_verified === true || claims.email_verified === "true";
  return verified && claims.email ? claims.email.toLowerCase() : undefined;
}

function parseDisplayName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let user: AppleUserPayload;
  try {
    user = JSON.parse(raw) as AppleUserPayload;
  } catch {
    throw new BadRequestException("Apple profile data is invalid");
  }
  const first = user.name?.firstName?.trim() || "";
  const last = user.name?.lastName?.trim() || "";
  const name = `${first} ${last}`.trim();
  if (name.length > 255)
    throw new BadRequestException("Apple profile data is invalid");
  return name || undefined;
}

function validateClaims(
  claims: AppleIdTokenClaims,
  nonce: string,
  clientId: string,
) {
  if (
    claims.iss !== APPLE_ISSUER ||
    claims.aud !== clientId ||
    !claims.sub ||
    claims.exp <= Math.floor(Date.now() / 1000) ||
    claims.nonce !== nonce
  ) {
    throw new UnauthorizedException("Apple identity could not be verified");
  }
  return { subject: claims.sub, email: verifiedEmail(claims) };
}

@Injectable()
export class AppleAuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly identities: IdentityService,
    private readonly sessions: CanonicalAuthService,
    @Inject(APPLE_OIDC_CLIENT) private readonly oidc: AppleOidcClient,
  ) {}

  async begin(): Promise<{ authorization_url: string }> {
    return this.beginTransaction();
  }

  async beginLink(
    userId: string,
    sessionId: string,
  ): Promise<{ authorization_url: string }> {
    await this.sessions.requireRecentSession(userId, sessionId);
    return this.beginTransaction({ purpose: "link", userId, sessionId });
  }

  private async beginTransaction(
    context?: Pick<AppleOAuthState, "purpose" | "userId" | "sessionId">,
  ): Promise<{ authorization_url: string }> {
    const settings = this.settings();
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const transaction: AppleOAuthState = {
      nonce,
      createdAt: Date.now(),
      ...context,
    };
    await this.redis.set(stateKey(state), transaction, {
      ttl: this.config.get("APPLE_OIDC_STATE_TTL_SECONDS"),
    });
    return {
      authorization_url: this.oidc.generateAuthUrl({
        client_id: settings.clientId,
        redirect_uri: settings.redirectUri,
        response_type: "code id_token",
        response_mode: "form_post",
        scope: "name email",
        state,
        nonce,
      }),
    };
  }

  async callback(input: {
    code?: string;
    state?: string;
    id_token?: string;
    user?: string;
    error?: string;
  }) {
    const settings = this.settings();
    if (input.error)
      throw new UnauthorizedException("Apple authentication was cancelled");
    if (!input.code || !input.state)
      throw new UnauthorizedException("Invalid Apple callback");
    const transaction = await this.redis.getAndDelete<AppleOAuthState>(
      stateKey(input.state),
    );
    if (
      !transaction ||
      Date.now() - transaction.createdAt >
        this.config.get("APPLE_OIDC_STATE_TTL_SECONDS") * 1000
    ) {
      throw new UnauthorizedException("Invalid or expired Apple callback");
    }
    try {
      const tokenResponse = await this.oidc.exchangeCode(input.code);
      const tokenClaims = validateClaims(
        await this.oidc.verifyIdToken(tokenResponse.id_token),
        transaction.nonce,
        settings.clientId,
      );
      if (input.id_token) {
        const frontClaims = validateClaims(
          await this.oidc.verifyIdToken(input.id_token),
          transaction.nonce,
          settings.clientId,
        );
        if (
          frontClaims.subject !== tokenClaims.subject ||
          (frontClaims.email &&
            tokenClaims.email &&
            frontClaims.email !== tokenClaims.email)
        ) {
          throw new UnauthorizedException(
            "Apple identity could not be verified",
          );
        }
      }
      const displayName = parseDisplayName(input.user);
      const providerIdentity = {
        provider: IdentityProvider.APPLE,
        issuer: APPLE_ISSUER,
        subject: tokenClaims.subject,
      } as const;
      if (transaction.purpose === "link") {
        if (!transaction.userId || !transaction.sessionId) {
          throw new UnauthorizedException("Invalid linking transaction");
        }
        await this.sessions.requireRecentSession(
          transaction.userId,
          transaction.sessionId,
        );
        await this.identities.linkProviderIdentity({
          targetUserId: toCanonicalUserId(transaction.userId),
          identity: providerIdentity,
          authorization: {
            actorUserId: toCanonicalUserId(transaction.userId),
            reauthenticated: true,
          },
        });
        return { status: "linked", provider: "APPLE" };
      }
      let principal =
        await this.identities.findByProviderIdentity(providerIdentity);
      if (!principal) {
        if (!tokenClaims.email) {
          throw new UnauthorizedException(
            "Apple email is required for first sign-in",
          );
        }
        try {
          principal = await this.identities.createProviderUser({
            username: usernameForProvider(
              tokenClaims.email,
              tokenClaims.subject,
            ),
            email: tokenClaims.email,
            identity: providerIdentity,
            displayName,
          });
        } catch (error) {
          if (error instanceof IdentityConflictError) {
            principal =
              await this.identities.findByProviderIdentity(providerIdentity);
            if (!principal) {
              throw new ConflictException(
                "Apple account requires explicit account linking",
              );
            }
          }
          if (!principal) throw error;
        }
      } else if (displayName) {
        await this.identities.setDisplayNameIfMissing(
          principal.subject,
          displayName,
        );
      }
      if (principal.accountStatus !== "ACTIVE") {
        throw new UnauthorizedException("Account is not active");
      }
      return {
        ...(await this.sessions.issueSession(principal)),
        user: principal,
      };
    } catch (error) {
      if (error instanceof IdentityConflictError) {
        throw new ConflictException("Provider identity is already linked");
      }
      if (
        error instanceof UnauthorizedException ||
        error instanceof ConflictException ||
        error instanceof BadRequestException
      )
        throw error;
      throw new UnauthorizedException("Apple authentication failed");
    }
  }

  private settings(): { clientId: string; redirectUri: string } {
    if (!this.config.get("APPLE_OIDC_ENABLED")) {
      throw new ServiceUnavailableException("Apple authentication is disabled");
    }
    const clientId = this.config.get("APPLE_CLIENT_ID");
    const redirectUri = this.config.get("APPLE_REDIRECT_URI");
    if (
      !clientId ||
      !redirectUri ||
      !this.config.get("APPLE_TEAM_ID") ||
      !this.config.get("APPLE_KEY_ID")
    ) {
      throw new ServiceUnavailableException(
        "Apple authentication is not configured",
      );
    }
    const url = new URL(redirectUri);
    if (
      url.protocol !== "https:" ||
      url.hostname === "localhost" ||
      /^[0-9.]+$/.test(url.hostname)
    ) {
      throw new ServiceUnavailableException(
        "Apple requires a registered HTTPS domain callback",
      );
    }
    if (
      !this.config.get("APPLE_PRIVATE_KEY") &&
      !this.config.get("APPLE_PRIVATE_KEY_FILE")
    ) {
      throw new ServiceUnavailableException(
        "Apple private signing key is unavailable",
      );
    }
    return { clientId, redirectUri };
  }
}
