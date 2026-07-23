import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

test('BUG-01 ensure flow keeps Native and Docker recovery contracts separate', () => {
  const rust = source('src-tauri/src/commands/ensure.rs');
  const nativeStart = rust.indexOf('crate::commands::gateway::start_gateway_locked(');
  const nativeRecovery = rust.slice(
    rust.indexOf('if matches!(selected_mode, OpenClawRuntimeMode::Docker)'),
    rust.indexOf('// Pull `app` into the manager trait surface'),
  );
  assert.ok(nativeStart >= 0, 'ensure flow must invoke the already-locked native start implementation');
  assert.doesNotMatch(nativeRecovery, /attempting Docker fallback|match check_docker\(\)\.await/);
  assert.match(nativeRecovery, /the selected Native runtime was not changed/);
});

test('BUG-GL01 all lifecycle writers share the operation gate', () => {
  const gateway = source('src-tauri/src/commands/gateway.rs');
  const ensure = source('src-tauri/src/commands/ensure.rs');
  const docker = source('src-tauri/src/commands/docker.rs');
  assert.match(gateway, /pub async fn start_gateway[\s\S]*operation_gate\.lock_owned\(\)\.await/);
  assert.match(gateway, /pub async fn restart_gateway[\s\S]*operation_gate/);
  assert.match(gateway, /pub async fn stop_gateway[\s\S]*operation_gate\.lock_owned\(\)\.await/);
  assert.match(ensure, /ensure_gateway_running[\s\S]*operation_gate\.lock_owned\(\)\.await/);
  assert.match(docker, /start_docker_gateway[\s\S]*operation_gate\.lock_owned\(\)\.await/);
});

test('BUG-GL02 ensure waits on the supervisor instead of returning an in-flight failure', () => {
  const ensure = source('src-tauri/src/commands/ensure.rs');
  assert.doesNotMatch(ensure, /ENSURE_IN_FLIGHT|Gateway recovery is already running/);
  assert.match(ensure, /start_gateway_locked/);
  assert.match(ensure, /start_docker_gateway_locked/);
});

test('BUG-GL03 desktop registers one OS-level application instance', () => {
  const cargo = source('src-tauri/Cargo.toml');
  const rust = source('src-tauri/src/lib.rs');
  assert.match(cargo, /tauri-plugin-single-instance/);
  assert.match(rust, /tauri_plugin_single_instance::init/);
  assert.match(rust, /get_webview_window\("main"\)[\s\S]*set_focus/);
});

test('BUG-GL04 diagnostics expose lifecycle and runtime ownership together', () => {
  const state = source('src-tauri/src/state/gateway_process.rs');
  const supervisor = source('src-tauri/src/commands/gateway_supervisor.rs');
  const panel = source('src/components/settings/GatewayLifecyclePanel.tsx');
  const processFields = state.slice(
    state.indexOf('pub struct GatewayProcess'),
    state.indexOf('impl GatewayProcess'),
  );
  assert.match(state, /runtime: Mutex<GatewayRuntimeState>/);
  assert.match(state, /pub fn transition\(/);
  assert.doesNotMatch(processFields, /pub lifecycle:|pub runtime_mode:/);
  assert.match(supervisor, /GatewayRuntimeSnapshot/);
  assert.match(supervisor, /lifecycle:[\s\S]*mode:[\s\S]*managed_pid/);
  assert.match(panel, /get_gateway_runtime_snapshot/);
  assert.match(panel, /runtimeModeLabel/);
});

test('BUG-GSC01 application lifecycle requests use the manager core', () => {
  const app = source('src/App.tsx');
  const channels = source('src/pages/ChannelsCenter/index.tsx');
  const settings = source('src/pages/SettingsPage.tsx');
  const palette = source('src/components/CommandPalette.tsx');
  const setup = source('src/hooks/useSetupFlow.ts');
  assert.doesNotMatch(app, /gateway\.disconnect\(\)/);
  assert.doesNotMatch(app, /window\.aegis\??\.gateway\??\.(?:retry|ensureRunning)\??\.\(/);
  assert.doesNotMatch(app, /gateway\.reconnectWithToken\(/);
  assert.match(app, /gatewayManager\.ensureRunning\(\)/);
  assert.match(app, /gatewayManager\.restart\(\)/);
  assert.match(channels, /gatewayManager\.restart\(\)/);
  assert.match(setup, /gatewayManager\.startForSetup\(\)/);
  assert.match(setup, /gatewayManager\.startDockerForSetup\(\)/);
  assert.doesNotMatch(setup, /await startGateway\(\)/);
  assert.doesNotMatch(setup, /await startDockerGateway\(\)/);
  assert.doesNotMatch(settings, /gateway\.connect\(/);
  assert.doesNotMatch(palette, /gateway\.connect\(/);
});

test('managed Gateway start owns readiness and preserves process diagnostics', () => {
  const gateway = source('src-tauri/src/commands/gateway.rs');
  const gatewayService = source('src-tauri/src/commands/gateway_service.rs');
  const processControl = source('src-tauri/src/commands/process_control.rs');
  const setup = source('src/hooks/useSetupFlow.ts');
  assert.match(gateway, /struct GatewayStartupPolicy/);
  assert.match(gateway, /first_output_timeout:[\s\S]*cfg!\(windows\)[\s\S]*120/);
  assert.match(gateway, /readiness_after_output:[\s\S]*from_secs\(90\)/);
  assert.match(gateway, /observed_bound_port/);
  assert.match(gateway, /did not pass OpenClaw health and authentication checks/);
  assert.match(gateway, /observed_bound_port/);
  assert.match(gateway, /did not pass OpenClaw health and authentication checks/);
  assert.match(gateway, /child\.try_wait\(\)[\s\S]*gateway_matches_config\(port, &config_path\)\.await/);
  assert.match(gateway, /OPENCLAW_GATEWAY_LIVENESS_PATH: &str = "healthz"/);
  assert.doesNotMatch(gateway, /TcpStream::connect/);
  assert.match(gateway, /terminate_owned_gateway\(&mut child\)\.await/);
  assert.match(gateway, /Recent Gateway output/);
  assert.match(gateway, /managed child health check passed/);
  assert.match(gatewayService, /run_command_output_confirmed/);
  assert.match(gatewayService, /error\.cleanup_confirmed\(\)/);
  assert.match(processControl, /terminate_grouped_process_tree_confirmed/);
  assert.match(setup, /waitForGatewayReady\(runId, isDockerRuntime \? 30_000 : 10_000, status\?\.port\)/);
});

test('BUG-WIN-STATE-01 validates selected storage with Node before Gateway bootstrap and authenticates external endpoints', () => {
  const gateway = source('src-tauri/src/commands/gateway.rs');
  const storage = source('src-tauri/src/commands/storage.rs');
  const probe = source('src-tauri/src/commands/openclaw_state_dir.rs');
  const diagnostics = source('src-tauri/src/state/gateway_diagnostics.rs');
  const setup = source('src/hooks/useSetupFlow.ts');
  const gate = source('src/components/setup/StorageSetupGate.tsx');

  assert.match(probe, /fs\.chmodSync\(probeDir, 0o700\)/);
  assert.match(probe, /verify_node_state_directory/);
  assert.match(storage, /async fn verify_layout_storage_capability/);
  assert.match(storage, /verify_layout_storage_capability\(&layout\)\.await/);
  assert.match(storage, /commands::system::check_node\(\)\.await/);
  assert.match(storage, /gateway_matches_config\(port, config_path\)/);
  assert.match(gateway, /gateway_accepts_configured_token/);
  assert.match(gateway, /bearer_auth\(token\)/);
  assert.match(diagnostics, /SelectStorage/);
  assert.match(setup, /recommendation === "select_storage"/);
  assert.match(gate, /forceConfigure \|\| \(!result\.configured && result\.legacyExists\)/);

  const start = gateway.slice(gateway.indexOf('pub(crate) async fn start_gateway_locked'));
  assert.ok(start.indexOf('verify_node_state_directory') < start.indexOf('ensure_config_with_token'));
  assert.ok(start.indexOf('ensure_config_with_token') < start.indexOf('cmd.spawn()'));
});

test('BUG-GW-01 forced storage recovery migrates the configured state, not only the legacy default', () => {
  const gate = source('src/components/setup/StorageSetupGate.tsx');

  assert.match(gate, /const shouldMigrateSelectedState = !usingLegacy[\s\S]*forceConfigure \|\| status\.legacyExists/);
  assert.match(gate, /migrateExisting: shouldMigrateSelectedState/);
});

test('BUG-GW-02 lifecycle ownership decisions authenticate the selected state directory', () => {
  const ensure = source('src-tauri/src/commands/ensure.rs');
  const gateway = source('src-tauri/src/commands/gateway.rs');
  const storage = source('src-tauri/src/commands/storage.rs');

  assert.match(ensure, /selected_native_gateway_ready[\s\S]*gateway_matches_config/);
  assert.match(ensure, /if selected_native_gateway_ready\(port\)\.await/);
  assert.match(storage, /wait_for_gateway\([\s\S]*gateway_matches_config/);
  assert.match(storage, /reachable: crate::commands::gateway::gateway_matches_config\(port, &old_config\)\.await/);
  assert.match(gateway, /wait_for_selected_gateway[\s\S]*gateway_matches_config/);
  assert.match(gateway, /if gateway_matches_config\(port, &config_path\)\.await/);
});

test('BUG-GSO-04 service restart uses the official command and native readiness budget', () => {
  const gateway = source('src-tauri/src/commands/gateway.rs');
  const restart = gateway.slice(
    gateway.indexOf('pub async fn restart_gateway'),
    gateway.indexOf('pub async fn restart_local_gateway'),
  );

  assert.match(restart, /cmd\.args\(\["gateway", "restart"\]\)/);
  assert.doesNotMatch(restart, /\["gateway", "--port", &port\.to_string\(\), "restart"\]/);
  assert.match(
    restart,
    /wait_for_selected_gateway\([\s\S]*native_gateway_readiness_timeout_secs\(\)[\s\S]*\)\s*\.await/,
  );
});

// BUG-WIN-CWD-01: state_dir (data directory) and Gateway cwd must be decoupled.
// `stable_openclaw_working_dir()` returns the non-root user home dir,
// while OPENCLAW_STATE_DIR / OPENCLAW_CONFIG_PATH stay on the chosen data drive.
// Fix: cwd = stable_home, not state_dir and not None (unpredictable parent cwd).
test('BUG-WIN-CWD-01 managed Gateway uses stable non-root cwd', () => {
  const system = source('src-tauri/src/commands/system.rs');
  const managed = system.slice(system.indexOf('fn managed_gateway'), system.indexOf('fn with_search_path'));
  // cwd is stable_openclaw_working_dir(), not state_dir and not None.
  assert.match(managed, /stable_openclaw_working_dir\(\)/);
  assert.doesNotMatch(managed, /working_dir = state_dir[.\s]*Some/);
});

test('BUG-GSO-01 offline service discovery is authoritative and fail-closed', () => {
  const gateway = source('src-tauri/src/commands/gateway.rs');
  const service = source('src-tauri/src/commands/gateway_service.rs');
  const start = gateway.slice(
    gateway.indexOf('pub async fn start_gateway'),
    gateway.indexOf('pub async fn stop_gateway'),
  );

  assert.match(service, /OPENCLAW_STATE_DIR/);
  assert.match(service, /paths_refer_to_same_location/);
  assert.doesNotMatch(service, /inspect_gateway_service_state_for_start/);
  assert.doesNotMatch(service, /STARTUP_SERVICE_STATUS_TIMEOUT/);
  assert.match(service, /stop_selected_gateway_service_verified/);
  assert.match(service, /"--no-probe"/);
  assert.ok(start.indexOf('if is_gateway_healthy(port).await') < start.indexOf('let service_inspection ='));
  assert.match(start, /inspect_gateway_service_state\([\s\S]*a competing Gateway was not started/);
});

test('BUG-GSO-02 an installed selected service remains the normal startup owner', () => {
  const gateway = source('src-tauri/src/commands/gateway.rs');
  const start = gateway.slice(
    gateway.indexOf('pub async fn start_gateway'),
    gateway.indexOf('pub async fn stop_gateway'),
  );

  assert.match(start, /start_installed_gateway_service\([\s\S]*service_inspection/);
  assert.ok(start.indexOf('let service_inspection =') < start.indexOf('is_port_available(port)'));
  assert.match(start, /InstalledServiceStartPolicy::Reconcile[\s\S]*inspect_gateway_service_state/);
});

test('BUG-GW-04 storage migration preserves only a verified official service binding', () => {
  const storage = source('src-tauri/src/commands/storage.rs');
  const service = source('src-tauri/src/commands/gateway_service.rs');

  assert.match(storage, /selected_service:\s*if old_bootstrap\.is_some\(\)/);
  assert.match(storage, /fn restore_mode\(self\).*GatewayRuntimeMode::SystemService/s);
  assert.match(storage, /stop_all_locked\([\s\S]*previous\.selected_service/);
  assert.match(service, /install_and_start_selected_gateway_service/);
  assert.doesNotMatch(storage, /run_gateway_service_command/);
});

test('setup self-rescue commands are registered and use official plugin convergence repair', () => {
  const repair = source('src-tauri/src/commands/openclaw_repair.rs');
  const lib = source('src-tauri/src/lib.rs');
  assert.match(repair, /pub async fn repair_openclaw/);
  assert.match(repair, /"update",\s*"repair"/);
  assert.match(repair, /terminate_process_tree/);
  assert.match(repair, /try_lock_owned\(\)/);
  assert.match(lib, /commands::openclaw_repair::repair_openclaw/);
  assert.doesNotMatch(lib, /repair_openclaw_for_setup|openclaw_doctor_repair|run_maintenance_repair/);
});

test('BUG-GSC03 manager has one state transition and emission core', () => {
  const manager = source('src/services/gateway/GatewayConnectionManager.ts');
  assert.equal((manager.match(/this\.fsm\.transition\(/g) ?? []).length, 1);
  assert.equal((manager.match(/this\.emit\(\)/g) ?? []).length, 1);
  assert.doesNotMatch(manager, /if \(status\.retrying\)[\s\S]{0,120}return/);
});

test('BUG-GSC04 Rust canonical state has one atomic writer', () => {
  const state = source('src-tauri/src/state/gateway_process.rs');
  const supervisor = source('src-tauri/src/commands/gateway_supervisor.rs');
  const gatewayCommand = source('src-tauri/src/commands/gateway.rs');
  assert.equal((state.match(/self\.runtime/g) ?? []).length, 2);
  assert.match(state, /pub fn runtime_snapshot\([\s\S]*self\.runtime\.lock/);
  assert.match(state, /pub fn transition\([\s\S]*self\.runtime\.lock/);
  assert.doesNotMatch(supervisor, /transition_lifecycle|transition_runtime|\.runtime\.lock/);
  assert.match(gatewayCommand, /paths::active_runtime_mode\(\)/);
  assert.doesNotMatch(gatewayCommand, /\.runtime\.lock|\.lifecycle\.lock|transition_lifecycle|transition_runtime/);
});

test('BUG-GSC08 gateway observation is read-only while lifecycle ownership is busy', () => {
  const gatewayCommand = source('src-tauri/src/commands/gateway.rs');
  const status = gatewayCommand.slice(
    gatewayCommand.indexOf('pub async fn gateway_status'),
    gatewayCommand.indexOf('pub async fn probe_gateway_port'),
  );
  assert.match(status, /try_lock_owned\(\)\.ok\(\)/);
  assert.match(status, /let can_reconcile = _observation_guard\.is_some\(\)/);
  assert.match(status, /GatewayObservation::ManagedChildUnready/);
  assert.match(status, /GatewayObservation::EndpointOffline/);
  assert.doesNotMatch(status, /state\.transition\(/);
});

test('BUG-GSC09 manager commits orchestration fields only through dispatch', () => {
  const manager = source('src/services/gateway/GatewayConnectionManager.ts');
  const beforeDispatch = manager.slice(0, manager.indexOf('private dispatch('));
  const afterDispatch = manager.slice(manager.indexOf('private dispatch('));
  assert.doesNotMatch(beforeDispatch, /this\.(?:error|retrying|logs)\s*=/);
  assert.match(afterDispatch, /this\.error\s*=/);
  assert.match(afterDispatch, /this\.retrying\s*=/);
  assert.match(afterDispatch, /this\.logs\s*=/);
  assert.doesNotMatch(manager, /startAttempted/);
  assert.match(manager, /this\.dispatch\(\{ type: 'RECOVERY_REQUESTED' \}\)/);
  assert.match(manager, /rejectPendingStart\('Gateway start was superseded/);
});

test('BUG-ST01 storage bootstrap is stable and environment overrides remain supported', () => {
  const paths = source('src-tauri/src/paths.rs');
  assert.match(paths, /storage_bootstrap_path/);
  assert.match(paths, /com\.junqi\.junqidesktop/);
  assert.match(paths, /OPENCLAW_STATE_DIR/);
  assert.match(paths, /OPENCLAW_CONFIG_PATH/);
});

test('BUG-ST02 storage decision is an explicit post-detection setup step', () => {
  const store = source('src/stores/app-store.ts');
  const navigation = source('src/stores/setup-navigation.ts');
  const flow = source('src/hooks/useSetupFlow.ts');
  const setup = source('src/pages/SetupPage.tsx');
  const gate = source('src/components/setup/StorageSetupGate.tsx');
  const main = source('src/main.tsx');
  assert.match(navigation, /\| "storage"/);
  assert.match(store, /postStorageStep/);
  assert.match(flow, /setPostStorageStep\("choosing-mode"\)[\s\S]*navigateSetup\("storage", "replace"\)/);
  assert.match(flow, /setPostStorageStep\("gateway-stopped"\)[\s\S]*navigateSetup\("storage", "replace"\)/);
  assert.match(flow, /setPostStorageStep\(onboardingRequired \? "configure-openclaw" : "ready"\)[\s\S]*navigateSetup\("storage", "replace"\)/);
  assert.match(setup, /case "storage"[\s\S]*<StorageSetupStep/);
  assert.match(gate, /get_storage_setup_status/);
  assert.match(gate, /configure_storage/);
  assert.match(gate, /migrateExisting/);
  assert.match(gate, /createdFresh:/);
  assert.match(flow, /createdFresh && \(postStorageStep === "ready" \|\| postStorageStep === "configure-openclaw"\)[\s\S]*"gateway-stopped"/);
  assert.match(setup, /onReady=\{flow\.completeStorageSetup\}/);
  assert.match(main, /import\('\.\/App'\)/);
  assert.doesNotMatch(main, /DesktopRoot/);
});

test('BUG-ST03 storage migration waits for a free gateway port before copying', () => {
  const storage = source('src-tauri/src/commands/storage.rs');
  const configure = storage.slice(storage.indexOf('pub async fn configure_storage'));
  const migration = configure.slice(configure.indexOf('let rollback = StorageRollbackContext'));
  const stop = migration.indexOf('stop_all_locked_with_compensation(');
  const waitForPort = migration.indexOf('wait_for_port_free(');
  const prepare = migration.indexOf('prepare_storage_target(');

  assert.ok(stop >= 0, 'migration must stop every managed runtime transactionally');
  assert.ok(waitForPort > stop, 'migration must wait after requesting shutdown');
  assert.ok(prepare > waitForPort, 'migration must not copy until the gateway port is free');
  assert.match(storage, /struct StorageRollbackContext/);
  assert.match(migration, /rollback\.run\(RollbackPolicy::AFTER_SWITCH/);
  assert.doesNotMatch(storage, /rollback_storage_transaction\(/);
});

test('BUG-ST04 storage progress is localized by stable keys in every locale', () => {
  const storage = source('src-tauri/src/commands/storage.rs');
  const gate = source('src/components/setup/StorageSetupGate.tsx');
  const locales = ['zh', 'zh-TW', 'en', 'ar'] as const;
  const progressKeys = [
    'storage.progress.stoppingGateway',
    'storage.progress.copying',
    'storage.progress.preparingFresh',
    'storage.progress.verifying',
    'storage.progress.switching',
    'storage.progress.startingGateway',
    'storage.progress.complete',
  ];
  const valueAt = (messages: Record<string, unknown>, key: string): unknown => {
    if (key in messages) return messages[key];
    return key.split('.').reduce<unknown>((value, segment) => {
      if (!value || typeof value !== 'object') return undefined;
      return (value as Record<string, unknown>)[segment];
    }, messages);
  };

  assert.match(gate, /payload\.key \? t\(payload\.key, payload\.message\)/);
  for (const key of progressKeys) {
    assert.match(storage, new RegExp(`"${key.replaceAll('.', '\\.')}"`));
    for (const locale of locales) {
      const messages = JSON.parse(source(`src/locales/${locale}.json`)) as Record<string, unknown>;
      assert.equal(typeof valueAt(messages, key), 'string', `${locale} is missing ${key}`);
    }
  }
});

test('BUG-GSO-03 selected service restart failures are fail-closed', () => {
  const rust = source('src-tauri/src/commands/gateway.rs');
  const restart = rust.slice(
    rust.indexOf('pub async fn restart_gateway'),
    rust.indexOf('pub async fn restart_local_gateway'),
  );
  const selectedServiceRestart = restart.slice(restart.indexOf('let context = service_identity.command_context'));

  assert.match(rust, /async fn restart_managed_gateway_without_service/);
  assert.match(
    restart,
    /GatewayRestartTarget::ManagedChild[\s\S]*restart_managed_gateway_without_service/,
  );
  assert.doesNotMatch(selectedServiceRestart, /restart_managed_gateway_without_service/);
  assert.match(selectedServiceRestart, /if !status\.success\(\)[\s\S]*selected_service_restart_error/);
  assert.match(
    selectedServiceRestart,
    /native_gateway_readiness_timeout_secs\(\)[\s\S]*selected_service_restart_error/,
  );
});

test('BUG-03 gateway manager snapshots include collected logs', () => {
  const manager = source('src/services/gateway/GatewayConnectionManager.ts');
  const errorScreen = source('src/components/GatewayErrorScreen.tsx');
  assert.match(manager, /logs: this\.logs/);
  assert.match(errorScreen, /logs=\{combinedLogs\}/);
});

test('BUG-03 normal gateway logs do not report the process as restarting', () => {
  const adapter = source('src/api/tauri-adapter.ts');
  const normalHandler = adapter.slice(
    adapter.indexOf('const handleGatewayLog'),
    adapter.indexOf('const handleRestartProgress'),
  );
  assert.doesNotMatch(normalHandler, /retrying:\s*true/);
  assert.doesNotMatch(normalHandler, /running:\s*false/);
});

test('BUG-04 restart lifecycle has explicit synchronous start and finish events', () => {
  const adapter = source('src/api/tauri-adapter.ts');
  assert.match(adapter, /GATEWAY_RESTART_STARTED_EVENT/);
  assert.match(adapter, /GATEWAY_RESTART_FINISHED_EVENT/);
  assert.match(adapter, /handleRestartFinished[\s\S]*requestImmediatePoll/);
});

test('BUG-04 late restart progress cannot re-lock recovery controls', () => {
  const adapter = source('src/api/tauri-adapter.ts');
  const progressHandler = adapter.slice(
    adapter.indexOf('const handleRestartProgress'),
    adapter.indexOf('const handleRestartStarted'),
  );
  assert.doesNotMatch(progressHandler, /restartActive\s*=\s*true/);
  assert.match(progressHandler, /retrying:\s*restartActive/);
});

test('BUG-GL07 restart CLI is terminated and fails closed on abnormal wait', () => {
  const rust = source('src-tauri/src/commands/gateway.rs');
  const waitBranches = rust.slice(
    rust.indexOf('let status = match tokio::time::timeout'),
    rust.indexOf('if !status.success()'),
  );
  assert.equal(
    (waitBranches.match(/terminate_owned_gateway\(&mut child\)\.await/g) ?? []).length,
    2,
  );
  assert.equal((waitBranches.match(/selected_service_restart_error\(&state, reason\)/g) ?? []).length, 2);
  assert.doesNotMatch(waitBranches, /restart_managed_gateway_without_service/);
});

test('BUG-GSO-07 successful pending service recovery disarms the start failure guard', () => {
  const gateway = source('src-tauri/src/commands/gateway.rs');
  const pendingStart = gateway.indexOf('let pending_service_running');
  const pending = gateway.slice(
    pendingStart,
    gateway.indexOf('let service_identity', pendingStart),
  );

  assert.match(pending, /state\.transition\([\s\S]*GatewayRuntimeMode::SystemService/);
  assert.match(pending, /start_failure_guard\.disarm\(\);[\s\S]*return Ok\(GatewayStatus/);
});

test('BUG-GSO-08 authenticated managed child reuse preserves child ownership', () => {
  const gateway = source('src-tauri/src/commands/gateway.rs');
  const start = gateway.slice(
    gateway.indexOf('pub(crate) async fn start_gateway_locked'),
    gateway.indexOf('pub async fn stop_gateway'),
  );

  assert.match(start, /inspect_gateway_owner\(&state\)/);
  assert.match(start, /managed_pid\.is_some\(\)[\s\S]*GatewayRuntimeMode::ManagedChild/);
  assert.match(start, /pid: managed_pid/);
});

test('BUG-GSO-09 managed restart terminates the old child before common startup', () => {
  const gateway = source('src-tauri/src/commands/gateway.rs');
  const restartManaged = gateway.slice(
    gateway.indexOf('async fn restart_managed_gateway_without_service'),
    gateway.indexOf('fn spawn_log_reader'),
  );

  assert.match(restartManaged, /child\.take\(\)/);
  assert.match(restartManaged, /terminate_owned_gateway\(&mut old_child\)\.await/);
  assert.ok(
    restartManaged.indexOf('terminate_owned_gateway') < restartManaged.indexOf('start_managed_gateway_locked'),
  );
});

test('BUG-GSO-09 explicit managed-owner restoration cannot reselect a service', () => {
  const gateway = source('src-tauri/src/commands/gateway.rs');
  const update = source('src-tauri/src/commands/gateway_update_handoff.rs');
  const storage = source('src-tauri/src/commands/storage.rs');

  assert.match(gateway, /InstalledServiceStartPolicy::ManagedChildOnly/);
  assert.match(gateway, /recover_failed_official_gateway_handoff[\s\S]*start_managed_gateway_locked/);
  assert.match(update, /restore_managed_child[\s\S]*start_managed_gateway_locked/);
  assert.match(storage, /RuntimeRestoreStrategy::ManagedChild[\s\S]*start_managed_gateway_locked/);
});

test('BUG-GSO-10 Native to Docker handoff fails closed on service ownership', () => {
  const docker = source('src-tauri/src/commands/docker.rs');
  const release = docker.slice(
    docker.indexOf('pub(crate) async fn release_managed_native_gateway_for_docker'),
    docker.indexOf('pub(crate) async fn release_managed_docker_gateway_for_native'),
  );

  assert.match(release, /inspect_gateway_service_state[\s\S]*map_err/);
  assert.match(release, /stop_installed_selected_gateway_service_verified/);
  assert.match(release, /service is not owned by the selected configuration/);
  assert.doesNotMatch(release, /inspection\.is_ok_and/);
});

test('BUG-GL12 restart fully terminates the managed child before restarting the service', () => {
  const gateway = source('src-tauri/src/commands/gateway.rs');
  const restart = gateway.slice(
    gateway.indexOf('pub async fn restart_gateway'),
    gateway.indexOf('pub async fn restart_local_gateway'),
  );

  assert.match(restart, /terminate_owned_gateway\(&mut old\)\.await/);
  assert.match(restart, /wait_for_port_free\(port, 30_000\)\.await/);
  assert.doesNotMatch(restart, /let _ = old\.kill\(\)\.await/);
});

test('BUG-GL08 restart contention is coalesced only by a completed restart generation', () => {
  const state = source('src-tauri/src/state/gateway_process.rs');
  const rust = source('src-tauri/src/commands/gateway.rs');
  assert.match(state, /restart_completed_generation: AtomicU64/);
  assert.match(rust, /observed_restart_generation/);
  assert.match(rust, /current Gateway restart finished|Concurrent Gateway restart finished/);
  assert.match(rust, /fetch_add\(1, Ordering::AcqRel\)/);
  assert.doesNotMatch(rust, /restart already in progress; joining the active restart/);
});

test('BUG-GL09 manager rejects stale lifecycle work and destroys its subscription', () => {
  const manager = source('src/services/gateway/GatewayConnectionManager.ts');
  const executor = source('src/services/gateway/GatewayActionExecutor.ts');
  const app = source('src/App.tsx');
  assert.match(manager, /LifecycleEpoch/);
  assert.match(manager, /if \(!this\.isCurrent\(generation\)\) return/);
  assert.match(executor, /const target = await resolveConnectionTarget\(\);[\s\S]*if \(!isCurrent\(\)\) return/);
  assert.match(app, /gatewayManager\.destroy\(\)/);
});

test('BUG-GL10 status polling is serial and invalidates in-flight results on cleanup', () => {
  const adapter = source('src/api/tauri-adapter.ts');
  const statusObserver = adapter.slice(
    adapter.indexOf('onStatusChanged: (cb: any)'),
    adapter.indexOf('\n  settings:'),
  );
  assert.doesNotMatch(statusObserver, /setInterval/);
  assert.match(statusObserver, /pollInFlight/);
  assert.match(statusObserver, /schedulePoll\(2_000\)/);
  assert.match(statusObserver, /pollGeneration \+= 1/);
  assert.match(statusObserver, /if \(!isCurrent\(\)\) return/g);
  assert.equal(
    (statusObserver.match(/subscribeTauriEvent\(/g) ?? []).length,
    2,
    'both status listeners must use the lifecycle-safe subscription boundary',
  );
});

test('BUG-05 recovery log surfaces retain useful diagnostic context', () => {
  const errorScreen = source('src/components/GatewayErrorScreen.tsx');
  assert.match(errorScreen, /const combinedLogs =/);
  assert.match(errorScreen, /max-h-48/);
  assert.match(errorScreen, /logs=\{combinedLogs\}/);
});

test('BUG-GL11 nonblocking recovery shares the App route and exposes determinate progress', () => {
  const dashboard = source('src/pages/Dashboard/index.tsx');
  const statusBar = source('src/components/Layout/StatusBar.tsx');
  const adapter = source('src/api/tauri-adapter.ts');
  const app = source('src/App.tsx');
  const settings = source('src/pages/SettingsPage.tsx');
  const console = source('src-tauri/src/commands/console.rs');
  assert.match(dashboard, /useSetupProgress\('gateway'\)/);
  assert.match(dashboard, /aegis:manual-reconnect/);
  assert.match(dashboard, /role="status"/);
  assert.match(statusBar, /<GatewaySelfRescuePanel/);
  assert.doesNotMatch(dashboard, /gateway\?\.ensureRunning/);
  assert.match(adapter, /gatewayRestartProgressFromLog/);
  assert.doesNotMatch(adapter.slice(adapter.indexOf('consoleUi:'), adapter.indexOf('\n  logs:')), /plugin-shell/);
  assert.match(app, /openControlUiAfterRecoveryRef/);
  assert.match(settings, /openControlUi:\s*true/);
  assert.match(console, /configured_gateway_port/);
  assert.match(console, /is_gateway_healthy\(port\)/);
});

test('BUG-06 stalled boot exposes the complete self-rescue center', () => {
  const statusBar = source('src/components/Layout/StatusBar.tsx');
  const panel = source('src/components/GatewaySelfRescuePanel.tsx');
  assert.match(statusBar, /gatewayPanelOpen[\s\S]*<GatewaySelfRescuePanel/);
  assert.match(statusBar, /onOpenLogs=/);
  assert.match(statusBar, /aegis:manual-reconnect/);
  assert.match(panel, /runOpenClawRepair/);
  assert.match(panel, /disabled=\{actionDisabled\}/);
  assert.match(panel, /<GatewayRescueChat/);
});

test('Gateway startup keeps the routed workbench visible', () => {
  const app = source('src/App.tsx');
  const layout = source('src/components/Layout/AppLayout.tsx');
  const dashboard = source('src/pages/Dashboard/index.tsx');
  assert.doesNotMatch(app, /BootTimelineOverlay/);
  assert.doesNotMatch(layout, /OfflineOverlay/);
  assert.match(dashboard, /!connected && \(/);
});

test('BUG-06 recovery logs remain reachable while Gateway is offline', () => {
  const routes = source('src/utils/gatewayOptionalRoutes.ts');
  assert.match(routes, /['"]\/logs['"]/);
});

test('BUG-07 WebSocket retry has one owner, deadline, and routes exhaustion into recovery', () => {
  const connection = source('src/services/gateway/Connection.ts');
  const app = source('src/App.tsx');
  assert.match(connection, /connect\(\s*url: string,\s*token: string,\s*deviceToken = '',\s*resetReconnectAttempts = true/);
  assert.match(connection, /connect\(this\.url, this\.token, this\.deviceToken, false\)/);
  assert.match(connection, /new ConnectionRetryPolicy\(3\)/);
  assert.match(connection, /CONNECTION_ATTEMPT_TIMEOUT_MS = 8_000/);
  assert.match(connection, /emitRetryState\('exhausted'/);
  assert.doesNotMatch(app, /scheduleReconnectRetries|bootRecoveryTimersRef/);
  assert.match(app, /onRetryState:[\s\S]*retry\.phase === 'exhausted'[\s\S]*surfaceVerifiedGatewayHandoffFailure\(\)/);
  assert.match(app, /retry\.phase === 'exhausted'[\s\S]*self-rescue is ready/);
});

test('BUG-08 an automatic retry can promote the manager directly to connected', () => {
  const stateMachine = source('src/services/gateway/GatewayStateMachine.ts');
  assert.match(
    stateMachine,
    /from: GatewayState\.DETECTING, event: 'WS_OPEN',[\s\S]*to: GatewayState\.CONNECTED/,
  );
  assert.match(
    stateMachine,
    /from: GatewayState\.STARTING,\s+event: 'WS_OPEN',[\s\S]*to: GatewayState\.CONNECTED/,
  );
});

test('OpenClaw updates reuse boot recovery UI without racing the updater restart', () => {
  const app = source('src/App.tsx');
  const hook = source('src/hooks/useOpenclawUpdate.ts');
  const lifecycle = source('src/services/openclawUpdateLifecycle.ts');

  assert.match(hook, /dispatchOpenclawUpdateMaintenanceStarted\(\)/);
  assert.match(hook, /await updateOpenclaw\(\)[\s\S]*dispatchOpenclawUpdateMaintenanceFinished\(\)/);
  assert.match(lifecycle, /aegis:openclaw-update-maintenance-started/);
  assert.match(app, /handleUpdateMaintenanceStarted[\s\S]*useBootSequenceStore\.getState\(\)\.reset\(\)/);
  assert.match(app, /if \(openclawUpdateActive\) return/);
  assert.match(app, /OPENCLAW_UPDATE_MAINTENANCE_FINISHED/);
});

test('migration-lock failures wait for OpenClaw expiry before another restart attempt', () => {
  const app = source('src/App.tsx');
  const recovery = source('src/services/gateway/openclawRepair.ts');

  assert.match(recovery, /MAX_MIGRATION_RETRY_DELAY_MS = 5 \* 60 \* 1000/);
  assert.match(app, /gatewayMigrationRetryDelayMs/);
  assert.match(app, /waitForGatewayMigrationLock/);
  assert.match(app, /gateway\.progress\.waitingForMigrationLock/);
  assert.match(app, /restartGatewayFromBoot\(result\?\.error/);
  assert.match(app, /cancelGatewayMigrationRetry/);
});

test('BUG-GSC11 an authenticated external Gateway cancels a stale migration retry', () => {
  const app = source('src/App.tsx');
  const adapter = source('src/api/tauri-adapter.ts');
  const manager = source('src/services/gateway/GatewayConnectionManager.ts');
  const recovery = source('src/services/gateway/openclawRepair.ts');

  assert.match(adapter, /probeSelectedGatewayReady/);
  assert.match(adapter, /invoke<boolean>\('probe_selected_gateway'/);
  assert.match(manager, /selectedGatewayReady/);
  assert.match(manager, /type: 'SELECTED_GATEWAY_READY'/);
  assert.match(app, /if \(snap\.selectedGatewayReady\)[\s\S]*cancelGatewayMigrationRetry\(\)/);
  assert.match(recovery, /createGatewayMigrationRetryCoordinator/);
});

test('Windows recovery terminates the owned process tree before a new Gateway starts', () => {
  const supervisor = source('src-tauri/src/commands/gateway_supervisor.rs');
  const processControl = source('src-tauri/src/commands/process_control.rs');

  assert.match(supervisor, /terminate_process_tree_confirmed\(/);
  assert.match(processControl, /taskkill/);
  assert.match(processControl, /"\/T", "\/F"/);
});

test('BUG-GSO-06 explicit Gateway stop handles both managed and selected-service owners', () => {
  const gateway = source('src-tauri/src/commands/gateway.rs');
  const stop = gateway.slice(
    gateway.indexOf('pub async fn stop_gateway'),
    gateway.indexOf('pub async fn gateway_status'),
  );

  assert.match(stop, /terminate_owned_gateway\(&mut child\)\.await/);
  assert.match(stop, /stop_installed_selected_gateway_service_verified/);
  assert.match(stop, /authenticated external Gateway is running/);
  assert.match(stop, /wait_for_port_free\(port, 30_000\)\s*\.await/);
  assert.doesNotMatch(stop, /child\s*\.kill\(\)/);
});

test('BUG-WSR-09 direct-provider failure text crosses the IPC boundary only after sanitization', () => {
  const rescue = source('src-tauri/src/commands/gateway_rescue.rs');
  assert.match(rescue, /fn provider_error_message/);
  assert.match(rescue, /sanitize_diagnostic_text\(&message, 1_000\)/);
  assert.match(rescue, /fn rescue_transport_error/);
  assert.match(rescue, /let message = provider_error_message\(&payload\)/);
  assert.match(rescue, /return Err\(format!\("\{\} \{\}", status\.as_u16\(\), message\)\)/);
});

test('BUG-WSR-13 a failed owned-port release aborts restart instead of launching another Gateway', () => {
  const gateway = source('src-tauri/src/commands/gateway.rs');
  const restart = gateway.slice(
    gateway.indexOf('pub async fn restart_gateway'),
    gateway.indexOf('pub async fn restart_local_gateway'),
  );
  const start = gateway.slice(
    gateway.indexOf('pub(crate) async fn start_gateway_locked'),
    gateway.indexOf('pub async fn stop_gateway'),
  );

  assert.match(restart, /owned child terminated but port remained occupied/);
  assert.doesNotMatch(restart, /Gateway port release is still pending/);
  assert.match(start, /start_gateway: owned child terminated but port remained occupied/);
  assert.doesNotMatch(start, /let _ = crate::commands::gateway_supervisor::wait_for_port_free\(port, 30_000\)/);
});

test('native recovery resolves the actual npm installation instead of profile-directory guesses', () => {
  const system = source('src-tauri/src/commands/system.rs');
  const paths = source('src-tauri/src/paths.rs');
  const search = system.slice(
    system.indexOf('pub(crate) fn openclaw_search_path'),
    system.indexOf('fn openclaw_binary_names'),
  );

  assert.match(system, /NativeOpenclawRuntime/);
  assert.match(system, /npm_reported_global_prefix/);
  assert.match(system, /resolve_openclaw_binary_async/);
  assert.match(search, /configured_npm_prefix/);
  assert.match(paths, /npm_bin_dir_for_prefix/);
  assert.doesNotMatch(search, /AppData|ProgramFiles|homebrew/);
});
