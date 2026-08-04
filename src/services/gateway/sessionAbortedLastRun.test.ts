import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGatewaySessionAbortedLastRun } from './sessionAbortedLastRun';

test('只投影 Gateway 显式给出的最近中止运行真值', () => {
  assert.equal(parseGatewaySessionAbortedLastRun(true), true);
  assert.equal(parseGatewaySessionAbortedLastRun(false), null);
  assert.equal(parseGatewaySessionAbortedLastRun(undefined), null);
  assert.equal(parseGatewaySessionAbortedLastRun('true'), null);
  assert.equal(parseGatewaySessionAbortedLastRun(1), null);
});
