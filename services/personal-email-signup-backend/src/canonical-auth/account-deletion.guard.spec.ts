import { UnauthorizedException } from "@nestjs/common";
import { AccountDeletionGuard } from "./account-deletion.guard";

describe("AccountDeletionGuard", () => {
  const subject = "00000000-0000-4000-8000-000000000011";
  const operationId = "00000000-0000-4000-8000-000000000012";
  const request: any = {
    headers: {
      authorization: "Bearer signed-token",
      "idempotency-key": operationId,
    },
  };
  const context: any = { switchToHttp: () => ({ getRequest: () => request }) };
  let auth: any;
  let deletion: any;
  let jwt: any;
  let guard: AccountDeletionGuard;

  beforeEach(() => {
    request.user = undefined;
    request.sessionId = undefined;
    request.deletionRetrySubject = undefined;
    auth = {
      authenticateAccessTokenContext: jest
        .fn()
        .mockRejectedValue(new UnauthorizedException()),
    };
    deletion = {
      getAcceptedRetry: jest.fn().mockResolvedValue({
        operationId,
        lifecycleRevision: "17",
        state: "CLEANUP_IN_PROGRESS",
      }),
    };
    jwt = {
      verify: jest.fn().mockReturnValue({
        sub: subject,
        sid: "00000000-0000-4000-8000-000000000013",
        typ: "canonical-access",
      }),
    };
    guard = new AccountDeletionGuard(auth, deletion, jwt);
  });

  it("permits only an exact retry of the irreversible deletion operation", async () => {
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(deletion.getAcceptedRetry).toHaveBeenCalledWith(
      subject,
      operationId,
    );
    expect(request.deletionRetrySubject).toBe(subject);
    expect(request.user).toBeUndefined();
  });

  it("rejects a revoked token when the operation id does not match its tombstone", async () => {
    deletion.getAcceptedRetry.mockResolvedValue(null);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(request.deletionRetrySubject).toBeUndefined();
  });

  it("uses the normal active-session principal for a new deletion request", async () => {
    const principal = { subject, accountStatus: "ACTIVE", emailVerified: true };
    auth.authenticateAccessTokenContext.mockResolvedValue({
      principal,
      sessionId: "00000000-0000-4000-8000-000000000013",
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBe(principal);
    expect(request.deletionRetrySubject).toBeUndefined();
    expect(jwt.verify).not.toHaveBeenCalled();
  });
});
