import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAgentSkillFilter } from './agentSkillConfig';

test('applies a normalized, deduplicated skill allowlist to only the requested agent', () => {
  const config = {
    agents: {
      defaults: { workspace: '/default' },
      list: [
        { id: 'alpha', name: 'Alpha' },
        { id: 'beta', skills: ['old'] },
      ],
    },
    channels: { dingtalk: { enabled: true } },
  };

  const next = applyAgentSkillFilter(config, 'ALPHA', [' review-contract ', 'review-contract', 'legal-agent']);

  assert.deepEqual(next.agents.list[0].skills, ['review-contract', 'legal-agent']);
  assert.deepEqual(next.agents.list[1], config.agents.list[1]);
  assert.deepEqual(next.channels, config.channels);
  assert.equal(config.agents.list[0].skills, undefined);
});

test('refuses to write skills when the created agent is absent from the latest config', () => {
  assert.throws(
    () => applyAgentSkillFilter({ agents: { list: [] } }, 'missing', ['skill']),
    /missing from config/,
  );
});
