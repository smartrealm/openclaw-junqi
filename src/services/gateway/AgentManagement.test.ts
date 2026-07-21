import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GatewayAgentDisplayNameUpdateError,
  OpenClawAgentManagement,
} from './AgentManagement';

test('adapts a Chinese display name to the official create/update RPCs', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const manager = new OpenClawAgentManagement({
    async request(method, params) {
      calls.push({ method, params });
      return method === 'agents.create'
        ? { ok: true, agentId: 'research', name: 'research', workspace: '/tmp/research' }
        : { ok: true, agentId: 'research' };
    },
  });

  const result = await manager.create({
    id: 'research',
    name: '研究助手',
    workspace: '/tmp/research',
  });

  assert.equal(result.name, '研究助手');
  assert.deepEqual(calls, [
    { method: 'agents.create', params: { name: 'research', workspace: '/tmp/research' } },
    { method: 'agents.update', params: { agentId: 'research', name: '研究助手' } },
  ]);
});

test('reports a partial creation when the display-name update fails', async () => {
  const manager = new OpenClawAgentManagement({
    async request(method) {
      if (method === 'agents.update') throw new Error('gateway rejected update');
      return { ok: true, agentId: 'research', name: 'research', workspace: '/tmp/research' };
    },
  });

  await assert.rejects(
    manager.create({ id: 'research', name: '研究助手', workspace: '/tmp/research' }),
    (error: unknown) => error instanceof GatewayAgentDisplayNameUpdateError
      && error.agentId === 'research'
      && error.displayName === '研究助手',
  );
});
