import assert from "node:assert/strict";
import { DwsRunner, normalizeRunnerConfig } from "../dist/dws-runner.js";
import { DwsSchemaRegistry } from "../dist/schema-contract.js";
import {
  DINGTALK_MINUTES_READ_ACKNOWLEDGEMENT,
  parseDingTalkTargetMinutesFixture,
  parseDingTalkTargetMinutesPreflightArguments,
  runDingTalkTargetMinutesPreflight,
  validateMinutesReadAcknowledgement,
} from "../dist/target-minutes-preflight.js";

const FIXTURE_INPUT_LIMIT = 65_536;

async function readFixtureFromStdin() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    assert.ok(bytes <= FIXTURE_INPUT_LIMIT, "Target Minutes fixture stdin exceeds 64 KiB");
    chunks.push(buffer);
  }
  assert.ok(bytes > 0, "Target Minutes fixture JSON is required on stdin");
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    assert.fail("Target Minutes fixture stdin must be valid JSON");
  }
  return parseDingTalkTargetMinutesFixture(parsed);
}

const input = parseDingTalkTargetMinutesPreflightArguments(process.argv.slice(2));
validateMinutesReadAcknowledgement(input.acknowledgement);
const fixture = await readFixtureFromStdin();
const runner = new DwsRunner(normalizeRunnerConfig({
  dwsPath: input.dwsPath,
  timeoutMs: 120_000,
}));
const result = await runDingTalkTargetMinutesPreflight(
  new DwsSchemaRegistry(runner),
  runner,
  input.profile,
  DINGTALK_MINUTES_READ_ACKNOWLEDGEMENT,
  fixture,
);
console.log(JSON.stringify(result, null, 2));
if (result.status !== "passed") process.exitCode = 1;
