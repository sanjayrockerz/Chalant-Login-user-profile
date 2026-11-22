import { ServiceUnavailableException } from "@nestjs/common";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export async function b2c9TestFaultPoint(
  boundary: string,
  operationId: string,
): Promise<void> {
  if (
    process.env.NODE_ENV !== "test" ||
    process.env.B2C9_TEST_FAULTS !== "enabled"
  ) {
    return;
  }

  const configured = process.env.B2C9_TEST_FAULT_CONTROL_URL;
  const runId = process.env.B2C9_RUN_ID;
  let endpoint: URL;
  try {
    endpoint = new URL(configured ?? "");
  } catch {
    throw new ServiceUnavailableException("C9 test fault controller is unavailable");
  }
  if (
    endpoint.protocol !== "http:" ||
    !LOOPBACK_HOSTS.has(endpoint.hostname) ||
    endpoint.pathname !== "/hit" ||
    endpoint.search ||
    endpoint.hash ||
    !runId
  ) {
    throw new ServiceUnavailableException("C9 test fault controller must be run-local");
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-b2c9-run": runId },
      body: JSON.stringify({ boundary, operationId }),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error("C9 test fault controller rejected the barrier");
    }
  } catch {
    throw new ServiceUnavailableException("C9 test fault barrier failed closed");
  }
}
