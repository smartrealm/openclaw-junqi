import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

// SetupPage is a directory of per-step screens; assert against all of them.
// Plugin recovery now owns its module; read it directly.
function hookFile(name: string): string {
  return readFileSync(new URL(`./useSetupFlow/${name}.ts`, import.meta.url), 'utf8');
}

function sourceDir(path: string): string {
  return readdirSync(new URL(path, import.meta.url))
    .filter((entry) => entry.endsWith('.ts') || entry.endsWith('.tsx'))
    .sort()
    .map((entry) => readFileSync(new URL(`${path}${entry}`, import.meta.url), 'utf8'))
    .join('\n');
}

const setupFlow = sourceDir('./useSetupFlow/');
const setupPage = sourceDir('../pages/SetupPage/');
const commands = source('../api/tauri-commands.ts');
const ensure = source('../../src-tauri/src/commands/ensure.rs');
const gateway = source('../../src-tauri/src/commands/gateway.rs');
const repair = source('../../src-tauri/src/commands/openclaw_repair.rs');
const cli = source('../../src-tauri/src/commands/openclaw_cli.rs');
const maintenance = source('../../src-tauri/src/commands/maintenance.rs');
const runtimePanel = source('../components/settings/ManagedRuntimeSettingsPanel.tsx');

test('BUG-RT-01 restores the persisted Docker target before setup detection', () => {
  const detection = hookFile('useSetupEnvironmentReview');

  assert.match(commands, /export const detectGatewayConfig = \(\) => invoke<GatewayConfigInfo>\("detect_gateway_config"\)/);
  assert.match(detection, /const runtimeTarget = await detectGatewayConfig\(\);/);
  assert.match(detection, /const runtime = runtimeTarget\.runtime_mode;/);
  assert.match(detection, /setInstallMode\(runtime\);/);
  assert.match(detection, /const openclaw = await checkOpenclaw\(\);/);
  assert.match(
    detection,
    /runtime === "native" && \(!openclaw\.installed \|\| openclaw\.relocation_required\)/,
  );
  const refreshRuntime = setupFlow.slice(
    setupFlow.indexOf('const refreshRuntime = useCallback'),
    setupFlow.indexOf('\n  return {', setupFlow.indexOf('const refreshRuntime = useCallback')),
  );
  assert.match(refreshRuntime, /const runtimeTarget = await detectGatewayConfig\(\);/);
  assert.match(refreshRuntime, /const status = selectedRuntime === "native" \? await checkOpenclaw\(\) : null/);
});

test('BUG-RT-02 selected Docker recovery never invokes native repair', () => {
  const recovery = hookFile('usePluginRecovery');
  const dockerRepair = recovery.slice(
    recovery.indexOf('if (installMode === "docker")'),
    recovery.indexOf('const repairingMessage = t("setup.repairingGateway"'),
  );

  assert.match(dockerRepair, /await pullOpenclawImage\(\)/);
  assert.match(dockerRepair, /await startGatewayAction\(\)/);
  assert.doesNotMatch(dockerRepair, /runOpenClawRepair/);
  assert.match(
    ensure,
    /let selected_mode = paths::active_runtime_mode\(\);[\s\S]*matches!\(selected_mode, OpenClawRuntimeMode::Docker\)[\s\S]*return ensure_selected_docker_gateway/,
  );
  assert.match(
    gateway,
    /restart_gateway[\s\S]*OpenClawRuntimeMode::Docker[\s\S]*release_managed_native_gateway_for_docker/,
  );
  const globalDockerRepair = repair.slice(
    repair.indexOf('async fn run_selected_docker_repair'),
    repair.indexOf('pub async fn run_openclaw_repair'),
  );
  assert.match(globalDockerRepair, /pull_openclaw_image/);
  assert.match(globalDockerRepair, /start_docker_gateway_locked/);
  assert.doesNotMatch(globalDockerRepair, /openclaw_command/);
});

test('BUG-RT-03 reinstall requests an actual forced package installation', () => {
  assert.match(setupPage, /onClick=\{flow\.requestReinstall\}/);
  assert.match(setupFlow, /const forceReinstall = reinstallRequestedRef\.current \|\| repairInvalidInstall;/);
  assert.match(setupFlow, /await reinstallOpenclaw\(operationId\)/);
  assert.match(commands, /invoke<string>\("reinstall_openclaw", \{ operationId \}\)/);
});

test('BUG-RT-05 only supported platforms expose automatic Node updates', () => {
  assert.match(runtimePanel, /nodeAutoUpdateSupported/);
  assert.match(runtimePanel, /onAction=\{status\.nodeAutoUpdateSupported \? \(\) => void runUpdate\('node'\) : undefined\}/);
  assert.match(runtimePanel, /gitAutoUpdateSupported/);
  assert.match(runtimePanel, /onAction=\{status\.gitAutoUpdateSupported \? \(\) => void runUpdate\('git'\) : undefined\}/);
  assert.match(runtimePanel, /runtimeUpdateSystem/);
});

test('BUG-RT-06 selected Docker reuses the container CLI for validation and maintenance', () => {
  assert.match(cli, /enum OpenClawCliTarget[\s\S]*Native[\s\S]*Docker/);
  assert.match(cli, /OpenClawRuntimeMode::Docker[\s\S]*docker::resolve_docker_bin/);
  assert.match(cli, /OPENCLAW_CONTAINER_NAME/);
  assert.match(cli, /OPENCLAW_CONTAINER_STATE_DIR/);
  assert.match(cli, /DOCKER_CANDIDATE_CONFIG_SCRIPT[\s\S]*trap cleanup[\s\S]*openclaw \\\"\$@\\\"/);
  assert.match(maintenance, /resolve_active_openclaw_target\(\)/);
  assert.match(maintenance, /target\.command\(args\)/);
});
