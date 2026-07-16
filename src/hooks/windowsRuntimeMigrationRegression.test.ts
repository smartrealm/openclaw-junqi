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
const gateway = readFileSync(new URL('../../src-tauri/src/commands/gateway.rs', import.meta.url), 'utf8');
const update = readFileSync(new URL('../../src-tauri/src/commands/openclaw_update.rs', import.meta.url), 'utf8');
const repair = readFileSync(new URL('../../src-tauri/src/commands/openclaw_repair.rs', import.meta.url), 'utf8');
const terminalIntegration = readFileSync(
  new URL('../../src-tauri/src/commands/terminal_integration/mod.rs', import.meta.url),
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
    /OpenclawInstallMode::Relocate => \{[\s\S]*?pick_install_target\(&app, step\)/,
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
  assert.match(
    relocationCommit,
    /verify_relocated_openclaw_prefix\(binary, installed_prefix\)/,
  );
  const system = readFileSync(
    new URL('../../src-tauri/src/commands/system.rs', import.meta.url),
    'utf8',
  );
  assert.match(
    system,
    /if paths::openclaw_relocation_required\(\) \{\s*return None;/,
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
  const npmCheck = system.slice(system.indexOf('pub async fn check_npm'), system.indexOf('fn portable_node_is_compatible'));
  assert.match(npmCheck, /if let Some\(node\) = paths::configured_node_path\(\)/);
  assert.ok(npmCheck.indexOf('return Ok(NpmStatus') < npmCheck.indexOf('let system_npm'));
  assert.match(setup, /let target_node = runtime_binary\(&target, "node"\)/);
  assert.match(setup, /let target_npm = staged_npm_cli\(&target\)/);
  assert.match(setup, /if !force && target_npm\.is_file\(\)/);
  assert.match(setup, /requirement\.supports\(&version\)/);
});

test('BUG-WRM-07 terminal integration succeeds before relocation is committed', () => {
  const relocationCommit = setup.slice(
    setup.indexOf('impl OpenclawRelocationRequest'),
    setup.indexOf('async fn install_openclaw_impl'),
  );
  const terminalSync = relocationCommit.indexOf('sync_terminal_integration_for_relocation');
  const persistBinary = relocationCommit.indexOf('persist_selected_openclaw_binary');
  const completeRelocation = relocationCommit.indexOf('complete_openclaw_relocation');
  assert.ok(terminalSync >= 0);
  assert.ok(terminalSync < persistBinary);
  assert.ok(persistBinary < completeRelocation);
  assert.match(terminalIntegration, /native_binary_override: Option<&Path>/);
});

test('BUG-WRM-08 path policy and relocation commit each have one owner', () => {
  assert.match(paths, /pub\(crate\) fn paths_refer_to_same_location/);
  assert.match(paths, /pub\(crate\) fn optional_paths_refer_to_same_location/);
  assert.match(paths, /pub\(crate\) fn paths_overlap/);
  assert.doesNotMatch(setup, /fn paths_refer_to_same_location/);
  assert.doesNotMatch(storage, /fn locations_overlap/);
  assert.match(setup, /struct OpenclawRelocationRequest/);
  assert.match(setup, /fn commit\(&self, binary: &Path, installed_prefix: &Path\)/);
});

test('runtime migration messages exist in every supported locale', () => {
  for (const locale of ['zh', 'en', 'ar']) {
    const messages = JSON.parse(
      readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(typeof messages['setup.openclaw.relocate'], 'string');
    const migrationHint = messages['storage.migrationLayoutLocked']
      ?? (messages.storage as Record<string, unknown> | undefined)?.migrationLayoutLocked;
    assert.equal(typeof migrationHint, 'string');
  }
});
