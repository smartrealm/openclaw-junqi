import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAgentCreationOverrides,
  persistAgentCreationOverrides,
} from './agentCreationConfig';

test('creation overrides preserve unrelated agent fields and write explicit empty skills', () => {
  const next = applyAgentCreationOverrides({
    agents: {
      defaults: { model: 'openai/default' },
      list: [
        { id: 'research', workspace: '/tmp/research', tools: { profile: 'coding' } },
        { id: 'other', name: 'Other' },
      ],
    },
  }, 'RESEARCH', {
    skills: [],
    model: { primary: 'openai/gpt-5', fallbacks: ['openai/gpt-5-mini', 'openai/gpt-5'] },
  });

  assert.deepEqual(next.agents.list[0], {
    id: 'research',
    workspace: '/tmp/research',
    tools: { profile: 'coding' },
    skills: [],
    model: { primary: 'openai/gpt-5', fallbacks: ['openai/gpt-5-mini'] },
  });
  assert.deepEqual(next.agents.list[1], { id: 'other', name: 'Other' });
});

test('creation overrides use a base-hash guarded Gateway patch', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const gateway = {
    async call(method: string, params: Record<string, unknown>) {
      calls.push({ method, params });
      return {
        exists: true,
        valid: true,
        hash: 'fresh',
        config: { agents: { list: [{ id: 'worker' }] } },
      };
    },
    async callPrivileged(method: string, params: Record<string, unknown>) {
      calls.push({ method, params });
      return { ok: true };
    },
  };

  await persistAgentCreationOverrides(gateway, 'worker', { skills: ['review-contract'] });

  assert.equal(calls[0].method, 'config.get');
  assert.equal(calls[1].method, 'config.patch');
  assert.equal(calls[1].params.baseHash, 'fresh');
  assert.deepEqual(JSON.parse(String(calls[1].params.raw)), {
    agents: { list: [{ id: 'worker', skills: ['review-contract'] }] },
  });
});

test('creation overrides reject an invalid snapshot before issuing a privileged patch', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const gateway = {
    async call(method: string, params: Record<string, unknown>) {
      calls.push({ method, params });
      return { exists: true, valid: false, config: {} };
    },
    async callPrivileged(method: string, params: Record<string, unknown>) {
      calls.push({ method, params });
      return { ok: true };
    },
  };

  await assert.rejects(
    persistAgentCreationOverrides(gateway, 'worker', { skills: ['review-contract'] }),
    /OpenClaw config snapshot is unavailable/,
  );
  assert.deepEqual(calls.map((call) => call.method), ['config.get']);
});
