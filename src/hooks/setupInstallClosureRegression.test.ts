import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const setup = readFileSync(new URL("../../src-tauri/src/commands/setup.rs", import.meta.url), "utf8");
const nodeRuntime = readFileSync(new URL("../../src-tauri/src/commands/node_runtime.rs", import.meta.url), "utf8");
const setupProgress = readFileSync(new URL("../../src-tauri/src/commands/setup_progress.rs", import.meta.url), "utf8");
const api = readFileSync(new URL("../api/tauri-commands.ts", import.meta.url), "utf8");
const flow = readFileSync(new URL("./useSetupFlow.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../pages/SetupPage.tsx", import.meta.url), "utf8");
const panels = readFileSync(new URL("../components/setup/SetupFlowPanels.tsx", import.meta.url), "utf8");
const progressEvents = readFileSync(new URL("./setupProgressEvents.ts", import.meta.url), "utf8");

test("BUG-INSTALL-01 Node checksums use independent sources with an official fallback", () => {
  const checksumFunction = nodeRuntime.match(/pub\(crate\) fn node_checksum_sources[\s\S]*?\n}/)?.[0] ?? "";
  assert.match(checksumFunction, /NODE_DISTRIBUTION_CATALOG/);
  assert.match(nodeRuntime, /NodeChecksumAuthority/);
  assert.match(nodeRuntime, /https:\/\/nodejs\.org\/dist/);
  assert.match(setup, /HashMap::<String, Vec<&'static str>>/);
  assert.match(setup, /providers\.len\(\) >= 2/);
});

test("BUG-INSTALL-02 a missing bundled npm uses the constrained runtime repair path", () => {
  assert.match(flow, /let npmStatus = setupNode\.npm/);
  assert.match(flow, /nodeStatus\.available && !npmStatus\.available[\s\S]*?await runDependencyInstall\(runId, "node", repairSetupNodeRuntime\)/);
  assert.doesNotMatch(flow, /await installNode\(true\)/);
  assert.match(api, /repairSetupNodeRuntime/);
  assert.match(setup, /pub async fn repair_setup_node_runtime/);
  assert.match(setup, /pub async fn install_node\([\s\S]*?force: Option<bool>,[\s\S]*?operation_id: Option<String>/);
  assert.match(setup, /resolve_complete_node_runtime_contract/);
  assert.match(setup, /install_node_for_requirement_with_operation\(app, requirement\.clone\(\), false, &operation\)/);
});

test("BUG-INSTALL-03 damaged OpenClaw metadata cannot block its repair", () => {
  assert.match(setup, /required_node_requirement_for_openclaw_binary[\s\S]*?Err\(local_error\)[\s\S]*?target_openclaw_node_requirement/);
  assert.match(flow, /repairInvalidInstall = oclawStatus\.binary_found/);
  assert.match(flow, /!oclawStatus\.package_valid/);
  assert.match(flow, /!oclawStatus\.gateway_command_ok/);
});

test("BUG-INSTALL-04 macOS dependency recovery stays inside the setup flow", () => {
  assert.match(nodeRuntime, /node_macos_installer_sources/);
  assert.match(setup, /install_macos_system_node/);
  assert.match(setup, /Command::new\("\/usr\/bin\/open"\)/);
  assert.match(setup, /Command::new\("\/usr\/bin\/xcode-select"\)/);
  assert.doesNotMatch(flow, /useMacSystemRecovery/);
  assert.doesNotMatch(page, /nodejs\.org/);
});

test("BUG-INSTALL-05 Unix OpenClaw installs are staged and rolled back", () => {
  assert.match(setup, /let install_prefix = staging_prefix\.as_path\(\)/);
  assert.match(setup, /promote_staged_unix_openclaw_install/);
  assert.match(setup, /recover_interrupted_unix_openclaw_promotion/);
  assert.match(setup, /OpenClaw activation failed and was rolled back/);
});

test("BUG-INSTALL-06 skipped optional steps count as handled", () => {
  assert.match(page, /s\.status === "done" \|\| s\.status === "skipped"/);
  assert.match(panels, /s\.status === "done" \|\| s\.status === "skipped"/);
  assert.match(panels, /status === "skipped"[\s\S]*?<Minus/);
});

test("BUG-INSTALL-07 setup progress carries structured translation params", () => {
  assert.match(setupProgress, /pub params: Option<BTreeMap<String, String>>/);
  assert.match(setup, /emit_keyed_with_params[\s\S]*?setup\.openclaw\.prepareDir/);
  assert.match(progressEvents, /Object\.entries\(value\.params/);
});

test("BUG-INSTALL-08 dependency downloads stream bytes and report actual totals", () => {
  assert.match(setup, /response\.chunk\(\)\.await/);
  assert.match(setup, /file\.write_all\(&chunk\)\.await/);
  assert.match(setup, /downloaded as f64 \/ total as f64/);
  assert.doesNotMatch(setup, /response\.bytes\(\)\.await/);
  assert.match(setup, /emit_coalesced\(app, step, &detail, &log_slot, progress\)/);
  assert.match(setupProgress, /pub log_slot: Option<String>/);
  assert.match(progressEvents, /logSlot:/);
});

test("BUG-INSTALL-09 Windows installers request elevation and retain exit status", () => {
  assert.match(setup, /ShellExecuteExW/);
  assert.match(setup, /"runas\\0"/);
  assert.match(setup, /GetExitCodeProcess/);
  assert.match(setup, /fn windows_installer_exit_succeeded/);
  assert.match(setup, /matches!\(exit_code, 0 \| 1641 \| 3010\)/);
  assert.match(setup, /reconcile_windows_installer_runtime/);
});
