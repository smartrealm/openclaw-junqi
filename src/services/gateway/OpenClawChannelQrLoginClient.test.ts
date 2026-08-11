import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenClawChannelQrLoginClient } from './OpenClawChannelQrLoginClient';

test('二维码登录控制只使用管理员连接调用官方开始与等待方法', async () => {
  const privilegedCalls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawChannelQrLoginClient({
    requestPrivileged: async (method, params) => {
      privilegedCalls.push({ method, params });
      return { status: 'waiting' };
    },
  });

  await client.start({ accountId: 'work' });
  await client.wait({ accountId: 'work' });

  assert.deepEqual(privilegedCalls, [
    { method: 'web.login.start', params: { accountId: 'work' } },
    { method: 'web.login.wait', params: { accountId: 'work' } },
  ]);
});
