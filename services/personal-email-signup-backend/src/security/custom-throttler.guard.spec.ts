import { CustomThrottlerGuard } from "./custom-throttler.guard";

describe("CustomThrottlerGuard authenticated user dimension", () => {
  it("assigns canonical principals separate user trackers", () => {
    const guard = new CustomThrottlerGuard(
      { get: () => undefined } as any,
      {} as any,
      {} as any,
    );
    const userThrottle = (guard as any)
      .buildDimensionThrottlers()
      .find((throttler: { name: string }) => throttler.name === "user");

    const first = userThrottle.getTracker({
      user: { subject: "00000000-0000-4000-8000-000000000031" },
    });
    const second = userThrottle.getTracker({
      user: { subject: "00000000-0000-4000-8000-000000000032" },
    });

    expect(first).not.toBe(second);
  });
});
