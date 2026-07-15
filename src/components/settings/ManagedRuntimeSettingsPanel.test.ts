import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const panel = readFileSync(new URL('./ManagedRuntimeSettingsPanel.tsx', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../../pages/SettingsPage.tsx', import.meta.url), 'utf8');
const setup = readFileSync(new URL('../../../src-tauri/src/commands/setup.rs', import.meta.url), 'utf8');
const gitRuntime = readFileSync(new URL('../../../src-tauri/src/commands/git_runtime.rs', import.meta.url), 'utf8');
const managedRuntime = readFileSync(new URL('../../../src-tauri/src/commands/managed_runtime.rs', import.meta.url), 'utf8');
const lib = readFileSync(new URL('../../../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const updater = readFileSync(new URL('../../../src-tauri/src/commands/openclaw_update.rs', import.meta.url), 'utf8');

test('storage settings exposes independent managed runtime lifecycle actions', () => {
  assert.match(settings, /activeTab === 'storage'[\s\S]*<ManagedRuntimeSettingsPanel \/>/);
  assert.match(panel, /get_managed_runtime_status/);
  assert.match(panel, /update_managed_node/);
  assert.match(panel, /update_managed_git/);
  assert.match(panel, /setup-progress/);
  assert.match(panel, /runtimeDir/);
  assert.match(panel, /nodeRequirement/);
});

test('runtime commands resolve publisher metadata and use transactional activation', () => {
  assert.doesNotMatch(setup, /GIT_WIN_VERSION|MANAGED_NODE_VERSION/);
  assert.match(gitRuntime, /releases\/latest/);
  assert.match(gitRuntime, /sha256/);
  assert.match(setup, /activate_staged_runtime/);
  assert.match(setup, /NODE_INSTALL_LOCK/);
  assert.match(setup, /GIT_INSTALL_LOCK/);
  assert.match(managedRuntime, /setup::update_managed_node_runtime/);
  assert.match(managedRuntime, /setup::update_managed_git_runtime/);
  assert.match(lib, /commands::managed_runtime::update_managed_node/);
  assert.match(lib, /commands::managed_runtime::update_managed_git/);
});

test('fresh install and existing-install update use distinct OpenClaw contracts', () => {
  assert.match(setup, /install_node[\s\S]*target_openclaw_node_requirement\(\)/);
  assert.match(setup, /update_managed_node_runtime[\s\S]*installed_openclaw_node_requirement\(\)/);
  assert.match(updater, /resolve_openclaw_node_requirement\(metadata_registry, version\)/);
  assert.match(updater, /ensure_compatible_node_runtime\(&app, UPDATE_PROGRESS_STEP, &target_requirement\)/);
});
