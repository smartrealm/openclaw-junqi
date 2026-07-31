import assert from 'node:assert/strict';
import test from 'node:test';
import {
  gatewayUptimeMs,
  millisecondsUntilNextGatewayUptimeTick,
} from './useGatewayUptime';

test('Gateway uptime is based on the central connection start and never goes negative', () => {
  assert.equal(gatewayUptimeMs(true, 1_000, 31_000), 30_000);
  assert.equal(gatewayUptimeMs(true, 31_000, 1_000), 0);
  assert.equal(gatewayUptimeMs(false, 1_000, 31_000), 0);
  assert.equal(gatewayUptimeMs(true, null, 31_000), 0);
});

test('Gateway uptime refreshes at its next displayed-minute boundary', () => {
  assert.equal(millisecondsUntilNextGatewayUptimeTick(1_000, 1_000), 60_000);
  assert.equal(millisecondsUntilNextGatewayUptimeTick(1_000, 31_000), 30_000);
  assert.equal(millisecondsUntilNextGatewayUptimeTick(1_000, 61_000), 60_000);
});
