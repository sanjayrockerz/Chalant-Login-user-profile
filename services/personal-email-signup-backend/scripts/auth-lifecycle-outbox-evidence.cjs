#!/usr/bin/env node
"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { appendFileSync } = require("node:fs");
const { Client } = require("pg");
const MAX_WAIT_TIMEOUT_MS = 420_000;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set([
  "SESSION_REVOKED",
  "ACCOUNT_STATUS_CHANGED",
  "LOGOUT_ALL",
]);

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error("invalid command arguments");
    }
    options[key.slice(2)] = value;
    index += 1;
  }
  if (command !== "snapshot" && command !== "wait") {
    throw new Error("command must be snapshot or wait");
  }
  if (options["event-id"] && !UUID.test(options["event-id"])) {
    throw new Error("event id must be a UUID");
  }
  if (options.subject && !UUID.test(options.subject)) {
    throw new Error("subject must be a UUID");
  }
  if (options.action && !ACTIONS.has(options.action)) {
    throw new Error("action is not supported");
  }
  if (command === "snapshot" && !options["event-id"] && !options.subject) {
    throw new Error("snapshot requires --event-id or --subject");
  }
  if (command === "wait") {
    if (!options["event-id"]) throw new Error("wait requires --event-id");
    if (!new Set(["pending", "delivered"]).has(options.state)) {
      throw new Error("wait requires --state pending or delivered");
    }
  }
  return { command, options };
}

function safeDatabaseTarget(rawUrl) {
  if (!rawUrl) throw new Error("DATABASE_URL_AUTH is required");
  const url = new URL(rawUrl);
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(url.hostname)) {
    throw new Error("Auth lifecycle evidence requires loopback PostgreSQL");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!/^phase1_[a-z0-9_]+$/i.test(database)) {
    throw new Error("database name must use the phase1_ disposable prefix");
  }
  return rawUrl;
}

function subjectFingerprint(subject) {
  return createHash("sha256").update(subject).digest("hex").slice(0, 16);
}

function classifyLastError(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const status = value.match(/(?:HTTP|status)\s+(\d{3})/i)?.[1];
  if (status) return `http_${status}`;
  if (/timeout|timed out|aborterror/i.test(value)) return "timeout";
  if (/econnrefused/i.test(value)) return "connection_refused";
  if (/econnreset/i.test(value)) return "connection_reset";
  if (/certificate|\btls\b|ssl/i.test(value)) return "tls_error";
  if (/fetch failed/i.test(value)) return "fetch_failed";
  return "other";
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed)) throw new Error("numeric option is invalid");
  return Math.min(Math.max(parsed, minimum), maximum);
}

function safeEvent(row) {
  if (!row) return null;
  const payload =
    row.payload && typeof row.payload === "object" ? row.payload : {};
  const subject =
    typeof payload.subject === "string" ? payload.subject : row.aggregate_id;
  return {
    schema: "auth.lifecycle.outbox-evidence.v1",
    eventId: row.id,
    eventType: row.event_type,
    subjectFingerprint: subjectFingerprint(subject),
    action: typeof payload.action === "string" ? payload.action : "UNKNOWN",
    scope: typeof payload.scope === "string" ? payload.scope : "UNKNOWN",
    accountRevision: Number.isInteger(payload.revision)
      ? payload.revision
      : null,
    attempts: row.attempts,
    claimed: row.claimed_at !== null,
    claimedAt: row.claimed_at?.toISOString() ?? null,
    delivered: row.delivered_at !== null,
    retryDueAt: row.next_attempt_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    deliveredAt: row.delivered_at?.toISOString() ?? null,
    lastErrorPresent: Boolean(row.last_error),
    lastErrorClass: classifyLastError(row.last_error),
  };
}

async function findEvent(client, options) {
  if (options["event-id"]) {
    const result = await client.query(
      `SELECT id, event_type, aggregate_id, payload, attempts, next_attempt_at,
              claimed_at, delivered_at, created_at, last_error
         FROM chat_profile_provisioning_outbox
        WHERE id = $1 AND event_type = 'auth.lifecycle.v1'`,
      [options["event-id"]],
    );
    return result.rows[0] ?? null;
  }
  const values = [options.subject];
  let actionClause = "";
  if (options.action) {
    values.push(options.action);
    actionClause = ` AND payload->>'action' = $${values.length}`;
  }
  const result = await client.query(
    `SELECT id, event_type, aggregate_id, payload, attempts, next_attempt_at,
            claimed_at, delivered_at, created_at, last_error
       FROM chat_profile_provisioning_outbox
      WHERE aggregate_id = $1 AND event_type = 'auth.lifecycle.v1'${actionClause}
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    values,
  );
  return result.rows[0] ?? null;
}

function recordEvidence(view) {
  const line = JSON.stringify({
    evidenceId: randomUUID(),
    observedAt: new Date().toISOString(),
    ...view,
  });
  process.stdout.write(`${line}\n`);
  const evidenceFile = process.env.AUTH_LIFECYCLE_EVIDENCE_FILE;
  if (evidenceFile) appendFileSync(evidenceFile, `${line}\n`, { mode: 0o600 });
}

async function main(argv = process.argv.slice(2)) {
  if (process.env.AUTH_LIFECYCLE_OUTBOX_DISPOSABLE !== "true") {
    throw new Error(
      "refusing to inspect without AUTH_LIFECYCLE_OUTBOX_DISPOSABLE=true",
    );
  }
  const { command, options } = parseArgs(argv);
  const connectionString = safeDatabaseTarget(process.env.DATABASE_URL_AUTH);
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 3000,
  });
  await client.connect();
  try {
    const timeoutMs = boundedInteger(
      options["timeout-ms"],
      30000,
      0,
      MAX_WAIT_TIMEOUT_MS,
    );
    const pollMs = boundedInteger(options["poll-ms"], 250, 50, 5000);
    const minimumAttempts = boundedInteger(
      options["min-attempts"],
      0,
      0,
      1000000,
    );
    const deadline = Date.now() + (command === "wait" ? timeoutMs : 0);
    let row;
    let previousState;
    do {
      row = await findEvent(client, options);
      if (command === "wait" && row) {
        const state = safeEvent(row);
        const signature = JSON.stringify({
          attempts: state.attempts,
          claimedAt: state.claimedAt,
          deliveredAt: state.deliveredAt,
          retryDueAt: state.retryDueAt,
          lastErrorClass: state.lastErrorClass,
        });
        if (signature !== previousState) {
          recordEvidence({ result: "state_observed", event: state });
          previousState = signature;
        }
      }
      if (command !== "wait") break;
      const ready =
        row &&
        (options.state === "delivered"
          ? row.delivered_at !== null
          : row.delivered_at === null && row.attempts >= minimumAttempts);
      if (ready || Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    } while (Date.now() <= deadline);

    const view = safeEvent(row);
    if (!view) {
      recordEvidence({
        result: "not_found",
        eventId: options["event-id"] ?? null,
      });
      return command === "wait" ? 1 : 0;
    }
    const matches =
      command !== "wait" ||
      (options.state === "delivered"
        ? view.delivered
        : !view.delivered && view.attempts >= minimumAttempts);
    recordEvidence({ result: matches ? "matched" : "timeout", event: view });
    return matches ? 0 : 1;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.stderr.write("Auth lifecycle outbox evidence check failed\n");
      process.exitCode = 2;
    },
  );
}

module.exports = {
  MAX_WAIT_TIMEOUT_MS,
  boundedInteger,
  classifyLastError,
  main,
  parseArgs,
  safeDatabaseTarget,
  safeEvent,
};
