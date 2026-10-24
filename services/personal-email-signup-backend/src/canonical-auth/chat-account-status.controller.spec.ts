import { createHmac } from "crypto";
import { UnauthorizedException } from "@nestjs/common";
import { ChatAccountStatusController } from "./chat-account-status.controller";

describe("ChatAccountStatusController", () => {
  const secret = "a-secret-that-is-long-enough-for-testing";
  const auth = { getAccountStatusForChat: jest.fn() };
  const config = { get: jest.fn(() => secret) };
  const controller = new ChatAccountStatusController(
    auth as never,
    config as never,
  );
  const id = "00000000-0000-4000-8000-000000000001";

  function signedHeaders(userId = id) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const path = `/internal/v1/chat-account-status/${userId}`;
    return {
      timestamp,
      signature: createHmac("sha256", secret)
        .update(`${timestamp}.GET.${path}`)
        .digest("hex"),
    };
  }

  beforeEach(() => jest.clearAllMocks());

  it("returns the current Auth status for a valid signed request", async () => {
    const response = { authUserId: id, accountStatus: "ACTIVE", version: 1 };
    auth.getAccountStatusForChat.mockResolvedValue(response);
    const headers = signedHeaders();

    await expect(
      controller.getStatus(id, headers.timestamp, headers.signature),
    ).resolves.toEqual(response);
    expect(auth.getAccountStatusForChat).toHaveBeenCalledWith(id);
  });

  it("rejects invalid signatures before querying Auth", async () => {
    const headers = signedHeaders();
    await expect(
      controller.getStatus(id, headers.timestamp, "0".repeat(64)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(auth.getAccountStatusForChat).not.toHaveBeenCalled();
  });

  it("rejects stale timestamps before querying Auth", async () => {
    await expect(controller.getStatus(id, "1", "00")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(auth.getAccountStatusForChat).not.toHaveBeenCalled();
  });
});
