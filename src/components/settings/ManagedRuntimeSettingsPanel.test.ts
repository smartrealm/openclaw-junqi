import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const panel = readFileSync(new URL('./ManagedRuntimeSettingsPanel.tsx', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../../pages/SettingsPage.tsx', import.meta.url), 'utf8');
const setup = readFileSync(new URL('../../../src-tauri/src/commands/setup.rs', import.meta.url), 'utf8');
const managedRuntime = readFileSync(new URL('../../../src-tauri/src/commands/managed_runtime.rs', import.meta.url), 'utf8');
const nodeRuntime = readFileSync(new URL('../../../src-tauri/src/commands/node_runtime.rs', import.meta.url), 'utf8');
const gitRuntime = readFileSync(new URL('../../../src-tauri/src/commands/git_runtime.rs', import.meta.url), 'utf8');
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

test('runtime commands use domestic vendor installers for system defaults and reserve archives for custom directories', () => {
  assert.match(setup, /install_windows_system_node/);
  assert.match(setup, /install_windows_system_node_from_mirrors/);
  assert.match(setup, /install_windows_system_node_with_winget/);
  assert.match(setup, /install_windows_system_git/);
  assert.match(setup, /install_windows_system_git_from_mirrors/);
  assert.match(setup, /install_or_upgrade_winget_package/);
  assert.match(setup, /WINGET_NODE_LTS_PACKAGE/);
  assert.match(setup, /WINGET_GIT_PACKAGE/);
  assert.match(setup, /install_portable_node_runtime/);
  assert.match(setup, /install_windows_portable_git/);
  assert.doesNotMatch(setup, /default_managed_(node|git)_runtime_dir/);
  assert.match(nodeRuntime, /npmmirror\.com\/mirrors\/node/);
  assert.match(nodeRuntime, /node_installer_sources/);
  assert.match(setup, /resolve_node_sha256/);
  assert.match(setup, /verified_managed_git_artifact/);
  assert.match(setup, /verified_system_git_installer_artifact/);
  assert.match(setup, /run_windows_installer/);
  assert.doesNotMatch(setup, /resolve_latest_managed_git_artifact/);
  assert.match(setup, /NODE_INSTALL_LOCK/);
  assert.match(setup, /GIT_INSTALL_LOCK/);
  assert.match(managedRuntime, /setup::update_managed_node_runtime/);
  assert.match(managedRuntime, /setup::update_managed_git_runtime/);
  assert.match(managedRuntime, /node_runtime::node_download_order\(\)/);
  assert.match(managedRuntime, /git_runtime::managed_git_download_order\(\)/);
  assert.match(managedRuntime, /runtime_update_supported/);
  assert.match(managedRuntime, /system_node_update/);
  assert.match(managedRuntime, /system_git_update/);
  assert.doesNotMatch(panel, /source === 'managed'/);
  assert.match(gitRuntime, /GIT_DISTRIBUTION_SOURCES/);
  assert.doesNotMatch(managedRuntime, /Windows Package Manager/);
  assert.doesNotMatch(managedRuntime, /GitHub/);
  assert.match(lib, /commands::managed_runtime::update_managed_node/);
  assert.match(lib, /commands::managed_runtime::update_managed_git/);
});

test('fresh install and existing-install update use distinct OpenClaw contracts', () => {
  assert.match(setup, /async fn setup_node_requirement[\s\S]*resolve_openclaw_binary_async[\s\S]*required_node_requirement_for_openclaw_binary[\s\S]*target_openclaw_node_requirement/);
  assert.match(setup, /install_node[\s\S]*setup_node_requirement\(\)/);
  assert.match(setup, /update_managed_node_runtime[\s\S]*installed_openclaw_node_requirement\(\)/);
  assert.match(updater, /resolve_openclaw_node_requirement\(metadata_registry, version\)/);
  assert.match(updater, /resolve_update_target_contract/);
  assert.match(updater, /ensure_compatible_node_runtime\([\s\S]*?&target\.node_requirement/);
  assert.match(updater, /validate_updated_runtime_contract/);
  assert.match(updater, /mark_update_failure/);
});
