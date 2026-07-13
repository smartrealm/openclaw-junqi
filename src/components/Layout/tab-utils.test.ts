import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveTab } from './tab-utils';

test('AI workspace belongs to the tools sidebar tab', () => {
  assert.equal(resolveTab('/ai-workspace'), 'tools');
});

test('OpenClaw command reference has its own sidebar tab', () => {
  assert.equal(resolveTab('/openclaw-commands'), 'commands');
  assert.equal(resolveTab('/openclaw-commands?category=gateway'), 'commands');
});
