const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const workflowPath = path.join(
  __dirname,
  "..",
  ".github",
  "workflows",
  "phase-0-quality.yml",
);
const workflow = fs.readFileSync(workflowPath, "utf8");

function legacyUpgradeSteps() {
  const start = workflow.indexOf(
    "- name: Upgrade the representative legacy database and verify identity persistence",
  );
  assert.notEqual(start, -1, "legacy-upgrade workflow step must exist");
  const end = workflow.indexOf("\n      - ", start + 1);
  return workflow.slice(start, end === -1 ? undefined : end);
}

test("historical identity upgrade applies recovery-consumption migration before verification", () => {
  const steps = legacyUpgradeSteps();
  const markers = [
    "npm run migration:upgrade:legacy",
    "prisma/migrations/20261024120000_auth_account_status_admin/migration.sql",
    "prisma/migrations/20261116120000_password_recovery_consumption/migration.sql",
    "npm run migration:upgrade:verify",
    "npm run test:identity:persistence",
  ].map((marker) => steps.indexOf(marker));

  assert.ok(
    markers.every((position) => position >= 0),
    "all upgrade steps must be present",
  );
  assert.deepEqual(
    markers,
    [...markers].sort((left, right) => left - right),
  );
  assert.match(
    steps,
    /psql "\$PHASE1_DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma\/migrations\/20261116120000_password_recovery_consumption\/migration\.sql/,
  );
});
