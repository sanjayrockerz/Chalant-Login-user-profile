import { ForbiddenException } from "@nestjs/common";
import { SafetyCaller, SafetyOrderingService } from "./safety-ordering.service";
import { AuthSafetyPrismaService } from "../../prisma/prisma.module";

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
    } as unknown as AuthSafetyPrismaService);
  }

  const chat: SafetyCaller = {
    id: "chat-backend-service",
    audience: "auth-safety-ordering",
    scope: "safety:operations:chat:inspect",
  };

  it("enables DISCLOSURE only with its explicit flag, independent of NODE_ENV", () => {
    const previous = {
      nodeEnv: process.env.NODE_ENV,
      enabled: process.env.AUTH_DISCLOSURE_ENABLED,
    };
    const instance = serviceFor(operation) as any;
    try {
      process.env.NODE_ENV = "production";
      delete process.env.AUTH_DISCLOSURE_ENABLED;
      expect(instance.disclosureEnabled()).toBe(false);
      process.env.AUTH_DISCLOSURE_ENABLED = "true";
      expect(instance.disclosureEnabled()).toBe(true);
      process.env.AUTH_DISCLOSURE_ENABLED = "enabled";
      expect(() => instance.disclosureEnabled()).toThrow(
        "AUTH_DISCLOSURE_ENABLED must be true or false",
      );
    } finally {
      if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous.nodeEnv;
      if (previous.enabled === undefined)
        delete process.env.AUTH_DISCLOSURE_ENABLED;
      else process.env.AUTH_DISCLOSURE_ENABLED = previous.enabled;
    }
  });

  it("replays a finalized void account mutation from its explicit null receipt", async () => {
    const instance = serviceFor(null) as any;
    jest.spyOn(instance, "createOrGet").mockResolvedValue({
      operationId,
      type: "ACCOUNT_MUTATION",
      state: "FINALIZED",
      sourceReceipt: { result: null },
    });
    jest.spyOn(instance, "advanceWaiters").mockResolvedValue(undefined);

    await expect(
      instance.runAccountMutation({
        operationId,
        subjectId: a,
        commandHash: "a".repeat(64),
        commit: jest.fn(),
      }),
    ).resolves.toBeNull();
  });

  it("allows Chat to inspect exact pair subjects and the held resource epoch", async () => {
    const result = await serviceFor(operation).getOperationForChat(
      operationId,
      chat,
    );

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
      serviceFor({
        ...operation,
        operationType: "ACCOUNT_MUTATION",
      }).getOperationForChat(operationId, chat),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("does not let another Auth client use the Chat pair-inspection scope", async () => {
    await expect(
      serviceFor(operation).getOperationForChat(operationId, {
        ...chat,
        id: "untrusted-client",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("keeps the operation owner inspection behavior unchanged", async () => {
    const profile: SafetyCaller = {
      id: "profile-connections-service",
      audience: "auth-safety-ordering",
      scope: "safety:operations:inspect",
    };

    const result = await serviceFor(operation).getOperation(
      operationId,
      profile,
    );
    expect(result).toMatchObject({ operationId, subjects: [a, b] });
  });

  it("derives a MATCH permit only from a checked, source-verified test operation", () => {
    const previous = {
      nodeEnv: process.env.NODE_ENV,
      enabled: process.env.AUTH_MATCH_COMMITMENT_ENABLED,
      testMode: process.env.AUTH_MATCH_COMMITMENT_TEST_MODE,
      sourceEnabled: process.env.AUTH_MATCH_SOURCE_CHECK_ENABLED,
      sourceTestMode: process.env.AUTH_MATCH_SOURCE_CHECK_TEST_MODE,
    };
    process.env.NODE_ENV = "test";
    process.env.AUTH_MATCH_COMMITMENT_ENABLED = "true";
    process.env.AUTH_MATCH_COMMITMENT_TEST_MODE = "true";
    try {
      const match = {
        ...operation,
        operationType: "MATCH",
        state: "CHECKED",
        callerServiceId: "chat-backend-service",
        resourceKeys: [`account:${a}`, `account:${b}`, pairKey].sort(),
        fenceEpochs: {
          [`account:${a}`]: "2",
          [`account:${b}`]: "3",
          [pairKey]: "4",
        },
        requestMetadata: {
          proposalId: "00000000-0000-4000-8000-000000000004",
          chatOperationId: "00000000-0000-4000-8000-000000000005",
          participants: [
            {
              authSubject: a,
              searchId: "00000000-0000-4000-8000-000000000006",
              generation: "1",
              originatingSessionId: "00000000-0000-4000-8000-000000000007",
            },
            {
              authSubject: b,
              searchId: "00000000-0000-4000-8000-000000000008",
              generation: "2",
              originatingSessionId: "00000000-0000-4000-8000-000000000009",
            },
          ],
        },
        sourceRevisions: {
          eligibility: {
            sourceCheckOnly: false,
            permitPolicy: "C17_DISPOSABLE_MATCH_V1",
          },
          profile: { pairRevision: 9 },
          accounts: { [a]: { revision: 3 }, [b]: { revision: 4 } },
        },
      };
      const permit = (serviceFor(null) as any).matchPermitForOperation(match);
      expect(permit).toMatchObject({
        operationId,
        proposalId: match.requestMetadata.proposalId,
        chatOperationId: match.requestMetadata.chatOperationId,
        testOnly: true,
      });
      expect(permit.permitId).toMatch(/^[a-f0-9]{64}$/);
      expect(
        (serviceFor(null) as any).matchPermitForOperation({
          ...match,
          state: "HELD",
        }),
      ).toBeNull();
      process.env.NODE_ENV = "development";
      expect(
        (serviceFor(null) as any).matchPermitForOperation(match),
      ).toBeNull();
      process.env.NODE_ENV = "production";
      process.env.AUTH_MATCH_SOURCE_CHECK_ENABLED = "true";
      process.env.AUTH_MATCH_SOURCE_CHECK_TEST_MODE = "false";
      process.env.AUTH_MATCH_COMMITMENT_TEST_MODE = "false";
      process.env.AUTH_MATCH_COMMITMENT_ENABLED = "true";
      const productionMatch = {
        ...match,
        sourceRevisions: {
          ...match.sourceRevisions,
          eligibility: { sourceCheckOnly: false, permitPolicy: "MATCH_V1" },
        },
      };
      const productionPermit = (
        serviceFor(null) as any
      ).matchPermitForOperation(productionMatch);
      expect(productionPermit).toMatchObject({
        policy: "MATCH_V1",
        operationId,
        proposalId: match.requestMetadata.proposalId,
      });
      expect(productionPermit).not.toHaveProperty("testOnly");
      expect(productionPermit.permitId).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous.nodeEnv;
      if (previous.enabled === undefined)
        delete process.env.AUTH_MATCH_COMMITMENT_ENABLED;
      else process.env.AUTH_MATCH_COMMITMENT_ENABLED = previous.enabled;
      if (previous.testMode === undefined)
        delete process.env.AUTH_MATCH_COMMITMENT_TEST_MODE;
      else process.env.AUTH_MATCH_COMMITMENT_TEST_MODE = previous.testMode;
      if (previous.sourceEnabled === undefined)
        delete process.env.AUTH_MATCH_SOURCE_CHECK_ENABLED;
      else process.env.AUTH_MATCH_SOURCE_CHECK_ENABLED = previous.sourceEnabled;
      if (previous.sourceTestMode === undefined)
        delete process.env.AUTH_MATCH_SOURCE_CHECK_TEST_MODE;
      else
        process.env.AUTH_MATCH_SOURCE_CHECK_TEST_MODE = previous.sourceTestMode;
    }
  });

  it("accepts each fresh disclosure only from current PostgreSQL consent evidence, including a prior reveal", () => {
    const instance = serviceFor(null) as any;
    const binding = {
      operationId,
      roomId: "00000000-0000-4000-8000-000000000004",
      requesterSubject: a,
      participantSubjects: [a, b],
    };
    const state = {
      operationId,
      roomId: binding.roomId,
      requesterSubject: a,
      participantSubjects: [a, b],
      source: "POSTGRESQL",
      state: "ELIGIBLE",
      revealOutcome: "READY",
      consentLockedAt: "2026-11-23T10:30:00.000Z",
      decisionA: true,
      decisionB: true,
      safetyRestricted: false,
      noMessageTermination: false,
      roomStatus: "ACTIVE",
      endReason: null,
      matchAt: "2026-11-23T10:00:00.000Z",
      firstMessageAt: "2026-11-23T10:01:00.000Z",
      eligibleAt: "2026-11-23T10:31:00.000Z",
      databaseNow: "2026-11-23T10:32:00.000Z",
    };
    expect(instance.validChatDisclosureState(state, binding)).toBe(true);
    expect(
      instance.validChatDisclosureState(
        {
          ...state,
          revealOutcome: "DISPATCHED",
          roomStatus: "REVEALED",
          endReason: "MUTUAL_REVEAL",
        },
        binding,
      ),
    ).toBe(true);
    expect(
      instance.validChatDisclosureState({ ...state, source: "REDIS" }, binding),
    ).toBe(false);
    expect(
      instance.validChatDisclosureState(
        { ...state, safetyRestricted: true },
        binding,
      ),
    ).toBe(false);
    expect(
      instance.validChatDisclosureState(
        { ...state, databaseNow: "2026-11-23T10:30:59.999Z" },
        binding,
      ),
    ).toBe(false);
  });
});
