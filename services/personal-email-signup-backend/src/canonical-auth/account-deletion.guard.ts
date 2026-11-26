import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { CanonicalAuthService } from "./canonical-auth.service";
import { AccountDeletionService } from "./account-deletion.service";
import { RequestWithPrincipal } from "./canonical-auth.types";

const ACCESS_TOKEN_TYPE = "canonical-access";
const ISSUER = "r3-canonical-identity";
const AUDIENCE = "r3-api";

@Injectable()
export class AccountDeletionGuard implements CanActivate {
  constructor(
    private readonly auth: CanonicalAuthService,
    private readonly deletion: AccountDeletionService,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithPrincipal>();
    const authorization = request.headers.authorization;
    const operationId = request.headers["idempotency-key"];
    if (
      typeof authorization !== "string" ||
      !authorization.startsWith("Bearer ")
    ) {
      throw new UnauthorizedException("Authentication required");
    }
    const token = authorization.slice(7);
    try {
      const session = await this.auth.authenticateAccessTokenContext(token);
      request.user = session.principal;
      request.sessionId = session.sessionId;
      return true;
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) throw error;
    }

    // A cryptographically valid but revoked access token may only repeat the
    // exact irreversible deletion operation. It cannot authorize account use.
    let claims: { sub?: string; sid?: string; typ?: string };
    try {
      claims = this.jwt.verify<{ sub?: string; sid?: string; typ?: string }>(
        token,
        {
          issuer: ISSUER,
          audience: AUDIENCE,
          algorithms: ["HS256"],
          // This fallback exposes only the matching deletion's non-sensitive
          // status. Signature and exact tombstone/operation binding remain
          // mandatory; it never authorizes account activity.
          ignoreExpiration: true,
        },
      );
    } catch {
      throw new UnauthorizedException("Invalid access token");
    }
    if (
      claims.typ !== ACCESS_TOKEN_TYPE ||
      typeof claims.sub !== "string" ||
      typeof claims.sid !== "string" ||
      typeof operationId !== "string"
    )
      throw new UnauthorizedException("Invalid account deletion retry");
    try {
      if (!(await this.deletion.getAcceptedRetry(claims.sub, operationId))) {
        throw new UnauthorizedException("Invalid account deletion retry");
      }
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException("Invalid account deletion retry");
    }
    request.deletionRetrySubject = claims.sub;
    return true;
  }
}
