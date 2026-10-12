/**
 * Phase 0 authentication quarantine.
 *
 * R3 does not yet have an authoritative identity implementation. This guard
 * therefore fails closed instead of accepting a token through a placeholder
 * validation path. Phase 1 must replace this seam with the approved identity
 * adapter and retain the same deny-by-default behavior for invalid sessions.
 */

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { CanonicalAuthService } from "../canonical-auth/canonical-auth.service";
import { RequestWithPrincipal } from "../canonical-auth/canonical-auth.types";

/**
 * JWT authentication guard
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Optional() private readonly sessions?: CanonicalAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.sessions) {
      throw new ServiceUnavailableException(
        "Canonical authentication is unavailable",
      );
    }
    const request = context.switchToHttp().getRequest<RequestWithPrincipal>();
    const header = request.headers.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer ")) {
      throw new UnauthorizedException("Authentication required");
    }
    const sessionContext = await this.sessions.authenticateAccessTokenContext(
      header.slice(7),
    );
    request.user = sessionContext.principal;
    request.sessionId = sessionContext.sessionId;
    return true;
  }
}
