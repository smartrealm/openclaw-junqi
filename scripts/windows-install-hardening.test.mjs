import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const setup = readFileSync(new URL('../src-tauri/src/commands/setup.rs', import.meta.url), 'utf8');
const gitRuntime = readFileSync(new URL('../src-tauri/src/commands/git_runtime.rs', import.meta.url), 'utf8');
const nodeRuntime = readFileSync(new URL('../src-tauri/src/commands/node_runtime.rs', import.meta.url), 'utf8');
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

test('Windows package uses the small WebView2 bootstrapper and standard system runtime defaults', () => {
  assert.equal(tauri.bundle.windows.webviewInstallMode.type, 'downloadBootstrapper');
  assert.deepEqual(tauri.plugins.updater.endpoints, []);
  // Existing system tools are reused. Missing tools use the vendor installer
  // from domestic mirrors, which keeps the vendor-selected default path.
  // Archives remain available only for an explicit portable selection.
  assert.match(setup, /install_windows_system_node/);
  assert.match(setup, /install_windows_system_node_from_mirrors/);
  assert.match(setup, /install_windows_system_node_with_winget/);
  assert.match(setup, /install_windows_system_git/);
  assert.match(setup, /install_windows_system_git_from_mirrors/);
  assert.match(setup, /install_or_upgrade_winget_package/);
  assert.match(setup, /paths::configured_node_runtime_dir\(\)/);
  assert.match(setup, /paths::configured_git_runtime_dir\(\)/);
  assert.match(setup, /install_portable_node_runtime/);
  assert.match(setup, /install_windows_portable_git/);
  assert.doesNotMatch(setup, /default_managed_(node|git)_runtime_dir/);
  assert.doesNotMatch(setup, /runtime_dir\(\)\.join\("node"\)/);
  assert.doesNotMatch(setup, /runtime_dir\(\)\.join\("git"\)/);
  assert.doesNotMatch(setup, /NODE_DISTRIBUTION_(BASES|SOURCES)/);
  assert.match(nodeRuntime, /NODE_DISTRIBUTION_SOURCES/);
  assert.match(nodeRuntime, /node_installer_sources/);
  assert.match(setup, /resolve_node_sha256/);
  assert.match(nodeRuntime, /npmmirror\.com\/mirrors\/node/);
  assert.match(nodeRuntime, /mirrors\.aliyun\.com\/nodejs-release/);
  assert.match(nodeRuntime, /mirrors\.cloud\.tencent\.com\/nodejs-release/);
  assert.match(nodeRuntime, /mirrors\.huaweicloud\.com\/nodejs/);
  assert.doesNotMatch(nodeRuntime, /nodejs\.org\/dist/);
  assert.doesNotMatch(setup, /resolve_latest_managed_git_artifact/);
  assert.match(gitRuntime, /registry\.npmmirror\.com\/.*git-for-windows/);
  assert.match(gitRuntime, /mirrors\.huaweicloud\.com\/git-for-windows/);
  assert.match(gitRuntime, /git_for_windows_installer/);
  assert.doesNotMatch(gitRuntime, /GitHub（备用）/);

  const nodeDefaultInstall = setup.slice(
    setup.indexOf('async fn install_windows_system_node('),
    setup.indexOf('async fn install_windows_system_node_from_mirrors('),
  );
  assert.ok(nodeDefaultInstall.indexOf('install_windows_system_node_from_mirrors') < nodeDefaultInstall.indexOf('install_windows_system_node_with_winget'));

  const gitDefaultInstall = setup.slice(
    setup.indexOf('async fn install_windows_system_git('),
    setup.indexOf('async fn install_windows_system_git_from_mirrors('),
  );
  assert.ok(gitDefaultInstall.indexOf('install_windows_system_git_from_mirrors') < gitDefaultInstall.indexOf('install_or_upgrade_winget_package'));
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
