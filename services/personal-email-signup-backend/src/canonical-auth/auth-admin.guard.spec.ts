import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { AuthAdminGuard } from "./auth-admin.guard";

describe("AuthAdminGuard", () => {
  const adminId = "00000000-0000-4000-8000-000000000102";

  function context(subject?: string): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user: subject ? { subject } : undefined }),
      }),
    } as unknown as ExecutionContext;
  }

  it("allows only a subject in the configured named-admin UUID allowlist", () => {
    const config = {
      get: jest.fn().mockReturnValue(` ${adminId.toUpperCase()} `),
    };
    const guard = new AuthAdminGuard(config as never);

    expect(guard.canActivate(context(adminId))).toBe(true);
    expect(() =>
      guard.canActivate(context("00000000-0000-4000-8000-000000000103")),
    ).toThrow(ForbiddenException);
  });

  it("denies all callers when no initial administrators are configured", () => {
    const guard = new AuthAdminGuard({
      get: jest.fn().mockReturnValue(undefined),
    } as never);

    expect(() => guard.canActivate(context(adminId))).toThrow(
      ForbiddenException,
    );
  });
});
