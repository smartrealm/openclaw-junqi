import assert from 'node:assert/strict';
import test from 'node:test';

import { toSafeIsoTimestamp } from './isoTimestamp';

test('does not format a schema-valid timestamp outside the JavaScript Date range', () => {
  assert.equal(toSafeIsoTimestamp(Number.MAX_SAFE_INTEGER), null);
});

test('formats an in-range checkpoint timestamp as ISO time', () => {
  assert.equal(toSafeIsoTimestamp(1_700_000_000_000), '2023-11-14T22:13:20.000Z');
});
