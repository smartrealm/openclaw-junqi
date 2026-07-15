import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const panel = readFileSync(new URL('./ManagedRuntimeSettingsPanel.tsx', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../../pages/SettingsPage.tsx', import.meta.url), 'utf8');
const setup = readFileSync(new URL('../../../src-tauri/src/commands/setup.rs', import.meta.url), 'utf8');
const managedRuntime = readFileSync(new URL('../../../src-tauri/src/commands/managed_runtime.rs', import.meta.url), 'utf8');
const lib = readFileSync(new URL('../../../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const updater = readFileSync(new URL('../../../src-tauri/src/commands/openclaw_update.rs', import.meta.url), 'utf8');

test('storage settings exposes independent system tool lifecycle actions', () => {
  assert.match(settings, /activeTab === 'storage'[\s\S]*<ManagedRuntimeSettingsPanel \/>/);
  assert.match(panel, /get_managed_runtime_status/);
  assert.match(panel, /update_managed_node/);
  assert.match(panel, /update_managed_git/);
  assert.match(panel, /setup-progress/);
  assert.doesNotMatch(panel, /status\?\.runtimeDir/);
  assert.match(panel, /nodeRequirement/);
});

test('runtime commands use system package management without hard-coded versions', () => {
  assert.doesNotMatch(setup, /GIT_WIN_VERSION|MANAGED_NODE_VERSION/);
  assert.match(setup, /OpenJS\.NodeJS\.LTS/);
  assert.match(setup, /Git\.Git/);
  assert.match(setup, /install_or_upgrade_winget_package/);
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
