import assert from 'node:assert/strict';
import test from 'node:test';
import { ProgressCardRefreshGate } from './progressCardRefreshGate';

test('读取期间收到的新进度修订会抑制旧结果并安排再次读取', () => {
  const gate = new ProgressCardRefreshGate();
  assert.equal(gate.request('gateway-a\u0000agent:main:main'), 'start');
  assert.equal(gate.request('gateway-a\u0000agent:main:main'), 'queued');
  assert.equal(gate.shouldPublish('gateway-a\u0000agent:main:main'), false);
  assert.equal(gate.finish('gateway-a\u0000agent:main:main'), true);
  assert.equal(gate.request('gateway-a\u0000agent:main:main'), 'start');
  assert.equal(gate.shouldPublish('gateway-a\u0000agent:main:main'), true);
  assert.equal(gate.finish('gateway-a\u0000agent:main:main'), false);
});
