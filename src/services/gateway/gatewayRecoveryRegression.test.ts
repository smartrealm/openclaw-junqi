import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

test('BUG-01 ensure flow attempts managed native gateway before Docker fallback', () => {
  const rust = source('src-tauri/src/commands/ensure.rs');
  const nativeStart = rust.indexOf('crate::commands::gateway::start_gateway(');
  const dockerFallback = rust.indexOf('match check_docker().await');
  assert.ok(nativeStart >= 0, 'ensure flow must invoke native start_gateway');
  assert.ok(dockerFallback > nativeStart, 'Docker fallback must run after native startup');
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
