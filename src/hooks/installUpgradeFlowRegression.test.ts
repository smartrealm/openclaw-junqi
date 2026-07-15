import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { progressForPhase, progressForSetupEvent } from './setupProgressModel';

const setupFlow = readFileSync(new URL('./useSetupFlow.ts', import.meta.url), 'utf8');
const setupPage = readFileSync(new URL('../pages/SetupPage.tsx', import.meta.url), 'utf8');
const storagePanel = readFileSync(new URL('../components/setup/StorageSetupGate.tsx', import.meta.url), 'utf8');
const storageCommand = readFileSync(new URL('../../src-tauri/src/commands/storage.rs', import.meta.url), 'utf8');
const updater = readFileSync(new URL('../../src-tauri/src/commands/openclaw_update.rs', import.meta.url), 'utf8');

test('BUG-IU-01 fresh storage requires onboarding before Gateway start', () => {
  const completion = setupFlow.slice(
    setupFlow.indexOf('const completeStorageSetup'),
    setupFlow.indexOf('const repairAndRetry'),
  );
  assert.match(completion, /if \(createdFresh\) setNeedsOnboarding\(true\)/);
  assert.match(completion, /createdFresh && \(postStorageStep === "ready" \|\| postStorageStep === "configure-openclaw"\)/);
  assert.match(setupPage, /onReady=\{flow\.completeStorageSetup\}/);
  assert.doesNotMatch(setupPage, /const finishStorage/);
});

test('BUG-IU-02 OpenClaw updater has one Gateway lifecycle owner', () => {
  assert.match(updater, /&\["update", "--yes", "--no-restart", "--json"\]/);
  assert.match(updater, /stop_managed_gateway\(&state\)[\s\S]*restore_managed_gateway/);
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
