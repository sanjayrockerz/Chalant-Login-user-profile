const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { sha256, verifyGovernance } = require("./phase1-governance-check");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chalant-phase1-governance-"));
  const packageRoot = path.join(root, "backend");
  const migrationRoot = path.join(packageRoot, "prisma", "migrations");
  fs.mkdirSync(migrationRoot, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, "prisma", "auth.schema.prisma"), "datasource db {}\n");
  fs.mkdirSync(path.join(migrationRoot, "20260101000000_test"));
  const sqlPath = path.join(migrationRoot, "20260101000000_test", "migration.sql");
  const sql = "CREATE TABLE example (id integer PRIMARY KEY);\n";
  fs.writeFileSync(sqlPath, sql);
  const baselinePath = path.join(packageRoot, "prisma", "baseline.json");
  fs.writeFileSync(
    baselinePath,
    JSON.stringify({
      baselineId: "test",
      schemaPath: "prisma/auth.schema.prisma",
      schemaSha256: sha256(path.join(packageRoot, "prisma", "auth.schema.prisma")),
      legacyMigrationSha256: {
        "20260101000000_test": sha256(sqlPath),
      },
    }),
  );
  return { packageRoot, baselinePath, sqlPath, migrationRoot };
}

test("accepts an unchanged governed migration and CRLF-equivalent bytes", () => {
  const f = fixture();
  assert.equal(verifyGovernance(f).baselineId, "test");
  fs.writeFileSync(f.sqlPath, "CREATE TABLE example (id integer PRIMARY KEY);\r\n");
  assert.equal(verifyGovernance(f).baselineId, "test");
});

test("rejects substantive SQL changes", () => {
  const f = fixture();
  fs.writeFileSync(f.sqlPath, "CREATE TABLE example (id text PRIMARY KEY);\n");
  assert.throws(() => verifyGovernance(f), /checksum changed/);
});

test("rejects a migration directory missing from the manifest", () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.migrationRoot, "20260102000000_unreviewed"));
  fs.writeFileSync(
    path.join(f.migrationRoot, "20260102000000_unreviewed", "migration.sql"),
    "SELECT 1;\n",
  );
  assert.throws(() => verifyGovernance(f), /require baseline review/);
});

test("rejects a manifest entry whose SQL file is missing", () => {
  const f = fixture();
  fs.unlinkSync(f.sqlPath);
  assert.throws(() => verifyGovernance(f), /migration is missing/);
});
