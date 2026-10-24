import { createHmac } from "crypto";
import { ChatProfileOutboxWorker } from "./chat-profile-outbox.worker";
import { PrismaService } from "../../prisma/prisma.module";

describe("ChatProfileOutboxWorker", () => {
  const event = {
    id: "00000000-0000-4000-8000-000000000002",
    eventType: "chat.profile.provision.v1",
    payload: { authUserId: "00000000-0000-4000-8000-000000000001" },
    attempts: 0,
  };
  const config: { get: jest.Mock<string, [string]> } = {
    get: jest.fn((key: string): string =>
      key === "CHAT_PROFILE_PROVISIONING_URL"
        ? "https://chat.example.test/api/v1/internal/v1/chat-profile-provisioning"
        : "a-secret-that-is-long-enough-for-testing",
    ),
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

  beforeEach(() => {
    jest.restoreAllMocks();
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
      config as never,
    );
  });

  it("only marks delivery complete after the Chat endpoint accepts the event", async () => {
    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockResolvedValue({ ok: true } as Response);

    await worker.deliverOne();

    const request = fetchMock.mock.calls[0]?.[1];
    const requestUrl = fetchMock.mock.calls[0]?.[0];
    expect(requestUrl).toBeInstanceOf(URL);
    if (!(requestUrl instanceof URL)) throw new Error("Endpoint must be a URL");
    expect(requestUrl.href).toBe(
      "https://chat.example.test/api/v1/internal/v1/chat-profile-provisioning",
    );
    expect(request?.method).toBe("POST");
    expect(request?.body).toContain(event.payload.authUserId);
    const headers = new Headers(request?.headers);
    const timestamp = headers.get("x-chat-event-timestamp");
    const body = request?.body;
    expect(typeof body).toBe("string");
    if (typeof body !== "string") throw new Error("Request body must be text");
    const expectedSignature = createHmac(
      "sha256",
      "a-secret-that-is-long-enough-for-testing",
    )
      .update(`${timestamp}.${body}`)
      .digest("hex");
    expect(headers.get("x-chat-event-signature")).toBe(expectedSignature);
    const successfulUpdate =
      prisma.outboxEvent.updateMany.mock.calls.at(-1)?.[0];
    expect(successfulUpdate?.data?.deliveredAt).toBeInstanceOf(Date);
  });

  it("keeps failed delivery pending and schedules a retry", async () => {
    jest
      .spyOn(global, "fetch")
      .mockResolvedValue({ ok: false, status: 503 } as Response);

    await worker.deliverOne();

    const failedUpdate = prisma.outboxEvent.updateMany.mock.calls.at(-1)?.[0];
    expect(failedUpdate?.data?.nextAttemptAt).toBeInstanceOf(Date);
    expect(failedUpdate?.data?.lastError).toBe("Chat returned HTTP 503");
    expect(failedUpdate?.data?.claimToken).toBeNull();
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
      return "a-secret-that-is-long-enough-for-testing";
    });
    prisma.outboxEvent.findFirst.mockResolvedValue(lifecycleEvent);
    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockResolvedValue({ ok: true } as Response);

    await worker.deliverOne();

    expect(fetchMock.mock.calls[0]?.[0]).toEqual(
      new URL("https://chat.example.test/lifecycle"),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.body).toContain(
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
});
