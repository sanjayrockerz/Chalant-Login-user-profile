const baseUrl = process.env.LOAD_BASE_URL || "http://127.0.0.1:3101";
const email = process.env.LOAD_EMAIL;
const password = process.env.LOAD_PASSWORD;
const concurrency = Number(process.env.LOAD_CONCURRENCY || 10);
const requestsPerRoute = Number(process.env.LOAD_REQUESTS || 50);

if (!email || !password) {
  console.error("LOAD_EMAIL and LOAD_PASSWORD are required");
  process.exit(2);
}

async function request(path, options = {}) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${path}`, options);
  await response.arrayBuffer();
  return { durationMs: performance.now() - started, status: response.status };
}

function summarize(name, samples) {
  const durations = samples
    .map((sample) => sample.durationMs)
    .sort((a, b) => a - b);
  const percentile = (p) =>
    durations[
      Math.min(durations.length - 1, Math.ceil(durations.length * p) - 1)
    ];
  const errors = samples.filter((sample) => sample.status >= 400).length;
  return {
    route: name,
    requests: samples.length,
    errors,
    errorRate: Number((errors / samples.length).toFixed(4)),
    p50Ms: Number(percentile(0.5).toFixed(2)),
    p95Ms: Number(percentile(0.95).toFixed(2)),
    p99Ms: Number(percentile(0.99).toFixed(2)),
    throughputRps: Number(
      (
        samples.length /
        (durations.reduce((sum, value) => sum + value, 0) / 1000)
      ).toFixed(2),
    ),
  };
}

async function runConcurrent(name, operation) {
  const samples = [];
  let next = 0;
  async function worker() {
    while (next < requestsPerRoute) {
      const index = next++;
      samples[index] = await operation();
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return summarize(name, samples);
}

async function main() {
  const login = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const loginBody = await login.json();
  if (!login.ok || typeof loginBody.access_token !== "string") {
    throw new Error(`Load setup login failed with HTTP ${login.status}`);
  }
  const authorization = { Authorization: `Bearer ${loginBody.access_token}` };
  const started = process.memoryUsage();
  const measurements = [
    await runConcurrent("GET /profile/me", () =>
      request("/profile/me", { headers: authorization }),
    ),
    await runConcurrent("GET /contacts/suggestions", () =>
      request("/contacts/suggestions", { headers: authorization }),
    ),
    await runConcurrent("GET /health/live", () => request("/health/live")),
  ];
  const ended = process.memoryUsage();
  console.log(
    JSON.stringify(
      {
        baseUrl,
        concurrency,
        requestsPerRoute,
        memoryDeltaMb: Number(
          ((ended.rss - started.rss) / 1024 / 1024).toFixed(2),
        ),
        measurements,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Load test failed");
  process.exit(1);
});
