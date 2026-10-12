import { Prisma } from '@prisma/client';
import { register } from 'prom-client';
import { ContactMatchingService } from './contact-matching.service';
import { ContactIdentifierType, MatchType } from './dto/contacts.dto';
import { PersistedContactRecord, RequestContext } from './contacts.types';

describe('ContactMatchingService', () => {
  let service: ContactMatchingService;
  let context: RequestContext;
  const uploaderId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
  const mutualCandidateId = 'd2719d39-19f6-4c87-9fbf-2ad2c2c12b40';
  const oneSidedCandidateId = '4b7adbb4-88ac-4df9-9122-6c94aa3e015a';
  let txMock: {
    user: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
    };
    hashedContact: {
      findMany: jest.Mock;
    };
    block: {
      findMany: jest.Mock;
    };
  };
  let tx: Prisma.TransactionClient;

  const contacts: PersistedContactRecord[] = [
    {
      userId: uploaderId,
      hash: 'hash-1',
      type: ContactIdentifierType.PHONE,
      normalizedValue: '+15550001',
      firstSeenAt: new Date('2025-01-01T00:00:00Z'),
      lastSeenAt: new Date('2025-01-01T00:00:00Z'),
      expiresAt: new Date('2025-02-01T00:00:00Z'),
    },
    {
      userId: uploaderId,
      hash: 'hash-2',
      type: ContactIdentifierType.PHONE,
      normalizedValue: '+15550002',
      firstSeenAt: new Date('2025-01-01T00:00:00Z'),
      lastSeenAt: new Date('2025-01-01T00:00:00Z'),
      expiresAt: new Date('2025-02-01T00:00:00Z'),
    },
  ];

  beforeEach(() => {
    register.resetMetrics();
    service = new ContactMatchingService();
    context = {
      correlationId: 'corr-123',
      tenantId: 'tenant-1',
    };

    txMock = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ hashedPhone: 'owner-hash' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      hashedContact: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      block: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    tx = txMock as unknown as Prisma.TransactionClient;
  });

  it('returns empty array when no contacts are provided', async () => {
    const results = await service.matchContacts(tx, {
  userId: uploaderId,
      contacts: [],
      context,
    });

    expect(results).toEqual([]);
    expect(txMock.user.findMany).not.toHaveBeenCalled();
  });

  it('identifies mutual and one-sided matches with privacy filters applied', async () => {
    txMock.user.findMany.mockResolvedValueOnce([
      {
        id: mutualCandidateId,
        displayName: 'Mutual User',
        profileImageUrl: null,
        hashedPhone: 'hash-1',
        allowContactDiscovery: true,
      },
      {
        id: oneSidedCandidateId,
        displayName: 'One Sided User',
        profileImageUrl: null,
        hashedPhone: 'hash-2',
        allowContactDiscovery: true,
      },
    ]);

    txMock.hashedContact.findMany.mockResolvedValueOnce([
      { userId: mutualCandidateId },
    ]);

    const results = await service.matchContacts(tx, {
      userId: uploaderId,
      contacts,
      context,
    });

    expect(results).toHaveLength(2);

    const mutual = results.find((match) => match.candidateUserId === mutualCandidateId);
    const oneSided = results.find((match) => match.candidateUserId === oneSidedCandidateId);

    expect(mutual?.matchType).toBe(MatchType.MUTUAL);
    expect(mutual?.confidenceScore).toBe(1.0);
    expect(oneSided?.matchType).toBe(MatchType.ONE_SIDED);
    expect(oneSided?.confidenceScore).toBe(0.7);

    expect(txMock.block.findMany).toHaveBeenCalled();
  });

  it('filters out blocked relationships in either direction', async () => {
    txMock.user.findMany.mockResolvedValueOnce([
      {
        id: 'd2719d39-19f6-4c87-9fbf-2ad2c2c12b40',
        displayName: 'Blocked By Uploader',
        profileImageUrl: null,
        hashedPhone: 'hash-1',
        allowContactDiscovery: true,
      },
      {
        id: '4b7adbb4-88ac-4df9-9122-6c94aa3e015a',
        displayName: 'Blocks Uploader',
        profileImageUrl: null,
        hashedPhone: 'hash-2',
        allowContactDiscovery: true,
      },
    ]);

    txMock.block.findMany.mockResolvedValueOnce([
      { blockerId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', blockedId: 'd2719d39-19f6-4c87-9fbf-2ad2c2c12b40' },
      { blockerId: '4b7adbb4-88ac-4df9-9122-6c94aa3e015a', blockedId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' },
    ]);

    const results = await service.matchContacts(tx, {
      userId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      contacts,
      context,
    });

    expect(results).toHaveLength(0);
  });

  it('treats all matches as one-sided when uploader hashed phone is missing', async () => {
    txMock.user.findUnique.mockResolvedValueOnce({ hashedPhone: null });
    txMock.user.findMany.mockResolvedValueOnce([
      {
        id: 'd2719d39-19f6-4c87-9fbf-2ad2c2c12b40',
        displayName: 'Candidate',
        profileImageUrl: null,
        hashedPhone: 'hash-1',
        allowContactDiscovery: true,
      },
    ]);

    const results = await service.matchContacts(tx, {
      userId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      contacts: [contacts[0]],
      context,
    });

    expect(results).toHaveLength(1);
    expect(results[0].matchType).toBe(MatchType.ONE_SIDED);
    expect(txMock.hashedContact.findMany).not.toHaveBeenCalled();
  });

  it('ignores users who opted out of contact discovery', async () => {
    txMock.user.findMany.mockResolvedValueOnce([
      {
        id: 'd2719d39-19f6-4c87-9fbf-2ad2c2c12b40',
        displayName: 'Opted Out User',
        profileImageUrl: null,
        hashedPhone: 'hash-1',
        allowContactDiscovery: false,
      },
      {
        id: '4b7adbb4-88ac-4df9-9122-6c94aa3e015a',
        displayName: 'Eligible User',
        profileImageUrl: null,
        hashedPhone: 'hash-2',
        allowContactDiscovery: true,
      },
    ]);

    const results = await service.matchContacts(tx, {
      userId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      contacts,
      context,
    });

  expect(results).toHaveLength(1);
  expect(results[0].candidateUserId).toBe(oneSidedCandidateId);
  });
});
