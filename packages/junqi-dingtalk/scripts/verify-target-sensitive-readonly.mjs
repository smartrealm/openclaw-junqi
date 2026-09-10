import assert from "node:assert/strict";
import { DwsRunner, normalizeRunnerConfig } from "../dist/dws-runner.js";
import { DwsSchemaRegistry } from "../dist/schema-contract.js";
import {
  DINGTALK_SENSITIVE_READ_ACKNOWLEDGEMENT,
  parseDingTalkTargetSensitiveReadonlyFixture,
  runDingTalkTargetSensitiveReadonlyPreflight,
  validateSensitiveReadAcknowledgement,
} from "../dist/target-sensitive-readonly-preflight.js";

const FIXTURE_INPUT_LIMIT = 1_048_576;

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    assert.ok(
      flag === "--dws-path" || flag === "--profile" || flag === "--acknowledge-sensitive-reads",
      `Unsupported argument: ${flag ?? "missing"}`,
    );
    assert.ok(typeof value === "string" && value.length > 0, `Missing value for ${flag}`);
    assert.equal(result[flag], undefined, `Duplicate argument: ${flag}`);
    result[flag] = value;
  }
  assert.equal(typeof result["--dws-path"], "string", "--dws-path is required");
  assert.equal(typeof result["--profile"], "string", "--profile is required");
  assert.equal(
    typeof result["--acknowledge-sensitive-reads"],
    "string",
    "--acknowledge-sensitive-reads is required",
  );
  return {
    dwsPath: result["--dws-path"],
    profile: result["--profile"],
    acknowledgement: result["--acknowledge-sensitive-reads"],
  };
}

async function readFixtureFromStdin() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    assert.ok(bytes <= FIXTURE_INPUT_LIMIT, "Sensitive fixture stdin exceeds 1 MiB");
    chunks.push(buffer);
  }
  assert.ok(bytes > 0, "Sensitive fixture JSON is required on stdin");
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    assert.fail("Sensitive fixture stdin must be valid JSON");
  }
  return parseDingTalkTargetSensitiveReadonlyFixture(parsed);
}

const input = parseArguments(process.argv.slice(2));
validateSensitiveReadAcknowledgement(input.acknowledgement);
const fixture = await readFixtureFromStdin();
const runner = new DwsRunner(normalizeRunnerConfig({
  dwsPath: input.dwsPath,
  timeoutMs: 120_000,
}));
const result = await runDingTalkTargetSensitiveReadonlyPreflight(
  new DwsSchemaRegistry(runner),
  runner,
  input.profile,
  DINGTALK_SENSITIVE_READ_ACKNOWLEDGEMENT,
  fixture,
);
console.log(JSON.stringify(result, null, 2));
if (result.status !== "passed") process.exitCode = 1;
