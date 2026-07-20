import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_GATEWAY_HOST,
  DEFAULT_GATEWAY_PORT,
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

test('settings render the shared Gateway URL instead of duplicating its port', () => {
  const settingsPage = readFileSync(new URL('../pages/SettingsPage.tsx', import.meta.url), 'utf8');
  assert.match(settingsPage, /placeholder=\{defaultGatewayWsUrl\(\)\}/);
  assert.match(settingsPage, /url: defaultGatewayWsUrl\(\)/);
  assert.doesNotMatch(settingsPage, /127\.0\.0\.1:18789/);
});
