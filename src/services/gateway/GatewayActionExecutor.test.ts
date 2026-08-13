import assert from 'node:assert/strict';
import test from 'node:test';
import { executeConnect } from './GatewayActionExecutor';

test('连接动作始终重新解析当前所选 Runtime 的连接目标', async () => {
  const calls: string[] = [];

  await executeConnect(
    (httpUrl) => calls.push(`http:${httpUrl}`),
    () => true,
    {
      targetRequest: { targetScope: 'selected-runtime' },
      executor: {
        resolveTarget: async (request) => {
          calls.push(`scope:${String(request.targetScope)}`);
          return {
            httpUrl: 'http://127.0.0.1:18888',
            wsUrl: 'ws://127.0.0.1:18888',
            token: 'test-token',
            deviceToken: 'test-device-token',
          };
        },
        persistHttpUrl: (httpUrl) => calls.push(`persist:${httpUrl}`),
        connect: (wsUrl) => calls.push(`connect:${wsUrl}`),
      },
    },
  );

  assert.deepEqual(calls, [
    'scope:selected-runtime',
    'http:http://127.0.0.1:18888',
    'persist:http://127.0.0.1:18888',
    'connect:ws://127.0.0.1:18888',
  ]);
});
