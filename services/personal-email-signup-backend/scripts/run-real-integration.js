const { spawnSync } = require("node:child_process");
const path = require("node:path");

const requiredDatabaseGates = [
  "PHASE1_DATABASE_URL",
  "PHASE2A_DATABASE_URL",
  "PHASE2B_DATABASE_URL",
  "PHASE2C_DATABASE_URL",
  "PHASE3_DATABASE_URL",
  "PHASE4_DATABASE_URL",
];

const missing = requiredDatabaseGates.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(
    `Real integration tests require disposable database gates: ${missing.join(", ")}`,
  );
  process.exit(2);
}

if (process.env.USE_REAL_REDIS !== "true") {
  console.error("Refusing to run: USE_REAL_REDIS=true is required");
  process.exit(2);
}

const suites = [
  "src/canonical-auth/canonical-auth.integration.spec.ts",
  "src/canonical-auth/google-auth.integration.spec.ts",
  "src/canonical-auth/apple-auth.integration.spec.ts",
  "src/contacts/canonical-contacts.integration.spec.ts",
  "src/identity/identity.module.integration.spec.ts",
  "src/identity/identity.persistence.integration.spec.ts",
  "src/policies/canonical-policy.integration.spec.ts",
  "src/user/canonical-profile.integration.spec.ts",
];

const result = spawnSync(
  process.execPath,
  [
    path.resolve(__dirname, "..", "node_modules", "jest", "bin", "jest.js"),
    ...suites,
    "--runInBand",
    "--detectOpenHandles",
  ],
  { cwd: path.resolve(__dirname, ".."), env: process.env, stdio: "inherit" },
);

process.exit(result.status ?? 1);
