import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveHistoryPageMetadata } from './historyPagination';

test('CHAT-06 accepts only an advancing OpenClaw nextOffset', () => {
  assert.deepEqual(resolveHistoryPageMetadata({ hasMore: true, nextOffset: 500 }, 0), {
    hasMore: true,
    nextOffset: 500,
  });
  assert.deepEqual(resolveHistoryPageMetadata({ hasMore: true, nextOffset: 500 }, 500), {
    hasMore: false,
  });
  assert.deepEqual(resolveHistoryPageMetadata({ hasMore: true }, 500), {
    hasMore: false,
  });
});
