import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const setup = readFileSync(new URL('../src-tauri/src/commands/setup.rs', import.meta.url), 'utf8');
const gitRuntime = readFileSync(new URL('../src-tauri/src/commands/git_runtime.rs', import.meta.url), 'utf8');
const nodeRuntime = readFileSync(new URL('../src-tauri/src/commands/node_runtime.rs', import.meta.url), 'utf8');
const platform = readFileSync(new URL('../src-tauri/src/platform.rs', import.meta.url), 'utf8');
const lib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const config = readFileSync(new URL('../src-tauri/src/commands/config.rs', import.meta.url), 'utf8');
const gatewayCredentials = readFileSync(new URL('../src-tauri/src/commands/gateway_credentials.rs', import.meta.url), 'utf8');
const cargo = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
const tauri = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const noUpdaterArtifactsProfile = JSON.parse(
  readFileSync(new URL('../src-tauri/tauri.no-updater-artifacts.conf.json', import.meta.url), 'utf8'),
);
const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const release = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const taggedRelease = readFileSync(new URL('../.github/workflows/tag-release.yml', import.meta.url), 'utf8');

test('Windows PATH refresh expands registry values and preserves process entries', () => {
  assert.match(platform, /ExpandEnvironmentStringsW/);
  assert.match(platform, /std::env::var_os\("PATH"\)/);
  assert.match(platform, /eq_ignore_ascii_case/);
  assert.doesNotMatch(platform, /parts\.join\(";"\)/);
  const refresh = platform.slice(
    platform.indexOf('fn refresh_windows_path_from_registry'),
    platform.indexOf('pub fn default_shell_command'),
  );
  assert.ok(
    refresh.indexOf('std::env::var_os("PATH")')
      < refresh.indexOf('HKEY_LOCAL_MACHINE'),
    'the inherited PATH must retain version-manager precedence before registry entries are appended',
  );
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
  // Existing system tools are reused. Missing tools prefer domestic mirrors
  // and retain official publisher endpoints as the last fallback. Archives
  // remain available only for an explicit portable selection.
  assert.match(setup, /install_windows_system_node/);
  assert.match(setup, /install_windows_system_node_from_mirrors/);
  assert.match(setup, /install_windows_system_node_with_winget/);
  assert.match(setup, /install_windows_system_git/);
  assert.match(setup, /install_windows_system_git_from_mirrors/);
  assert.match(setup, /ensure_winget_package/);
  assert.match(setup, /paths::configured_node_runtime_dir\(\)/);
  assert.match(setup, /paths::configured_git_runtime_dir\(\)/);
  assert.match(setup, /install_portable_node_runtime/);
  assert.match(setup, /install_windows_portable_git/);
  assert.doesNotMatch(setup, /default_managed_(node|git)_runtime_dir/);
  assert.doesNotMatch(setup, /runtime_dir\(\)\.join\("node"\)/);
  assert.doesNotMatch(setup, /runtime_dir\(\)\.join\("git"\)/);
  assert.doesNotMatch(setup, /NODE_DISTRIBUTION_(BASES|SOURCES)/);
  assert.match(nodeRuntime, /NODE_DISTRIBUTION_CATALOG/);
  assert.match(nodeRuntime, /node_installer_sources/);
  assert.match(setup, /resolve_node_sha256/);
  assert.match(nodeRuntime, /npmmirror\.com\/mirrors\/node/);
  assert.match(nodeRuntime, /mirrors\.aliyun\.com\/nodejs-release/);
  assert.match(nodeRuntime, /mirrors\.cloud\.tencent\.com\/nodejs-release/);
  assert.match(nodeRuntime, /mirrors\.huaweicloud\.com\/nodejs/);
  assert.match(nodeRuntime, /node_checksum_sources[\s\S]*NODE_DISTRIBUTION_CATALOG/);
  assert.match(nodeRuntime, /nodejs\.org\/dist/);
  assert.match(setup, /providers\.len\(\) >= 2/);
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
  assert.ok(gitDefaultInstall.indexOf('install_windows_system_git_from_mirrors') < gitDefaultInstall.indexOf('ensure_winget_package'));
});

test('Windows signing is isolated behind the unreachable trusted promotion path', () => {
  assert.equal(tauri.bundle.windows.signCommand, undefined);
  assert.match(release, /needs\.verify-version\.outputs\.signing-enabled == 'true' && runner\.os == 'Windows'/);
  assert.match(release, /WINDOWS_PFX_BASE64/);
  assert.match(release, /WINDOWS_TIMESTAMP_URL/);
  assert.match(release, /signtool sign \/fd SHA256/);
  assert.match(release, /signtool verify \/pa \/all \/tw/);
  assert.equal(noUpdaterArtifactsProfile.bundle?.createUpdaterArtifacts, false);
  assert.match(release, /--config\s+src-tauri\/tauri\.no-updater-artifacts\.conf\.json/);
  assert.doesNotMatch(release, /tags:\s*\[/);
});

test('Windows reads the selected OpenClaw token and stores device credentials in Credential Manager', () => {
  const detector = config.slice(
    config.indexOf('pub async fn detect_gateway_config'),
    config.indexOf('pub async fn set_active_gateway_runtime'),
  );
  assert.match(detector, /paths::active_config_path\(\)/);
  assert.match(detector, /extract_token_from_config/);
  assert.match(detector, /ws_url/);
  assert.match(gatewayCredentials, /store_system_credential/);
  assert.match(gatewayCredentials, /get_system_credential/);
  assert.doesNotMatch(gatewayCredentials, /std::fs::(?:write|read_to_string)/);
  assert.match(cargo, /\[target\.'cfg\(windows\)'\.dependencies\][\s\S]*keyring\s*=\s*\{[^}]*"windows-native"/);
});

test('Windows release matrix builds and stages NSIS installers for x64 and ARM64', () => {
  assert.match(release, /name: Windows x64[\s\S]*target: 'x86_64-pc-windows-msvc'[\s\S]*--bundles nsis/);
  assert.match(release, /name: Windows ARM64[\s\S]*target: 'aarch64-pc-windows-msvc'[\s\S]*--bundles nsis/);
  assert.match(release, /bundle\/nsis\|\.exe/);
  assert.doesNotMatch(release, /--bundles nsis,msi|bundle\/msi\|\.msi/);
  assert.match(taggedRelease, /--bundles nsis/);
  assert.doesNotMatch(taggedRelease, /--bundles nsis,msi|bundle\/msi\/\*\.msi/);
  assert.match(taggedRelease, /Validate signed release assets and generate updater manifest/);
  assert.doesNotMatch(taggedRelease, /asset_count|Expected 19 release assets/);
  assert.match(release, /if-no-files-found: error/);
});

test('Cargo dependencies are prefetched before Windows builds run offline', () => {
  for (const workflow of [ci, release, taggedRelease]) {
    assert.match(workflow, /Fetch locked Rust dependencies/);
    assert.match(workflow, /node scripts\/fetch-cargo-dependencies\.mjs --target/);
  }
  assert.match(ci, /Build NSIS installer[\s\S]*CARGO_NET_OFFLINE: "true"/);
  assert.match(release, /Build unsigned candidate[\s\S]*CARGO_NET_OFFLINE: "true"/);
  assert.match(taggedRelease, /Build signed updater artifacts and installers[\s\S]*CARGO_NET_OFFLINE: "true"/);
});
