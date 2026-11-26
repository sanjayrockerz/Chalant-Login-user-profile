import { createHmac, randomUUID } from "crypto";
import { IncomingMessage, ServerResponse } from "http";
import { createServer } from "https";
import { AddressInfo } from "net";
import { readFileSync, writeFileSync } from "fs";
import {
  AuthSafetyPrismaService,
  PrismaService,
} from "../../prisma/prisma.module";
import { ChatProfileOutboxWorker } from "./chat-profile-outbox.worker";

const enabled =
  process.env.AUTH_LIFECYCLE_OUTBOX_RUN_REAL_DB === "1" &&
  process.env.AUTH_LIFECYCLE_OUTBOX_DISPOSABLE === "true" &&
  process.env.DATABASE_URL_AUTH &&
  process.env.AUTH_SAFETY_DATABASE_URL &&
  process.env.AUTH_LIFECYCLE_OUTBOX_RUN_ID;

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a JSON object in the outbox fixture request");
  }
  return value as Record<string, unknown>;
};

const requiredString = (
  record: Record<string, unknown>,
  field: string,
): string => {
  const value = record[field];
  if (typeof value !== "string") {
    throw new Error(`Expected string field ${field} in the outbox fixture`);
  }
  return value;
};

(enabled ? describe : describe.skip)(
  "Auth outbox failure isolation with restricted disposable roles",
  () => {
    const secret = "auth-outbox-isolation-secret-that-is-at-least-32-bytes";
    const profileSecret =
      "profile-cleanup-outbox-secret-at-least-32-bytes-long";
    const now = new Date();
    const subjects = Array.from({ length: 5 }, () => randomUUID());
    const ids = Array.from({ length: 7 }, () => randomUUID());
    let runtime: PrismaService;
    let safety: AuthSafetyPrismaService;
    let server: ReturnType<typeof createServer>;
    let worker: ChatProfileOutboxWorker;
    let competingWorker: ChatProfileOutboxWorker;
    let listeningUrl: string;
    let releaseProvision!: () => void;
    let provisionReleased = false;
    let migrationBackfillEvidence: Record<string, unknown>;
    const received: Array<{
      path: string;
      body: Record<string, unknown>;
      startedAt: number;
      finishedAt?: number;
    }> = [];
    let heldProvisionEventId: string;

    const waitUntil = async (
      predicate: () => Promise<boolean> | boolean,
      label: string,
    ) => {
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline) {
        if (await predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`Timed out waiting for ${label}`);
    };

    const signedSuperseded = (event: Record<string, unknown>) => {
      const payload = asRecord(event.payload);
      const eventId = requiredString(event, "eventId");
      const eventType = requiredString(event, "eventType");
      const subject = requiredString(payload, "authUserId");
      const operationId = randomUUID();
      const requestHash = "a".repeat(64);
      const fenceReceiptHash = "b".repeat(64);
      const lifecycleRevision = "3";
      const signature = createHmac("sha256", secret)
        .update(
          `chat-outbox.superseded.v1|${eventId}|${eventType}|${subject}|${operationId}|${lifecycleRevision}|${requestHash}|${fenceReceiptHash}`,
        )
        .digest("hex");
      return {
        accepted: false,
        terminalReceipt: {
          eventId,
          eventType,
          subject,
          outcome: "SUPERSEDED_BY_DELETION",
          operationId,
          lifecycleRevision,
          fenceRequestHash: requestHash,
          fenceReceiptHash,
          signature,
        },
      };
    };

    beforeAll(async () => {
      if (
        !process.env.AUTH_RUNTIME_DATABASE_ROLE ||
        !process.env.AUTH_SAFETY_DATABASE_ROLE
      ) {
        throw new Error(
          "Restricted Auth runtime and safety role names are required",
        );
      }
      const databaseUrl = process.env.AUTH_LIFECYCLE_OUTBOX_DATABASE_URL;
      if (!databaseUrl)
        throw new Error("Run-scoped Auth runtime database URL is required");
      process.env.DATABASE_URL_AUTH = databaseUrl;
      runtime = new PrismaService();
      safety = new AuthSafetyPrismaService();
      await runtime.onModuleInit();
      await safety.onModuleInit();
      const migrationFixtures = await runtime.outboxEvent.findMany({
        where: {
          id: {
            in: [
              "00000000-0000-4000-8000-000000000091",
              "00000000-0000-4000-8000-000000000093",
            ],
          },
        },
      });
      const migratedDelivered = migrationFixtures.find(
        (row) => row.id === "00000000-0000-4000-8000-000000000091",
      );
      const migratedPending = migrationFixtures.find(
        (row) => row.id === "00000000-0000-4000-8000-000000000093",
      );
      if (
        !migratedDelivered ||
        !migratedDelivered.deliveredAt ||
        !migratedDelivered.terminalAt ||
        migratedDelivered.deliveryOutcome !== "APPLIED" ||
        migratedDelivered.terminalAt.getTime() !==
          migratedDelivered.deliveredAt.getTime() ||
        !migratedPending ||
        migratedPending.terminalAt !== null ||
        migratedPending.deliveryOutcome !== null
      ) {
        throw new Error(
          "Populated outbox outcome migration did not preserve delivered and pending rows",
        );
      }
      migrationBackfillEvidence = {
        status: "PASS",
        deliveredRows: 1,
        pendingRowsPreserved: 1,
        terminalOutcome: migratedDelivered.deliveryOutcome,
        terminalTimeMatchesPriorDelivery: true,
      };
      const profileOperationId = randomUUID();
      const profileSubject = subjects[4];
      const profileRequestHash = "e".repeat(64);
      const profileRevision = "23";
      const profilePayload = {
        eventType: "auth.account.deletion.cleanup.v1",
        operationId: profileOperationId,
        subject: profileSubject,
        requestHash: profileRequestHash,
        lifecycleRevision: profileRevision,
      };
      await safety.safetyOperation.create({
        data: {
          id: profileOperationId,
          requestHash: profileRequestHash,
          operationType: "ACCOUNT_MUTATION",
          callerServiceId: "outbox-failure-isolation-test",
          subjects: [profileSubject],
          resourceKeys: [`account:${profileSubject}`],
          state: "FINALIZED",
          requestMetadata: {
            purpose: "ACCOUNT_DELETION_V1",
            phase: "CLEANUP_IN_PROGRESS",
            lifecycleRevision: profileRevision,
          },
        },
      });

      const provisionPayload = { authUserId: subjects[0] };
      const lifecyclePayload = {
        authUserId: subjects[0],
        accountStatus: "SUSPENDED",
        version: 2,
      };
      const realtimePayload = {
        eventId: ids[3],
        eventType: "auth.lifecycle.v1",
        version: 1,
        subject: subjects[2],
        action: "SESSION_REVOKED",
        scope: "SESSION",
        sessionId: randomUUID(),
        occurredAt: now.toISOString(),
      };
      const statusPayload = {
        eventId: ids[4],
        eventType: "auth.lifecycle.v1",
        version: 1,
        subject: subjects[3],
        action: "ACCOUNT_STATUS_CHANGED",
        scope: "ACCOUNT",
        accountStatus: "SUSPENDED",
        revision: 2,
        occurredAt: now.toISOString(),
      };

      const events = [
        {
          id: ids[0],
          eventType: "chat.profile.provision.v1",
          aggregateId: subjects[0],
          payload: provisionPayload,
          createdAt: new Date(now.getTime() - 5_000),
        },
        {
          id: ids[1],
          eventType: "chat.account.lifecycle.v1",
          aggregateId: subjects[0],
          payload: lifecyclePayload,
          createdAt: new Date(now.getTime() - 4_000),
        },
        {
          id: ids[2],
          eventType: "chat.profile.provision.v1",
          aggregateId: subjects[1],
          payload: { authUserId: subjects[1] },
          createdAt: new Date(now.getTime() - 3_000),
        },
        {
          id: ids[3],
          eventType: "auth.lifecycle.v1",
          aggregateId: subjects[2],
          payload: realtimePayload,
          createdAt: new Date(now.getTime() - 2_000),
        },
        {
          id: ids[4],
          eventType: "auth.lifecycle.v1",
          aggregateId: subjects[3],
          payload: statusPayload,
          createdAt: new Date(now.getTime() - 1_000),
        },
        {
          id: ids[5],
          eventType: "auth.account.deletion.cleanup.v1",
          aggregateId: profileSubject,
          payload: profilePayload,
          createdAt: now,
        },
      ];
      heldProvisionEventId = ids[0];
      for (const event of events) {
        await runtime.outboxEvent.create({ data: event as never });
      }

      const keyPath = process.env.AUTH_LIFECYCLE_TEST_TLS_KEY;
      const certPath = process.env.AUTH_LIFECYCLE_TEST_TLS_CERT;
      if (!keyPath || !certPath)
        throw new Error("Runner-generated TLS files are required");
      server = createServer(
        { key: readFileSync(keyPath), cert: readFileSync(certPath) },
        (request: IncomingMessage, response: ServerResponse) => {
          const chunks: Buffer[] = [];
          request.on("data", (chunk: Buffer) => chunks.push(chunk));
          const handleRequest = async () => {
            const body = asRecord(
              JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
            );
            const observation: (typeof received)[number] = {
              path: request.url ?? "",
              body,
              startedAt: Date.now(),
            };
            received.push(observation);
            if (
              request.url === "/chat-provision" &&
              body.eventId === heldProvisionEventId
            ) {
              if (!provisionReleased)
                await new Promise<void>((resolve) => {
                  releaseProvision = resolve;
                });
              response.statusCode = 200;
              response.end(JSON.stringify(signedSuperseded(body)));
            } else if (request.url === "/chat-provision") {
              response.statusCode = 401;
              response.end("unauthorized");
            } else if (request.url === "/profile-cleanup") {
              const receipt = {
                ...body,
                state: "CLEANUP_COMPLETED",
                receiptHash: createHmac("sha256", profileSecret)
                  .update(
                    `receipt.cleanup.${requiredString(body, "operationId")}.${requiredString(body, "subject")}.${requiredString(body, "lifecycleRevision")}.${requiredString(body, "requestHash")}.CLEANUP_COMPLETED`,
                  )
                  .digest("hex"),
                resultMetadata: {},
              };
              response.statusCode = 200;
              response.end(JSON.stringify(receipt));
            } else {
              response.statusCode = 202;
              response.end(JSON.stringify({ accepted: true }));
            }
            observation.finishedAt = Date.now();
          };
          request.on("end", () => {
            void handleRequest().catch(() => {
              if (!response.headersSent) response.statusCode = 500;
              response.end("outbox test fixture request failed");
            });
          });
        },
      );
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address() as AddressInfo;
      listeningUrl = `https://127.0.0.1:${address.port}`;
      const config = {
        get(key: string): string | undefined {
          const values: Record<string, string> = {
            CHAT_PROFILE_PROVISIONING_URL: `${listeningUrl}/chat-provision`,
            CHAT_ACCOUNT_LIFECYCLE_URL: `${listeningUrl}/chat-lifecycle`,
            AUTH_LIFECYCLE_URL: `${listeningUrl}/realtime-lifecycle`,
            PROFILE_ACCOUNT_DELETION_CLEANUP_URL: `${listeningUrl}/profile-cleanup`,
            CHAT_PROFILE_PROVISIONING_HMAC_SECRET: secret,
            AUTH_LIFECYCLE_HMAC_SECRET:
              "realtime-outbox-secret-at-least-32-characters-long",
            PROFILE_ACCOUNT_DELETION_HMAC_SECRET: profileSecret,
          };
          return values[key];
        },
      };
      worker = new ChatProfileOutboxWorker(runtime, safety, config as never);
      competingWorker = new ChatProfileOutboxWorker(
        runtime,
        safety,
        config as never,
      );
    });

    afterAll(async () => {
      provisionReleased = true;
      releaseProvision?.();
      if (runtime) {
        await runtime.outboxEvent.deleteMany({ where: { id: { in: ids } } });
        await runtime.$disconnect();
      }
      if (safety) {
        await safety.safetyOperation.deleteMany({
          where: { callerServiceId: "outbox-failure-isolation-test" },
        });
        await safety.$disconnect();
      }
      if (server?.listening)
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it("isolates rejected Chat events while valid Realtime, account-status, and Profile cleanup events advance", async () => {
      const started = Date.now();
      let deliverySettled = false;
      const firstPoll = worker.deliverOne().then(() => {
        deliverySettled = true;
      });
      await waitUntil(
        () =>
          received.some(
            (event) =>
              event.path === "/chat-provision" &&
              event.body.eventId === heldProvisionEventId,
          ),
        "held Chat provisioning attempt",
      );
      await waitUntil(async () => {
        const rows = await runtime.outboxEvent.findMany({
          where: { id: { in: [ids[3], ids[5]] } },
        });
        return rows.every((row) => row.deliveredAt !== null);
      }, "independent Realtime and Profile cleanup acknowledgements while Chat is held");
      expect(deliverySettled).toBe(false);
      const independentCompletionMs = Date.now() - started;
      provisionReleased = true;
      releaseProvision();
      await firstPoll;

      const firstRows = await runtime.outboxEvent.findMany({
        where: { id: { in: ids } },
      });
      const byId = new Map(firstRows.map((row) => [row.id, row]));
      expect(byId.get(ids[0])).toMatchObject({
        deliveredAt: null,
        deliveryOutcome: "SUPERSEDED_BY_DELETION",
      });
      expect(byId.get(ids[0])?.terminalAt).toBeInstanceOf(Date);
      expect(byId.get(ids[1])?.deliveredAt).toBeNull();
      expect(byId.get(ids[2])).toMatchObject({
        deliveredAt: null,
        terminalAt: null,
        attempts: 0,
      });
      for (const eventId of [ids[3], ids[5]]) {
        expect(byId.get(eventId)?.deliveredAt).toBeInstanceOf(Date);
        expect(byId.get(eventId)?.deliveryOutcome).toBe("APPLIED");
      }
      expect(byId.get(ids[4])?.deliveredAt).toBeNull();

      await worker.deliverOne();
      const finalRows = await runtime.outboxEvent.findMany({
        where: { id: { in: ids } },
      });
      const finalById = new Map(finalRows.map((row) => [row.id, row]));
      expect(finalById.get(ids[1])?.deliveredAt).toBeInstanceOf(Date);
      expect(finalById.get(ids[4])?.deliveredAt).toBeInstanceOf(Date);
      expect(finalById.get(ids[2])).toMatchObject({
        deliveredAt: null,
        terminalAt: null,
        attempts: 1,
        lastError: "Chat returned HTTP 401",
      });
      expect(received.some((event) => event.path === "/chat-lifecycle")).toBe(
        true,
      );
      expect(independentCompletionMs).toBeLessThan(3_000);
      expect(
        received
          .filter((event) =>
            ["/realtime-lifecycle", "/profile-cleanup"].includes(event.path),
          )
          .every(
            (event) =>
              event.finishedAt !== undefined &&
              event.finishedAt - event.startedAt < 1_000,
          ),
      ).toBe(true);
      const evidencePath = process.env.AUTH_LIFECYCLE_OUTBOX_EVIDENCE_FILE;
      if (!evidencePath)
        throw new Error("Run-scoped sanitized evidence path is required");
      writeFileSync(
        evidencePath,
        `${JSON.stringify(
          {
            runId: process.env.AUTH_LIFECYCLE_OUTBOX_RUN_ID,
            scenario: "OUTBOX_FAILURE_ISOLATION",
            status: "PASS",
            populatedMigrationBackfill: migrationBackfillEvidence,
            authRuntimeRole: process.env.AUTH_RUNTIME_DATABASE_ROLE,
            authSafetyRole: process.env.AUTH_SAFETY_DATABASE_ROLE,
            pendingAtStart: 6,
            independentEventsAdvancedWhileChatHeld: [
              "AUTH_REALTIME_SESSION_REVOCATION",
              "PROFILE_DELETION_CLEANUP",
            ],
            authAccountStatusDeliveredOnFollowingLaneTurn: true,
            obsoleteChatProvisionTerminalOutcome: "SUPERSEDED_BY_DELETION",
            unauthorizedChatProvisionRemainedPending: true,
            chatSameSubjectLifecycleWaitedForOlderProvisioning: true,
            independentCompletionMs,
            destinationRequestDurationsMs: received.map(
              ({ path, startedAt, finishedAt }) => ({
                destination: path,
                duration:
                  finishedAt === undefined ? null : finishedAt - startedAt,
              }),
            ),
            events: finalRows.map(
              ({
                id,
                eventType,
                attempts,
                deliveredAt,
                terminalAt,
                deliveryOutcome,
              }) => ({
                id,
                eventType,
                attempts,
                delivered: deliveredAt !== null,
                terminal: terminalAt !== null,
                outcome: deliveryOutcome,
              }),
            ),
            causalOrdering:
              "Chat identity events for one Auth subject remain ordered across provisioning and lifecycle event types",
          },
          null,
          2,
        )}\n`,
        { mode: 0o600 },
      );
    });

    it("recovers an expired claim while two workers compete without duplicate delivery", async () => {
      const eventId = ids[6];
      const payload = {
        eventId,
        eventType: "auth.lifecycle.v1",
        version: 1,
        subject: randomUUID(),
        action: "SESSION_REVOKED",
        scope: "SESSION",
        sessionId: randomUUID(),
        occurredAt: new Date().toISOString(),
      };
      await runtime.outboxEvent.create({
        data: {
          id: eventId,
          eventType: "auth.lifecycle.v1",
          aggregateId: payload.subject,
          payload,
          attempts: 1,
          claimedAt: new Date(Date.now() - 61_000),
          claimToken: randomUUID(),
          nextAttemptAt: new Date(Date.now() - 1_000),
        },
      });
      await Promise.all([worker.deliverOne(), competingWorker.deliverOne()]);

      const row = await runtime.outboxEvent.findUniqueOrThrow({
        where: { id: eventId },
      });
      expect(row.deliveredAt).toBeInstanceOf(Date);
      expect(row.deliveryOutcome).toBe("APPLIED");
      expect(row.attempts).toBe(2);
      expect(row.claimedAt).toBeNull();
      expect(row.claimToken).toBeNull();
      expect(
        received.filter(
          (event) =>
            event.path === "/realtime-lifecycle" &&
            event.body.eventId === eventId,
        ),
      ).toHaveLength(1);
      const evidencePath = process.env.AUTH_LIFECYCLE_OUTBOX_EVIDENCE_FILE;
      if (!evidencePath)
        throw new Error("Run-scoped sanitized evidence path is required");
      const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as Record<
        string,
        unknown
      >;
      evidence.expiredLeaseRecovery = {
        status: "PASS",
        previousAttempts: 1,
        attemptsAfterRecovery: row.attempts,
        competingWorkers: 2,
        receiverEffects: 1,
        durableOutcome: row.deliveryOutcome,
      };
      writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
        mode: 0o600,
      });
    });
  },
);
