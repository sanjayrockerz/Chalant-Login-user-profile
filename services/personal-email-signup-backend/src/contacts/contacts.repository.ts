import { Injectable, Logger } from "@nestjs/common";
import { MatchType as PrismaMatchType, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.module";
import { ContactIdentifierType, MatchType } from "./dto/contacts.dto";
import {
  NormalizedContact,
  PersistedContactRecord,
  PrismaTransactionClient,
} from "./contacts.types";

interface SuggestionUpsertInput {
  suggestedUserId: string;
  matchType: MatchType;
  matchStrength: number;
  createdAt: Date;
}

interface SuggestionQueryOptions {
  limit: number;
  offset: number;
  matchType?: MatchType;
  minConfidence?: number;
  since?: Date;
  excludeAccepted?: boolean;
}

export interface SuggestionRecord {
  id: number;
  userId: string;
  suggestedUserId: string;
  matchType: MatchType;
  matchStrength: number;
  createdAt: Date;
  viewedAt: Date | null;
  acceptedAt: Date | null;
  stale: boolean;
  suggestedUser: {
    id: string;
    displayName: string | null;
    profileImageUrl: string | null;
  };
}

export interface DeletionResult {
  contactsDeleted: number;
  suggestionsCleared: number;
  mutualDiscoveriesRemoved: number;
  completedAt: Date;
  privacySettings: {
    discoveryEnabled: boolean;
    discoveryOptedOut: boolean;
    mutualDiscoveryOnly: boolean;
    lastUpdated: Date;
  };
}

@Injectable()
export class ContactsRepository {
  private readonly logger = new Logger(ContactsRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async countExistingHashes(
    tx: PrismaTransactionClient,
    userId: string,
    hashes: string[],
  ): Promise<Set<string>> {
    if (hashes.length === 0) {
      return new Set();
    }

    const records = await tx.hashedContact.findMany({
      where: {
        userId,
        hashedPhone: {
          in: hashes,
        },
      },
      select: {
        hashedPhone: true,
      },
    });

    return new Set(records.map((record) => record.hashedPhone));
  }

  async insertHashedContacts(
    tx: PrismaTransactionClient,
    userId: string,
    contacts: NormalizedContact[],
    retentionDays: number,
  ): Promise<PersistedContactRecord[]> {
    if (contacts.length === 0) {
      return [];
    }

    const now = new Date();
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(now.getTime() + retentionMs);
    const normalizedByHash = new Map(
      contacts.map(
        (contact) => [contact.hash, contact.normalizedValue] as const,
      ),
    );

    await tx.hashedContact.createMany({
      data: contacts.map((contact) => ({
        userId,
        hashedPhone: contact.hash,
        uploadedAt: now,
        expiresAt,
      })),
      skipDuplicates: true,
    });

    const persisted = await tx.hashedContact.findMany({
      where: {
        userId,
        hashedPhone: {
          in: contacts.map((contact) => contact.hash),
        },
      },
    });

    return persisted.map((record) => ({
      userId: record.userId,
      hash: record.hashedPhone,
      type: ContactIdentifierType.PHONE,
      normalizedValue:
        normalizedByHash.get(record.hashedPhone) ?? record.hashedPhone,
      firstSeenAt: record.uploadedAt,
      lastSeenAt: record.uploadedAt,
      expiresAt: record.expiresAt,
    }));
  }

  async getStoredContacts(
    tx: PrismaTransactionClient,
    userId: string,
  ): Promise<PersistedContactRecord[]> {
    const records = await tx.hashedContact.findMany({
      where: {
        userId,
      },
      orderBy: {
        uploadedAt: "desc",
      },
    });

    return records.map((record) => ({
      userId: String(record.userId),
      hash: record.hashedPhone,
      type: ContactIdentifierType.PHONE,
      normalizedValue: record.hashedPhone,
      firstSeenAt: record.uploadedAt,
      lastSeenAt: record.uploadedAt,
      expiresAt: record.expiresAt,
    }));
  }

  async deleteContacts(
    tx: PrismaTransactionClient,
    userId: string,
    optOutOfDiscovery: boolean,
  ): Promise<DeletionResult> {
    const [contactsDeleted, authoredSuggestions, targetedSuggestions] =
      await Promise.all([
        tx.hashedContact.deleteMany({
          where: { userId },
        }),
        tx.contactSuggestion.deleteMany({
          where: { userId },
        }),
        tx.contactSuggestion.deleteMany({
          where: { suggestedUserId: userId },
        }),
      ]);

    const now = new Date();

    const result: DeletionResult = {
      contactsDeleted: contactsDeleted.count,
      suggestionsCleared: authoredSuggestions.count,
      mutualDiscoveriesRemoved: targetedSuggestions.count,
      completedAt: now,
      privacySettings: {
        discoveryEnabled: !optOutOfDiscovery,
        discoveryOptedOut: optOutOfDiscovery,
        mutualDiscoveryOnly: optOutOfDiscovery,
        lastUpdated: now,
      },
    };

    this.logger.debug(`Deleted contacts for user=${userId}`, result);

    return result;
  }

  fetchExistingConnections(
    tx: PrismaTransactionClient,
    userId: string,
    candidateIds: string[],
  ): Promise<Set<string>> {
    // Connections table is not yet implemented. Return empty set to skip filtering.
    void tx;
    void userId;
    void candidateIds;
    return Promise.resolve(new Set());
  }

  async upsertSuggestions(
    tx: PrismaTransactionClient,
    userId: string,
    suggestions: SuggestionUpsertInput[],
  ): Promise<void> {
    if (suggestions.length === 0) {
      return;
    }

    await Promise.all(
      suggestions.map((suggestion) =>
        tx.contactSuggestion.upsert({
          where: {
            userId_suggestedUserId: {
              userId,
              suggestedUserId: suggestion.suggestedUserId,
            },
          },
          update: {
            matchType: suggestion.matchType as PrismaMatchType,
            matchStrength: suggestion.matchStrength,
            createdAt: suggestion.createdAt,
            stale: false,
          },
          create: {
            userId,
            suggestedUserId: suggestion.suggestedUserId,
            matchType: suggestion.matchType as PrismaMatchType,
            matchStrength: suggestion.matchStrength,
            createdAt: suggestion.createdAt,
            stale: false,
          },
        }),
      ),
    );
  }

  async fetchSuggestionSummaries(
    tx: PrismaTransactionClient,
    userId: string,
    options: SuggestionQueryOptions,
  ): Promise<{ records: SuggestionRecord[]; total: number }> {
    const where: Record<string, unknown> = {
      userId,
      stale: false,
      suggestedUser: { allowContactDiscovery: true },
    };

    if (options.matchType && options.matchType !== MatchType.ALL) {
      where.matchType = options.matchType;
    }

    if (typeof options.minConfidence === "number") {
      where.matchStrength = {
        gte: options.minConfidence,
      };
    }

    if (options.since) {
      where.createdAt = {
        gte: options.since,
      };
    }

    if (options.excludeAccepted) {
      where.acceptedAt = null;
    }

    const [records, total] = await Promise.all([
      tx.contactSuggestion.findMany({
        where,
        orderBy: [{ matchStrength: "desc" }, { createdAt: "desc" }],
        skip: options.offset,
        take: options.limit,
        include: {
          suggestedUser: {
            select: {
              id: true,
              displayName: true,
              profileImageUrl: true,
            },
          },
        },
      }),
      tx.contactSuggestion.count({ where }),
    ]);

    const formatted = records.map((record) => ({
      id: record.id,
      userId: record.userId,
      suggestedUserId: record.suggestedUserId,
      matchType: record.matchType as MatchType,
      matchStrength: Number(record.matchStrength),
      createdAt: record.createdAt,
      viewedAt: record.viewedAt,
      acceptedAt: record.acceptedAt,
      stale: record.stale,
      suggestedUser: {
        id: record.suggestedUser.id,
        displayName: record.suggestedUser.displayName,
        profileImageUrl: record.suggestedUser.profileImageUrl,
      },
    }));

    return { records: formatted, total };
  }

  async markSuggestionsViewed(
    tx: PrismaTransactionClient,
    suggestionIds: number[],
  ): Promise<void> {
    if (suggestionIds.length === 0) {
      return;
    }

    await tx.contactSuggestion.updateMany({
      where: {
        id: {
          in: suggestionIds,
        },
        viewedAt: null,
      },
      data: {
        viewedAt: new Date(),
      },
    });
  }

  async markSuggestionsStale(
    tx: PrismaTransactionClient,
    userId: string,
  ): Promise<void> {
    await tx.contactSuggestion.updateMany({
      where: {
        userId,
        stale: false,
      },
      data: {
        stale: true,
      },
    });
  }

  async fetchUserSummaries(
    tx: Prisma.TransactionClient,
    userIds: string[],
  ): Promise<
    Map<string, { displayName: string | null; profileImageUrl: string | null }>
  > {
    if (userIds.length === 0) {
      return new Map();
    }

    const users = await tx.user.findMany({
      where: {
        id: {
          in: userIds,
        },
      },
      select: {
        id: true,
        displayName: true,
        profileImageUrl: true,
      },
    });

    return new Map(
      users.map((user) => [
        user.id,
        {
          displayName: user.displayName,
          profileImageUrl: user.profileImageUrl,
        },
      ]),
    );
  }
}
