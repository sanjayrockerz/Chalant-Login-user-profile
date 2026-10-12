export const APPLE_OIDC_CLIENT = "APPLE_OIDC_CLIENT";

export interface AppleOidcClient {
  generateAuthUrl(options: Record<string, string>): string;
  createClientSecret(): string;
  exchangeCode(code: string): Promise<{ id_token: string }>;
  verifyIdToken(idToken: string): Promise<AppleIdTokenClaims>;
}

export interface AppleIdTokenClaims {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat?: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
  is_private_email?: boolean | string;
}

export interface AppleOAuthState {
  nonce: string;
  createdAt: number;
  purpose?: "sign_in" | "link";
  userId?: string;
  sessionId?: string;
}

export interface AppleUserPayload {
  name?: {
    firstName?: string;
    lastName?: string;
  };
  email?: string;
}
