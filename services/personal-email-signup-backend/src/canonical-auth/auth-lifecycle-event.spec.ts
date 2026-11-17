import { UserAccountStatus } from "@prisma/client";
import { CanonicalAuthService } from "./canonical-auth.service";

interface CapturedOutboxEvent {
  id?: string;
  eventType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

interface TransactionMock {
  $queryRaw: jest.Mock<Promise<unknown>, [unknown]>;
  user: {
    findUnique: jest.Mock<Promise<Record<string, unknown> | null>, [unknown]>;
    updateMany: jest.Mock<Promise<{ count: number }>, [unknown]>;
  };
  identitySession: {
    findUnique: jest.Mock<
      Promise<{ id: string; userId: string } | null>,
      [unknown]
    >;
    findMany: jest.Mock<Promise<Array<{ id: string }>>, [unknown]>;
    updateMany: jest.Mock<Promise<{ count: number }>, [unknown]>;
  };
  accountStatusAudit: {
    create: jest.Mock<Promise<void>, [unknown]>;
  };
  outboxEvent: {
    create: jest.Mock<Promise<void>, [{ data: CapturedOutboxEvent }]>;
  };
  capturedOutbox: CapturedOutboxEvent[];
}

const subject = "00000000-0000-4000-8000-000000000101";
const sessionId = "00000000-0000-4000-8000-000000000102";

function makeTransaction(): TransactionMock {
  const capturedOutbox: CapturedOutboxEvent[] = [];
  return {
    $queryRaw: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue([]),
    user: {
      findUnique: jest
        .fn<Promise<Record<string, unknown> | null>, [unknown]>()
        .mockResolvedValue(null),
      updateMany: jest
        .fn<Promise<{ count: number }>, [unknown]>()
        .mockResolvedValue({ count: 1 }),
    },
    identitySession: {
      findUnique: jest
        .fn<Promise<{ id: string; userId: string } | null>, [unknown]>()
        .mockResolvedValue(null),
      findMany: jest
        .fn<Promise<Array<{ id: string }>>, [unknown]>()
        .mockResolvedValue([]),
      updateMany: jest
        .fn<Promise<{ count: number }>, [unknown]>()
        .mockResolvedValue({ count: 1 }),
    },
    accountStatusAudit: {
      create: jest.fn<Promise<void>, [unknown]>().mockResolvedValue(undefined),
    },
    outboxEvent: {
      create: jest
        .fn<Promise<void>, [{ data: CapturedOutboxEvent }]>()
        .mockImplementation(({ data }) => {
          capturedOutbox.push(data);
          return Promise.resolve();
        }),
    },
    capturedOutbox,
  };
}

function makeService(transaction: TransactionMock) {
  const prisma = {
    $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
      callback(transaction),
    ),
  };
  const service = new CanonicalAuthService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { prisma, service };
}

describe("Auth lifecycle outbox persistence", () => {
  it("writes a session revocation event only when logout changes an active session", async () => {
    const transaction = makeTransaction();
    transaction.identitySession.findUnique.mockResolvedValue({
      id: sessionId,
      userId: subject,
    });
    transaction.identitySession.updateMany.mockResolvedValue({ count: 1 });
    const { prisma, service } = makeService(transaction);

    await service.logout("opaque-refresh-token");

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const eventCall = transaction.capturedOutbox[0];
    expect(eventCall).toBeDefined();
    expect(eventCall).toMatchObject({
      eventType: "auth.lifecycle.v1",
      aggregateId: subject,
      payload: {
        eventType: "auth.lifecycle.v1",
        version: 1,
        subject,
        action: "SESSION_REVOKED",
        scope: "SESSION",
        sessionId,
      },
    });
    expect(typeof eventCall?.id).toBe("string");
    expect(eventCall?.id).toBe(eventCall?.payload.eventId);
    expect(typeof eventCall?.payload.occurredAt).toBe("string");
  });

  it("does not emit a duplicate event for an already-revoked session", async () => {
    const transaction = makeTransaction();
    transaction.identitySession.findUnique.mockResolvedValue({
      id: sessionId,
      userId: subject,
    });
    transaction.identitySession.updateMany.mockResolvedValue({ count: 0 });
    const { service } = makeService(transaction);

    await service.logout("opaque-refresh-token");

    expect(transaction.capturedOutbox).toHaveLength(0);
  });

  it("emits one event per session actually revoked by logout-all", async () => {
    const sessions = [
      { id: sessionId },
      { id: "00000000-0000-4000-8000-000000000103" },
    ];
    const transaction = makeTransaction();
    transaction.identitySession.findMany.mockResolvedValue(sessions);
    transaction.identitySession.updateMany.mockResolvedValue({
      count: sessions.length,
    });
    const { service } = makeService(transaction);

    await service.revokeAllSessions(subject);

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
    expect(transaction.capturedOutbox).toHaveLength(2);
    expect(
      transaction.capturedOutbox.map(({ payload }) => payload.sessionId),
    ).toEqual(sessions.map(({ id }) => id));
  });

  it("does not emit session events when logout-all has no active sessions", async () => {
    const transaction = makeTransaction();
    transaction.identitySession.findMany.mockResolvedValue([]);
    const { service } = makeService(transaction);

    await service.revokeAllSessions(subject);

    expect(transaction.identitySession.updateMany).not.toHaveBeenCalled();
    expect(transaction.capturedOutbox).toHaveLength(0);
  });

  it("does not alter the existing Chat event when adding account status lifecycle delivery", async () => {
    const transaction = makeTransaction();
    transaction.user.findUnique.mockResolvedValue({
      id: subject,
      accountStatus: UserAccountStatus.ACTIVE,
      accountStatusVersion: 4,
    });
    const { service } = makeService(transaction);

    await service.changeAccountStatus({
      targetId: subject,
      actorId: "00000000-0000-4000-8000-000000000104",
      accountStatus: UserAccountStatus.DISABLED,
    });

    const payloads = transaction.capturedOutbox;
    const chatEvent = payloads.find(
      (row) => row.eventType === "chat.account.lifecycle.v1",
    );
    expect(chatEvent?.payload).toEqual({
      authUserId: subject,
      accountStatus: UserAccountStatus.DISABLED,
      version: 5,
    });
    const authEvent = payloads.find(
      (row) => row.eventType === "auth.lifecycle.v1",
    );
    expect(authEvent?.payload).toMatchObject({
      action: "ACCOUNT_STATUS_CHANGED",
      scope: "ACCOUNT",
      subject,
      accountStatus: UserAccountStatus.DISABLED,
      revision: 5,
    });
  });
});
