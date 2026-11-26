import { Logger } from "@nestjs/common";
import { AuthAccountDeletionFenceClient } from "./account-deletion-fence.client";

describe("AuthAccountDeletionFenceClient diagnostics", () => {
  const operationId = "0f0d2f6c-9aa5-4d17-bef5-7af1fcde2b01";
  const subject = "5ea91712-61d5-436d-9e78-0d856cb11f70";
  const requestHash = "a".repeat(64);
  const config = {
    get: jest.fn(
      (name: string) =>
        ({
          CHAT_ACCOUNT_DELETION_URL: "http://127.0.0.1:4321",
          CHAT_ACCOUNT_DELETION_HMAC_SECRET: "disposable-secret-".repeat(3),
        })[name],
    ),
  };

  it("logs the exact downstream target and safe transport classification without logging secrets", async () => {
    const error = Object.assign(
      new Error("fetch failed for http://private-url/token"),
      {
        cause: Object.assign(new Error("connection refused"), {
          code: "ECONNREFUSED",
        }),
      },
    );
    const fetchImpl = jest.fn().mockRejectedValue(error);
    const warn = jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    const client = new AuthAccountDeletionFenceClient(
      config as never,
      fetchImpl as never,
    );

    await expect(
      client.prepareChat(subject, operationId, requestHash, "2"),
    ).rejects.toThrow(
      "Account deletion fence outcome is unknown; retry the same operation ID",
    );

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        '"event":"account_deletion.fence.transport_failure"',
      ),
    );
    const serialized = String(warn.mock.calls.at(-1)?.[0]);
    expect(serialized).toContain('"service":"Chat"');
    expect(serialized).toContain(`"operationId":"${operationId}"`);
    expect(serialized).toContain('"failureClass":"TRANSPORT"');
    expect(serialized).toContain('"errorCode":"ECONNREFUSED"');
    expect(serialized).not.toContain("private-url");
    expect(serialized).not.toContain("disposable-secret");
    warn.mockRestore();
  });
});
