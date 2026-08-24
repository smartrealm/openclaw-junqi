import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VoiceWakeGatewayClient,
  VoiceWakeGatewayUnavailableError,
} from './VoiceWakeGatewayClient';
import type { VoiceWakeGatewayEventListener } from './voiceWakeEventBridge';
import type { VoiceWakeRoutingConfig } from '@/types/voiceWake';

function clientWith(
  responses: unknown[],
  options: { connectionId?: string | null; current?: boolean } = {},
) {
  const calls: Array<{ method: string; params: Record<string, unknown>; connectionId: string }> = [];
  const client = new VoiceWakeGatewayClient({
    captureConnectionId: () => options.connectionId === undefined ? 'connection-a' : options.connectionId,
    isConnectionCurrent: () => options.current ?? true,
    requestFenced: async (method, params, connectionId) => {
      calls.push({ method, params, connectionId });
      return responses.shift();
    },
    subscribe: (_listener: VoiceWakeGatewayEventListener) => () => undefined,
  });
  return { client, calls };
}

const routing: VoiceWakeRoutingConfig = {
  version: 1,
  defaultTarget: { mode: 'current' },
  routes: [{ trigger: 'junqi', target: { sessionKey: 'agent:main:main' } }],
  updatedAtMs: 100,
};

test('唤醒词读写始终绑定同一个可信 Gateway 连接', async () => {
  const { client, calls } = clientWith([
    { triggers: ['junqi'] },
    { triggers: ['JARVIS', '你好'] },
  ]);
  assert.deepEqual(await client.getTriggers(), { triggers: ['junqi'] });
  assert.deepEqual(await client.setTriggers(['JARVIS', '你好']), { triggers: ['JARVIS', '你好'] });
  assert.deepEqual(calls, [
    { method: 'voicewake.get', params: {}, connectionId: 'connection-a' },
    {
      method: 'voicewake.set',
      params: { triggers: ['JARVIS', '你好'] },
      connectionId: 'connection-a',
    },
  ]);
});

test('当前设置投影通过官方读取方法取得唤醒路由', async () => {
  const { client, calls } = clientWith([{ config: routing }]);
  assert.deepEqual(await client.getRouting(), routing);
  assert.deepEqual(calls, [
    { method: 'voicewake.routing.get', params: {}, connectionId: 'connection-a' },
  ]);
});

test('智能体唤醒路由通过官方智能体快照派生显式主会话', async () => {
  const { client, calls } = clientWith([
    {
      defaultId: 'main',
      mainKey: 'primary',
      scope: 'global',
      agents: [{ id: 'main' }, { id: 'jarvis' }],
    },
    {
      defaultId: 'main',
      mainKey: 'primary',
      scope: 'per-sender',
      agents: [{ id: 'main' }],
    },
  ]);
  assert.equal(await client.resolveAgentMainSessionKey(' jarvis '), 'agent:jarvis:global');
  assert.equal(await client.resolveAgentMainSessionKey('missing'), null);
  assert.deepEqual(calls, [
    {
      method: 'agents.list',
      params: {},
      connectionId: 'connection-a',
    },
    {
      method: 'agents.list',
      params: {},
      connectionId: 'connection-a',
    },
  ]);
});

test('客户端拒绝畸形响应、缺失连接和请求期间的身份变化', async () => {
  await assert.rejects(
    clientWith([{ triggers: [42] }]).client.getTriggers(),
    (error: unknown) => {
      assert.ok(error instanceof VoiceWakeGatewayUnavailableError);
      assert.equal(error.reason, 'invalid_response');
      return true;
    },
  );
  await assert.rejects(
    clientWith([{ triggers: ['junqi'] }], { connectionId: null }).client.getTriggers(),
    (error: unknown) => {
      assert.ok(error instanceof VoiceWakeGatewayUnavailableError);
      assert.equal(error.reason, 'connection_unavailable');
      return true;
    },
  );
  await assert.rejects(
    clientWith([{ triggers: ['junqi'] }], { current: false }).client.getTriggers(),
    (error: unknown) => {
      assert.ok(error instanceof VoiceWakeGatewayUnavailableError);
      assert.equal(error.reason, 'connection_changed');
      return true;
    },
  );
});
