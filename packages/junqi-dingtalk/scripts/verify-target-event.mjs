import { DwsRunner, normalizeRunnerConfig } from "../dist/dws-runner.js";
import { DingTalkEventRuntime } from "../dist/event-runtime.js";
import {
  buildDingTalkTargetEventConfig,
  parseDingTalkTargetEventSmokeArguments,
  runDingTalkTargetEventSmoke,
} from "../dist/target-event-smoke.js";

const input = parseDingTalkTargetEventSmokeArguments(process.argv.slice(2));
const runner = new DwsRunner(normalizeRunnerConfig({
  dwsPath: input.dwsPath,
  timeoutMs: 120_000,
}));
const runtime = new DingTalkEventRuntime(runner, buildDingTalkTargetEventConfig(input));
const result = await runDingTalkTargetEventSmoke(runtime, input.waitSeconds * 1_000);
console.log(JSON.stringify(result, null, 2));
if (result.status !== "verified") process.exitCode = 1;
