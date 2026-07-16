import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const setup = readFileSync(new URL('../src-tauri/src/commands/setup.rs', import.meta.url), 'utf8');
const lib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const tauri = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const release = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');

test('Windows PATH refresh expands registry values and preserves process entries', () => {
  assert.match(setup, /ExpandEnvironmentStringsW/);
  assert.match(setup, /std::env::var_os\("PATH"\)/);
  assert.match(setup, /eq_ignore_ascii_case/);
  assert.doesNotMatch(setup, /parts\.join\(";"\)/);
});

test('OpenClaw promotion has persistent recovery state', () => {
  assert.match(setup, /OPENCLAW_PROMOTION_MARKER/);
  assert.match(setup, /recover_interrupted_openclaw_promotion\(target_prefix\)/);
  assert.match(setup, /rollback also failed/);
});

test('generic winget package installation command is not exposed', () => {
  assert.doesNotMatch(setup, /pub async fn install_winget_package/);
  assert.doesNotMatch(lib, /commands::setup::install_winget_package/);
});

test('Windows bootstrap is offline and runtime installation respects the selected path policy', () => {
  assert.equal(tauri.bundle.windows.webviewInstallMode.type, 'offlineInstaller');
  assert.deepEqual(tauri.plugins.updater.endpoints, []);
  // No custom runtime directory means standard system installation. A
  // user-selected portable directory is the only path that downloads archives.
  assert.match(setup, /install_windows_system_node/);
  assert.match(setup, /install_windows_system_git/);
  assert.match(setup, /install_or_upgrade_winget_package/);
  assert.match(setup, /paths::configured_node_runtime_dir\(\)/);
  assert.match(setup, /paths::configured_git_runtime_dir\(\)/);
  assert.match(setup, /install_windows_portable_node/);
  assert.match(setup, /install_windows_portable_git/);
  assert.match(setup, /CHINA_NODE_INDEX/);
  assert.match(setup, /resolve_node_sha256/);
  assert.match(setup, /npmmirror\.com\/mirrors\/node/);
});

test('Windows releases require and verify Authenticode signatures', () => {
  assert.equal(tauri.bundle.windows.signCommand, undefined);
  assert.match(release, /signpath\/github-action-submit-signing-request@b9d91eadd323de506c0c81cf0c7fe7438f3360fd/g);
  assert.match(release, /SIGNPATH_APPLICATION_ARTIFACT_CONFIGURATION_SLUG/);
  assert.match(release, /SIGNPATH_INSTALLER_ARTIFACT_CONFIGURATION_SLUG/);
  assert.match(release, /pnpm tauri signer sign \$installer\.FullName/);
  assert.match(release, /generate-updater-manifest\.mjs/);
  assert.match(release, /Get-AuthenticodeSignature/);
  assert.match(release, /signature\.Status -ne 'Valid'/);
});
