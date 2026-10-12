import { ExecutionContext, ServiceUnavailableException } from "@nestjs/common";
import { JwtAuthGuard } from "./jwt-auth.guard";

describe("JwtAuthGuard", () => {
  it("fails closed while the canonical auth service is unavailable", async () => {
    const guard = new JwtAuthGuard();
    const context = {} as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
