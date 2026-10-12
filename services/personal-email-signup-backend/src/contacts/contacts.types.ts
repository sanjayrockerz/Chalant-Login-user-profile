import { PrismaClient } from '@prisma/client';
import { ContactIdentifierType, MatchType } from './dto/contacts.dto';

export type PrismaTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface RequestContext {
  correlationId: string;
  tenantId: string;
  userAgent?: string;
  userTier?: 'free' | 'premium' | 'enterprise';
  ipAddressHash?: string;
  deviceIdHash?: string;
}

export interface NormalizedContact {
  originalIdentifier: string;
  type: ContactIdentifierType;
  normalizedValue: string;
  hash: string;
}

export interface NormalizationResult {
  uniqueContacts: NormalizedContact[];
  invalidIdentifiers: string[];
  invalidDetails: Array<{ identifier: string; reason: string }>;
  duplicateHashes: Set<string>;
  typeBreakdown: Record<ContactIdentifierType, number>;
  withinBatchDuplicates: number;
}

export interface PersistedContactRecord {
  userId: string;
  hash: string;
  type: ContactIdentifierType;
  normalizedValue: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

export interface MatchCandidate {
  candidateUserId: string;
  displayName: string;
  matchType: MatchType;
  matchSource: ContactIdentifierType;
  confidenceScore: number;
  discoveredAt: Date;
  mutualConnections: number;
  isActive: boolean;
  isActionable: boolean;
}
