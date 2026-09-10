import { DwsRunner, normalizeRunnerConfig } from "../dist/dws-runner.js";
import { DwsSchemaRegistry } from "../dist/schema-contract.js";
import {
  parseDingTalkTargetCalendarSmokeArguments,
  runDingTalkTargetCalendarSmoke,
} from "../dist/target-calendar-smoke.js";

const input = parseDingTalkTargetCalendarSmokeArguments(process.argv.slice(2));
const runner = new DwsRunner(normalizeRunnerConfig({
  dwsPath: input.dwsPath,
  timeoutMs: 120_000,
}));
const result = await runDingTalkTargetCalendarSmoke(
  new DwsSchemaRegistry(runner),
  runner,
  input,
);
console.log(JSON.stringify(result, null, 2));
if (result.status !== "verified") process.exitCode = 1;
