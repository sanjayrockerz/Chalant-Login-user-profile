import { Injectable } from "@nestjs/common";
import {
  LegacyIdentitySource,
  Prisma,
  UserAccountStatus,
} from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.module";
import { IdentityConflictError } from "./identity.errors";
import { CanonicalUserId, ProviderIdentityKey } from "./identity.types";

export interface IdentityUserRecord {
  id: string;
  username: string;
  email: string;
  isVerified: boolean;
  accountStatus: UserAccountStatus;
}

export interface IdentityRepositoryPort {
  createUser(
    username: string,
    email: string,
    passwordHash: string,
  ): Promise<IdentityUserRecord>;
  createProviderUser(
    username: string,
    email: string,
    provider: ProviderIdentityKey,
    displayName?: string,
  ): Promise<IdentityUserRecord>;
  setDisplayNameIfMissing(
    userId: CanonicalUserId,
    displayName: string,
  ): Promise<void>;
  findUserById(userId: CanonicalUserId): Promise<IdentityUserRecord | null>;
  findByProviderIdentity(
    identity: ProviderIdentityKey,
  ): Promise<IdentityUserRecord | null>;
  linkProviderIdentity(
    userId: CanonicalUserId,
    identity: ProviderIdentityKey,
  ): Promise<void>;
  findLegacyMapping(
    source: LegacyIdentitySource,
    originalId: string,
  ): Promise<CanonicalUserId | null>;
  createLegacyMapping(
    userId: CanonicalUserId,
    source: LegacyIdentitySource,
    originalId: string,
  ): Promise<void>;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function toRecord(user: {
  id: string;
  username: string;
  email: string;
  isVerified: boolean;
  accountStatus: UserAccountStatus;
}): IdentityUserRecord {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    isVerified: user.isVerified,
    accountStatus: user.accountStatus,
  };
}

@Injectable()
export class PrismaIdentityRepository implements IdentityRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async createUser(
    username: string,
    email: string,
    passwordHash: string,
  ): Promise<IdentityUserRecord> {
    try {
      const user = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.user.create({
          data: {
            username,
            email,
            password: passwordHash,
            accountStatus: UserAccountStatus.ACTIVE,
            passwordCredential: { create: { passwordHash } },
          },
        });
        return created;
      });
      return toRecord(user);
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new IdentityConflictError(
          "Canonical user identity conflicts with an existing user",
        );
      }
      throw error;
    }
  }

  async createProviderUser(
    username: string,
    email: string,
    provider: ProviderIdentityKey,
    displayName?: string,
  ): Promise<IdentityUserRecord> {
    try {
      const user = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.user.create({
          data: {
            username,
            email,
            password: null,
            isVerified: true,
            accountStatus: UserAccountStatus.ACTIVE,
            ...(displayName ? { displayName } : {}),
            identityLinks: {
              create: {
                provider: provider.provider,
                issuer: provider.issuer,
                subject: provider.subject,
              },
            },
          },
        });
        return created;
      });
      return toRecord(user);
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new IdentityConflictError(
          "Canonical user identity conflicts with an existing user",
        );
      }
      throw error;
    }
  }

  async setDisplayNameIfMissing(
    userId: CanonicalUserId,
    displayName: string,
  ): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id: userId, displayName: null },
      data: { displayName },
    });
  }

  async findUserById(
    userId: CanonicalUserId,
  ): Promise<IdentityUserRecord | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        isVerified: true,
        accountStatus: true,
      },
    });
    return user ? toRecord(user) : null;
  }

  async findByProviderIdentity(
    identity: ProviderIdentityKey,
  ): Promise<IdentityUserRecord | null> {
    const link = await this.prisma.userIdentity.findUnique({
      where: {
        issuer_subject: { issuer: identity.issuer, subject: identity.subject },
      },
      select: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            isVerified: true,
            accountStatus: true,
          },
        },
      },
    });
    return link ? toRecord(link.user) : null;
  }

  async linkProviderIdentity(
    userId: CanonicalUserId,
    identity: ProviderIdentityKey,
  ): Promise<void> {
    try {
      await this.prisma.userIdentity.create({
        data: {
          userId,
          provider: identity.provider,
          issuer: identity.issuer,
          subject: identity.subject,
        },
      });
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        const existing = await this.prisma.userIdentity.findUnique({
          where: {
            issuer_subject: {
              issuer: identity.issuer,
              subject: identity.subject,
            },
          },
          select: { userId: true, provider: true },
        });
        if (
          existing?.userId === userId &&
          existing.provider === identity.provider
        )
          return;
        throw new IdentityConflictError("Provider identity is already linked");
      }
      throw error;
    }
  }

  async findLegacyMapping(
    source: LegacyIdentitySource,
    originalId: string,
  ): Promise<CanonicalUserId | null> {
    const mapping = await this.prisma.legacyIdentityMapping.findUnique({
      where: { source_originalId: { source, originalId } },
      select: { userId: true },
    });
    return mapping ? (mapping.userId as CanonicalUserId) : null;
  }

  async createLegacyMapping(
    userId: CanonicalUserId,
    source: LegacyIdentitySource,
    originalId: string,
  ): Promise<void> {
    try {
      await this.prisma.legacyIdentityMapping.create({
        data: { userId, source, originalId },
      });
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        const existing = await this.prisma.legacyIdentityMapping.findUnique({
          where: { source_originalId: { source, originalId } },
          select: { userId: true },
        });
        if (existing?.userId === userId) return;
        throw new IdentityConflictError(
          "Legacy identity mapping already exists",
        );
      }
      throw error;
    }
  }
}
