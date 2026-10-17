const fs = require("fs");
const path = require("path");
const { Client } = require(path.resolve(__dirname, "..", "services", "personal-email-signup-backend", "node_modules", "pg"));
const { getTarget } = require("./phase1-db-safety");
const { verifyGovernance } = require("./phase1-governance-check");

async function main() {
  verifyGovernance();
  const target = getTarget();
  const client = new Client({ connectionString: target.rawUrl });
  await client.connect();
  try {
    const sql = fs.readFileSync(path.join(__dirname, "phase1-legacy-uuid-upgrade.sql"), "utf8");
    await client.query(sql);
    const result = await client.query(`SELECT table_name, column_name, udt_name FROM information_schema.columns WHERE table_schema = 'public' AND ((table_name = 'User' AND column_name = 'id') OR (table_name = 'RefreshToken' AND column_name = 'userId'))`);
    if (result.rows.length !== 2 || result.rows.some((row) => row.udt_name !== "uuid")) throw new Error("Legacy UUID upgrade did not produce UUID identity columns");
    console.log(JSON.stringify({ status: "LEGACY_UUID_UPGRADE_APPLIED", database: target.database }));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Legacy UUID upgrade failed");
  process.exitCode = 1;
});
