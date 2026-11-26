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
  };
  let worker: ChatProfileOutboxWorker;
  let nextStatus: number | undefined;
  let nextBody = "";
  let pendingResponses: Array<(statusCode: number) => void>;
  let requests: Array<{
    url: URL;
    options: https.RequestOptions;
    body: string;
  }>;

  beforeEach(() => {
    jest.restoreAllMocks();
    nextStatus = 202;
    nextBody = "";
    pendingResponses = [];
    requests = [];
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
          response.statusCode = statusCode;
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

  it("keeps failed delivery pending and schedules a retry", async () => {
    nextStatus = 503;

    await worker.deliverOne();

    const failedUpdate = prisma.outboxEvent.updateMany.mock.calls.at(-1)?.[0];
    expect(failedUpdate?.data?.nextAttemptAt).toBeInstanceOf(Date);
    expect(failedUpdate?.data?.lastError).toBe("Chat returned HTTP 503");
    expect(failedUpdate?.data?.claimToken).toBeNull();
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
    prisma.outboxEvent.findFirst.mockResolvedValue(lifecycleEvent);
    await worker.deliverOne();

    expect(requests[0]?.url).toEqual(
      new URL("https://chat.example.test/lifecycle"),
    );
    expect(requests[0]?.body).toContain(
      '"eventType":"chat.account.lifecycle.v1"',
    );
    expect(prisma.outboxEvent.findFirst.mock.calls[0]?.[0].where).toMatchObject(
      {
        eventType: {
          in: ["chat.profile.provision.v1", "chat.account.lifecycle.v1"],
        },
      },
    );
  });

  it("does not let an unconfigured lifecycle endpoint block signup delivery", async () => {
    prisma.outboxEvent.findFirst.mockResolvedValue(null as never);

    await worker.deliverOne();

    expect(prisma.outboxEvent.findFirst.mock.calls[0]?.[0].where).toMatchObject(
      {
        eventType: { in: ["chat.profile.provision.v1"] },
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
      { eventType: { in: ["auth.lifecycle.v1"] } },
    );
    expect(
      prisma.outboxEvent.updateMany.mock.calls.at(-1)?.[0].data?.deliveredAt,
    ).toBeInstanceOf(Date);
  });

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
