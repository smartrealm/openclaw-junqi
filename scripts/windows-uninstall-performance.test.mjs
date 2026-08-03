import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const uninstall = fs.readFileSync('src-tauri/src/commands/uninstall.rs', 'utf8');
const gatewayService = fs.readFileSync('src-tauri/src/commands/gateway_service.rs', 'utf8');

function rustFunction(source, signature, nextSignature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing Rust function: ${signature}`);
  const end = source.indexOf(nextSignature, start + signature.length);
  assert.notEqual(end, -1, `missing Rust function boundary: ${nextSignature}`);
  return source.slice(start, end);
}

test('BUG-WUF-03 proves Native service absence before runtime discovery', () => {
  const cleanup = rustFunction(
    uninstall,
    'async fn run_async()',
    'fn finish_with_runtime_note',
  );
  const artifactProbe = cleanup.indexOf('inspect_gateway_service_artifacts_without_runtime().await');
  const runtimeDiscovery = cleanup.indexOf('resolve_openclaw_binary_async().await');

  assert.ok(artifactProbe >= 0, 'uninstall cleanup must probe Windows service artifacts');
  assert.ok(runtimeDiscovery > artifactProbe, 'artifact absence must be checked before OpenClaw discovery');
  assert.match(
    cleanup.slice(artifactProbe, runtimeDiscovery),
    /return finish\(errors\)/,
  );
});

test('BUG-WUF-04 selected Native uninstall uses one status and one official uninstall command', () => {
  const cleanup = rustFunction(
    gatewayService,
    'pub(crate) async fn uninstall_selected_gateway_service(',
    'pub(crate) async fn install_and_start_selected_gateway_service(',
  );

  assert.equal((cleanup.match(/inspect_gateway_service_state\(/g) ?? []).length, 1);
  assert.equal((cleanup.match(/run_service_command\(/g) ?? []).length, 1);
  assert.doesNotMatch(cleanup, /stop_installed_selected_gateway_service_verified\(/);
  assert.match(cleanup, /\["gateway", "uninstall", "--json"\]/);
  assert.match(cleanup, /wait_for_port_free\(port, 30_000\)/);
});
