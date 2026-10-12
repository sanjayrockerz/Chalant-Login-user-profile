import {
  IdentityProvider,
  LegacyIdentitySource,
  UserAccountStatus,
} from "@prisma/client";

export type CanonicalUserId = string & {
  readonly __canonicalUserId: unique symbol;
};

export function toCanonicalUserId(value: string): CanonicalUserId {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(value)) {
    throw new Error("Canonical user ID must be a UUID");
  }
  return value as CanonicalUserId;
}

export interface CanonicalPrincipal {
  readonly subject: CanonicalUserId;
  readonly accountStatus: UserAccountStatus;
  readonly email: string;
  readonly username: string;
  readonly emailVerified: boolean;
}

export interface CreateCanonicalUserInput {
  readonly username: string;
  readonly email: string;
  readonly passwordHash: string;
}

export interface ProviderIdentityKey {
  readonly provider: IdentityProvider;
  readonly issuer: string;
  readonly subject: string;
}

export interface IdentityLinkAuthorization {
  readonly actorUserId: CanonicalUserId;
  readonly reauthenticated: boolean;
}

export interface LegacyIdentityLookup {
  readonly source: LegacyIdentitySource;
  readonly originalId: string;
}

export interface LinkProviderIdentityInput {
  readonly targetUserId: CanonicalUserId;
  readonly identity: ProviderIdentityKey;
  readonly authorization: IdentityLinkAuthorization;
}

export interface CreateLegacyMappingInput extends LegacyIdentityLookup {
  readonly targetUserId: CanonicalUserId;
}
