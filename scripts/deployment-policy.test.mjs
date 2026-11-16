import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function workflow(name) {
  return readFileSync(resolve(repositoryRoot, ".github/workflows", name), "utf8");
}

function jobBlock(source, jobName) {
  const jobsIndex = source.indexOf("\njobs:\n");
  assert.notEqual(jobsIndex, -1, "workflow must define jobs");
  const header = new RegExp(`^  ${jobName}:\\s*$`, "m");
  const match = header.exec(source.slice(jobsIndex));
  assert.ok(match, `${jobName} must exist`);
  const start = jobsIndex + match.index;
  const rest = source.slice(start + match[0].length);
  const nextJob = /^  [a-zA-Z0-9_-]+:\s*$/m.exec(rest);
  return source.slice(
    start,
    nextJob ? start + match[0].length + nextJob.index : undefined,
  );
}

function deploymentCondition(source, jobName) {
  const block = jobBlock(source, jobName);
  const singleLine = /^    if:\s*(.+)$/m.exec(block);
  if (singleLine && !singleLine[1].startsWith(">")) return singleLine[1];

  const folded = /^    if:\s*>[-+]?\s*\n((?:      .*\n?)+)/m.exec(block);
  assert.ok(folded, `${jobName} must have an explicit job condition`);
  return folded[1].replaceAll("\n", " ");
}

function dispatchInput(source, inputName) {
  const dispatchIndex = source.indexOf("\n  workflow_dispatch:\n");
  assert.notEqual(dispatchIndex, -1, "workflow must support manual dispatch");
  const inputHeader = new RegExp(`^      ${inputName}:\\s*$`, "m");
  const match = inputHeader.exec(source.slice(dispatchIndex));
  assert.ok(match, `${inputName} input must be defined`);
  const start = dispatchIndex + match.index;
  const rest = source.slice(start + match[0].length);
  const nextInput = /^      [a-zA-Z0-9_-]+:\s*$/m.exec(rest);
  return source.slice(
    start,
    nextInput ? start + match[0].length + nextInput.index : undefined,
  );
}

function assertManualEnvironmentGate(condition, environment) {
  assert.match(condition, /github\.event_name\s*==\s*'workflow_dispatch'/);
  assert.match(
    condition,
    new RegExp(
      `github\\.event\\.inputs\\.target_environment\\s*==\\s*'${environment}'`,
    ),
  );
}

test("signup and login CI remain available on pushes and pull requests", () => {
  for (const name of ["signup-service.yml", "login-service.yml"]) {
    const source = workflow(name);
    assert.match(source, /^  push:\s*$/m, `${name} retains push CI`);
    assert.match(source, /^  pull_request:\s*$/m, `${name} retains pull-request CI`);
    for (const job of ["lint_typecheck", "tests", "build"]) {
      const condition = deploymentCondition(source, job);
      assert.doesNotMatch(condition, /github\.event_name\s*==\s*'workflow_dispatch'/);
    }
  }
});

for (const [service, file] of [
  ["signup", "signup-service.yml"],
  ["login", "login-service.yml"],
]) {
  test(`${service} deployment requires a manual target selection`, () => {
    const source = workflow(file);
    const input = dispatchInput(source, "target_environment");
    assert.match(input, /required: true/);
    assert.match(input, /type: choice/);
    assert.match(input, /- staging/);
    assert.match(input, /- production/);

    const staging = deploymentCondition(source, "deploy-staging");
    assertManualEnvironmentGate(staging, "staging");
    assertManualEnvironmentGate(staging, "production");
    assert.match(staging, /github\.event\.inputs\.promote_to_prod\s*==\s*'true'/);

    const production = deploymentCondition(source, "deploy-production");
    assertManualEnvironmentGate(production, "production");
    assert.match(
      production,
      /github\.event\.inputs\.promote_to_prod\s*==\s*'true'/,
    );

    const imageBuild = jobBlock(source, "build");
    assert.match(
      imageBuild,
      /push:\s*\$\{\{\s*github\.event_name\s*==\s*'workflow_dispatch'[\s\S]*?target_environment[\s\S]*?promote_to_prod/,
      "registry publication must require manual environment selection",
    );
  });
}

test("shared deployment and database migration workflow is manual only", () => {
  const source = workflow("deployment.yml");
  const triggerBlock = source.slice(0, source.indexOf("\nenv:\n"));
  assert.match(triggerBlock, /^  workflow_dispatch:\s*$/m);
  assert.doesNotMatch(triggerBlock, /^  workflow_run:\s*$/m);
  assert.doesNotMatch(source, /github\.event\.workflow_run/);

  const environment = dispatchInput(source, "environment");
  assert.match(environment, /required: true/);
  assert.match(environment, /type: choice/);
  assert.match(environment, /- staging/);
  assert.match(environment, /- production/);
  assert.match(dispatchInput(source, "service"), /required: true/);
});
