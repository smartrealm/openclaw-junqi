import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { progressForPhase, progressForSetupEvent } from './setupProgressModel';

const setupFlow = readFileSync(new URL('./useSetupFlow.ts', import.meta.url), 'utf8');
const setupPage = readFileSync(new URL('../pages/SetupPage.tsx', import.meta.url), 'utf8');
const storagePanel = readFileSync(new URL('../components/setup/StorageSetupGate.tsx', import.meta.url), 'utf8');
const storageCommand = readFileSync(new URL('../../src-tauri/src/commands/storage.rs', import.meta.url), 'utf8');
const setupCommand = readFileSync(new URL('../../src-tauri/src/commands/setup.rs', import.meta.url), 'utf8');
const dockerCommand = readFileSync(new URL('../../src-tauri/src/commands/docker.rs', import.meta.url), 'utf8');
const updater = readFileSync(new URL('../../src-tauri/src/commands/openclaw_update.rs', import.meta.url), 'utf8');

test('BUG-IU-01 fresh storage requires onboarding before Gateway start', () => {
  const completion = setupFlow.slice(
    setupFlow.indexOf('const completeStorageSetup'),
    setupFlow.indexOf('const repairAndRetry'),
  );
  assert.match(completion, /if \(createdFresh\) updateOnboardingRequirement\(true\)/);
  assert.match(completion, /createdFresh && \(postStorageStep === "ready" \|\| postStorageStep === "configure-openclaw"\)/);
  assert.match(setupPage, /onReady=\{flow\.completeStorageSetup\}/);
  assert.doesNotMatch(setupPage, /const finishStorage/);
});

test('BUG-IU-02 OpenClaw updater has one Gateway lifecycle owner', () => {
  assert.match(updater, /&\["update", "--yes", "--no-restart", "--json"\]/);
  assert.match(updater, /GatewayUpdateHandoff::prepare\(&state, &runtime\)/);
  assert.match(updater, /handoff\.restore\(app\.clone\(\), state\.clone\(\), runtime\)/);
  assert.match(updater, /handoff\.mark_unrecoverable_failure/);
  assert.doesNotMatch(updater, /reconcile_installed_update_with_restart_failure/);
  assert.doesNotMatch(updater, /GATEWAY_RESTART_FAILURE_MARKERS/);
});

test('BUG-IU-03 backend owns the fresh-storage result contract', () => {
  assert.match(storageCommand, /created_fresh: bool/);
  assert.match(storageCommand, /created_fresh: false/);
  assert.match(storageCommand, /created_fresh: !migrate_existing/);
  assert.match(storagePanel, /invoke<StorageConfigureResult>\('configure_storage'/);
  assert.match(storagePanel, /createdFresh: result\.createdFresh/);
  assert.doesNotMatch(storagePanel, /createdFresh: !usingLegacy/);
});

test('BUG-IU-11 runtime downloads reuse only digest-verified persistent cache entries', () => {
  assert.match(setupCommand, /runtime_download_cache_path/);
  assert.match(setupCommand, /restore_verified_download_cache/);
  assert.match(setupCommand, /actual\.eq_ignore_ascii_case\(expected_sha256\)/);
  assert.match(setupCommand, /persist_verified_download_cache\(cache, destination\)/);
});

test('BUG-IU-12 Windows x86 installs and reuses a stable portable MinGit fallback', () => {
  const systemCommand = readFileSync(new URL('../../src-tauri/src/commands/system.rs', import.meta.url), 'utf8');
  const paths = readFileSync(new URL('../../src-tauri/src/paths.rs', import.meta.url), 'utf8');
  assert.match(paths, /managed_git_fallback_dir/);
  assert.match(systemCommand, /std::env::consts::ARCH == "x86"[\s\S]*?managed_git_fallback_path/);
  assert.match(setupCommand, /std::env::consts::ARCH == "x86"[\s\S]*?managed_git_fallback_dir/);
});

test('BUG-IU-13 Windows x86 exposes a capability reason instead of pretending Docker is missing', () => {
  assert.match(dockerCommand, /unsupported_reason: Option<String>/);
  assert.match(dockerCommand, /Docker Desktop is not supported on 32-bit Windows/);
  assert.match(setupPage, /dockerUnsupportedX86/);
});

test('BUG-IU-07 Docker readiness distinguishes an installed daemon from an available OpenClaw image', () => {
  const detection = setupFlow.slice(
    setupFlow.indexOf('// ── Docker detect after the welcome step'),
    setupFlow.indexOf('// ── setup-progress event listener'),
  );

  assert.match(dockerCommand, /pub struct DockerStatus[\s\S]*?image_available: bool/);
  assert.match(dockerCommand, /args\(\["image", "inspect", &image\]\)/);
  assert.match(detection, /image_available: false/);
  assert.match(setupFlow, /if \(dockerStatus\?\.image_available\)[\s\S]*?reusingDockerImage[\s\S]*?else \{[\s\S]*?pullOpenclawImage\("latest"\)/);
});

test('BUG-IU-08 an exact managed Docker container is reused while contract drift recreates it', () => {
  const dockerStart = dockerCommand.slice(
    dockerCommand.indexOf('pub(crate) async fn start_docker_gateway_with_image_locked'),
    dockerCommand.indexOf('/// Spawn `docker logs'),
  );

  assert.match(dockerCommand, /fn managed_container_matches_runtime_contract/);
  assert.match(dockerCommand, /HostConfig\/RestartPolicy\/Name/);
  assert.match(dockerCommand, /HostConfig\/PortBindings/);
  assert.match(dockerStart, /managed_container_matches_runtime_contract/);
  assert.match(dockerStart, /args\(\["start", OPENCLAW_CONTAINER_NAME\]\)/);
  assert.match(dockerStart, /Reusing existing Docker container/);
  assert.ok(
    dockerStart.indexOf('managed_container_matches_runtime_contract')
      < dockerStart.indexOf('remove_managed_container_for_recreate'),
  );
});

test('BUG-IU-09 a failed Docker candidate is cleaned before runtime compensation', () => {
  const dockerStart = dockerCommand.slice(
    dockerCommand.indexOf('pub(crate) async fn start_docker_gateway_with_image_locked'),
    dockerCommand.indexOf('/// Spawn `docker logs'),
  );

  assert.match(dockerCommand, /async fn cleanup_failed_managed_container/);
  assert.match(dockerCommand, /failed Docker candidate could not be cleaned up/);
  assert.match(dockerStart, /docker start failed:[\s\S]*cleanup_failed_managed_container/);
  assert.match(dockerStart, /Container exited unexpectedly[\s\S]*cleanup_failed_managed_container/);
  assert.match(dockerStart, /cleanup_failed_managed_container\([\s\S]*Gateway health check timed out/);
});

test('BUG-IU-10 runtime switching preserves the source Gateway when the target port owner is unknown', () => {
  assert.match(dockerCommand, /assert_target_port_owned_or_available/);
  assert.match(dockerCommand, /release_managed_native_gateway_for_docker/);
  assert.match(dockerCommand, /target_matches_native/);
  assert.match(dockerCommand, /release_managed_docker_gateway_for_native/);
  assert.match(dockerCommand, /target_matches_docker/);
  assert.match(dockerCommand, /container_publishes_host_port/);
  assert.match(dockerCommand, /healthy \{source\} runtime was left running and \{target\} was not started/);
});

test('BUG-IU-06 relocating configured storage migrates the selected state, not only the legacy default', () => {
  const migrationSource = storagePanel.slice(
    storagePanel.indexOf('function migrationSource'),
    storagePanel.indexOf('function errorMessage'),
  );
  const chooseDirectory = storagePanel.slice(
    storagePanel.indexOf('const chooseDirectory'),
    storagePanel.indexOf('const chooseExactDirectory'),
  );
  const applyStorage = storagePanel.slice(
    storagePanel.indexOf('const applyStorage'),
    storagePanel.indexOf('useEffect(() => {\n    setCompletion(null)'),
  );

  assert.match(migrationSource, /forceConfigure \|\| status\.configured \? status\.stateDir : status\.legacyDir/);
  assert.match(migrationSource, /forceConfigure \|\| status\.configured \|\| status\.legacyExists/);
  assert.match(chooseDirectory, /hasMigratableSource\(status, forceConfigure\)/);
  assert.match(applyStorage, /hasMigratableSource\(status, forceConfigure\)/);
  assert.match(storageCommand, /let source = paths::desktop_dir\(\)/);
});

test('BUG-IU-04 external Gateway restoration stays JunQi-managed', () => {
  const start = storageCommand.indexOf('async fn start_runtime_locked');
  const runtimeRestore = storageCommand.slice(start, storageCommand.indexOf('fn restore_bootstrap', start));
  assert.match(storageCommand, /enum RuntimeRestoreStrategy/);
  assert.match(storageCommand, /GatewayRuntimeMode::External\s*\| GatewayRuntimeMode::None => Self::ManagedChild/);
  assert.match(runtimeRestore, /RuntimeRestoreStrategy::SystemService =>/);
  assert.match(runtimeRestore, /strategy\.restored_mode\(\)/);
});

test('BUG-IU-05 setup progress stays after storage and reaches 100', () => {
  assert.doesNotMatch(setupFlow, /resetProgress/);
  assert.equal(progressForPhase('node', 0), 31);
  assert.equal(progressForSetupEvent('git', 0, 'native'), progressForPhase('openclaw', 0));
  assert.equal(progressForSetupEvent('pull', 0, 'docker'), 31);
  assert.equal(progressForSetupEvent('container', 100, 'docker'), 84);
  assert.equal(progressForPhase('ready', 100), 100);
});

test('BUG-CPI-04 package updates require a target Node contract before Gateway shutdown', () => {
  const preflight = updater.slice(
    updater.indexOf('let (dry_run_output, metadata_source)'),
    updater.indexOf('let restore_gateway = stop_managed_gateway'),
  );
  const completion = updater.slice(
    updater.indexOf('if result.mode.as_deref()'),
    updater.indexOf('let refreshed = system::detect_openclaw'),
  );

  assert.match(preflight, /parse_dry_run_update_status/);
  assert.match(preflight, /resolve_update_target_contract/);
  assert.match(preflight, /emit_update_error\(&app, &error, Some\(0\.38\)\);[\s\S]*return Err\(error\)/);
  assert.match(preflight, /ensure_compatible_node_runtime[\s\S]*target\.node_requirement/);
  assert.match(completion, /validate_updated_runtime_contract/);
  assert.match(completion, /sync_terminal_integration_with_native_runtime/);
  assert.match(completion, /Gateway recovery failed[\s\S]*mark_update_failure/);
});

test('BUG-CPI-05 npm-prefix relocation preserves the installed package contract', () => {
  assert.match(storageCommand, /OpenclawRelocationContract::new/);
  assert.match(setupCommand, /enum OpenclawInstallTargetResolution/);
  assert.match(setupCommand, /PinnedRelocation\(paths::OpenclawRelocationContract\)/);
  assert.match(setupCommand, /resolve_openclaw_release_target\(node, contract\.version\(\)\)/);
  assert.match(setupCommand, /OpenclawInstallTargetResolution::for_install\(mode, relocation\.as_ref\(\)\)/);
});
