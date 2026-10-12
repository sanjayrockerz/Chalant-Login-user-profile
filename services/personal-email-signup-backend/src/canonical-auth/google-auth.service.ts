import {
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
import { CanonicalAuthService } from "./canonical-auth.service";
import {
  GOOGLE_OIDC_CLIENT,
  GoogleIdTokenClaims,
  GoogleOAuthState,
  GoogleOidcClient,
} from "./google-oidc.types";
import { RedisService } from "../redis/redis.service";
import { usernameForProvider } from "./provider-user.util";
import { toCanonicalUserId } from "../identity/identity.types";

const GOOGLE_ISSUER = "https://accounts.google.com";
const GOOGLE_STATE_PREFIX = "oauth:google:state:";

function stateKey(state: string): string {
  return `${GOOGLE_STATE_PREFIX}${createHash("sha256").update(state).digest("hex")}`;
}

function requireClaims(
  payload: GoogleIdTokenClaims | undefined,
  expectedNonce: string,
  clientId: string,
) {
  if (!payload || payload.iss !== GOOGLE_ISSUER || payload.sub === undefined) {
    throw new UnauthorizedException("Google identity could not be verified");
  }
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(clientId) || payload.nonce !== expectedNonce) {
    throw new UnauthorizedException("Google identity could not be verified");
  }
  if (!payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new UnauthorizedException("Google identity could not be verified");
  }
  if (!payload.email || payload.email_verified !== true) {
    throw new UnauthorizedException("A verified Google email is required");
  }
  return {
    subject: payload.sub,
    email: payload.email.toLowerCase(),
  };
}

@Injectable()
export class GoogleAuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly identities: IdentityService,
    private readonly sessions: CanonicalAuthService,
    @Inject(GOOGLE_OIDC_CLIENT) private readonly oidc: GoogleOidcClient,
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
    context?: Pick<GoogleOAuthState, "purpose" | "userId" | "sessionId">,
  ): Promise<{ authorization_url: string }> {
    const settings = this.settings();
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(48).toString("base64url");
    const codeChallenge = createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    const transaction: GoogleOAuthState = {
      nonce,
      codeVerifier,
      createdAt: Date.now(),
      ...context,
    };
    await this.redis.set(stateKey(state), transaction, {
      ttl: this.config.get("GOOGLE_OIDC_STATE_TTL_SECONDS"),
    });
    return {
      authorization_url: this.oidc.generateAuthUrl({
        client_id: settings.clientId,
        redirect_uri: settings.redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      }),
    };
  }

  async callback(code: string, state: string) {
    const settings = this.settings();
    if (!code || !state)
      throw new UnauthorizedException("Invalid Google callback");
    const transaction = await this.redis.getAndDelete<GoogleOAuthState>(
      stateKey(state),
    );
    if (
      !transaction ||
      Date.now() - transaction.createdAt >
        this.config.get("GOOGLE_OIDC_STATE_TTL_SECONDS") * 1000
    ) {
      throw new UnauthorizedException("Invalid or expired Google callback");
    }
    let idToken: string | undefined;
    try {
      idToken = (
        await this.oidc.getToken({
          code,
          codeVerifier: transaction.codeVerifier,
        })
      ).tokens.id_token;
      if (!idToken) throw new Error("Google did not return an ID token");
      const verified = await this.oidc.verifyIdToken({
        idToken,
        audience: settings.clientId,
      });
      const identity = requireClaims(
        verified.getPayload(),
        transaction.nonce,
        settings.clientId,
      );
      const providerIdentity = {
        provider: IdentityProvider.GOOGLE,
        issuer: GOOGLE_ISSUER,
        subject: identity.subject,
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
        return { status: "linked", provider: "GOOGLE" };
      }
      let principal =
        await this.identities.findByProviderIdentity(providerIdentity);
      if (!principal) {
        try {
          principal = await this.identities.createProviderUser({
            username: usernameForProvider(identity.email, identity.subject),
            email: identity.email,
            identity: providerIdentity,
          });
        } catch (error) {
          if (error instanceof IdentityConflictError) {
            principal =
              await this.identities.findByProviderIdentity(providerIdentity);
            if (!principal) {
              throw new ConflictException(
                "Google account requires explicit account linking",
              );
            }
          }
          if (!principal) throw error;
        }
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
        error instanceof ConflictException
      )
        throw error;
      throw new UnauthorizedException("Google authentication failed");
    }
  }

  private settings(): { clientId: string; redirectUri: string } {
    if (!this.config.get("GOOGLE_OIDC_ENABLED")) {
      throw new ServiceUnavailableException(
        "Google authentication is disabled",
      );
    }
    const clientId = this.config.get("GOOGLE_CLIENT_ID");
    const redirectUri = this.config.get("GOOGLE_REDIRECT_URI");
    if (!clientId || !redirectUri || !this.config.get("GOOGLE_CLIENT_SECRET")) {
      throw new ServiceUnavailableException(
        "Google authentication is not configured",
      );
    }
    return { clientId, redirectUri };
  }
}
