import { b2c9TestFaultPoint } from "./b2c9-test-fault";

describe("B2C9 test fault point", () => {
  const original = {
    nodeEnv: process.env.NODE_ENV,
    enabled: process.env.B2C9_TEST_FAULTS,
    endpoint: process.env.B2C9_TEST_FAULT_CONTROL_URL,
    runId: process.env.B2C9_RUN_ID,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries({
      NODE_ENV: original.nodeEnv,
      B2C9_TEST_FAULTS: original.enabled,
      B2C9_TEST_FAULT_CONTROL_URL: original.endpoint,
      B2C9_RUN_ID: original.runId,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    jest.restoreAllMocks();
  });

  it("has no effect outside test mode even when the flag is set", async () => {
    process.env.NODE_ENV = "production";
    process.env.B2C9_TEST_FAULTS = "enabled";
    const fetch = jest.spyOn(global, "fetch");

    await expect(b2c9TestFaultPoint("auth.soc.held.before-response", "test-operation")).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});
