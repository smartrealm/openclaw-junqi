import test from 'node:test';
import assert from 'node:assert/strict';
import { NotificationOperationGate } from './notificationOperationGate';

test('a mutation invalidates an older notification refresh', () => {
  const gate = new NotificationOperationGate();
  const token = gate.beginRefresh();
  assert.ok(token);

  gate.beginMutation();

  assert.equal(gate.canCommitRefresh(token), false);
  assert.equal(gate.beginRefresh(), null);
  assert.equal(gate.finishMutation(true), false);
});

test('concurrent mutations request one repair refresh after a failure', () => {
  const gate = new NotificationOperationGate();
  gate.beginMutation();
  gate.beginMutation();

  assert.equal(gate.finishMutation(false), false);
  assert.equal(gate.finishMutation(true), true);
  assert.ok(gate.beginRefresh());
});

test('successful mutations do not trigger an unnecessary repair refresh', () => {
  const gate = new NotificationOperationGate();
  gate.beginMutation();
  assert.equal(gate.finishMutation(true), false);
});
