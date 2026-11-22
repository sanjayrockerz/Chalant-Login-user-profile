import { UserAccountStatus } from "@prisma/client";
import { CanonicalAuthService } from "./canonical-auth.service";
import { SafetyOrderingService } from "../safety-ordering/safety-ordering.service";

describe("CanonicalAuthService account status administration", () => {
  const targetId = "00000000-0000-4000-8000-000000000101";
  const adminId = "00000000-0000-4000-8000-000000000102";
  const operationId = "00000000-0000-4000-8000-000000000103";

  it("records a status change, named actor, and versioned Chat event in one transaction", async () => {
    const outboxRows: Array<{
      eventType: string;
      aggregateId: string;
      payload: Record<string, unknown>;
    }> = [];
    const outboxCreate = jest
      .fn<Promise<void>, [{ data: (typeof outboxRows)[number] }]>()
      .mockImplementation(({ data }) => {
        outboxRows.push(data);
        return Promise.resolve();
      });
    const tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: targetId,
          accountStatus: UserAccountStatus.ACTIVE,
          accountStatusVersion: 0,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      accountStatusAudit: { create: jest.fn().mockResolvedValue({}) },
      outboxEvent: { create: outboxCreate },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const runAccountMutation = jest.fn(
      async (input: { commit: (client: typeof tx) => Promise<unknown> }) =>
        input.commit(tx),
    );
    const service = new CanonicalAuthService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { runAccountMutation } as unknown as SafetyOrderingService,
    );

    const result = await service.changeAccountStatus({
      operationId,
      targetId,
      actorId: adminId,
      accountStatus: UserAccountStatus.SUSPENDED,
    });

    expect(runAccountMutation).toHaveBeenCalledWith(
      expect.objectContaining({ operationId, subjectId: targetId }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: targetId, accountStatusVersion: 0 },
      data: {
        accountStatus: UserAccountStatus.SUSPENDED,
        accountStatusVersion: { increment: 1 },
      },
    });
    expect(tx.accountStatusAudit.create).toHaveBeenCalledWith({
      data: {
        targetUserId: targetId,
        actorUserId: adminId,
        fromStatus: UserAccountStatus.ACTIVE,
        toStatus: UserAccountStatus.SUSPENDED,
        version: 1,
      },
    });
    expect(tx.outboxEvent.create).toHaveBeenCalledWith({
      data: {
        eventType: "chat.account.lifecycle.v1",
        aggregateId: targetId,
        payload: {
          authUserId: targetId,
          accountStatus: UserAccountStatus.SUSPENDED,
          version: 1,
        },
      },
    });
    const authEvent = outboxRows.find(
      (row) => row.eventType === "auth.lifecycle.v1",
    );
    expect(authEvent?.aggregateId).toBe(targetId);
    expect(authEvent?.payload).toMatchObject({
      eventType: "auth.lifecycle.v1",
      version: 1,
      subject: targetId,
      action: "ACCOUNT_STATUS_CHANGED",
      scope: "ACCOUNT",
      accountStatus: UserAccountStatus.SUSPENDED,
      revision: 1,
    });
    expect(typeof authEvent?.payload.occurredAt).toBe("string");
    expect(result).toEqual({
      authUserId: targetId,
      accountStatus: UserAccountStatus.SUSPENDED,
      version: 1,
      changed: true,
    });
  });
});
