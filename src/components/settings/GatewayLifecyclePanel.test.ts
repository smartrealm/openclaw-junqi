import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./GatewayLifecyclePanel.tsx', import.meta.url), 'utf8');

test('Gateway lifecycle settings reuse the official autostart transaction', () => {
  assert.match(source, /gatewayAutostartStatus/);
  assert.match(source, /enableGatewayAutostart\(\)[\s\S]*handoffGatewayToOfficialService\(\)/);
  assert.match(source, /disableGatewayAutostart\(\)[\s\S]*gatewayLifecycle\.restart\('gateway-autostart-disabled'\)/);
  assert.match(source, /variant === 'full' \? gatewayAutostartStatus\(\)/);
});

test('Gateway lifecycle settings contain no platform service identity guesses', () => {
  assert.doesNotMatch(source, /launchctl|systemctl|schtasks|\.plist|ai\.openclaw|18789/i);
});

test('Gateway lifecycle settings use the shared typed runtime snapshot boundary', () => {
  assert.match(source, /getGatewayRuntimeSnapshot\(\)/);
  assert.doesNotMatch(source, /invoke<GatewayRuntimeSnapshot>\('get_gateway_runtime_snapshot'\)/);
});

test('Gateway lifecycle settings render the shared backend-driven autostart presentation', () => {
  assert.match(source, /presentGatewayAutostart\(autostart, t\)/);
  assert.match(source, /autostartPresentation\?\.description/);
});
