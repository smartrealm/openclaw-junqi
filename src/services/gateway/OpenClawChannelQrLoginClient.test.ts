import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenClawChannelQrLoginClient } from './OpenClawChannelQrLoginClient';

test('二维码登录控制使用管理员连接，状态核验使用普通连接', async () => {
  const ordinaryCalls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const privilegedCalls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawChannelQrLoginClient({
    request: async (method, params) => {
      ordinaryCalls.push({ method, params });
      return { channels: {} };
    },
    requestPrivileged: async (method, params) => {
      privilegedCalls.push({ method, params });
      return { status: 'waiting' };
    },
  });

  await client.start({ accountId: 'work' });
  await client.wait({ accountId: 'work' });
  await client.status({ channel: 'qqbot' });

  assert.deepEqual(privilegedCalls, [
    { method: 'web.login.start', params: { accountId: 'work' } },
    { method: 'web.login.wait', params: { accountId: 'work' } },
  ]);
  assert.deepEqual(ordinaryCalls, [
    { method: 'channels.status', params: { channel: 'qqbot' } },
  ]);
});
