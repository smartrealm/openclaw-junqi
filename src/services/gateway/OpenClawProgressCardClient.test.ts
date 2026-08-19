import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayRpcError } from './Connection';
import {
  OpenClawProgressCardClient,
  OpenClawProgressCardUnavailableError,
} from './OpenClawProgressCardClient';
import { OpenClawProgressCardResponseError } from '@/progress-card/domain';

function createClient(response: unknown, current = true) {
  const calls: Array<{ method: string; params: Record<string, unknown>; connectionId: string }> = [];
  const client = new OpenClawProgressCardClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => current,
    requestFenced: async (method, params, connectionId) => {
      calls.push({ method, params, connectionId });
      return response;
    },
  });
  return { client, calls };
}

test('进度卡读取绑定可信连接和智能体作用域会话别名', async () => {
  const response = {
    card: {
      sessionKey: 'agent:legal:global',
      revision: 2,
      updatedAt: 10,
      steps: [{ step: '核对', status: 'in_progress' }],
    },
  };
  const { client, calls } = createClient(response);

  assert.equal((await client.get('agent:legal:global'))?.revision, 2);
  assert.deepEqual(calls, [{
    method: 'progressCard.get',
    params: { sessionKey: 'agent:legal:global' },
    connectionId: 'gateway-a',
  }]);
});

test('进度卡客户端拒绝跨会话响应和连接切换后的迟到结果', async () => {
  await assert.rejects(
    createClient({
      card: { sessionKey: 'agent:other:main', revision: 1, updatedAt: 1 },
    }).client.get('agent:main:main'),
    OpenClawProgressCardResponseError,
  );
  await assert.rejects(
    createClient({ card: null }, false).client.get('agent:main:main'),
    (error: unknown) => {
      assert.ok(error instanceof OpenClawProgressCardUnavailableError);
      assert.equal(error.reason, 'connection_changed');
      return true;
    },
  );
});

test('进度卡客户端按实际请求响应判定方法不可用', async () => {
  const client = new OpenClawProgressCardClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async (method) => {
      throw new GatewayRpcError(`unknown method: ${method}`, 'INVALID_REQUEST');
    },
  });
  await assert.rejects(client.get('agent:main:main'), (error: unknown) => {
    assert.ok(error instanceof OpenClawProgressCardUnavailableError);
    assert.equal(error.reason, 'method_unavailable');
    return true;
  });
});
