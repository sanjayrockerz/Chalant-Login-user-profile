const { execFileSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

if (process.env.AUTH_LIFECYCLE_OUTBOX_DISPOSABLE !== "true") {
  console.error(
    "Refusing to run: set AUTH_LIFECYCLE_OUTBOX_DISPOSABLE=true only for a task-owned disposable PostgreSQL database",
  );
  process.exit(2);
}
if (!process.env.DATABASE_URL_AUTH) {
  console.error("DATABASE_URL_AUTH is required");
  process.exit(2);
}

const packageRoot = path.resolve(__dirname, "..");
const tempDir = mkdtempSync(path.join(os.tmpdir(), "auth-outbox-real-"));
const keyPath = path.join(tempDir, "server-key.pem");
const certPath = path.join(tempDir, "server-cert.pem");
const configPath = path.join(tempDir, "openssl.cnf");

try {
  writeFileSync(
    configPath,
    [
      "[req]",
      "distinguished_name = subject",
      "x509_extensions = extensions",
      "prompt = no",
      "[subject]",
      "CN = 127.0.0.1",
      "[extensions]",
      "subjectAltName = @names",
      "basicConstraints = critical,CA:TRUE",
      "keyUsage = critical,digitalSignature,keyEncipherment,keyCertSign",
      "extendedKeyUsage = serverAuth",
      "[names]",
      "IP.1 = 127.0.0.1",
      "DNS.1 = localhost",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-config",
      configPath,
    ],
    { stdio: "ignore" },
  );

  const env = {
    ...process.env,
    AUTH_LIFECYCLE_OUTBOX_RUN_REAL_DB: "1",
    AUTH_LIFECYCLE_OUTBOX_DATABASE_URL: process.env.DATABASE_URL_AUTH,
    AUTH_LIFECYCLE_TEST_TLS_KEY: keyPath,
    AUTH_LIFECYCLE_TEST_TLS_CERT: certPath,
    NODE_EXTRA_CA_CERTS: certPath,
  };
  const result = spawnSync(
    process.execPath,
    [
      path.join(packageRoot, "node_modules", "jest", "bin", "jest.js"),
      "--runTestsByPath",
      "src/canonical-auth/chat-profile-outbox.worker.integration.spec.ts",
      "--runInBand",
      "--detectOpenHandles",
    ],
    { cwd: packageRoot, env, stdio: "inherit" },
  );
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Unable to prepare real outbox test",
  );
  process.exitCode = 1;
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
