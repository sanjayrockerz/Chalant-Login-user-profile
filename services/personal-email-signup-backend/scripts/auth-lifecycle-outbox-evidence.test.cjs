"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  MAX_WAIT_TIMEOUT_MS,
  boundedInteger,
  classifyLastError,
  parseArgs,
  safeDatabaseTarget,
  safeEvent,
} = require("./auth-lifecycle-outbox-evidence.cjs");

const eventId = "3f9bba2f-8be1-4fa0-8b64-2c697cf913ae";

test("allows a measured retry wait beyond five minutes without exceeding the explicit bound", () => {
  assert.equal(MAX_WAIT_TIMEOUT_MS, 420_000);
  assert.equal(boundedInteger("390000", 30000, 0, MAX_WAIT_TIMEOUT_MS), 390_000);
  assert.equal(boundedInteger("999999", 30000, 0, MAX_WAIT_TIMEOUT_MS), 420_000);
});

test("accepts event snapshot and retry-state wait commands", () => {
  assert.deepEqual(parseArgs(["snapshot", "--event-id", eventId]), {
    command: "snapshot",
    options: { "event-id": eventId },
  });
  assert.equal(
    parseArgs([
      "wait",
      "--event-id",
      eventId,
      "--state",
      "pending",
      "--min-attempts",
      "2",
    ]).options["min-attempts"],
    "2",
  );
});

test("rejects unsupported event IDs, actions, and wait states", () => {
  assert.throws(() => parseArgs(["snapshot", "--event-id", "not-a-uuid"]));
  assert.throws(() =>
    parseArgs(["snapshot", "--subject", eventId, "--action", "DELETE_ACCOUNT"]),
  );
  assert.throws(() =>
    parseArgs(["wait", "--event-id", eventId, "--state", "claimed"]),
  );
});

test("requires loopback and a phase1-prefixed disposable database", () => {
  assert.equal(
    safeDatabaseTarget(
      "postgresql://tester:test@127.0.0.1:55432/phase1_auth_test",
    ),
    "postgresql://tester:test@127.0.0.1:55432/phase1_auth_test",
  );
  assert.throws(() =>
    safeDatabaseTarget("postgresql://tester:test@db.internal/app"),
  );
  assert.throws(() =>
    safeDatabaseTarget("postgresql://tester:test@127.0.0.1/app"),
  );
});

test("emits only redacted lifecycle evidence fields", () => {
  const privateSubject = "b9eaf82e-2faa-499b-b671-3dcd38eec198";
  const privateSession = "f318d166-8c02-4aae-a47e-c27a3da5371c";
  const view = safeEvent({
    id: eventId,
    event_type: "auth.lifecycle.v1",
    aggregate_id: privateSubject,
    payload: {
      eventId,
      subject: privateSubject,
      action: "SESSION_REVOKED",
      scope: "SESSION",
      sessionId: privateSession,
      refreshToken: "do-not-log-this-token",
      revision: 4,
    },
    attempts: 3,
    next_attempt_at: new Date("2026-11-17T12:00:00.000Z"),
    claimed_at: null,
    delivered_at: null,
    created_at: new Date("2026-11-17T11:59:00.000Z"),
    last_error: "credential=private-value",
  });
  const serialized = JSON.stringify(view);

  assert.equal(view.eventId, eventId);
  assert.equal(view.action, "SESSION_REVOKED");
  assert.equal(view.scope, "SESSION");
  assert.equal(view.accountRevision, 4);
  assert.equal(view.lastErrorPresent, true);
  assert.equal(view.lastErrorClass, "other");
  assert.equal(serialized.includes(privateSubject), false);
  assert.equal(serialized.includes(privateSession), false);
  assert.equal(serialized.includes("do-not-log-this-token"), false);
  assert.equal(serialized.includes("private-value"), false);
});

test("classifies retry errors without exposing their raw text", () => {
  assert.equal(classifyLastError("Chat returned HTTP 503"), "http_503");
  assert.equal(classifyLastError("connect ECONNREFUSED 127.0.0.1:3001"), "connection_refused");
  assert.equal(classifyLastError("fetch failed: credential=private"), "fetch_failed");
  assert.equal(classifyLastError(null), null);
});
