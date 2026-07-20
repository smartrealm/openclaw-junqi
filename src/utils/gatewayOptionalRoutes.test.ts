import test from 'node:test';
import assert from 'node:assert/strict';
import { isGatewayOptionalPath, routePathFromLocation } from './gatewayOptionalRoutes';

test('gateway-optional routes are available before Gateway recovery completes', () => {
  for (const path of ['/settings', '/terminal', '/config', '/logs', '/openclaw-commands', '/activity']) {
    assert.equal(isGatewayOptionalPath(path), true, path);
  }
  assert.equal(isGatewayOptionalPath('/channels'), false);
  assert.equal(isGatewayOptionalPath('/cron'), false);
});

test('hash-router locations resolve to their application path', () => {
  assert.equal(routePathFromLocation({ pathname: '/', hash: '#/openclaw-commands?category=gateway' } as Location), '/openclaw-commands');
  assert.equal(routePathFromLocation({ pathname: '/settings', hash: '' } as Location), '/settings');
});
