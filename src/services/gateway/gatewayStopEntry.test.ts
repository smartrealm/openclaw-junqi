import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const panel = readFileSync('src/components/settings/GatewayLifecyclePanel.tsx', 'utf8');
const commands = readFileSync('src/api/tauri-commands.ts', 'utf8');
const lib = readFileSync('src-tauri/src/lib.rs', 'utf8');
const gateway = readFileSync('src-tauri/src/commands/gateway.rs', 'utf8');

// AUD-03: stop_gateway and stop_docker_gateway were fully implemented in Rust
// and registered, but no surface reached them - the user could not stop the
// Gateway from the app at all.
test('the app exposes a stop entry for the selected runtime', () => {
  assert.match(commands, /export const stopGateway = \(\) => invoke<string>\("stop_gateway"\)/);
  assert.match(panel, /stopGateway\(\)/);
  assert.match(panel, /onClick=\{\(\) => void stopSelectedGateway\(\)\}/);
});

// One runtime-agnostic entry point: stop_gateway resolves the selected runtime
// itself, so the UI must not choose between native and docker commands.
test('the stop entry never picks a runtime-specific command', () => {
  assert.doesNotMatch(panel, /stop_docker_gateway|stopDockerGateway/);
  assert.match(gateway, /pub async fn stop_gateway[\s\S]*OpenClawRuntimeMode::Docker/);
  assert.match(gateway, /stop_docker_gateway_locked\(\)\.await/);
});

test('stopping takes a deliberate second action and reports failure', () => {
  // Destructive to in-flight sessions, so a single stray click must not do it.
  assert.match(panel, /if \(!stopArmed\) \{\s*\n\s*setStopArmed\(true\);\s*\n\s*return;/);
  assert.match(panel, /stopConfirm/);
  // A failed stop leaves the Gateway running; silence would misrepresent that.
  assert.match(panel, /\{stopError && \(/);
  assert.match(panel, /stopFailed/);
});

test('the stop commands stay registered', () => {
  for (const command of ['stop_gateway', 'stop_docker_gateway']) {
    assert.ok(lib.includes(command), `${command} must remain registered`);
  }
});

// AUD-03 second half: three lifecycle commands had no consumer at all.
// Registration is IPC surface exposed to the WebView, so an entry point nobody
// calls is cost without benefit.
test('lifecycle commands with no consumer are no longer registered', () => {
  for (const command of ['restart_local_gateway', 'get_gateway_lifecycle', 'docker_gateway_status']) {
    assert.ok(!lib.includes(`${command},`), `${command} must not be registered`);
  }
});

test('a still-used helper keeps its implementation but loses its command wrapper', () => {
  const docker = readFileSync('src-tauri/src/commands/docker.rs', 'utf8');
  const ensure = readFileSync('src-tauri/src/commands/ensure.rs', 'utf8');
  // docker_gateway_status is live code: ensure_gateway_running depends on it.
  assert.match(ensure, /docker_gateway_status\(Some\(port\)\)/);
  assert.match(docker, /pub\(crate\) async fn docker_gateway_status/);
  assert.doesNotMatch(docker, /#\[tauri::command\]\npub async fn docker_gateway_status/);
});

test('the two pure aliases are gone rather than merely unregistered', () => {
  const gateway = readFileSync('src-tauri/src/commands/gateway.rs', 'utf8');
  const supervisor = readFileSync('src-tauri/src/commands/gateway_supervisor.rs', 'utf8');
  assert.doesNotMatch(gateway, /fn restart_local_gateway/);
  assert.doesNotMatch(supervisor, /fn get_gateway_lifecycle/);
  // Their replacements stay: restart_gateway takes the same optional port, and
  // the runtime snapshot already carries the lifecycle field.
  assert.match(gateway, /pub async fn restart_gateway/);
  assert.match(supervisor, /pub async fn get_gateway_runtime_snapshot/);
});
