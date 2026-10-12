import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Counter, Histogram, register } from "prom-client";
import { ContactIdentifierType, MatchType } from "./dto/contacts.dto";
import {
  MatchCandidate,
  PersistedContactRecord,
  PrismaTransactionClient,
  RequestContext,
} from "./contacts.types";

interface MatchContactsInput {
  userId: string;
  contacts: PersistedContactRecord[];
  context: RequestContext;
}

interface FindMatchesInput {
  uploaderId: string;
  uploadedHashes: string[];
  context: RequestContext;
  contactLookup: Map<string, PersistedContactRecord>;
}

type MatchedUserRecord = {
  id: string;
  displayName: string | null;
  profileImageUrl: string | null;
  hashedPhone: string | null;
  allowContactDiscovery: boolean;
};

type BlockRecord = {
  blockerId: string;
  blockedId: string;
};

const MATCH_TYPE_LABELS: Record<
  MatchType.MUTUAL | MatchType.ONE_SIDED,
  string
> = {
  [MatchType.MUTUAL]: "mutual",
  [MatchType.ONE_SIDED]: "one_sided",
};

const matchesCounter: Counter<"match_type" | "tenant_id"> = (() => {
  const existing = register.getSingleMetric("contacts_matches_found_total");
  if (existing) {
    return existing as Counter<"match_type" | "tenant_id">;
  }

  return new Counter<"match_type" | "tenant_id">({
    name: "contacts_matches_found_total",
    help: "Count of contact matches discovered during uploads",
    labelNames: ["match_type", "tenant_id"],
    registers: [register],
  });
})();

const matchingDurationHistogram: Histogram<"tenant_id"> = (() => {
  const existing = register.getSingleMetric(
    "contacts_matching_duration_seconds",
  );
  if (existing) {
    return existing as Histogram<"tenant_id">;
  }

  return new Histogram<"tenant_id">({
    name: "contacts_matching_duration_seconds",
    help: "Latency histogram for contact matching execution",
    labelNames: ["tenant_id"],
    buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2],
    registers: [register],
  });
})();

@Injectable()
export class ContactMatchingService {
  private readonly logger = new Logger(ContactMatchingService.name);
  private readonly hashChunkSize = 100;

  async matchContacts(
    tx: PrismaTransactionClient,
    { userId, contacts, context }: MatchContactsInput,
  ): Promise<MatchCandidate[]> {
    if (contacts.length === 0) {
      return [];
    }

    const uniqueHashes = [...new Set(contacts.map((contact) => contact.hash))];
    const contactLookup = new Map<string, PersistedContactRecord>();
    contacts.forEach((contact) => {
      if (!contactLookup.has(contact.hash)) {
        contactLookup.set(contact.hash, contact);
      }
    });

    return this.findMatches(tx, {
      uploaderId: userId,
      uploadedHashes: uniqueHashes,
      context,
      contactLookup,
    });
  }

  private async findMatches(
    tx: PrismaTransactionClient,
    { uploaderId, uploadedHashes, context, contactLookup }: FindMatchesInput,
  ): Promise<MatchCandidate[]> {
    if (uploadedHashes.length === 0) {
      return [];
    }

    const start = process.hrtime.bigint();
    const tenantId = context.tenantId ?? "unknown";
    const uploader = await tx.user.findUnique({
      where: { id: uploaderId },
      select: { hashedPhone: true },
    });

    const uploaderHashedPhone = uploader?.hashedPhone ?? null;

    const matchedUsers = await this.fetchEligibleUsers(
      tx,
      uploadedHashes,
      uploaderId,
    );

    if (matchedUsers.length === 0) {
      this.recordMetrics(start, tenantId, 0, 0);
      this.logger.debug(`Found 0 matches for user=${uploaderId}`, {
        correlationId: context.correlationId,
        tenantId,
      });
      return [];
    }

    const mutualIds = await this.computeMutualMatches(
      tx,
      matchedUsers,
      uploaderHashedPhone,
    );
    const blockedPairs = await this.fetchBlockedPairs(
      tx,
      uploaderId,
      matchedUsers,
    );
    const blockedSet = new Set(
      blockedPairs.map((pair) => `${pair.blockerId}:${pair.blockedId}`),
    );

    const matches: MatchCandidate[] = [];
    let mutualCount = 0;
    let oneSidedCount = 0;

    for (const user of matchedUsers) {
      const candidateId = user.id;

      if (candidateId === uploaderId) {
        continue;
      }

      if (
        blockedSet.has(`${uploaderId}:${candidateId}`) ||
        blockedSet.has(`${candidateId}:${uploaderId}`)
      ) {
        continue;
      }

      const contactRecord = user.hashedPhone
        ? contactLookup.get(user.hashedPhone)
        : undefined;
      if (!contactRecord) {
        continue;
      }

      const isMutual = mutualIds.has(candidateId);
      const confidence = isMutual ? 1.0 : 0.7;

      matches.push({
        candidateUserId: String(candidateId),
        displayName: user.displayName ?? "Friend",
        matchType: isMutual ? MatchType.MUTUAL : MatchType.ONE_SIDED,
        matchSource: contactRecord.type ?? ContactIdentifierType.PHONE,
        confidenceScore: confidence,
        discoveredAt: new Date(),
        mutualConnections: isMutual ? 1 : 0,
        isActive: true,
        isActionable: true,
      });

      if (isMutual) {
        mutualCount += 1;
      } else {
        oneSidedCount += 1;
      }
    }

    this.recordMetrics(start, tenantId, mutualCount, oneSidedCount);

    this.logger.log(
      `Found ${mutualCount} mutual and ${oneSidedCount} one-sided matches for user ${uploaderId}`,
      {
        correlationId: context.correlationId,
        tenantId,
      },
    );

    return matches;
  }

  private async fetchEligibleUsers(
    tx: PrismaTransactionClient,
    hashes: string[],
    uploaderId: string,
  ): Promise<MatchedUserRecord[]> {
    const results: MatchedUserRecord[] = [];

    for (const chunk of this.chunk(hashes, this.hashChunkSize)) {
      if (chunk.length === 0) {
        continue;
      }

      const chunkMatches = await tx.user.findMany({
        where: {
          hashedPhone: { in: chunk },
          id: { not: uploaderId },
          allowContactDiscovery: true,
        },
        select: {
          id: true,
          displayName: true,
          profileImageUrl: true,
          hashedPhone: true,
          allowContactDiscovery: true,
        },
      });

      chunkMatches
        .filter((user) => user.allowContactDiscovery)
        .forEach((user) => results.push(user));
    }

    return results;
  }

  private async computeMutualMatches(
    tx: PrismaTransactionClient,
    matchedUsers: MatchedUserRecord[],
    uploaderHashedPhone: string | null,
  ): Promise<Set<string>> {
    if (!uploaderHashedPhone) {
      return new Set();
    }

    const userIds = matchedUsers.map((user) => user.id);
    const mutualIds = new Set<string>();

    for (const chunk of this.chunk(userIds, this.hashChunkSize)) {
      if (chunk.length === 0) {
        continue;
      }

      const records = await tx.hashedContact.findMany({
        where: {
          userId: { in: chunk },
          hashedPhone: uploaderHashedPhone,
        },
        select: { userId: true },
      });

      records.forEach((record) => mutualIds.add(record.userId));
    }

    return mutualIds;
  }

  private async fetchBlockedPairs(
    tx: PrismaTransactionClient,
    uploaderId: string,
    matchedUsers: MatchedUserRecord[],
  ): Promise<BlockRecord[]> {
    if (matchedUsers.length === 0) {
      return [];
    }

    const candidateIds = matchedUsers.map((user) => user.id);
    const blocks: BlockRecord[] = [];

    for (const chunk of this.chunk(candidateIds, this.hashChunkSize)) {
      if (chunk.length === 0) {
        continue;
      }

      const blockResults = await tx.block.findMany({
        where: {
          OR: [
            {
              blockerId: uploaderId,
              blockedId: { in: chunk },
            },
            {
              blockerId: { in: chunk },
              blockedId: uploaderId,
            },
          ],
        },
        select: {
          blockerId: true,
          blockedId: true,
        },
      });

      blocks.push(...blockResults);
    }

    return blocks;
  }

  private chunk<T>(values: T[], size: number): T[][] {
    if (values.length === 0) {
      return [];
    }

    if (values.length <= size) {
      return [values];
    }

    const chunks: T[][] = [];
    for (let i = 0; i < values.length; i += size) {
      chunks.push(values.slice(i, i + size));
    }
    return chunks;
  }

  private recordMetrics(
    start: bigint,
    tenantId: string,
    mutualCount: number,
    oneSidedCount: number,
  ): void {
    const end = process.hrtime.bigint();
    const elapsedMs = Number(end - start) / 1_000_000;
    matchingDurationHistogram
      .labels({ tenant_id: tenantId })
      .observe(elapsedMs / 1000);

    if (mutualCount > 0) {
      matchesCounter
        .labels({
          match_type: MATCH_TYPE_LABELS[MatchType.MUTUAL],
          tenant_id: tenantId,
        })
        .inc(mutualCount);
    }

    if (oneSidedCount > 0) {
      matchesCounter
        .labels({
          match_type: MATCH_TYPE_LABELS[MatchType.ONE_SIDED],
          tenant_id: tenantId,
        })
        .inc(oneSidedCount);
    }
  }
}
