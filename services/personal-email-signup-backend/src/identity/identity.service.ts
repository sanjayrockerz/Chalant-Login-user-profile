import { Inject, Injectable } from "@nestjs/common";
import {
  IdentityProvider,
  LegacyIdentitySource,
  UserAccountStatus,
} from "@prisma/client";
import {
  IdentityNotFoundError,
  IdentityValidationError,
  UnauthorizedIdentityLinkError,
} from "./identity.errors";
import { IdentityRepositoryPort } from "./identity.repository";
import {
  CanonicalPrincipal,
  CanonicalUserId,
  CreateCanonicalUserInput,
  CreateLegacyMappingInput,
  LinkProviderIdentityInput,
  ProviderIdentityKey,
  toCanonicalUserId,
} from "./identity.types";

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new IdentityValidationError(`${field} is required`);
  return normalized;
}

@Injectable()
export class IdentityService {
  constructor(
    @Inject("IdentityRepositoryPort")
    private readonly repository: IdentityRepositoryPort,
  ) {}

  async createCanonicalUser(
    input: CreateCanonicalUserInput,
  ): Promise<CanonicalPrincipal> {
    const username = requireText(input.username, "username");
    const email = requireText(input.email, "email").toLowerCase();
    const passwordHash = requireText(input.passwordHash, "passwordHash");
    const user = await this.repository.createUser(
      username,
      email,
      passwordHash,
    );
    return this.toPrincipal(user);
  }

  async getCanonicalPrincipal(userId: string): Promise<CanonicalPrincipal> {
    const canonicalUserId = this.parseUserId(userId);
    const user = await this.repository.findUserById(canonicalUserId);
    if (!user) throw new IdentityNotFoundError("Canonical user was not found");
    return this.toPrincipal(user);
  }

  async createProviderUser(input: {
    username: string;
    email: string;
    identity: ProviderIdentityKey;
    displayName?: string;
  }): Promise<CanonicalPrincipal> {
    const username = requireText(input.username, "username");
    const email = requireText(input.email, "email").toLowerCase();
    const displayName = input.displayName?.trim();
    if (displayName && displayName.length > 255) {
      throw new IdentityValidationError("displayName is too long");
    }
    this.validateProviderIdentity(input.identity);
    if (input.identity.provider === IdentityProvider.PASSWORD) {
      throw new IdentityValidationError(
        "Password users must be created through the password credential flow",
      );
    }
    const user = await this.repository.createProviderUser(
      username,
      email,
      input.identity,
      displayName,
    );
    return this.toPrincipal(user);
  }

  async setDisplayNameIfMissing(
    userId: CanonicalUserId,
    displayName: string,
  ): Promise<void> {
    const normalized = requireText(displayName, "displayName");
    if (normalized.length > 255) {
      throw new IdentityValidationError("displayName is too long");
    }
    await this.repository.setDisplayNameIfMissing(userId, normalized);
  }

  async findByProviderIdentity(
    identity: ProviderIdentityKey,
  ): Promise<CanonicalPrincipal | null> {
    this.validateProviderIdentity(identity);
    const user = await this.repository.findByProviderIdentity(identity);
    return user ? this.toPrincipal(user) : null;
  }

  async linkProviderIdentity(input: LinkProviderIdentityInput): Promise<void> {
    if (
      input.authorization.actorUserId !== input.targetUserId ||
      !input.authorization.reauthenticated
    ) {
      throw new UnauthorizedIdentityLinkError(
        "Fresh authentication by the target user is required",
      );
    }
    this.validateProviderIdentity(input.identity);
    const target = await this.repository.findUserById(input.targetUserId);
    if (!target)
      throw new IdentityNotFoundError("Target canonical user was not found");
    await this.repository.linkProviderIdentity(
      input.targetUserId,
      input.identity,
    );
  }

  async findLegacyMapping(
    source: LegacyIdentitySource,
    originalId: string,
  ): Promise<CanonicalUserId | null> {
    const normalizedId = requireText(originalId, "originalId");
    return this.repository.findLegacyMapping(source, normalizedId);
  }

  async createLegacyMapping(input: CreateLegacyMappingInput): Promise<void> {
    const originalId = requireText(input.originalId, "originalId");
    await this.repository.findUserById(input.targetUserId).then((user) => {
      if (!user)
        throw new IdentityNotFoundError("Target canonical user was not found");
    });
    await this.repository.createLegacyMapping(
      input.targetUserId,
      input.source,
      originalId,
    );
  }

  private parseUserId(value: string): CanonicalUserId {
    try {
      return toCanonicalUserId(value);
    } catch (error: unknown) {
      throw new IdentityValidationError(
        error instanceof Error ? error.message : "Invalid canonical user ID",
      );
    }
  }

  private validateProviderIdentity(identity: ProviderIdentityKey): void {
    if (
      ![
        IdentityProvider.GOOGLE,
        IdentityProvider.APPLE,
        IdentityProvider.PASSWORD,
      ].includes(identity.provider)
    ) {
      throw new IdentityValidationError("Unsupported identity provider");
    }
    requireText(identity.issuer, "issuer");
    requireText(identity.subject, "subject");
  }

  private toPrincipal(user: {
    id: string;
    username: string;
    email: string;
    isVerified: boolean;
    accountStatus: UserAccountStatus;
  }): CanonicalPrincipal {
    return {
      subject: toCanonicalUserId(user.id),
      accountStatus: user.accountStatus,
      email: user.email,
      username: user.username,
      emailVerified: user.isVerified,
    };
  }
}
