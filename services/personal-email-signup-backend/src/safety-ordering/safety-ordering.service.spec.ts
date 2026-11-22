import { ForbiddenException } from "@nestjs/common";
import { SafetyCaller, SafetyOrderingService } from "./safety-ordering.service";
import { PrismaService } from "../../prisma/prisma.module";

describe("SafetyOrderingService Chat verification", () => {
  const operationId = "00000000-0000-4000-8000-000000000001";
  const a = "00000000-0000-4000-8000-000000000002";
  const b = "00000000-0000-4000-8000-000000000003";
  const pairKey = `pair:${a}:${b}`;
  const operation = {
    id: operationId,
    operationType: "BLOCK",
    callerServiceId: "profile-connections-service",
    state: "HELD",
    resourceKeys: [pairKey],
    subjects: [a, b],
    fenceEpochs: { [pairKey]: "9" },
    waiterTickets: {},
    createdAt: new Date("2026-11-21T00:00:00.000Z"),
    updatedAt: new Date("2026-11-21T00:00:01.000Z"),
    failureCode: null,
    sourceRevisions: null,
    sourceReceipt: null,
    chatReceipt: null,
  };

  function serviceFor(row: typeof operation | null) {
    return new SafetyOrderingService({
      safetyOperation: { findUnique: jest.fn().mockResolvedValue(row) },
    } as unknown as PrismaService);
  }

  const chat: SafetyCaller = {
    id: "chat-backend-service",
    audience: "auth-safety-ordering",
    scope: "safety:operations:chat:inspect",
  };

  it("allows Chat to inspect exact pair subjects and the held resource epoch", async () => {
    const result = await serviceFor(operation).getOperationForChat(operationId, chat);

    expect(result).toMatchObject({
      operationId,
      type: "BLOCK",
      state: "HELD",
      callerServiceId: "profile-connections-service",
      resourceKeys: [pairKey],
      subjects: [a, b],
      fenceEpochs: { [pairKey]: "9" },
      permitIssued: false,
    });
  });

  it("does not let Chat inspect account operations through the pair verification scope", async () => {
    await expect(
      serviceFor({ ...operation, operationType: "ACCOUNT_MUTATION" }).getOperationForChat(operationId, chat),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("does not let another Auth client use the Chat pair-inspection scope", async () => {
    await expect(serviceFor(operation).getOperationForChat(operationId, {
      ...chat,
      id: "untrusted-client",
    })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("keeps the operation owner inspection behavior unchanged", async () => {
    const profile: SafetyCaller = {
      id: "profile-connections-service",
      audience: "auth-safety-ordering",
      scope: "safety:operations:inspect",
    };

    const result = await serviceFor(operation).getOperation(operationId, profile);
    expect(result).toMatchObject({ operationId, subjects: [a, b] });
  });
});
