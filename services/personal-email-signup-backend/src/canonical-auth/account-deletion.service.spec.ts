import { createHash } from "node:crypto";
import { ServiceUnavailableException } from "@nestjs/common";
import { AccountDeletionService } from "./account-deletion.service";

describe("AccountDeletionService", () => {
  const subject = "00000000-0000-4000-8000-000000000001";
  const operationId = "00000000-0000-4000-8000-000000000002";
  let prisma: any;
  let safety: any;
  let fences: any;
  let service: AccountDeletionService;

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn().mockImplementation((callback) =>
        callback({
          $queryRaw: jest.fn().mockResolvedValue([{ acquired: true }]),
        }),
      ),
      accountDeletionTombstone: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      safetyOperation: { findUnique: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: subject, accountStatusVersion: 0 }),
      },
    };
    safety = {
      beginAccountDeletion: jest.fn().mockResolvedValue({ state: "HELD" }),
      runAccountMutation: jest.fn().mockImplementation(async ({ commit }) =>
        commit({
          accountDeletionTombstone: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn(),
          },
          safetyOperation: { update: jest.fn() },
          identitySession: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          refreshToken: {
            deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          outboxEvent: { create: jest.fn() },
          user: {
            findUnique: jest
              .fn()
              .mockResolvedValue({ accountStatusVersion: 0 }),
            delete: jest.fn(),
          },
        }),
      ),
    };
    const receiptFor = (
      requestedSubject: string,
      requestedOperationId: string,
      requestHash: string,
      lifecycleRevision = "1",
    ) => ({
      operationId: requestedOperationId,
      subject: requestedSubject,
      requestHash,
      lifecycleRevision,
      state: "FENCED" as const,
      receiptHash: "e".repeat(64),
    });
    fences = {
      prepareProfile: jest
        .fn()
        .mockImplementation(async (...args: [string, string, string, string]) =>
          receiptFor(...args),
        ),
      prepareChat: jest
        .fn()
        .mockImplementation(async (...args: [string, string, string, string]) =>
          receiptFor(...args),
        ),
      prepareRealtime: jest
        .fn()
        .mockImplementation(async (...args: [string, string, string, string]) =>
          receiptFor(...args),
        ),
    };
    service = new AccountDeletionService(prisma, safety, fences, {
      get: jest.fn().mockReturnValue(true),
    } as any);
  });

  it("does not irreversibly accept deletion until every required subject fence is durable", async () => {
    const receiptFor = (
      requestedSubject: string,
      requestedOperationId: string,
      requestHash: string,
      lifecycleRevision = "1",
    ) => ({
      operationId: requestedOperationId,
      subject: requestedSubject,
      requestHash,
      lifecycleRevision,
      state: "FENCED" as const,
      receiptHash: "e".repeat(64),
    });
    let releaseRealtime!: () => void;
    fences.prepareRealtime.mockImplementation(
      async (
        requestedSubject: string,
        requestedOperationId: string,
        requestHash: string,
        lifecycleRevision: string,
      ) =>
        new Promise((resolve) => {
          releaseRealtime = () =>
            resolve(
              receiptFor(
                requestedSubject,
                requestedOperationId,
                requestHash,
                lifecycleRevision,
              ),
            );
        }),
    );

    const pending = service.requestDeletion(subject, operationId);
    await new Promise((resolve) => setImmediate(resolve));

    expect(safety.runAccountMutation).not.toHaveBeenCalled();
    expect(fences.prepareProfile).toHaveBeenCalledWith(
      subject,
      operationId,
      expect.any(String),
      "1",
    );
    expect(fences.prepareChat).toHaveBeenCalledWith(
      subject,
      operationId,
      expect.any(String),
      "1",
    );
    releaseRealtime();

    await expect(pending).resolves.toMatchObject({
      state: "CLEANUP_IN_PROGRESS",
    });
    expect(safety.runAccountMutation).toHaveBeenCalledTimes(1);
  });

  it("recovers only persisted PREPARING operations using the original subject and operation identity", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ operationId, subject }]);
    const result = await service.recoverPendingDeletions(25);
    expect(result).toBe(1);
    expect(safety.beginAccountDeletion).toHaveBeenCalledWith({
      operationId,
      subjectId: subject,
      commandHash: createHash("sha256")
        .update(
          JSON.stringify(["auth-account-deletion-v1", subject, operationId]),
        )
        .digest("hex"),
    });
    expect(fences.prepareProfile).toHaveBeenCalledTimes(1);
    expect(fences.prepareChat).toHaveBeenCalledTimes(1);
    expect(fences.prepareRealtime).toHaveBeenCalledTimes(1);
    expect(safety.runAccountMutation).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw.mock.calls[0][0].join(" ")).toContain(
      "request_metadata->>'phase' = 'PREPARING'",
    );
  });

  it("continues a recovery batch after one operation fails closed", async () => {
    const secondSubject = "00000000-0000-4000-8000-000000000003";
    const secondOperation = "00000000-0000-4000-8000-000000000004";
    prisma.$queryRaw.mockResolvedValueOnce([
      { operationId, subject },
      { operationId: secondOperation, subject: secondSubject },
    ]);
    fences.prepareRealtime
      .mockRejectedValueOnce(new Error("receipt unavailable"))
      .mockImplementationOnce(
        async (
          requestedSubject,
          requestedOperationId,
          requestHash,
          lifecycleRevision,
        ) => ({
          operationId: requestedOperationId,
          subject: requestedSubject,
          requestHash,
          lifecycleRevision,
          state: "FENCED" as const,
          receiptHash: "f".repeat(64),
        }),
      );
    await expect(service.recoverPendingDeletions()).resolves.toBe(2);
    expect(fences.prepareRealtime).toHaveBeenCalledTimes(2);
    expect(safety.runAccountMutation).toHaveBeenCalledTimes(1);
  });

  it("returns pending without duplicating downstream fence calls when another recovery owns the subject lock", async () => {
    prisma.$transaction.mockImplementationOnce(
      (callback: (tx: unknown) => unknown) =>
        callback({
          $queryRaw: jest.fn().mockResolvedValue([{ acquired: false }]),
        }),
    );

    await expect(
      service.requestDeletion(subject, operationId),
    ).resolves.toEqual({
      operationId,
      state: "PENDING",
    });
    expect(fences.prepareProfile).not.toHaveBeenCalled();
    expect(fences.prepareChat).not.toHaveBeenCalled();
    expect(fences.prepareRealtime).not.toHaveBeenCalled();
    expect(safety.runAccountMutation).not.toHaveBeenCalled();
  });

  it("leaves the deletion operation pending when a required fence is unavailable", async () => {
    fences.prepareChat.mockRejectedValue(new ServiceUnavailableException());

    await expect(
      service.requestDeletion(subject, operationId),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(safety.runAccountMutation).not.toHaveBeenCalled();
  });

  it("rejects deletion when the production activation gate is disabled", async () => {
    service = new AccountDeletionService(prisma, safety, fences, {
      get: jest.fn().mockReturnValue(false),
    } as any);

    await expect(
      service.requestDeletion(subject, operationId),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(safety.beginAccountDeletion).not.toHaveBeenCalled();
  });

  it("does not treat a tombstone as success for a different idempotency key", async () => {
    prisma.accountDeletionTombstone.findUnique.mockResolvedValue({
      lifecycleRevision: 2n,
    });

    await expect(
      service.requestDeletion(subject, "00000000-0000-4000-8000-000000000003"),
    ).rejects.toThrow(
      "Account deletion was already accepted under a different operation",
    );
  });

  it("returns only the durable deletion status for an exact retry after the Auth User is gone", async () => {
    const commandHash = createHash("sha256")
      .update(
        JSON.stringify(["auth-account-deletion-v1", subject, operationId]),
      )
      .digest("hex");
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          callerId: "auth-account-lifecycle",
          type: "ACCOUNT_MUTATION",
          subjects: [subject],
          resourceKeys: [`account:${subject}`],
          commandHash,
        }),
      )
      .digest("hex");
    prisma.accountDeletionTombstone.findUnique.mockResolvedValue({
      lifecycleRevision: 17n,
    });
    prisma.safetyOperation.findUnique.mockResolvedValue({
      requestHash,
      operationType: "ACCOUNT_MUTATION",
      callerServiceId: "auth-account-lifecycle",
      subjects: [subject],
      resourceKeys: [`account:${subject}`],
      requestMetadata: {
        purpose: "ACCOUNT_DELETION_V1",
        phase: "CLEANUP_IN_PROGRESS",
        lifecycleRevision: "17",
      },
      state: "FINALIZED",
    });
    await expect(
      service.getAcceptedRetry(subject, operationId),
    ).resolves.toEqual({
      operationId,
      state: "CLEANUP_IN_PROGRESS",
      lifecycleRevision: "17",
    });
  });

  it("allows only an exact hash-bound retry while deletion is pending behind another account resource", async () => {
    const commandHash = createHash("sha256")
      .update(
        JSON.stringify(["auth-account-deletion-v1", subject, operationId]),
      )
      .digest("hex");
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          callerId: "auth-account-lifecycle",
          type: "ACCOUNT_MUTATION",
          subjects: [subject],
          resourceKeys: [`account:${subject}`],
          commandHash,
        }),
      )
      .digest("hex");
    prisma.accountDeletionTombstone.findUnique.mockResolvedValue(null);
    prisma.safetyOperation.findUnique.mockResolvedValue({
      requestHash,
      operationType: "ACCOUNT_MUTATION",
      callerServiceId: "auth-account-lifecycle",
      subjects: [subject],
      resourceKeys: [`account:${subject}`],
      requestMetadata: { purpose: "ACCOUNT_DELETION_V1", phase: "PREPARING" },
      state: "HELD",
    });

    await expect(
      service.getAcceptedRetry(subject, operationId),
    ).resolves.toEqual({
      operationId,
      state: "PENDING",
    });
  });
});
