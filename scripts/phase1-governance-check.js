const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const packageRoot = path.resolve(
  __dirname,
  "..",
  "services",
  "personal-email-signup-backend",
);
const baselinePath = path.join(
  packageRoot,
  "prisma",
  "baseline",
  "20261009160000_canonical_schema.json",
);

function sha256(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function loadBaseline() {
  return JSON.parse(fs.readFileSync(baselinePath, "utf8"));
}

function verifyGovernance() {
  const baseline = loadBaseline();
  const schemaPath = path.join(packageRoot, baseline.schemaPath);
  if (sha256(schemaPath) !== baseline.schemaSha256) {
    throw new Error(
      "Canonical Prisma schema does not match the reviewed baseline checksum",
    );
  }

  const migrationRoot = path.join(packageRoot, "prisma", "migrations");
  for (const [migrationName, expectedHash] of Object.entries(
    baseline.legacyMigrationSha256,
  )) {
    const migrationPath = path.join(
      migrationRoot,
      migrationName,
      "migration.sql",
    );
    if (!fs.existsSync(migrationPath))
      throw new Error(
        `Governed historical migration is missing: ${migrationName}`,
      );
    if (sha256(migrationPath) !== expectedHash) {
      throw new Error(
        `Governed historical migration checksum changed: ${migrationName}`,
      );
    }
  }

  const actualMigrations = fs
    .readdirSync(migrationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const governedMigrations = Object.keys(baseline.legacyMigrationSha256).sort();
  const ungoverned = actualMigrations.filter(
    (name) => !governedMigrations.includes(name),
  );
  if (ungoverned.length > 0) {
    throw new Error(
      `Migration directories require baseline review: ${ungoverned.join(", ")}`,
    );
  }
  return baseline;
}

if (require.main === module) {
  try {
    const baseline = verifyGovernance();
    console.log(
      JSON.stringify({
        status: "MIGRATION_GOVERNANCE_VALID",
        baselineId: baseline.baselineId,
      }),
    );
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Migration governance check failed",
    );
    process.exitCode = 1;
  }
}

module.exports = { verifyGovernance };
