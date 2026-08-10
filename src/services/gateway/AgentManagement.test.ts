import test from 'node:test';
import assert from 'node:assert/strict';
import {
  confirmOpenClawAgentDelete,
  confirmOpenClawAgentUpdate,
  GatewayAgentDisplayNameUpdateError,
  OpenClawAgentManagement,
} from './AgentManagement';

test('agent mutation acknowledgement parsers require the official identity', () => {
  assert.deepEqual(confirmOpenClawAgentUpdate({ ok: true, agentId: 'Research' }, 'research'), {
    ok: true,
    agentId: 'Research',
  });
  assert.deepEqual(confirmOpenClawAgentDelete({ ok: true, agentId: 'research', removedBindings: 0 }, 'research'), {
    ok: true,
    agentId: 'research',
  });
  assert.throws(
    () => confirmOpenClawAgentUpdate({ ok: true, agentId: 'other' }, 'research'),
    /different agent|did not confirm/,
  );
  assert.throws(
    () => confirmOpenClawAgentDelete({ ok: true, agentId: 'research' }, 'research'),
    /removedBindings/,
  );
});

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

test('leaves an ordinary Agent workspace undefined for Gateway resolution', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const manager = new OpenClawAgentManagement({
    async request(method, params) {
      calls.push({ method, params });
      return { ok: true, agentId: 'research', name: 'research', workspace: '/tmp/research' };
    },
  });

  await manager.create({ id: 'research' });

  assert.deepEqual(calls, [
    { method: 'agents.create', params: { name: 'research' } },
  ]);
});

test('does not project an agent when the official create acknowledgement is incomplete', async () => {
  const manager = new OpenClawAgentManagement({
    async request() {
      return { ok: false, agentId: 'research' };
    },
  });

  await assert.rejects(
    manager.create({ id: 'research' }),
    /agents\.create did not confirm success/,
  );
});

test('does not report a display-name update when the official update acknowledgement targets another agent', async () => {
  const manager = new OpenClawAgentManagement({
    async request(method) {
      return method === 'agents.create'
        ? { ok: true, agentId: 'research', name: 'research', workspace: '/tmp/research' }
        : { ok: true, agentId: 'other' };
    },
  });

  await assert.rejects(
    manager.create({ id: 'research', name: '研究助手' }),
    GatewayAgentDisplayNameUpdateError,
  );
});
