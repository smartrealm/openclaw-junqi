import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dispatchGatewayChatMessage,
  dispatchGatewayChatMessageWithLeafFenceNegotiation,
  type GatewayChatLeafFenceCapabilityState,
} from './index';
import { GatewayRpcError, type GatewayRequestParams } from './Connection';
import type { OpenClawSessionSteerInput } from './OpenClawSessionSteerClient';

test('普通发送不会改写会话推理可见性', async () => {
  const requests: Array<{ method: string; params: GatewayRequestParams }> = [];
  let steerCalls = 0;
  const result = await dispatchGatewayChatMessage(
    {
      isConnected: () => true,
      request: async (method, params) => {
        requests.push({ method, params });
        return { runId: 'run-1' };
      },
    },
    {
      steer: async () => {
        steerCalls += 1;
        throw new Error('普通发送不应调用 sessions.steer');
      },
    },
    {
      message: 'continue the task',
      sessionKey: 'agent:main:desktop',
      clientMessageId: 'message-1',
    },
  );

  assert.deepEqual(result, { runId: 'run-1' });
  assert.equal(steerCalls, 0);
  assert.deepEqual(requests, [{
    method: 'chat.send',
    params: {
      sessionKey: 'agent:main:desktop',
      message: 'continue the task',
      idempotencyKey: 'message-1',
    },
  }]);
});

test('普通发送将已验证的 transcript leaf 原样交给 OpenClaw', async () => {
  const requests: Array<{ method: string; params: GatewayRequestParams }> = [];
  await dispatchGatewayChatMessage(
    {
      isConnected: () => true,
      request: async (method, params) => {
        requests.push({ method, params });
        return { runId: 'run-leaf' };
      },
    },
    { steer: async () => { throw new Error('不应执行 steering'); } },
    {
      message: 'keep this on the displayed branch',
      sessionKey: 'agent:main:desktop',
      clientMessageId: 'message-leaf',
      expectedLeafEntryId: 'leaf-current',
    },
  );

  assert.deepEqual(requests, [{
    method: 'chat.send',
    params: {
      sessionKey: 'agent:main:desktop',
      expectedLeafEntryId: 'leaf-current',
      message: 'keep this on the displayed branch',
      idempotencyKey: 'message-leaf',
    },
  }]);
});

test('稳定 Runtime 明确拒绝 leaf 围栏时只在参数校验后协商一次', async () => {
  const requests: GatewayRequestParams[] = [];
  const capability: GatewayChatLeafFenceCapabilityState = { connectionId: null, support: 'unknown' };
  const transport = {
    isConnected: () => true,
    request: async (_method: string, params: GatewayRequestParams) => {
      requests.push(params);
      if ('expectedLeafEntryId' in params) {
        throw new GatewayRpcError(
          "invalid chat.send params: at root: unexpected property 'expectedLeafEntryId'",
          'INVALID_REQUEST',
        );
      }
      return { runId: 'accepted' };
    },
  };
  const steer = { steer: async () => { throw new Error('不应执行 steering'); } };

  await dispatchGatewayChatMessageWithLeafFenceNegotiation(transport, steer, {
    message: 'first', sessionKey: 'agent:main:new', clientMessageId: 'message-first', expectedLeafEntryId: null,
  }, 'connection-1', capability);
  await dispatchGatewayChatMessageWithLeafFenceNegotiation(transport, steer, {
    message: 'second', sessionKey: 'agent:main:new', clientMessageId: 'message-second', expectedLeafEntryId: 'leaf-1',
  }, 'connection-1', capability);

  assert.equal(capability.support, 'unsupported');
  assert.equal(requests.length, 3);
  assert.equal((requests[0] as Record<string, unknown>).expectedLeafEntryId, null);
  assert.equal('expectedLeafEntryId' in requests[1]!, false);
  assert.equal('expectedLeafEntryId' in requests[2]!, false);
});

test('chat.send 的其他失败不得触发降参重放', async () => {
  let attempts = 0;
  const capability: GatewayChatLeafFenceCapabilityState = { connectionId: null, support: 'unknown' };
  await assert.rejects(
    dispatchGatewayChatMessageWithLeafFenceNegotiation({
      isConnected: () => true,
      request: async () => {
        attempts += 1;
        throw new GatewayRpcError('model unavailable', 'INVALID_REQUEST');
      },
    }, { steer: async () => { throw new Error('不应执行 steering'); } }, {
      message: 'first', sessionKey: 'agent:main:new', clientMessageId: 'message-failed', expectedLeafEntryId: null,
    }, 'connection-1', capability),
    /model unavailable/,
  );
  assert.equal(attempts, 1);
  assert.equal(capability.support, 'unknown');
});

test('转向发送使用 OpenClaw 的 sessions.steer 且不会退回 chat.send', async () => {
  const requests: Array<{ method: string; params: GatewayRequestParams }> = [];
  const steerCalls: OpenClawSessionSteerInput[] = [];
  const expected = {
    response: { runId: 'run-2' },
    acknowledgement: { state: 'active' as const, runId: 'run-2' },
    interruptedActiveRun: true,
  };

  const result = await dispatchGatewayChatMessage(
    {
      isConnected: () => true,
      request: async (method, params) => {
        requests.push({ method, params });
        return { runId: 'unexpected' };
      },
    },
    {
      steer: async (input) => {
        steerCalls.push(input);
        return expected;
      },
    },
    {
      message: 'interrupt and continue',
      attachments: [{ type: 'file', content: 'payload' }],
      sessionKey: 'agent:main:desktop',
      clientMessageId: 'message-2',
      delivery: 'steer',
    },
  );

  assert.equal(result, expected);
  assert.deepEqual(requests, []);
  assert.deepEqual(steerCalls, [{
    key: 'agent:main:desktop',
    message: 'interrupt and continue',
    idempotencyKey: 'message-2',
    attachments: [{ type: 'file', content: 'payload' }],
  }]);
});
