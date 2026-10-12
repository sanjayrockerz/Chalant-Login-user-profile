import { CanonicalPrincipal } from "../identity/identity.types";

export interface RegisterPasswordInput {
  readonly email: string;
  readonly username: string;
  readonly password: string;
}

export interface PasswordLoginInput {
  readonly email: string;
  readonly password: string;
}

export interface SessionTokens {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_in: number;
}

export interface AuthenticatedResponse extends SessionTokens {
  readonly user: CanonicalPrincipal;
}

export interface RequestWithPrincipal {
  user?: CanonicalPrincipal;
  sessionId?: string;
  headers: Record<string, string | string[] | undefined>;
}

export interface AuthenticatedSessionContext {
  principal: CanonicalPrincipal;
  sessionId: string;
}
