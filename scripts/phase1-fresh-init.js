const { execFileSync } = require("child_process");
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
const {
  getTarget,
  packageRootPath,
  prismaBinary,
} = require("./phase1-db-safety");
const { verifyGovernance } = require("./phase1-governance-check");

async function main() {
  verifyGovernance();
  const target = getTarget();
  const client = new Client({ connectionString: target.rawUrl });
  await client.connect();
  try {
    const provenance = await client.query(
      `SELECT current_database() AS database, current_user AS role,
              inet_server_port() AS port, current_setting('data_directory', true) AS data_directory`,
    );
    const actual = provenance.rows[0];
    if (actual.database !== target.database)
      throw new Error(
        "Connected database identity does not match the requested target",
      );
    const sql = execFileSync(
      prismaBinary(),
      [
        "migrate",
        "diff",
        "--from-empty",
        "--to-schema-datamodel",
        "prisma/auth.schema.prisma",
        "--script",
      ],
      {
        cwd: packageRootPath(),
        env: { ...process.env, DATABASE_URL_AUTH: target.rawUrl },
        maxBuffer: 16 * 1024 * 1024,
        shell: process.platform === "win32",
      },
    ).toString();
    await client.query(sql);
    const tables = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
       AND table_name IN ('User', 'RefreshToken', 'user_identities', 'password_credentials',
                          'identity_sessions', 'legacy_identity_mappings', 'hashed_contacts',
                          'contact_suggestions', 'blocks', 'push_tokens')
       ORDER BY table_name`,
    );
    if (tables.rowCount !== 10)
      throw new Error(
        `Fresh schema expected 10 core tables, found ${tables.rowCount}`,
      );
    console.log(
      JSON.stringify({
        status: "FRESH_SCHEMA_INITIALIZED",
        provenance: target.provenance,
        database: actual.database,
        role: actual.role,
        port: actual.port,
      }),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : "Fresh schema initialization failed",
  );
  process.exitCode = 1;
});
