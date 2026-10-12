export const GOOGLE_OIDC_CLIENT = "GOOGLE_OIDC_CLIENT";

export interface GoogleOidcClient {
  generateAuthUrl(options: Record<string, string>): string;
  getToken(options: {
    code: string;
    codeVerifier: string;
  }): Promise<{ tokens: { id_token?: string } }>;
  verifyIdToken(options: {
    idToken: string;
    audience: string;
  }): Promise<{ getPayload(): GoogleIdTokenClaims | undefined }>;
}

export interface GoogleIdTokenClaims {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  azp?: string;
  email?: string;
  email_verified?: boolean;
  nonce?: string;
  exp?: number;
}

export interface GoogleOAuthState {
  nonce: string;
  codeVerifier: string;
  createdAt: number;
  purpose?: "sign_in" | "link";
  userId?: string;
  sessionId?: string;
}
