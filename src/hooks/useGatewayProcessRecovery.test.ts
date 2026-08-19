import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isGatewayProcessRecovered,
  shouldNotifyGatewayProcessRecovered,
} from './useGatewayProcessRecovery';

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

test('Gateway 进程持续就绪时只触发一次恢复通知', () => {
  const ready = {
    running: true,
    processAlive: true,
    ready: true,
    retrying: false,
    error: null,
    logs: { stdout: '', stderr: '' },
  };
  const unavailable = { ...ready, ready: false };

  assert.equal(shouldNotifyGatewayProcessRecovered(false, ready), true);
  assert.equal(shouldNotifyGatewayProcessRecovered(true, ready), false);
  assert.equal(shouldNotifyGatewayProcessRecovered(true, unavailable), false);
  assert.equal(shouldNotifyGatewayProcessRecovered(false, ready), true);
});
