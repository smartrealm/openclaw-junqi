import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runtime = readFileSync(new URL('./browserProviderRuntime.ts', import.meta.url), 'utf8');
const backend = readFileSync(
  new URL('../../../src-tauri/src/commands/browser_provider.rs', import.meta.url),
  'utf8',
);
const registration = readFileSync(new URL('../../../src-tauri/src/lib.rs', import.meta.url), 'utf8');

test('browser provider discovery keeps the renderer, command and Rust registration aligned', () => {
  assert.match(runtime, /invoke<unknown>\('probe_browser_providers'\)/);
  assert.match(runtime, /invoke\('open_ego_lite'\)/);
  assert.match(backend, /pub fn probe_browser_providers\(\)/);
  assert.match(backend, /pub fn open_ego_lite\(\)/);
  assert.match(backend, /detect_path\(EGO_BROWSER_BINARY\)/);
  assert.match(registration, /commands::browser_provider::probe_browser_providers/);
  assert.match(registration, /commands::browser_provider::open_ego_lite/);
  assert.doesNotMatch(backend, /Command::new|std::process::Command|tokio::process/);
});
