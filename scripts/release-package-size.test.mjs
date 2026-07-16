import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cargo = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
const release = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const tauri = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));

test('production Rust profile is optimized for package size', () => {
  assert.doesNotMatch(cargo, /features\s*=\s*\[[^\]]*"devtools"/s);
  assert.match(cargo, /\[profile\.release\]/);
  assert.match(cargo, /codegen-units\s*=\s*1/);
  assert.match(cargo, /lto\s*=\s*true/);
  assert.match(cargo, /opt-level\s*=\s*"s"/);
  assert.match(cargo, /panic\s*=\s*"abort"/);
  assert.match(cargo, /strip\s*=\s*"symbols"/);
});

test('macOS release packages are split by architecture', () => {
  assert.match(release, /target: 'aarch64-apple-darwin'/);
  assert.match(release, /target: 'x86_64-apple-darwin'/);
  assert.doesNotMatch(release, /target: 'universal-apple-darwin'/);
});

test('Windows packages embed only the small WebView2 bootstrapper', () => {
  assert.equal(tauri.bundle.windows.webviewInstallMode.type, 'embedBootstrapper');
  assert.equal(tauri.bundle.windows.webviewInstallMode.silent, true);
  assert.doesNotMatch(release, /package_variant: offline/);
  assert.doesNotMatch(release, /Mark offline Windows installers/);
});
