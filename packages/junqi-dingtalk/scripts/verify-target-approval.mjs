import { DwsRunner, normalizeRunnerConfig } from "../dist/dws-runner.js";
import { DwsSchemaRegistry } from "../dist/schema-contract.js";
import {
  parseDingTalkTargetApprovalPreflightArguments,
  runDingTalkTargetApprovalPreflight,
} from "../dist/target-approval-preflight.js";

const input = parseDingTalkTargetApprovalPreflightArguments(process.argv.slice(2));
const runner = new DwsRunner(normalizeRunnerConfig({
  dwsPath: input.dwsPath,
  timeoutMs: 120_000,
}));
const result = await runDingTalkTargetApprovalPreflight(
  new DwsSchemaRegistry(runner),
  runner,
  input,
);
console.log(JSON.stringify(result, null, 2));
if (result.status !== "ready_for_manual_review") process.exitCode = 1;
