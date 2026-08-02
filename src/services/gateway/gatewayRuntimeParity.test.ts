import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const gateway = readFileSync('src-tauri/src/commands/gateway.rs', 'utf8');
const ensure = readFileSync('src-tauri/src/commands/ensure.rs', 'utf8');

function rustFnBody(fileSource: string, name: string): string {
  const start = [`pub async fn ${name}`, `pub(crate) async fn ${name}`, `\nasync fn ${name}`]
    .map((signature) => fileSource.indexOf(signature))
    .find((index) => index >= 0) ?? -1;
  if (start < 0) throw new Error(`Rust function \`${name}\` not found`);
  const open = fileSource.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < fileSource.length; index += 1) {
    if (fileSource[index] === '{') depth += 1;
    else if (fileSource[index] === '}') {
      depth -= 1;
      if (depth === 0) return fileSource.slice(start, index + 1);
    }
  }
  throw new Error(`Rust function \`${name}\` body is unbalanced`);
}

// AUD-05 fixes the boundary rather than changing behaviour. Docker Desktop cold
// start is not verified here; these assertions only stop the current semantics
// from drifting unnoticed.
test('every lifecycle mutation resolves the selected runtime before acting', () => {
  for (const fn of ['restart_gateway', 'stop_gateway', 'ensure_gateway_running']) {
    const body = fn === 'ensure_gateway_running' ? rustFnBody(ensure, fn) : rustFnBody(gateway, fn);
    assert.match(body, /active_runtime_mode\(\)/, `${fn} must read the selected runtime`);
  }
});

// The audit's first pass counted function names per file and concluded Docker
// had no restart. It does - the dispatch lives in gateway.rs, not docker.rs.
test('restart and stop both carry a Docker branch', () => {
  const restart = rustFnBody(gateway, 'restart_gateway');
  assert.match(restart, /OpenClawRuntimeMode::Docker/);
  assert.match(restart, /GatewayRuntimeMode::Docker/);

  const stop = rustFnBody(gateway, 'stop_gateway');
  assert.match(stop, /OpenClawRuntimeMode::Docker/);
  assert.match(stop, /stop_docker_gateway_locked\(\)\.await/);
});

// A failure must name the runtime it happened on; a shared generic message is
// how a Docker fault gets diagnosed as a Native one.
test('the Docker branch reports its own runtime in state transitions', () => {
  const restart = rustFnBody(gateway, 'restart_gateway');
  assert.match(restart, /Docker container/i);
  assert.doesNotMatch(restart, /"restart_gateway: recreating selected Native/);
});

// Native-only operations stay Native-only on purpose; asserting it keeps a
// future change from quietly extending them to a runtime they cannot serve.
test('service handoff remains a Native-only concept', () => {
  const handoff = rustFnBody(gateway, 'handoff_gateway_to_official_service');
  assert.match(handoff, /Native|native/);
});
