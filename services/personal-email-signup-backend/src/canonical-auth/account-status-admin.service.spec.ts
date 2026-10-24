import { UserAccountStatus } from "@prisma/client";
import { CanonicalAuthService } from "./canonical-auth.service";

describe("CanonicalAuthService account status administration", () => {
  const targetId = "00000000-0000-4000-8000-000000000101";
  const adminId = "00000000-0000-4000-8000-000000000102";

  it("records a status change, named actor, and versioned Chat event in one transaction", async () => {
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
      outboxEvent: { create: jest.fn().mockResolvedValue({ id: "event-id" }) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
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

    const result = await service.changeAccountStatus({
      targetId,
      actorId: adminId,
      accountStatus: UserAccountStatus.SUSPENDED,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
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
    expect(result).toEqual({
      authUserId: targetId,
      accountStatus: UserAccountStatus.SUSPENDED,
      version: 1,
      changed: true,
    });
  });
});
