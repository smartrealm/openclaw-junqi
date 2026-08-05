import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifySessionListLoadFailure,
  createSessionListMutationFence,
} from './sessionListMutationFence';

test('session list snapshots are rejected after a confirmed create mutation', () => {
  const fence = createSessionListMutationFence();
  const beforeOrDuringCreate = fence.capture();

  fence.invalidate();
  assert.equal(fence.isCurrent(beforeOrDuringCreate), false);

  const afterConfirmation = fence.capture();
  assert.equal(fence.isCurrent(afterConfirmation), true);
});

test('only a current list request and current mutation fence report a load failure', () => {
  assert.equal(classifySessionListLoadFailure(true, true), 'failed');
  assert.equal(classifySessionListLoadFailure(false, true), 'superseded');
  assert.equal(classifySessionListLoadFailure(true, false), 'superseded');
  assert.equal(classifySessionListLoadFailure(false, false), 'superseded');
});
