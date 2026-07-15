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
  assert.match(paths, /pub fn complete_openclaw_relocation\(\)/);
  assert.match(setupFlow, /oclaw\.relocation_required/);
  const relocate = setup.slice(
    setup.indexOf('async fn install_openclaw_impl'),
    setup.indexOf('/// 准备 Gateway'),
  );
  assert.ok(relocate.indexOf('persist_selected_openclaw_binary') >= 0);
  assert.ok(
    relocate.indexOf('complete_openclaw_relocation')
      > relocate.indexOf('persist_selected_openclaw_binary'),
  );
  assert.match(
    relocate,
    /verify_relocated_openclaw_prefix\(&openclaw_bin, &openclaw_prefix\)/,
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
