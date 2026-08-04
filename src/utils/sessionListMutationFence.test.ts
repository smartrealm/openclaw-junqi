import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionListMutationFence } from './sessionListMutationFence';

test('session list snapshots are rejected after a confirmed create mutation', () => {
  const fence = createSessionListMutationFence();
  const beforeOrDuringCreate = fence.capture();

  fence.invalidate();
  assert.equal(fence.isCurrent(beforeOrDuringCreate), false);

  const afterConfirmation = fence.capture();
  assert.equal(fence.isCurrent(afterConfirmation), true);
});
