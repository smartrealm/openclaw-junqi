import { DwsRunner, normalizeRunnerConfig } from "../dist/dws-runner.js";
import { DwsSchemaRegistry } from "../dist/schema-contract.js";
import {
  parseDingTalkTargetTodoSmokeArguments,
  runDingTalkTargetTodoSmoke,
} from "../dist/target-todo-smoke.js";

const input = parseDingTalkTargetTodoSmokeArguments(process.argv.slice(2));
const runner = new DwsRunner(normalizeRunnerConfig({
  dwsPath: input.dwsPath,
  timeoutMs: 120_000,
}));
const result = await runDingTalkTargetTodoSmoke(
  new DwsSchemaRegistry(runner),
  runner,
  input,
);
console.log(JSON.stringify(result, null, 2));
if (result.status !== "verified") process.exitCode = 1;
