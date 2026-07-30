import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_GATEWAY_HOST,
  DEFAULT_GATEWAY_PORT,
  DEFAULT_MEMORY_API_URL,
  defaultGatewayHttpUrl,
  defaultGatewayWsUrl,
} from './runtimeDefaults';

test('shared runtime defaults expose a valid Gateway endpoint', () => {
  assert.ok(DEFAULT_GATEWAY_HOST.trim().length > 0);
  assert.ok(Number.isInteger(DEFAULT_GATEWAY_PORT));
  assert.ok(DEFAULT_GATEWAY_PORT > 0 && DEFAULT_GATEWAY_PORT <= 65_535);
  assert.equal(defaultGatewayWsUrl(), `ws://${DEFAULT_GATEWAY_HOST}:${DEFAULT_GATEWAY_PORT}`);
  assert.equal(defaultGatewayHttpUrl(), `http://${DEFAULT_GATEWAY_HOST}:${DEFAULT_GATEWAY_PORT}`);
});

test('Gateway URL helpers preserve an explicitly resolved port', () => {
  const resolvedPort = DEFAULT_GATEWAY_PORT === 65_535 ? 1 : DEFAULT_GATEWAY_PORT + 1;
  assert.equal(defaultGatewayWsUrl(resolvedPort), `ws://${DEFAULT_GATEWAY_HOST}:${resolvedPort}`);
  assert.equal(defaultGatewayHttpUrl(resolvedPort), `http://${DEFAULT_GATEWAY_HOST}:${resolvedPort}`);
});

test('Gateway URL helpers reject invalid resolved ports', () => {
  assert.throws(() => defaultGatewayWsUrl(0), /gateway\.port/);
  assert.throws(() => defaultGatewayHttpUrl(65_536), /gateway\.port/);
  assert.throws(() => defaultGatewayWsUrl(Number.NaN), /gateway\.port/);
});

test('production consumers use shared runtime endpoint defaults', () => {
  assert.equal(DEFAULT_MEMORY_API_URL, 'http://localhost:3040');

  const settingsPage = readFileSync(new URL('../pages/SettingsPage.tsx', import.meta.url), 'utf8');
  assert.match(settingsPage, /placeholder=\{defaultGatewayWsUrl\(\)\}/);
  assert.match(settingsPage, /url: defaultGatewayWsUrl\(\)/);
  assert.doesNotMatch(settingsPage, /127\.0\.0\.1:18789/);

  for (const relativePath of [
    '../stores/settingsStore.ts',
    '../services/gateway/credentialProvider.ts',
    '../pages/MemoryExplorer.tsx',
  ]) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    assert.match(source, /runtimeDefaults/);
    assert.doesNotMatch(source, /ws:\/\/127\.0\.0\.1:18789/);
    assert.doesNotMatch(source, /http:\/\/localhost:3040/);
  }
});

test('BUG-FCA-11 locale files never become a second runtime endpoint source', () => {
  // Translations are display copy. Once a locale spells a runtime endpoint,
  // changing the default requires editing runtime-defaults.json *and* every
  // locale — exactly the drift `runtimeDefaults` exists to prevent.
  for (const locale of ['zh', 'en', 'zh-TW']) {
    const source = readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), 'utf8');
    assert.doesNotMatch(
      source,
      /http:\/\/localhost:3040/,
      `${locale}.json must not restate the Memory API default endpoint`,
    );
    assert.doesNotMatch(
      source,
      /127\.0\.0\.1:18789/,
      `${locale}.json must not restate the Gateway default endpoint`,
    );
  }
});
