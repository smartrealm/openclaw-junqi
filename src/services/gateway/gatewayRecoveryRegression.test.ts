import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

test('BUG-01 ensure flow attempts managed native gateway before Docker fallback', () => {
  const rust = source('src-tauri/src/commands/ensure.rs');
  const nativeStart = rust.indexOf('crate::commands::gateway::start_gateway_locked(');
  const dockerFallback = rust.indexOf('match check_docker().await');
  assert.ok(nativeStart >= 0, 'ensure flow must invoke the already-locked native start implementation');
  assert.ok(dockerFallback > nativeStart, 'Docker fallback must run after native startup');
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
  assert.doesNotMatch(gatewayCommand, /runtime_mode|\.lifecycle\.lock|transition_lifecycle|transition_runtime/);
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
  const flow = source('src/hooks/useSetupFlow.ts');
  const setup = source('src/pages/SetupPage.tsx');
  const gate = source('src/components/setup/StorageSetupGate.tsx');
  const main = source('src/main.tsx');
  assert.match(store, /\| "storage"/);
  assert.match(store, /postStorageStep/);
  assert.match(flow, /setPostStorageStep\("choosing-mode"\)[\s\S]*setSetupStep\("storage"\)/);
  assert.match(flow, /setPostStorageStep\("gateway-stopped"\)[\s\S]*setSetupStep\("storage"\)/);
  assert.match(flow, /setPostStorageStep\(onboardingRequired \? "configure-openclaw" : "ready"\)[\s\S]*setSetupStep\("storage"\)/);
  assert.match(setup, /case "storage"[\s\S]*<StorageSetupStep/);
  assert.match(gate, /get_storage_setup_status/);
  assert.match(gate, /configure_storage/);
  assert.match(gate, /migrateExisting/);
  assert.match(gate, /createdFresh:/);
  assert.match(setup, /result\?\.createdFresh && \(postStorageStep === "ready" \|\| postStorageStep === "configure-openclaw"\)[\s\S]*"gateway-stopped"/);
  assert.match(main, /import\('\.\/App'\)/);
  assert.doesNotMatch(main, /DesktopRoot/);
});

test('BUG-ST03 storage migration waits for a free gateway port before copying', () => {
  const storage = source('src-tauri/src/commands/storage.rs');
  const configure = storage.slice(storage.indexOf('pub async fn configure_storage'));
  const stop = configure.indexOf('stop_all_locked(');
  const waitForPort = configure.indexOf('wait_for_port_free(');
  const prepare = configure.indexOf('prepare_storage_target(');

  assert.ok(stop >= 0, 'migration must stop every managed runtime');
  assert.ok(waitForPort > stop, 'migration must wait after requesting shutdown');
  assert.ok(prepare > waitForPort, 'migration must not copy until the gateway port is free');
  assert.match(configure, /rollback_storage_transaction\(/);
});

test('BUG-ST04 storage progress is localized by stable keys in every locale', () => {
  const storage = source('src-tauri/src/commands/storage.rs');
  const gate = source('src/components/setup/StorageSetupGate.tsx');
  const locales = ['zh', 'en', 'ar'] as const;
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

test('BUG-02 service restart failures use the managed gateway fallback', () => {
  const rust = source('src-tauri/src/commands/gateway.rs');
  assert.match(rust, /async fn start_managed_gateway_fallback/);
  assert.match(rust, /if !status\.success\(\)[\s\S]*start_managed_gateway_fallback/);
  assert.match(rust, /health check did not pass in time[\s\S]*start_managed_gateway_fallback/);
});

test('BUG-03 gateway manager snapshots include collected logs', () => {
  const manager = source('src/services/gateway/GatewayConnectionManager.ts');
  const overlay = source('src/components/BootTimelineOverlay.tsx');
  assert.match(manager, /logs: this\.logs/);
  assert.match(overlay, /recovery\.logs\.length > 0/);
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

test('BUG-GL07 restart CLI is terminated before managed fallback on abnormal wait', () => {
  const rust = source('src-tauri/src/commands/gateway.rs');
  const waitBranches = rust.slice(
    rust.indexOf('let status = match tokio::time::timeout'),
    rust.indexOf('if !status.success()'),
  );
  assert.equal(
    (waitBranches.match(/terminate_owned_gateway\(&mut child\)\.await/g) ?? []).length,
    2,
  );
  assert.match(waitBranches, /terminate_owned_gateway\(&mut child\)\.await;[\s\S]*start_managed_gateway_fallback/);
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
    (statusObserver.match(/if \(stopped\) fn\(\)/g) ?? []).length,
    2,
    'late Tauri listener registrations must immediately unsubscribe after cleanup',
  );
});

test('BUG-05 recovery log surfaces retain useful diagnostic context', () => {
  const offline = source('src/components/OfflineOverlay.tsx');
  const boot = source('src/components/BootTimelineOverlay.tsx');
  assert.match(offline, /max-h-64/);
  assert.match(offline, /slice\(-40\)/);
  assert.match(boot, /max-h-64/);
  assert.match(boot, /slice\(-40\)/);
});

test('BUG-GL11 offline recovery shares the App route and exposes determinate progress', () => {
  const offline = source('src/components/OfflineOverlay.tsx');
  const adapter = source('src/api/tauri-adapter.ts');
  const app = source('src/App.tsx');
  const settings = source('src/pages/SettingsPage.tsx');
  const console = source('src-tauri/src/commands/console.rs');
  assert.match(offline, /useSetupProgress\('gateway'\)/);
  assert.match(offline, /aegis:manual-reconnect/);
  assert.match(offline, /role="progressbar"/);
  assert.doesNotMatch(offline, /gateway\?\.ensureRunning/);
  assert.match(adapter, /gatewayRestartProgressFromLog/);
  assert.doesNotMatch(adapter.slice(adapter.indexOf('consoleUi:'), adapter.indexOf('\n  logs:')), /plugin-shell/);
  assert.match(app, /openControlUiAfterRecoveryRef/);
  assert.match(settings, /openControlUi:\s*true/);
  assert.match(console, /configured_gateway_port/);
  assert.match(console, /is_gateway_serving\(port\)/);
});

test('BUG-06 stalled boot exposes the complete self-rescue center', () => {
  const boot = source('src/components/BootTimelineOverlay.tsx');
  const panel = source('src/components/GatewaySelfRescuePanel.tsx');
  assert.match(boot, /recovery\?\.showRestart[\s\S]*<GatewaySelfRescuePanel/);
  assert.match(boot, /onReconnect=\{recovery\.onReconnect\}/);
  assert.match(boot, /onOpenLogs=\{recovery\.onOpenLogs\}/);
  assert.match(boot, /logs=\{recovery\.logs\.slice\(-40\)\.join/);
  assert.match(panel, /openclaw_doctor_repair/);
  assert.match(panel, /<GatewayRescueChat/);
});

test('BUG-07 WebSocket retry has one owner, deadline, and real UI attempt events', () => {
  const connection = source('src/services/gateway/Connection.ts');
  const app = source('src/App.tsx');
  assert.match(connection, /connect\(url: string, token: string, resetReconnectAttempts = true\)/);
  assert.match(connection, /connect\(this\.url, this\.token, false\)/);
  assert.match(connection, /new ConnectionRetryPolicy\(3\)/);
  assert.match(connection, /CONNECTION_ATTEMPT_TIMEOUT_MS = 8_000/);
  assert.match(connection, /emitRetryState\('exhausted'/);
  assert.doesNotMatch(app, /scheduleReconnectRetries|bootRecoveryTimersRef/);
  assert.match(app, /onRetryState:[\s\S]*retry\.phase === 'exhausted'[\s\S]*setBootRecoveryReady\(true\)/);
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
