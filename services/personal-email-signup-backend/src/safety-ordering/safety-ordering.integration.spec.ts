import { randomUUID, createHash, createHmac } from "crypto";
import { spawnSync } from "child_process";
import { resolve } from "path";
import { UserAccountStatus } from "@prisma/client";
import { ConfigService } from "../config/config.service";
import { PrismaService } from "../../prisma/prisma.module";
import { CanonicalAuthService } from "../canonical-auth/canonical-auth.service";
import { SafetyCaller, SafetyOrderingService } from "./safety-ordering.service";
import { SafetyServiceCredentialVerifier } from "./safety-service-credential-verifier";

const databaseUrl = process.env.SAFETY_ORDERING_DATABASE_URL;
const disposable = process.env.SAFETY_ORDERING_DISPOSABLE === "true";
const describeDatabase = databaseUrl && disposable ? describe : describe.skip;

describeDatabase("Safety Ordering Coordinator PostgreSQL acceptance", () => {
  let prisma: PrismaService;
  let independentPrisma: PrismaService;
  let service: SafetyOrderingService;
  let independentService: SafetyOrderingService;
  const operationIds: string[] = [];
  const resourceKeys = new Set<string>();
  const nonceServiceIds = new Set<string>();
  const testUserIds = new Set<string>();

  const profile: SafetyCaller = {
    id: "profile-connections-service",
    audience: "auth-safety-ordering",
    scope: "safety:operations:request",
  };
  const chatReceiptCaller: SafetyCaller = {
    id: "chat-backend-service",
    audience: "auth-safety-ordering",
    scope: "safety:receipts:chat",
  };

  beforeAll(async () => {
    if (!databaseUrl || !disposable)
      throw new Error("Disposable PostgreSQL gate is required");
    process.env.DATABASE_URL_AUTH = databaseUrl;
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    await prisma.$connect();
    independentPrisma = new PrismaService();
    await independentPrisma.$connect();
    const table = await prisma.$queryRaw<Array<{ table_name: string | null }>>`
      SELECT to_regclass('public.safety_operations')::text AS table_name
    `;
    if (!table[0]?.table_name)
      throw new Error(
        "Safety Ordering migration is not applied to the disposable database",
      );
    service = new SafetyOrderingService(prisma);
    independentService = new SafetyOrderingService(independentPrisma);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.$transaction(async (tx) => {
      if (operationIds.length) {
        await tx.safetyOperationWaiter.deleteMany({
          where: { operationId: { in: operationIds } },
        });
        const stillOwned = await tx.safetyResource.count({
          where: { ownerOperationId: { in: operationIds } },
        });
        if (stillOwned === 0) {
          await tx.safetyOperation.deleteMany({
            where: { id: { in: operationIds } },
          });
        }
      }
      if (resourceKeys.size) {
        await tx.safetyResource.deleteMany({
          where: { resourceKey: { in: [...resourceKeys] } },
        });
      }
      if (nonceServiceIds.size) {
        await tx.safetyServiceNonce.deleteMany({
          where: { serviceId: { in: [...nonceServiceIds] } },
        });
      }
      if (testUserIds.size) {
        await tx.outboxEvent.deleteMany({
          where: { aggregateId: { in: [...testUserIds] } },
        });
        await tx.accountStatusAudit.deleteMany({
          where: { targetUserId: { in: [...testUserIds] } },
        });
        await tx.user.deleteMany({ where: { id: { in: [...testUserIds] } } });
      }
    });
    await prisma.$disconnect();
    await independentPrisma.$disconnect();
  });

  function pair(a = randomUUID(), b = randomUUID()): [string, string] {
    return [a, b];
  }

  async function create(
    type: "ACCOUNT_MUTATION" | "BLOCK" | "UNBLOCK",
    subjects: string[],
  ) {
    const operationId = randomUUID();
    operationIds.push(operationId);
    const result = await service.createOrGet(profile, {
      operationId,
      type,
      subjects,
      ...(type === "ACCOUNT_MUTATION"
        ? {
            commandHash: createHash("sha256")
              .update(`test-account-mutation:${operationId}`)
              .digest("hex"),
          }
        : {}),
    });
    result.resourceKeys.forEach((key) => resourceKeys.add(key));
    return { operationId, result };
  }

  async function finalizePair(operationId: string, keys: string[]) {
    await service.recordChatPairTermination(chatReceiptCaller, {
      receiptId: `chat-${operationId}`,
      operationId,
      resourceKeys: keys,
      kind: "CHAT_PAIR_TERMINATED",
      transactionId: `chat-tx-${operationId}`,
      payloadHash: createHash("sha256").update(operationId).digest("hex"),
      committedAt: new Date().toISOString(),
    });
    return service.finalize(profile, {
      receiptId: `profile-${operationId}`,
      operationId,
      resourceKeys: keys,
      kind: "PROFILE_SOURCE_COMMITTED",
      transactionId: `profile-tx-${operationId}`,
      payloadHash: createHash("sha256")
        .update(`source-${operationId}`)
        .digest("hex"),
      committedAt: new Date().toISOString(),
    });
  }

  function canonicalAuth(safety: SafetyOrderingService) {
    return new CanonicalAuthService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      safety,
    );
  }

  async function createTestUser() {
    const id = randomUUID();
    testUserIds.add(id);
    resourceKeys.add(`account:${id}`);
    await prisma.user.create({
      data: {
        id,
        username: `soc_${id.replace(/-/g, "")}`,
        email: `${id}@soc.example.test`,
      },
    });
    return id;
  }

  function crashWorker(
    mode: "before-commit" | "after-commit",
    operationId: string,
    targetId: string,
    actorId: string,
  ) {
    return spawnSync(
      process.execPath,
      [
        "-r",
        "ts-node/register",
        resolve(__dirname, "account-mutation-crash-worker.ts"),
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 15_000,
        env: {
          ...process.env,
          SAFETY_ORDERING_DATABASE_URL: databaseUrl,
          DATABASE_URL_AUTH: databaseUrl,
          DATABASE_URL: databaseUrl,
          SAFETY_TEST_OPERATION_ID: operationId,
          SAFETY_TEST_TARGET_ID: targetId,
          SAFETY_TEST_ACTOR_ID: actorId,
          SAFETY_TEST_CRASH_MODE: mode,
        },
      },
    );
  }

  it("enforces FIFO for overlapping operations while disjoint pairs proceed", async () => {
    const [a, b] = pair();
    const first = await create("BLOCK", [a, b]);
    const second = await create("BLOCK", [b, a]);
    const third = await create("UNBLOCK", [a, b]);
    const unrelated = await create("BLOCK", pair());

    expect(first.result.state).toBe("HELD");
    expect(second.result.state).toBe("REQUESTED");
    expect(third.result.state).toBe("REQUESTED");
    expect(unrelated.result.state).toBe("HELD");
    expect(second.result.resourceKeys).toEqual(first.result.resourceKeys);
    expect(Object.keys(first.result.waiterTickets)).toHaveLength(1);

    await finalizePair(first.operationId, first.result.resourceKeys);
    const promotedSecond = await service.getOperation(
      second.operationId,
      profile,
    );
    const stillWaitingThird = await service.getOperation(
      third.operationId,
      profile,
    );
    expect(promotedSecond.state).toBe("HELD");
    expect(promotedSecond.waiterTickets).toEqual(second.result.waiterTickets);
    expect(stillWaitingThird.state).toBe("REQUESTED");
    expect(
      BigInt(promotedSecond.fenceEpochs[first.result.resourceKeys[0]]),
    ).toBeGreaterThan(
      BigInt(first.result.fenceEpochs[first.result.resourceKeys[0]]),
    );
    const restartedService = new SafetyOrderingService(prisma);
    expect(
      (await restartedService.getOperation(second.operationId, profile)).state,
    ).toBe("HELD");

    await finalizePair(second.operationId, second.result.resourceKeys);
    expect((await service.getOperation(third.operationId, profile)).state).toBe(
      "HELD",
    );
    const finalizedFirst = await service.getOperation(
      first.operationId,
      profile,
    );
    expect(finalizedFirst.fenceEpochs).toEqual(first.result.fenceEpochs);
    await finalizePair(third.operationId, third.result.resourceKeys);
    await finalizePair(unrelated.operationId, unrelated.result.resourceKeys);
  });

  it("replays identical operation IDs and rejects changed arguments", async () => {
    const [a, b] = pair();
    const first = await create("BLOCK", [a, b]);
    const replay = await service.createOrGet(profile, {
      operationId: first.operationId,
      type: "BLOCK",
      subjects: [b, a],
    });
    expect(replay.operationId).toBe(first.operationId);
    expect(replay.state).toBe(first.result.state);
    await expect(
      service.createOrGet(profile, {
        operationId: first.operationId,
        type: "BLOCK",
        subjects: pair(),
      }),
    ).rejects.toThrow();
    await finalizePair(first.operationId, first.result.resourceKeys);
  });

  it("serializes concurrent overlapping requests in database ticket order", async () => {
    const [a, b] = pair();
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    operationIds.push(...ids);
    const contenderResults = await Promise.allSettled([
      service.createOrGet(profile, {
        operationId: ids[0],
        type: "BLOCK",
        subjects: [a, b],
      }),
      independentService.createOrGet(profile, {
        operationId: ids[1],
        type: "UNBLOCK",
        subjects: [b, a],
      }),
      service.createOrGet(profile, {
        operationId: ids[2],
        type: "BLOCK",
        subjects: [a, b],
      }),
    ]);
    const rejected = contenderResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (rejected) throw rejected.reason;
    const contenders = contenderResults.map((result) => {
      if (result.status !== "fulfilled") throw result.reason;
      return result.value;
    });
    const contendersWithIds = contenders.map((result, index) => ({
      operationId: ids[index],
      result,
    }));
    contenders.forEach((result) =>
      result.resourceKeys.forEach((key) => resourceKeys.add(key)),
    );
    const held = contendersWithIds.filter(
      ({ result }) => result.state === "HELD",
    );
    const waiting = contendersWithIds.filter(
      ({ result }) => result.state === "REQUESTED",
    );
    expect(held).toHaveLength(1);
    expect(waiting).toHaveLength(2);

    const waiterRows = await prisma.safetyOperationWaiter.findMany({
      where: {
        operationId: { in: waiting.map(({ operationId }) => operationId) },
      },
      orderBy: { ticket: "asc" },
    });
    const oldestWaitingId = waiterRows[0].operationId;
    await finalizePair(held[0].operationId, held[0].result.resourceKeys);
    expect((await service.getOperation(oldestWaitingId, profile)).state).toBe(
      "HELD",
    );
    const laterWaiting = waiting.find(
      ({ operationId }) => operationId !== oldestWaitingId,
    );
    expect(
      (await service.getOperation(laterWaiting.operationId, profile)).state,
    ).toBe("REQUESTED");

    const promoted = waiting.find(
      ({ operationId }) => operationId === oldestWaitingId,
    );
    await finalizePair(promoted.operationId, promoted.result.resourceKeys);
    await finalizePair(
      laterWaiting.operationId,
      laterWaiting.result.resourceKeys,
    );
  });

  it("supports atomic three-resource grants without exposing MATCH permits", async () => {
    const [a, b] = pair();
    const blocker = await create("BLOCK", [a, b]);
    const matchId = randomUUID();
    operationIds.push(matchId);
    const keys = [
      `account:${a}`,
      `account:${b}`,
      `pair:${[a, b].sort().join(":")}`,
    ].sort();
    keys.forEach((key) => resourceKeys.add(key));
    const requestHash = createHash("sha256").update(matchId).digest("hex");

    // Seed an internal queue entry to exercise the multi-resource primitive;
    // the public API rejects MATCH before creating or granting such requests.
    await prisma.$transaction(async (tx) => {
      await tx.safetyOperation.create({
        data: {
          id: matchId,
          requestHash,
          operationType: "MATCH",
          callerServiceId: "chat-backend-service",
          subjects: [a, b],
          resourceKeys: keys,
        },
      });
      for (const key of keys) {
        await tx.safetyResource.upsert({
          where: { resourceKey: key },
          create: { resourceKey: key },
          update: {},
        });
        const row = await tx.safetyResource.update({
          where: { resourceKey: key },
          data: { nextTicket: { increment: 1 } },
        });
        await tx.safetyOperationWaiter.create({
          data: {
            operationId: matchId,
            resourceKey: key,
            ticket: row.nextTicket,
          },
        });
      }
    });
    await expect(
      service.createOrGet(
        { ...profile, id: "chat-backend-service" },
        {
          operationId: randomUUID(),
          type: "MATCH",
          subjects: [a, b],
        },
      ),
    ).rejects.toThrow(/not active/i);

    const internal = service as unknown as {
      tryGrant: (id: string) => Promise<void>;
    };
    await internal.tryGrant(matchId);
    const waiting = await service.getOperation(matchId, {
      ...profile,
      id: "chat-backend-service",
    });
    expect(waiting.state).toBe("REQUESTED");
    const resources = await prisma.safetyResource.findMany({
      where: { resourceKey: { in: keys } },
    });
    expect(
      resources.filter((row) => row.ownerOperationId === matchId),
    ).toHaveLength(0);

    await finalizePair(blocker.operationId, blocker.result.resourceKeys);
    const held = await service.getOperation(matchId, {
      ...profile,
      id: "chat-backend-service",
    });
    expect(held.state).toBe("HELD");
    expect(held.permitIssued).toBe(false);
    const owned = await prisma.safetyResource.findMany({
      where: { resourceKey: { in: keys }, ownerOperationId: matchId },
    });
    expect(owned).toHaveLength(3);

    await service.abort(
      { ...profile, id: "chat-backend-service" },
      {
        receiptId: `abort-${matchId}`,
        operationId: matchId,
        resourceKeys: keys,
        kind: "NO_PROTECTED_EFFECT",
        payloadHash: createHash("sha256")
          .update(`abort-${matchId}`)
          .digest("hex"),
        committedAt: new Date().toISOString(),
      },
    );
  });

  it("keeps an unresolved hold after a delay and releases only on source proof", async () => {
    const [subject] = pair();
    const operation = await create("ACCOUNT_MUTATION", [subject]);
    expect(operation.result.state).toBe("HELD");
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(
      (await service.getOperation(operation.operationId, profile)).state,
    ).toBe("HELD");
    await service.markRecoveryRequired(
      { ...profile, scope: "safety:operations:recover" },
      operation.operationId,
      "ACK_UNKNOWN",
    );
    expect(
      (await service.getOperation(operation.operationId, profile)).state,
    ).toBe("RECOVERY_REQUIRED");
    const receipt = {
      receiptId: `deny-${operation.operationId}`,
      operationId: operation.operationId,
      resourceKeys: operation.result.resourceKeys,
      kind: "NO_PROTECTED_EFFECT" as const,
      payloadHash: createHash("sha256")
        .update(`deny-${operation.operationId}`)
        .digest("hex"),
      committedAt: new Date().toISOString(),
    };
    const denied = await service.deny(profile, receipt, "SOURCE_DENIED");
    expect(denied.state).toBe("FINALIZED");
    expect(denied.failureCode).toBe("SOURCE_DENIED");
  });

  it("rejects a source receipt for the wrong resource set without unlocking", async () => {
    const operation = await create("ACCOUNT_MUTATION", [randomUUID()]);
    await expect(
      service.finalize(profile, {
        receiptId: `invalid-${operation.operationId}`,
        operationId: operation.operationId,
        resourceKeys: [`account:${randomUUID()}`],
        kind: "AUTH_SOURCE_COMMITTED",
        transactionId: "wrong-resource",
        payloadHash: createHash("sha256")
          .update("wrong-resource")
          .digest("hex"),
        committedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/resource set/i);
    expect(
      (await service.getOperation(operation.operationId, profile)).state,
    ).toBe("HELD");
    const owner = await prisma.safetyResource.findFirst({
      where: { ownerOperationId: operation.operationId },
    });
    expect(owner?.resourceKey).toBe(operation.result.resourceKeys[0]);
    await service.deny(
      profile,
      {
        receiptId: `deny-${operation.operationId}`,
        operationId: operation.operationId,
        resourceKeys: operation.result.resourceKeys,
        kind: "NO_PROTECTED_EFFECT",
        payloadHash: createHash("sha256")
          .update(`deny-${operation.operationId}`)
          .digest("hex"),
        committedAt: new Date().toISOString(),
      },
      "SOURCE_DENIED",
    );
  });

  it("replays the same finalized pair source receipt without reopening the fence", async () => {
    const operation = await create("BLOCK", pair());
    const keys = operation.result.resourceKeys;
    await service.recordChatPairTermination(chatReceiptCaller, {
      receiptId: `chat-${operation.operationId}`,
      operationId: operation.operationId,
      resourceKeys: keys,
      kind: "CHAT_PAIR_TERMINATED",
      transactionId: `chat-tx-${operation.operationId}`,
      payloadHash: createHash("sha256")
        .update(`chat-${operation.operationId}`)
        .digest("hex"),
      committedAt: "2026-11-21T00:00:05.000Z",
    });
    const receipt = {
      receiptId: `profile-${operation.operationId}`,
      operationId: operation.operationId,
      resourceKeys: keys,
      kind: "PROFILE_SOURCE_COMMITTED" as const,
      transactionId: `profile-tx-${operation.operationId}`,
      payloadHash: createHash("sha256")
        .update(`source-${operation.operationId}`)
        .digest("hex"),
      committedAt: "2026-11-21T00:00:06.000Z",
    };

    const first = await service.finalize(profile, receipt);
    const replay = await service.finalize(profile, receipt);

    expect(first.state).toBe("FINALIZED");
    expect(replay.state).toBe("FINALIZED");
    expect(replay.sourceReceipt).toEqual(receipt);
  });

  it("database guards prevent direct finalization and resource unlock", async () => {
    const operation = await create("ACCOUNT_MUTATION", [randomUUID()]);
    await expect(
      prisma.safetyOperation.update({
        where: { id: operation.operationId },
        data: { state: "FINALIZED" },
      }),
    ).rejects.toThrow(
      /illegal safety operation state transition|cannot finalize/i,
    );
    await expect(
      prisma.safetyResource.update({
        where: { resourceKey: operation.result.resourceKeys[0] },
        data: { ownerOperationId: null },
      }),
    ).rejects.toThrow(/resource release requires a finalized operation/i);
    await expect(
      prisma.safetyResource.update({
        where: { resourceKey: operation.result.resourceKeys[0] },
        data: { fenceEpoch: { decrement: 1 } },
      }),
    ).rejects.toThrow(/counters cannot decrease/i);
    expect(
      (await service.getOperation(operation.operationId, profile)).state,
    ).toBe("HELD");
    await service.deny(
      profile,
      {
        receiptId: `deny-${operation.operationId}`,
        operationId: operation.operationId,
        resourceKeys: operation.result.resourceKeys,
        kind: "NO_PROTECTED_EFFECT",
        payloadHash: createHash("sha256")
          .update(`deny-${operation.operationId}`)
          .digest("hex"),
        committedAt: new Date().toISOString(),
      },
      "SOURCE_DENIED",
    );
  });

  it("uses PostgreSQL nonce uniqueness to reject a replay across verifier instances", async () => {
    const serviceId = `replay-test-${randomUUID()}`;
    nonceServiceIds.add(serviceId);
    const keyId = "test-key-v1";
    const secret = "safety-coordinator-real-postgres-test-secret";
    const audience = "auth-safety-ordering";
    const scope = "safety:operations:request";
    const nonce = Buffer.from(randomUUID().replace(/-/g, "").repeat(2), "hex")
      .toString("base64url")
      .slice(0, 43);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = {
      operationId: randomUUID(),
      type: "BLOCK",
      subjects: [randomUUID(), randomUUID()],
    };
    const sortedJson = (value: unknown): string => {
      if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`;
      if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${sortedJson(record[key])}`)
          .join(",")}}`;
      }
      return JSON.stringify(value);
    };
    const bodyDigest = createHash("sha256")
      .update(sortedJson(body))
      .digest("hex");
    const canonical = JSON.stringify([
      2,
      Number(timestamp),
      serviceId,
      "POST",
      "/internal/v1/safety-operations",
      nonce,
      audience,
      scope,
      bodyDigest,
    ]);
    const signature = createHmac("sha256", secret)
      .update(canonical)
      .digest("hex");
    const config = {
      get: jest.fn().mockReturnValue({
        [serviceId]: {
          protocolVersions: ["v2"],
          keys: { [keyId]: secret },
          audiences: [audience],
          scopes: [scope],
        },
      }),
    } as unknown as ConfigService;
    const verifierA = new SafetyServiceCredentialVerifier(config, prisma);
    const verifierB = new SafetyServiceCredentialVerifier(
      config,
      independentPrisma,
    );
    const headers = {
      serviceId,
      keyId,
      timestamp,
      nonce,
      audience,
      scope,
      signature,
    };
    await expect(
      verifierA.verify(
        "POST",
        "/internal/v1/safety-operations",
        body,
        headers,
        scope,
      ),
    ).resolves.toMatchObject({ id: serviceId });
    await expect(
      verifierB.verify(
        "POST",
        "/internal/v1/safety-operations",
        body,
        headers,
        scope,
      ),
    ).rejects.toThrow(/replay/i);
  });

  it("commits status, audit, outbox, source receipt, and release atomically", async () => {
    const subject = await createTestUser();
    const operationId = randomUUID();
    operationIds.push(operationId);
    const auth = canonicalAuth(service);
    const mutation = {
      operationId,
      targetId: subject,
      actorId: randomUUID(),
      accountStatus: UserAccountStatus.SUSPENDED,
    };

    const result = await auth.changeAccountStatus(mutation);
    const replay = await auth.changeAccountStatus(mutation);
    const user = await prisma.user.findUnique({ where: { id: subject } });
    const operation = await prisma.safetyOperation.findUnique({
      where: { id: operationId },
    });
    const auditCount = await prisma.accountStatusAudit.count({
      where: { targetUserId: subject },
    });
    const lifecycleEvents = await prisma.outboxEvent.count({
      where: { aggregateId: subject },
    });
    const resource = await prisma.safetyResource.findUnique({
      where: { resourceKey: `account:${subject}` },
    });

    expect(result).toEqual({
      authUserId: subject,
      accountStatus: UserAccountStatus.SUSPENDED,
      version: 1,
      changed: true,
    });
    expect(replay).toEqual(result);
    expect(user).toMatchObject({
      accountStatus: UserAccountStatus.SUSPENDED,
      accountStatusVersion: 1,
    });
    expect(auditCount).toBe(1);
    expect(lifecycleEvents).toBe(2);
    expect(operation?.state).toBe("FINALIZED");
    const sourceReceipt = operation?.sourceReceipt as {
      operationId?: string;
      kind?: string;
      result?: unknown;
    } | null;
    expect(sourceReceipt?.operationId).toBe(operationId);
    expect(sourceReceipt?.kind).toBe("AUTH_SOURCE_COMMITTED");
    expect(sourceReceipt?.result).toEqual(result);
    expect(resource?.ownerOperationId).toBeNull();
    await expect(
      auth.changeAccountStatus({
        ...mutation,
        accountStatus: UserAccountStatus.DISABLED,
      }),
    ).rejects.toThrow(/reused with different arguments/i);
    expect(
      await prisma.accountStatusAudit.count({
        where: { targetUserId: subject },
      }),
    ).toBe(1);
  });

  it("rejects direct status writes and a stale completed fence", async () => {
    const subject = await createTestUser();
    await expect(
      prisma.user.update({
        where: { id: subject },
        data: {
          accountStatus: UserAccountStatus.SUSPENDED,
          accountStatusVersion: { increment: 1 },
        },
      }),
    ).rejects.toThrow(/requires an SOC fence/i);

    const operationId = randomUUID();
    operationIds.push(operationId);
    const result = await canonicalAuth(service).changeAccountStatus({
      operationId,
      targetId: subject,
      actorId: randomUUID(),
      accountStatus: UserAccountStatus.SUSPENDED,
    });
    expect(result.version).toBe(1);
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.safety_operation_id', ${operationId}, true)`;
        await tx.$executeRaw`SELECT set_config('app.safety_fence_epoch', '1', true)`;
        return tx.user.update({
          where: { id: subject },
          data: {
            accountStatus: UserAccountStatus.ACTIVE,
            accountStatusVersion: { increment: 1 },
          },
        });
      }),
    ).rejects.toThrow(/does not own the current SOC fence/i);
  });

  it("keeps an earlier SOC account owner ahead of a later status mutation", async () => {
    const subject = await createTestUser();
    const blockerId = randomUUID();
    const statusId = randomUUID();
    operationIds.push(blockerId, statusId);
    const blockerCaller: SafetyCaller = {
      id: "auth-test-blocker",
      audience: "auth-safety-ordering",
      scope: "safety:operations:request",
    };
    const blockerHash = createHash("sha256")
      .update(`blocker:${blockerId}`)
      .digest("hex");
    const blocker = await service.createOrGet(blockerCaller, {
      operationId: blockerId,
      type: "ACCOUNT_MUTATION",
      subjects: [subject],
      commandHash: blockerHash,
    });
    expect(blocker.state).toBe("HELD");

    const auth = canonicalAuth(service);
    const statusMutation = {
      operationId: statusId,
      targetId: subject,
      actorId: randomUUID(),
      accountStatus: UserAccountStatus.SUSPENDED,
    };
    await expect(auth.changeAccountStatus(statusMutation)).rejects.toThrow(
      /waiting for its SOC resource/i,
    );
    expect(
      (await prisma.user.findUnique({ where: { id: subject } }))?.accountStatus,
    ).toBe(UserAccountStatus.ACTIVE);

    await service.deny(
      blockerCaller,
      {
        receiptId: `no-effect-${blockerId}`,
        operationId: blockerId,
        resourceKeys: blocker.resourceKeys,
        kind: "NO_PROTECTED_EFFECT",
        payloadHash: blockerHash,
        committedAt: new Date().toISOString(),
      },
      "TEST_NO_EFFECT",
    );
    const promoted = await service.getOperation(statusId, {
      id: "auth-account-lifecycle",
      audience: "auth-safety-ordering",
      scope: "safety:operations:request",
    });
    expect(promoted.state).toBe("HELD");
    const result = await auth.changeAccountStatus(statusMutation);
    expect(result.accountStatus).toBe(UserAccountStatus.SUSPENDED);
  });

  it("rolls back a process crash before commit and resumes the held operation", async () => {
    const subject = await createTestUser();
    const operationId = randomUUID();
    const actorId = randomUUID();
    operationIds.push(operationId);
    const worker = crashWorker("before-commit", operationId, subject, actorId);
    if (worker.signal !== "SIGKILL") {
      throw new Error(
        `before-commit worker did not crash: status=${worker.status}, error=${worker.error?.message}, stderr=${worker.stderr}`,
      );
    }
    expect(worker.status).toBeNull();

    const afterCrash = await prisma.user.findUnique({ where: { id: subject } });
    const heldOperation = await prisma.safetyOperation.findUnique({
      where: { id: operationId },
    });
    expect(afterCrash).toMatchObject({
      accountStatus: UserAccountStatus.ACTIVE,
      accountStatusVersion: 0,
    });
    expect(heldOperation?.state).toBe("HELD");

    const recovered = await canonicalAuth(service).changeAccountStatus({
      operationId,
      targetId: subject,
      actorId,
      accountStatus: UserAccountStatus.SUSPENDED,
    });
    expect(recovered.version).toBe(1);
    expect(
      (await prisma.safetyOperation.findUnique({ where: { id: operationId } }))
        ?.state,
    ).toBe("FINALIZED");
  });

  it("replays the committed result after a process dies before its HTTP acknowledgement", async () => {
    const subject = await createTestUser();
    const operationId = randomUUID();
    const actorId = randomUUID();
    operationIds.push(operationId);
    const worker = crashWorker("after-commit", operationId, subject, actorId);
    if (worker.signal !== "SIGKILL") {
      throw new Error(
        `after-commit worker did not crash: status=${worker.status}, error=${worker.error?.message}, stderr=${worker.stderr}`,
      );
    }
    expect(worker.status).toBeNull();

    const persisted = await prisma.safetyOperation.findUnique({
      where: { id: operationId },
    });
    expect(persisted?.state).toBe("FINALIZED");
    const auth = canonicalAuth(independentService);
    const mutation = {
      operationId,
      targetId: subject,
      actorId,
      accountStatus: UserAccountStatus.SUSPENDED,
    };
    await expect(auth.changeAccountStatus(mutation)).resolves.toEqual(
      (persisted?.sourceReceipt as Record<string, unknown>)?.result,
    );
    expect(
      await prisma.accountStatusAudit.count({
        where: { targetUserId: subject },
      }),
    ).toBe(1);
    expect(
      await prisma.outboxEvent.count({ where: { aggregateId: subject } }),
    ).toBe(2);
  });
});
