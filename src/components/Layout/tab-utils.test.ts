import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveTab } from './tab-utils';

test('OpenClaw command reference has its own sidebar tab', () => {
  assert.equal(resolveTab('/openclaw-commands'), 'commands');
  assert.equal(resolveTab('/openclaw-commands?category=gateway'), 'commands');
});

test('channel maintenance stays under the agent configuration tab', () => {
  assert.equal(resolveTab('/channels'), 'agents');
});

test('OpenClaw 工具配置属于工具标签而不是智能体标签', () => {
  assert.equal(resolveTab('/config?tab=tools'), 'tools');
  assert.equal(resolveTab('/config'), 'agents');
  assert.equal(resolveTab('/config?tab=agents'), 'agents');
});
