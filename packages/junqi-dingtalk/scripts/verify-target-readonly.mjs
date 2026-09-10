import assert from "node:assert/strict";
import { DwsRunner, normalizeRunnerConfig } from "../dist/dws-runner.js";
import { DwsSchemaRegistry } from "../dist/schema-contract.js";
import { runDingTalkTargetReadonlySmoke } from "../dist/target-readonly-smoke.js";

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    assert.ok(
      flag === "--dws-path" || flag === "--profile" || flag === "--scope",
      `Unsupported argument: ${flag ?? "missing"}`,
    );
    assert.ok(typeof value === "string" && value.length > 0, `Missing value for ${flag}`);
    assert.equal(result[flag], undefined, `Duplicate argument: ${flag}`);
    result[flag] = value;
  }
  assert.equal(typeof result["--dws-path"], "string", "--dws-path is required");
  assert.equal(typeof result["--profile"], "string", "--profile is required");
  assert.ok(
    result["--scope"] === "core" || result["--scope"] === "extended",
    "--scope must be core or extended",
  );
  return {
    dwsPath: result["--dws-path"],
    profile: result["--profile"],
    scope: result["--scope"],
  };
}

const input = parseArguments(process.argv.slice(2));
const runner = new DwsRunner(normalizeRunnerConfig({
  dwsPath: input.dwsPath,
  timeoutMs: 120_000,
}));
const result = await runDingTalkTargetReadonlySmoke(
  new DwsSchemaRegistry(runner),
  runner,
  input.profile,
  input.scope,
);
console.log(JSON.stringify(result, null, 2));
if (result.failedCount > 0) process.exitCode = 1;
