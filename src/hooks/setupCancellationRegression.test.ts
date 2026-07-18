import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const setup = readFileSync(new URL("../../src-tauri/src/commands/setup.rs", import.meta.url), "utf8");
const app = readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");
const api = readFileSync(new URL("../api/tauri-commands.ts", import.meta.url), "utf8");
const flow = readFileSync(new URL("./useSetupFlow.ts", import.meta.url), "utf8");

test("BUG-WIN-CANCEL-01 dependency cancellation is scoped to the initiating setup run", () => {
  assert.match(setup, /struct DependencyInstallOperationCoordinator/);
  assert.match(setup, /struct DependencyInstallOperation/);
  assert.match(setup, /pub fn cancel_dependency_install\(operation_id: String\)/);
  assert.match(setup, /active: HashMap<String, ActiveDependencyInstallOperation>/);
  assert.match(setup, /if coordinator\.active\.contains_key\(&id\)/);
  assert.match(setup, /Arc::ptr_eq\(&active\.cancellation\.requested, &self\.cancellation\.requested\)/);
  assert.match(app, /commands::setup::cancel_dependency_install/);
  assert.match(api, /cancelDependencyInstall = \(operationId: string\)/);
  assert.match(flow, /const activeDependencyOperationRef = useRef<string \| null>\(null\)/);
  assert.match(flow, /const requestDependencyCancellation = useCallback\([\s\S]*?cancelDependencyInstall\(operationId\)/);
  assert.match(flow, /const cancelActiveRun = useCallback\(\(\) => \{[\s\S]*?requestDependencyCancellation\(operationId\)/);
  assert.match(flow, /const runDependencyInstall = useCallback\([\s\S]*?operationId = `\$\{dependencyInstallScopeRef\.current\}:\$\{runId\}:\$\{tool\}`/);
});

test("BUG-WIN-CANCEL-02 Windows cancellation keeps process-tree cleanup authoritative", () => {
  assert.match(setup, /async fn wait_for_controlled_child[\s\S]*?ControlledProcessWaitError::Cancelled/);
  assert.match(setup, /terminate_process_tree_confirmed\(child, child\.id\(\)\)\.await/);
  assert.match(setup, /async fn wait_for_elevated_windows_process[\s\S]*?process\.terminate_and_reap\(\)\.await/);
  assert.match(setup, /ShellExecuteExW may be blocked by the Windows UAC dialog[\s\S]*?reaps the installer tree/);
  assert.match(setup, /async fn run_winget_package_command[\s\S]*?Some\(operation\)/);
  assert.match(setup, /Cancellation requested\. JunQi is safely stopping the active/);
});

test("BUG-WIN-CANCEL-03 stale runtime selection cannot commit or compensate a newer run", () => {
  const selectMode = flow.slice(
    flow.indexOf("const selectMode = useCallback"),
    flow.indexOf("const requestReinstall = useCallback"),
  );

  assert.match(selectMode, /const runId = beginRun\(\)/);
  assert.match(selectMode, /await setActiveGatewayRuntime\(mode\);\s*if \(!isRunActive\(runId\)\) return/);
  assert.match(selectMode, /completed = await runNativeSetup\(runId\)/);
  assert.match(selectMode, /completed = await runDockerSetup\(runId\)/);
  assert.match(selectMode, /await commitActiveGatewayRuntime\(mode\);\s*if \(!isRunActive\(runId\)\) return;\s*await commitRuntimeReconfiguration\(\)/);
  assert.match(selectMode, /const restoredRuntimeLocations = await rollbackRuntimeReconfiguration\(\);\s*if \(!isRunActive\(runId\)\) return/);
  assert.match(selectMode, /await rollbackActiveGatewayRuntime\(mode\);\s*if \(!isRunActive\(runId\)\) return/);
});
