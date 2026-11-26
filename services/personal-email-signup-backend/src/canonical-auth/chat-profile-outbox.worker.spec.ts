import { createHmac } from "crypto";
import { EventEmitter } from "node:events";
import * as https from "node:https";
import { PassThrough } from "node:stream";
jest.mock("node:https", () => ({ request: jest.fn() }));
import { ChatProfileOutboxWorker } from "./chat-profile-outbox.worker";
import { PrismaService } from "../../prisma/prisma.module";

describe("ChatProfileOutboxWorker", () => {
  const event = {
    id: "00000000-0000-4000-8000-000000000002",
    eventType: "chat.profile.provision.v1",
    payload: { authUserId: "00000000-0000-4000-8000-000000000001" },
    attempts: 0,
  };
  const config: { get: jest.Mock<string | undefined, [string]> } = {
    get: jest.fn((key: string): string | undefined => {
      if (key === "CHAT_PROFILE_PROVISIONING_URL")
        return "https://chat.example.test/api/v1/internal/v1/chat-profile-provisioning";
      if (key === "CHAT_PROFILE_PROVISIONING_HMAC_SECRET")
        return "a-secret-that-is-long-enough-for-testing";
      return undefined;
    }),
  };
  let prisma: {
    outboxEvent: {
      findFirst: jest.MockedFunction<
        (args: Record<string, unknown>) => Promise<typeof event>
      >;
      updateMany: jest.MockedFunction<
        (args: {
          data?: Record<string, unknown>;
          where?: Record<string, unknown>;
        }) => Promise<{ count: number }>
      >;
    };
    $queryRawUnsafe: jest.MockedFunction<
      (...args: unknown[]) => Promise<Array<{ blocked: boolean }>>
    >;
  };
  let worker: ChatProfileOutboxWorker;
  let nextStatus: number | undefined;
  let nextBody = JSON.stringify({ accepted: true });
  let pendingResponses: Array<(statusCode: number) => void>;
  let requests: Array<{
    url: URL;
    options: https.RequestOptions;
    body: string;
  }>;
  let statusByPath: Record<string, number>;

  beforeEach(() => {
    jest.restoreAllMocks();
    nextStatus = 202;
    nextBody = JSON.stringify({ accepted: true });
    pendingResponses = [];
    requests = [];
    statusByPath = {};
    (https.request as jest.Mock).mockReset().mockImplementation(((
      url: URL,
      options: https.RequestOptions,
      callback: (
        response: NodeJS.ReadableStream & { statusCode?: number },
      ) => void,
    ) => {
      const request = new EventEmitter() as EventEmitter & {
        end: (body: string) => void;
        destroy: (error: Error) => void;
      };
      request.end = (body: string) => {
        requests.push({ url, options, body });
        const respond = (statusCode: number) => {
          const response = new PassThrough() as PassThrough & {
            statusCode?: number;
          };
          response.statusCode = statusByPath[url.pathname] ?? statusCode;
          callback(response);
          response.end(nextBody);
        };
        if (nextStatus === undefined) pendingResponses.push(respond);
        else respond(nextStatus);
      };
      request.destroy = (error: Error) => {
        queueMicrotask(() => request.emit("error", error));
      };
      return request as unknown as ReturnType<typeof https.request>;
    }) as typeof https.request);
    config.get.mockImplementation((key: string): string | undefined => {
      if (key === "CHAT_PROFILE_PROVISIONING_URL")
        return "https://chat.example.test/api/v1/internal/v1/chat-profile-provisioning";
      if (key === "CHAT_PROFILE_PROVISIONING_HMAC_SECRET")
        return "a-secret-that-is-long-enough-for-testing";
      return undefined;
    });
    prisma = {
      outboxEvent: {
        findFirst: jest
          .fn<Promise<typeof event>, [Record<string, unknown>]>()
          .mockResolvedValue(event),
        updateMany: jest
          .fn<
            Promise<{ count: number }>,
            [
              {
                data?: Record<string, unknown>;
                where?: Record<string, unknown>;
              },
            ]
          >()
          .mockResolvedValue({ count: 1 }),
      },
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ blocked: false }]),
    };
    worker = new ChatProfileOutboxWorker(
      prisma as unknown as PrismaService,
      prisma as never,
      config as never,
    );
  });

  it("only marks delivery complete after the Chat endpoint accepts the event", async () => {
    await worker.deliverOne();

    const request = requests[0];
    expect(request?.url.href).toBe(
      "https://chat.example.test/api/v1/internal/v1/chat-profile-provisioning",
    );
    expect(request?.options.method).toBe("POST");
    expect(request?.options.agent).toBe(false);
    const requestHeaders = request?.options.headers as Record<string, string>;
    expect(requestHeaders.connection).toBe("close");
    expect(request?.body).toContain(event.payload.authUserId);
    const headers = requestHeaders;
    const timestamp = headers["x-chat-event-timestamp"];
    const body = request?.body;
    expect(typeof body).toBe("string");
    if (typeof body !== "string") throw new Error("Request body must be text");
    const expectedSignature = createHmac(
      "sha256",
      "a-secret-that-is-long-enough-for-testing",
    )
      .update(`${timestamp}.${body}`)
      .digest("hex");
    expect(headers["x-chat-event-signature"]).toBe(expectedSignature);
    const successfulUpdate =
      prisma.outboxEvent.updateMany.mock.calls.at(-1)?.[0];
    expect(successfulUpdate?.data?.deliveredAt).toBeInstanceOf(Date);
  });

  it.each([
    [
      "an explicit negative response without a receipt",
      '{"accepted":false}',
      "Chat superseded-event receipt binding is invalid",
    ],
    ["an empty response", "", "Chat acknowledgement is invalid"],
    ["a malformed response", "not-json", "Chat acknowledgement is invalid"],
    [
      "an unrelated success body",
      '{"status":"ok"}',
      "Chat acknowledgement is invalid",
    ],
    [
      "a contradictory applied envelope",
      '{"accepted":true,"stale":false}',
      "Chat acknowledgement is invalid",
    ],
  ])("does not acknowledge Chat 2xx with %s", async (_label, body, error) => {
    nextBody = body;

    await worker.deliverOne();

    const retry = prisma.outboxEvent.updateMany.mock.calls.at(-1)?.[0];
    expect(retry?.data?.deliveredAt).toBeUndefined();
    expect(retry?.data?.terminalAt).toBeUndefined();
    expect(retry?.data?.deliveryOutcome).toBeUndefined();
    expect(retry?.data?.nextAttemptAt).toBeInstanceOf(Date);
    expect(retry?.data?.lastError).toBe(error);
  });

  it("keeps failed delivery pending and schedules a retry", async () => {
    nextStatus = 503;

    await worker.deliverOne();

    const failedUpdate = prisma.outboxEvent.updateMany.mock.calls.at(-1)?.[0];
    expect(failedUpdate?.data?.nextAttemptAt).toBeInstanceOf(Date);
    expect(failedUpdate?.data?.lastError).toBe("Chat returned HTTP 503");
    expect(failedUpdate?.data?.claimToken).toBeNull();
  });

  it("accepts only an exact Chat-signed deletion supersession receipt", async () => {
    const operationId = "00000000-0000-4000-8000-000000000030";
    const requestHash = "c".repeat(64);
    const fenceReceiptHash = "d".repeat(64);
    const signature = createHmac(
      "sha256",
      "a-secret-that-is-long-enough-for-testing",
    )
      .update(
        `chat-outbox.superseded.v1|${event.id}|${event.eventType}|${event.payload.authUserId}|${operationId}|3|${requestHash}|${fenceReceiptHash}`,
      )
      .digest("hex");
    nextBody = JSON.stringify({
      accepted: false,
      terminalReceipt: {
        eventId: event.id,
        eventType: event.eventType,
        subject: event.payload.authUserId,
        outcome: "SUPERSEDED_BY_DELETION",
        operationId,
        lifecycleRevision: "3",
        fenceRequestHash: requestHash,
        fenceReceiptHash,
        signature,
      },
    });

    await worker.deliverOne();

    const update = prisma.outboxEvent.updateMany.mock.calls.at(-1)?.[0];
    expect(update?.data?.deliveryOutcome).toBe("SUPERSEDED_BY_DELETION");
    expect(update?.data?.terminalAt).toBeInstanceOf(Date);
    expect(update?.data?.deliveredAt).toBeUndefined();
  });

  it("does not terminalize a mismatched Chat deletion receipt", async () => {
    nextBody = JSON.stringify({
      accepted: false,
      terminalReceipt: {
        eventId: "00000000-0000-4000-8000-000000000099",
        eventType: event.eventType,
        subject: event.payload.authUserId,
        outcome: "SUPERSEDED_BY_DELETION",
        operationId: "00000000-0000-4000-8000-000000000030",
        lifecycleRevision: "3",
        fenceRequestHash: "a".repeat(64),
        fenceReceiptHash: "b".repeat(64),
        signature: "0".repeat(64),
      },
    });

    await worker.deliverOne();

    const retry = prisma.outboxEvent.updateMany.mock.calls.at(-1)?.[0];
    expect(retry?.data?.nextAttemptAt).toBeInstanceOf(Date);
    expect(retry?.data?.deliveryOutcome).toBeUndefined();
    expect(retry?.data?.terminalAt).toBeUndefined();
    expect(retry?.data?.lastError).toBe(
      "Chat superseded-event receipt binding is invalid",
    );
  });

  it("isolates a rejected Chat lane from Chat lifecycle and Realtime delivery", async () => {
    const provision = { ...event, id: "00000000-0000-4000-8000-000000000010" };
    const chatLifecycle = {
      ...event,
      id: "00000000-0000-4000-8000-000000000011",
      eventType: "chat.account.lifecycle.v1",
      payload: {
        authUserId: "00000000-0000-4000-8000-000000000021",
        accountStatus: "SUSPENDED",
        version: 2,
      },
    };
    const authLifecycle = {
      ...event,
      id: "00000000-0000-4000-8000-000000000012",
      eventType: "auth.lifecycle.v1",
      payload: {
        eventId: "00000000-0000-4000-8000-000000000012",
        eventType: "auth.lifecycle.v1",
        version: 1,
        subject: "00000000-0000-4000-8000-000000000022",
        action: "SESSION_REVOKED",
        scope: "SESSION",
        sessionId: "00000000-0000-4000-8000-000000000023",
        occurredAt: new Date().toISOString(),
      },
    };
    const byType = new Map<string, typeof event>();
    byType.set(provision.eventType, provision);
    byType.set(
      chatLifecycle.eventType,
      chatLifecycle as unknown as typeof event,
    );
    byType.set(
      authLifecycle.eventType,
      authLifecycle as unknown as typeof event,
    );
    config.get.mockImplementation(
      (key: string) =>
        ({
          CHAT_PROFILE_PROVISIONING_URL: "https://chat.example.test/profile",
          CHAT_ACCOUNT_LIFECYCLE_URL: "https://chat.example.test/lifecycle",
          AUTH_LIFECYCLE_URL: "https://realtime.example.test/lifecycle",
          CHAT_PROFILE_PROVISIONING_HMAC_SECRET:
            "a-secret-that-is-long-enough-for-testing",
          AUTH_LIFECYCLE_HMAC_SECRET:
            "a-dedicated-auth-lifecycle-secret-of-32-bytes",
        })[key],
    );
    prisma.outboxEvent.findFirst.mockImplementation(
      async (args: Record<string, unknown>) => {
        const eventType = (args.where as { eventType?: string })?.eventType;
        return (byType.get(eventType ?? "") ?? null) as never;
      },
    );
    statusByPath["/profile"] = 401;

    await worker.deliverOne();

    expect(requests.map(({ url }) => url.pathname).sort()).toEqual([
      "/lifecycle",
      "/lifecycle",
      "/profile",
    ]);
    const completed = prisma.outboxEvent.updateMany.mock.calls
      .map(([call]) => call)
      .filter((call) => call.data?.deliveredAt instanceof Date)
      .map((call) => (call.where as { id: string }).id);
    expect(completed).toEqual(
      expect.arrayContaining([chatLifecycle.id, authLifecycle.id]),
    );
    const rejected = prisma.outboxEvent.updateMany.mock.calls.find(
      ([call]) =>
        (call.where as { id?: string })?.id === provision.id &&
        call.data?.nextAttemptAt,
    );
    expect(rejected?.[0].data?.deliveryOutcome).toBeUndefined();
    expect(rejected?.[0].data?.lastError).toBe("Chat returned HTTP 401");
  });

  it("waits for an active delivery to persist its acknowledgement during shutdown", async () => {
    nextStatus = undefined;

    const delivery = worker.deliverOne();
    for (let attempt = 0; attempt < 10 && requests.length === 0; attempt += 1) {
      await Promise.resolve();
    }
    expect(requests).toHaveLength(1);

    let shutdownComplete = false;
    const shutdown = worker.onModuleDestroy().then(() => {
      shutdownComplete = true;
    });
    await Promise.resolve();
    expect(shutdownComplete).toBe(false);

    pendingResponses[0]?.(202);
    await Promise.all([delivery, shutdown]);

    expect(shutdownComplete).toBe(true);
    expect(
      prisma.outboxEvent.updateMany.mock.calls.at(-1)?.[0].data?.deliveredAt,
    ).toBeInstanceOf(Date);
  });

  it("routes lifecycle events to the lifecycle endpoint with their event type", async () => {
    const lifecycleEvent = {
      ...event,
      eventType: "chat.account.lifecycle.v1",
      payload: {
        authUserId: "00000000-0000-4000-8000-000000000001",
        accountStatus: "SUSPENDED",
        version: 2,
      },
    };
    config.get.mockImplementation((key: string) => {
      if (key === "CHAT_PROFILE_PROVISIONING_URL")
        return "https://chat.example.test/profile";
      if (key === "CHAT_ACCOUNT_LIFECYCLE_URL")
        return "https://chat.example.test/lifecycle";
      if (key === "CHAT_PROFILE_PROVISIONING_HMAC_SECRET")
        return "a-secret-that-is-long-enough-for-testing";
      return undefined;
    });
    prisma.outboxEvent.findFirst.mockImplementation(
      async (args: Record<string, unknown>) =>
        (args.where as { eventType?: string })?.eventType ===
        lifecycleEvent.eventType
          ? lifecycleEvent
          : (null as never),
    );
    await worker.deliverOne();

    expect(requests[0]?.url).toEqual(
      new URL("https://chat.example.test/lifecycle"),
    );
    expect(requests[0]?.body).toContain(
      '"eventType":"chat.account.lifecycle.v1"',
    );
    expect(prisma.outboxEvent.findFirst.mock.calls).toEqual(
      expect.arrayContaining([
        [
          expect.objectContaining({
            where: expect.objectContaining({
              eventType: "chat.account.lifecycle.v1",
            }),
          }),
        ],
      ]),
    );
  });

  it("does not let an unconfigured lifecycle endpoint block signup delivery", async () => {
    prisma.outboxEvent.findFirst.mockResolvedValue(null as never);

    await worker.deliverOne();

    expect(prisma.outboxEvent.findFirst.mock.calls[0]?.[0].where).toMatchObject(
      {
        eventType: "chat.profile.provision.v1",
      },
    );
  });

  it("delivers the versioned Auth envelope over a separately signed HTTPS route", async () => {
    const payload = {
      eventId: event.id,
      eventType: "auth.lifecycle.v1",
      version: 1,
      subject: "00000000-0000-4000-8000-000000000001",
      action: "SESSION_REVOKED",
      scope: "SESSION",
      sessionId: "00000000-0000-4000-8000-000000000003",
      occurredAt: "2026-11-17T12:00:00.000Z",
    };
    config.get.mockImplementation((key: string) => {
      if (key === "AUTH_LIFECYCLE_URL")
        return "https://community.example.test/internal/auth-lifecycle";
      if (key === "AUTH_LIFECYCLE_HMAC_SECRET")
        return "a-dedicated-auth-lifecycle-secret-of-32-bytes";
      return undefined;
    });
    prisma.outboxEvent.findFirst.mockResolvedValue({
      ...event,
      eventType: "auth.lifecycle.v1",
      payload,
    } as unknown as typeof event);
    await worker.deliverOne();

    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request?.url).toEqual(
      new URL("https://community.example.test/internal/auth-lifecycle"),
    );
    expect(request?.body).toBe(JSON.stringify(payload));
    expect(request?.options.agent).toBe(false);
    const headers = request?.options.headers as Record<string, string>;
    const timestamp = headers["x-auth-lifecycle-timestamp"];
    expect(headers["x-auth-lifecycle-event-id"]).toBe(payload.eventId);
    expect(headers["x-chat-event-signature"]).toBeUndefined();
    expect(headers["x-auth-lifecycle-signature"]).toBe(
      createHmac("sha256", "a-dedicated-auth-lifecycle-secret-of-32-bytes")
        .update(`${timestamp}.${JSON.stringify(payload)}`)
        .digest("hex"),
    );
    expect(prisma.outboxEvent.findFirst.mock.calls[0]?.[0].where).toMatchObject(
      { eventType: "auth.lifecycle.v1" },
    );
    expect(
      prisma.outboxEvent.updateMany.mock.calls.at(-1)?.[0].data?.deliveredAt,
    ).toBeInstanceOf(Date);
  });

  it.each([
    "",
    '{"accepted":false}',
    '{"status":"ok"}',
    '{"accepted":true,"stale":true}',
  ])(
    "keeps Auth lifecycle delivery pending when Realtime ingress returns %p",
    async (responseBody) => {
      nextBody = responseBody;
      const payload = {
        eventId: event.id,
        eventType: "auth.lifecycle.v1",
        version: 1,
        subject: "00000000-0000-4000-8000-000000000001",
        action: "SESSION_REVOKED",
        scope: "SESSION",
        sessionId: "00000000-0000-4000-8000-000000000003",
        occurredAt: "2026-11-17T12:00:00.000Z",
      };
      config.get.mockImplementation((key: string) => {
        if (key === "AUTH_LIFECYCLE_URL")
          return "https://community.example.test/internal/auth-lifecycle";
        if (key === "AUTH_LIFECYCLE_HMAC_SECRET")
          return "a-dedicated-auth-lifecycle-secret-of-32-bytes";
        return undefined;
      });
      prisma.outboxEvent.findFirst.mockResolvedValue({
        ...event,
        eventType: "auth.lifecycle.v1",
        payload,
      } as unknown as typeof event);

      await worker.deliverOne();

      const retry = prisma.outboxEvent.updateMany.mock.calls.at(-1)?.[0];
      expect(retry?.data?.deliveredAt).toBeUndefined();
      expect(retry?.data?.deliveryOutcome).toBeUndefined();
      expect(retry?.data?.nextAttemptAt).toBeInstanceOf(Date);
      expect(retry?.data?.lastError).toBe(
        "Realtime acknowledgement is invalid",
      );
    },
  );

  it("persists only an authenticated exact-revision Profile cleanup receipt", async () => {
    const secret = "profile-deletion-secret-with-at-least-32-characters";
    const payload = {
      eventType: "auth.account.deletion.cleanup.v1",
      operationId: "00000000-0000-4000-8000-000000000004",
      subject: "00000000-0000-4000-8000-000000000005",
      requestHash: "b".repeat(64),
      lifecycleRevision: "23",
    };
    const receipt = {
      ...payload,
      state: "CLEANUP_COMPLETED",
      receiptHash: createHmac("sha256", secret)
        .update(
          `receipt.cleanup.${payload.operationId}.${payload.subject}.23.${payload.requestHash}.CLEANUP_COMPLETED`,
        )
        .digest("hex"),
      resultMetadata: {},
    };
    nextBody = JSON.stringify(receipt);
    config.get.mockImplementation((key: string) => {
      if (key === "PROFILE_ACCOUNT_DELETION_CLEANUP_URL")
        return "https://profile.example.test/api/v1/internal/v1/account-deletion/cleanup";
      if (key === "PROFILE_ACCOUNT_DELETION_HMAC_SECRET") return secret;
      return undefined;
    });
    const cleanupEvent = {
      ...event,
      eventType: "auth.account.deletion.cleanup.v1",
      payload,
    };
    prisma.outboxEvent.findFirst.mockResolvedValue(cleanupEvent as never);
    const operationUpdate = jest.fn();
    const transaction = jest.fn(async (fn: (tx: any) => Promise<any>) =>
      fn({
        safetyOperation: {
          findUnique: jest.fn().mockResolvedValue({
            requestMetadata: {
              purpose: "ACCOUNT_DELETION_V1",
              phase: "CLEANUP_IN_PROGRESS",
              lifecycleRevision: "23",
            },
          }),
          update: operationUpdate,
        },
        outboxEvent: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      }),
    );
    (prisma as any).$transaction = transaction;
    await worker.deliverOne();
    expect(requests[0]?.url.href).toBe(
      "https://profile.example.test/api/v1/internal/v1/account-deletion/cleanup",
    );
    expect(operationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: payload.operationId },
        data: {
          requestMetadata: expect.objectContaining({
            phase: "CLEANUP_IN_PROGRESS",
            profileCleanupState: "CLEANUP_COMPLETED",
            profileCleanupReceipt: receipt,
          }),
        },
      }),
    );
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
