const path = require("path");
const { Client } = require(
  path.resolve(
    __dirname,
    "..",
    "services",
    "personal-email-signup-backend",
    "node_modules",
    "pg",
  ),
);
const { getTarget } = require("./phase1-db-safety");

async function main() {
  const target = getTarget();
  const client = new Client({ connectionString: target.rawUrl });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT
        (SELECT count(*) FROM "User" WHERE email = 'pre-identity@example.test') AS users,
        (SELECT count(*) FROM hashed_contacts hc JOIN "User" u ON u.id = hc.user_id WHERE u.email = 'pre-identity@example.test') AS contacts,
        (SELECT count(*) FROM contact_suggestions cs JOIN "User" u ON u.id = cs.user_id WHERE u.email = 'pre-identity@example.test') AS suggestions,
        (SELECT count(*) FROM blocks b JOIN "User" u ON u.id = b.blocker_id WHERE u.email = 'pre-identity@example.test') AS blocks`);
    const row = result.rows[0];
    if (
      row.users !== "1" ||
      row.contacts !== "1" ||
      row.suggestions !== "1" ||
      row.blocks !== "1"
    ) {
      throw new Error(
        `Synthetic upgrade records were not preserved: ${JSON.stringify(row)}`,
      );
    }
    console.log(
      JSON.stringify({
        status: "UPGRADE_FIXTURE_PRESERVED",
        provenance: target.provenance,
        records: row,
      }),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Upgrade verification failed",
  );
  process.exitCode = 1;
});
