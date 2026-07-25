import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./GatewayLifecyclePanel.tsx', import.meta.url), 'utf8');

test('Gateway lifecycle settings reuse the official autostart transaction', () => {
  assert.match(source, /gatewayAutostartStatus/);
  assert.match(source, /enableGatewayAutostart\(\)[\s\S]*handoffGatewayToOfficialService\(\)/);
  assert.match(source, /disableGatewayAutostart\(\)[\s\S]*invoke\('restart_local_gateway'\)/);
  assert.match(source, /variant === 'full' \? gatewayAutostartStatus\(\)/);
});

test('Gateway lifecycle settings contain no platform service identity guesses', () => {
  assert.doesNotMatch(source, /launchctl|systemctl|schtasks|\.plist|ai\.openclaw|18789/i);
});
