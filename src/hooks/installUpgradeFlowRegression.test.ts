import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { progressForPhase, progressForSetupEvent } from './setupProgressModel';

const setupFlow = readFileSync(new URL('./useSetupFlow.ts', import.meta.url), 'utf8');
const setupPage = readFileSync(new URL('../pages/SetupPage.tsx', import.meta.url), 'utf8');
const storagePanel = readFileSync(new URL('../components/setup/StorageSetupGate.tsx', import.meta.url), 'utf8');
const storageCommand = readFileSync(new URL('../../src-tauri/src/commands/storage.rs', import.meta.url), 'utf8');
const setupCommand = readFileSync(new URL('../../src-tauri/src/commands/setup.rs', import.meta.url), 'utf8');
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
  assert.equal(progressForPhase('git', 0), 31);
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
