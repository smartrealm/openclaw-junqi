import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const setup = readFileSync(new URL("../../src-tauri/src/commands/setup.rs", import.meta.url), "utf8");
const app = readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");
const api = readFileSync(new URL("../api/tauri-commands.ts", import.meta.url), "utf8");
const flow = readFileSync(new URL("./useSetupFlow.ts", import.meta.url), "utf8");
const runtimeTransaction = readFileSync(
  new URL("../services/setup/runtimeSelectionTransaction.ts", import.meta.url),
  "utf8",
);

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
  assert.match(selectMode, /executeRuntimeSelectionTransaction\(mode, previousMode/);
  assert.match(selectMode, /isActive: \(\) => isRunActive\(runId\)/);
  assert.match(selectMode, /stageMode: setActiveGatewayRuntime/);
  assert.match(selectMode, /runNativeSetup\(runId\)[\s\S]*?runDockerSetup\(runId\)/);
  assert.match(selectMode, /commit: commitSetupGatewayRuntime/);
  assert.match(selectMode, /rollbackPendingLocations: rollbackRuntimeReconfiguration/);
  assert.match(selectMode, /rollbackMode: rollbackActiveGatewayRuntime/);
  assert.match(runtimeTransaction, /if \(!ports\.isActive\(\)\) return \{ status: "superseded" \}/);
  assert.match(runtimeTransaction, /await ports\.commit\(targetMode\)/);
  assert.match(runtimeTransaction, /await ports\.rollbackMode\(targetMode\)/);
});

test("BUG-WIN-CANCEL-04 Back compensates a staged mode before navigating", () => {
  const goBack = flow.slice(
    flow.indexOf("const goBack = useCallback"),
    flow.indexOf("const retryGit = useCallback"),
  );
  assert.match(goBack, /const restoredRuntimeLocations = await rollbackRuntimeReconfiguration\(\)/);
  assert.match(goBack, /if \(!restoredRuntimeLocations\) \{\s*await rollbackActiveGatewayRuntime\(installMode\)/);
  assert.ok(goBack.indexOf("rollbackActiveGatewayRuntime") < goBack.indexOf("goBackSetup"));
});

test("BUG-WFR-05 stale Wizard completion cannot commit official-service handoff UI", () => {
  const applyResult = flow.slice(
    flow.indexOf("const applyWizardResult = useCallback"),
    flow.indexOf("const recoverLostWizardSession = useCallback"),
  );
  assert.match(applyResult, /result: OpenClawWizardResult,\s*operationId: number/);
  assert.match(applyResult, /await invoke<boolean>\("handoff_gateway_to_official_service", \{\}\);\s*assertWizardOperationCurrent\(operationId\)/);
  assert.match(applyResult, /await invoke<boolean>\("probe_selected_gateway", \{\}\);\s*assertWizardOperationCurrent\(operationId\)/);
  assert.match(applyResult, /const modelProbe = await probeActiveRuntimeModel\(\);\s*assertWizardOperationCurrent\(operationId\)/);
  assert.match(applyResult, /await refreshGatewayConnectionTarget\(\);\s*assertWizardOperationCurrent\(operationId\)/);
});
