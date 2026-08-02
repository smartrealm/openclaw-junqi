import assert from 'node:assert/strict';
import test from 'node:test';
import { isGatewayProcessRecovered } from './useGatewayProcessRecovery';

test('Gateway recovery requires an authenticated ready status, not only a live process', () => {
  assert.equal(isGatewayProcessRecovered({
    running: true,
    processAlive: true,
    ready: false,
    retrying: false,
    error: null,
    logs: { stdout: '', stderr: '' },
  }), false);
  assert.equal(isGatewayProcessRecovered({
    running: true,
    processAlive: true,
    ready: true,
    retrying: false,
    error: null,
    logs: { stdout: '', stderr: '' },
  }), true);
  assert.equal(isGatewayProcessRecovered({
    running: true,
    processAlive: true,
    ready: true,
    retrying: false,
    error: 'authenticated probe failed',
    logs: { stdout: '', stderr: '' },
  }), false);
});
