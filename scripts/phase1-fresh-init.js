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

    const uuidColumns = await client.query(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND udt_name = 'uuid'
         AND (table_name, column_name) IN (
           ('User', 'id'), ('RefreshToken', 'userId'),
           ('user_identities', 'user_id'), ('password_credentials', 'user_id'),
           ('identity_sessions', 'user_id'), ('legacy_identity_mappings', 'user_id'),
           ('policy_acceptance_history', 'user_id'), ('hashed_contacts', 'user_id'),
           ('contact_suggestions', 'user_id'), ('contact_suggestions', 'suggested_user_id'),
           ('blocks', 'blocker_id'), ('blocks', 'blocked_id'),
           ('push_tokens', 'user_id')
         )`,
    );
    const expectedUuidColumns = [
      "User.id",
      "RefreshToken.userId",
      "user_identities.user_id",
      "password_credentials.user_id",
      "identity_sessions.user_id",
      "legacy_identity_mappings.user_id",
      "policy_acceptance_history.user_id",
      "hashed_contacts.user_id",
      "contact_suggestions.user_id",
      "contact_suggestions.suggested_user_id",
      "blocks.blocker_id",
      "blocks.blocked_id",
      "push_tokens.user_id",
    ];
    const actualUuidColumns = new Set(
      uuidColumns.rows.map((row) => `${row.table_name}.${row.column_name}`),
    );
    const missingUuidColumns = expectedUuidColumns.filter(
      (column) => !actualUuidColumns.has(column),
    );
    if (missingUuidColumns.length > 0)
      throw new Error(
        `Fresh schema has non-UUID or missing identity columns: ${missingUuidColumns.join(", ")}`,
      );

    const foreignKeys = await client.query(
      `SELECT child.relname AS child_table,
              child_attribute.attname AS child_column,
              parent.relname AS parent_table,
              parent_attribute.attname AS parent_column
       FROM pg_constraint constraint_row
       JOIN pg_class child ON child.oid = constraint_row.conrelid
       JOIN pg_class parent ON parent.oid = constraint_row.confrelid
       JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY AS child_key(attnum, position) ON TRUE
       JOIN LATERAL unnest(constraint_row.confkey) WITH ORDINALITY AS parent_key(attnum, position)
         ON parent_key.position = child_key.position
       JOIN pg_attribute child_attribute
         ON child_attribute.attrelid = child.oid AND child_attribute.attnum = child_key.attnum
       JOIN pg_attribute parent_attribute
         ON parent_attribute.attrelid = parent.oid AND parent_attribute.attnum = parent_key.attnum
       WHERE constraint_row.contype = 'f'
         AND child.relnamespace = 'public'::regnamespace
         AND parent.relname = 'User'`,
    );
    const actualForeignKeys = new Set(
      foreignKeys.rows.map(
        (row) =>
          `${row.child_table}.${row.child_column}->${row.parent_table}.${row.parent_column}`,
      ),
    );
    const expectedForeignKeys = [
      "RefreshToken.userId->User.id",
      "user_identities.user_id->User.id",
      "password_credentials.user_id->User.id",
      "identity_sessions.user_id->User.id",
      "legacy_identity_mappings.user_id->User.id",
      "policy_acceptance_history.user_id->User.id",
      "hashed_contacts.user_id->User.id",
      "contact_suggestions.user_id->User.id",
      "contact_suggestions.suggested_user_id->User.id",
      "blocks.blocker_id->User.id",
      "blocks.blocked_id->User.id",
      "push_tokens.user_id->User.id",
    ];
    const missingForeignKeys = expectedForeignKeys.filter(
      (foreignKey) => !actualForeignKeys.has(foreignKey),
    );
    if (missingForeignKeys.length > 0)
      throw new Error(
        `Fresh schema is missing canonical UUID foreign keys: ${missingForeignKeys.join(", ")}`,
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
