import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const storagePanel = readFileSync(
  new URL('../components/setup/StorageSetupGate.tsx', import.meta.url),
  'utf8',
);
const setupFlow = readFileSync(new URL('./useSetupFlow.ts', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/tauri-commands.ts', import.meta.url), 'utf8');
const paths = readFileSync(new URL('../../src-tauri/src/paths.rs', import.meta.url), 'utf8');
const storage = readFileSync(
  new URL('../../src-tauri/src/commands/storage.rs', import.meta.url),
  'utf8',
);
const setup = readFileSync(new URL('../../src-tauri/src/commands/setup.rs', import.meta.url), 'utf8');
const lib = readFileSync(new URL('../../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const config = readFileSync(new URL('../../src-tauri/src/commands/config.rs', import.meta.url), 'utf8');
const gateway = readFileSync(new URL('../../src-tauri/src/commands/gateway.rs', import.meta.url), 'utf8');
const update = readFileSync(new URL('../../src-tauri/src/commands/openclaw_update.rs', import.meta.url), 'utf8');
const repair = readFileSync(new URL('../../src-tauri/src/commands/openclaw_repair.rs', import.meta.url), 'utf8');
const terminalIntegration = readFileSync(
  new URL('../../src-tauri/src/commands/terminal_integration/mod.rs', import.meta.url),
  'utf8',
);
const terminalWindows = readFileSync(
  new URL('../../src-tauri/src/commands/terminal_integration/windows.rs', import.meta.url),
  'utf8',
);

test('BUG-WRM-01 migration locks data layout but permits independent runtime locations', () => {
  assert.match(storagePanel, /const dataLayoutLocked =/);
  assert.match(storagePanel, /workspaceLocation[\s\S]*?disabled=\{dataLayoutLocked\}/);
  assert.doesNotMatch(storagePanel, /customNodeRuntime[\s\S]{0,500}disabled=\{dataLayoutLocked\}/);
  assert.doesNotMatch(storagePanel, /customGitRuntime[\s\S]{0,500}disabled=\{dataLayoutLocked\}/);
  assert.match(storage, /migration_allows_independent_dependency_locations_to_change/);
  assert.doesNotMatch(
    storage,
    /layout\.node_runtime_dir != existing_layout\.node_runtime_dir/,
  );
});

test('BUG-WRM-02 npm prefix change runs a dedicated dynamic-prefix relocation', () => {
  assert.match(storage, /runtime_changes\.npm_prefix|changes\.npm_prefix/);
  assert.match(setup, /OpenclawInstallMode::Relocate/);
  assert.match(
    setup,
    /OpenclawInstallMode::Relocate => \{[\s\S]*?pick_install_target\(&app, step, &compatible_node\)/,
  );
  assert.match(setupFlow, /await relocateOpenclaw\(\)/);
  assert.match(api, /invoke<string>\("relocate_openclaw"\)/);
  assert.match(lib, /commands::setup::relocate_openclaw/);
});

test('BUG-WRM-03 pending relocation survives restart and clears only after success', () => {
  assert.match(paths, /openclaw_relocation_required: bool/);
  assert.match(paths, /pub fn complete_openclaw_relocation\(/);
  assert.match(setupFlow, /oclaw\.relocation_required/);
  const relocationCommit = setup.slice(
    setup.indexOf('impl OpenclawRelocationRequest'),
    setup.indexOf('async fn install_openclaw_impl'),
  );
  assert.ok(relocationCommit.indexOf('persist_selected_openclaw_binary') >= 0);
  assert.ok(
    relocationCommit.indexOf('complete_openclaw_relocation')
      > relocationCommit.indexOf('persist_selected_openclaw_binary'),
  );
  assert.match(relocationCommit, /fn freeze_target\(&mut self, target: &Path\)/);
  assert.match(relocationCommit, /self\.effective_target = Some\(target\.to_path_buf\(\)\)/);
  assert.match(relocationCommit, /verify_relocated_openclaw_prefix\(binary, target\)/);
  assert.ok(
    relocationCommit.indexOf('self.effective_target = Some(target.to_path_buf())')
      < relocationCommit.indexOf('verify_relocated_openclaw_prefix(binary, target)'),
  );
  const system = readFileSync(
    new URL('../../src-tauri/src/commands/system.rs', import.meta.url),
    'utf8',
  );
  assert.match(
    system,
    /fn resolve_authoritative_openclaw_binary\(\)[\s\S]*?paths::openclaw_relocation_required\(\)[\s\S]*?AuthoritativeOpenclawResolution::Blocked/,
  );
  assert.match(system, /ensure_openclaw_relocation_complete/);
  assert.match(setup, /fn for_current_storage\(self\) -> Self/);
  assert.match(gateway, /start_gateway_locked[\s\S]*?ensure_openclaw_relocation_complete/);
  assert.match(update, /update_openclaw[\s\S]*?ensure_openclaw_relocation_complete/);
  assert.match(repair, /run_native_openclaw_repair[\s\S]*?ensure_openclaw_relocation_complete/);
});

test('BUG-WRM-04 runtime reconfiguration always stops the previous Gateway', () => {
  const sameLocation = storage.slice(
    storage.indexOf('if paths::paths_refer_to_same_location(&target, &source)'),
    storage.indexOf('if migrate_existing && target.starts_with(&source)'),
  );
  assert.match(sameLocation, /if native_runtime_reconfiguration \{[\s\S]*?stop_all_locked/);
  const stopGuard = sameLocation.slice(
    sameLocation.indexOf('if native_runtime_reconfiguration {'),
    sameLocation.indexOf('stop_all_locked'),
  );
  assert.doesNotMatch(stopGuard, /previous\.reachable/);
});

test('BUG-WRM-05 relocation shares the global operation lock and validates its prefix request', () => {
  const relocate = setup.slice(
    setup.indexOf('async fn install_openclaw_impl'),
    setup.indexOf('/// 准备 Gateway'),
  );
  assert.ok(relocate.indexOf('operation_gate.lock_owned().await') >= 0);
  assert.ok(
    relocate.indexOf('operation_gate.lock_owned().await')
      < relocate.indexOf('install_lock.lock().await'),
  );
  assert.match(paths, /complete_openclaw_relocation\(expected_npm_prefix: Option<&Path>\)/);
  assert.match(paths, /optional_paths_refer_to_same_location\(layout\.npm_prefix\.as_deref\(\), expected_npm_prefix\)/);
});

test('BUG-WRM-06 an explicit portable Node never falls through to system npm', () => {
  const system = readFileSync(
    new URL('../../src-tauri/src/commands/system.rs', import.meta.url),
    'utf8',
  );
  const npmCheck = system.slice(system.indexOf('pub\(crate\) async fn check_npm_for_node'), system.indexOf('fn npm_openclaw_entry'));
  assert.match(npmCheck, /NpmExecutionContext::for_node\(Path::new\(node_path\)\)/);
  assert.match(system, /impl NpmExecutionContext[\s\S]*?search_path_with_executable_parent\(node, &openclaw_search_path\(\)\)/);
  assert.match(system, /struct NodeRuntimeContract/);
  assert.match(setup, /NodeRuntimeContract::resolve\(requirement\)/);
  assert.match(setup, /NpmExecutionContext::for_node\(&node_path\)/);
  assert.match(setup, /npm: &npm_context/);
  assert.doesNotMatch(npmCheck, /detect_path\("npm"\)/);
  assert.match(setup, /let target_node = runtime_binary\(&target, "node"\)/);
  assert.match(setup, /validate_node_runtime_pair\(&target_node, &requirement\)/);
  assert.doesNotMatch(setup, /staged_npm_cli/);
});

test('BUG-WRM-07 terminal integration uses the validated runtime before relocation commits', () => {
  const relocationCommit = setup.slice(
    setup.indexOf('impl OpenclawRelocationRequest'),
    setup.indexOf('async fn install_openclaw_impl'),
  );
  const terminalSync = relocationCommit.indexOf('sync_terminal_integration_with_native_runtime');
  const persistBinary = relocationCommit.indexOf('persist_selected_openclaw_binary');
  const completeRelocation = relocationCommit.indexOf('complete_openclaw_relocation');
  assert.ok(terminalSync >= 0);
  assert.ok(persistBinary < terminalSync);
  assert.ok(terminalSync < completeRelocation);
  assert.match(terminalIntegration, /NativeOpenclawLaunchSpec/);
  assert.match(terminalWindows, /NativeOpenclawLaunchSpec::NodeScript/);
  assert.doesNotMatch(terminalWindows, /detect_path\("node"\)/);
  assert.doesNotMatch(terminalWindows, /configured_node_path\(\)/);
});

test('BUG-WRM-08 path policy and relocation commit each have one owner', () => {
  assert.match(paths, /pub\(crate\) fn paths_refer_to_same_location/);
  assert.match(paths, /pub\(crate\) fn optional_paths_refer_to_same_location/);
  assert.match(paths, /pub\(crate\) fn paths_overlap/);
  assert.doesNotMatch(setup, /fn paths_refer_to_same_location/);
  assert.doesNotMatch(storage, /fn locations_overlap/);
  assert.match(setup, /struct OpenclawRelocationRequest/);
  assert.match(setup, /async fn commit\([\s\S]*?runtime: &crate::commands::system::NativeOpenclawRuntime/);
});

test('BUG-WRM-09 runtime location changes persist a compensating transaction until Gateway health commits it', () => {
  assert.match(paths, /struct PendingRuntimeReconfiguration/);
  assert.match(paths, /fn begin_runtime_reconfiguration/);
  assert.match(paths, /fn commit_setup_runtime_transaction/);
  assert.match(paths, /fn stage_runtime_reconfiguration_previous_layout/);
  assert.match(paths, /fn complete_runtime_reconfiguration_recovery/);
  assert.doesNotMatch(paths, /fn rollback_runtime_reconfiguration/);
  assert.doesNotMatch(storage, /pub async fn commit_runtime_reconfiguration/);
  assert.match(storage, /pub async fn rollback_runtime_reconfiguration/);
  assert.match(storage, /recover_interrupted_runtime_reconfiguration/);
  assert.match(storage, /recover_runtime_reconfiguration_after_failure/);
  assert.match(storage, /StorageReconfigurationFailurePolicy/);
  assert.match(lib, /commands::storage::recover_interrupted_runtime_reconfiguration/);
  assert.match(lib, /commands::config::commit_setup_gateway_runtime/);
  assert.match(lib, /commands::storage::rollback_runtime_reconfiguration/);
  assert.match(api, /invoke<boolean>\("commit_setup_gateway_runtime"/);
  assert.match(api, /invoke<boolean>\("rollback_runtime_reconfiguration"\)/);
  assert.doesNotMatch(api, /commit_active_gateway_runtime|commit_runtime_reconfiguration/);

  const selection = setupFlow.slice(
    setupFlow.indexOf('const selectMode = useCallback'),
    setupFlow.indexOf('const requestReinstall = useCallback'),
  );
  assert.match(selection, /commit: commitSetupGatewayRuntime/);
  assert.match(selection, /rollbackPendingLocations: rollbackRuntimeReconfiguration/);
  assert.match(selection, /rollbackMode: rollbackActiveGatewayRuntime/);
  assert.match(paths, /fn commit_setup_runtime_transaction/);
  assert.match(config, /pub async fn commit_setup_gateway_runtime/);
});

test('BUG-WRM-10 incomplete runtime recovery blocks storage edits and offers a retryable restoration action', () => {
  assert.match(storage, /runtime_reconfiguration_recovery_error: Option<String>/);
  assert.match(storage, /runtime_reconfiguration_recovery_error\.is_none\(\)/);
  assert.match(storagePanel, /runtimeReconfigurationRecoveryError\?: string \| null/);
  assert.match(storagePanel, /await rollbackRuntimeReconfiguration\(\);[\s\S]*await loadStorageStatus\(\);/);
  assert.match(storagePanel, /if \(status\.runtimeReconfigurationRecoveryError\)/);
  assert.match(storagePanel, /runtimeRecoveryRetry/);
});

test('BUG-WRM-11 recovery uses the prior verified service launch when the candidate npm runtime is incomplete', () => {
  const recovery = storage.slice(
    storage.indexOf('async fn recover_pending_runtime_reconfiguration'),
    storage.indexOf('async fn recover_runtime_reconfiguration_after_failure'),
  );
  assert.match(paths, /struct NativeGatewayServiceLaunchContract/);
  assert.match(recovery, /gateway_recovery\.native_service_launch\(\)/);
  assert.match(recovery, /native_openclaw_runtime_from_gateway_service_launch_contract/);
  assert.match(recovery, /stop_all_locked_with_service_runtime/);
  assert.doesNotMatch(recovery, /stop_all_locked\(\n\s*state,\n\s*candidate_binary/);
});

test('runtime migration messages exist in every supported locale', () => {
  for (const locale of ['zh', 'zh-TW', 'en', 'ar']) {
    const messages = JSON.parse(
      readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(typeof messages['setup.openclaw.relocate'], 'string');
    const migrationHint = messages['storage.migrationLayoutLocked']
      ?? (messages.storage as Record<string, unknown> | undefined)?.migrationLayoutLocked;
    assert.equal(typeof migrationHint, 'string');
  }
});
