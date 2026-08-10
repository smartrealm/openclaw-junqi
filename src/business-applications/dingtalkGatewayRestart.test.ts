import assert from 'node:assert/strict';
import test from 'node:test';
import { restartDingTalkGateway } from './dingtalkGatewayRestart';

test('通过统一生命周期重启并等待新的已验证连接', async () => {
  const sources: string[] = [];
  let connected = false;
  await restartDingTalkGateway({
    lifecycle: {
      async restart(source) {
        sources.push(source);
        connected = true;
        return { success: true, action: 'restart', source };
      },
    },
    captureConnectionId: () => 'old-connection',
    read: () => connected
      ? {
          connected: true,
          connectionId: 'new-connection',
          identityConnectionId: 'new-connection',
          identityVerified: true,
        }
      : {
          connected: true,
          connectionId: 'old-connection',
          identityConnectionId: 'old-connection',
          identityVerified: true,
        },
  });

  assert.deepEqual(sources, ['business-applications-dingtalk']);
});

test('统一生命周期拒绝重启时不等待连接', async () => {
  let reads = 0;
  await assert.rejects(
    restartDingTalkGateway({
      lifecycle: {
        async restart(source) {
          return { success: false, error: '重启被拒绝', action: 'restart', source };
        },
      },
      captureConnectionId: () => 'old-connection',
      read: () => {
        reads += 1;
        return {
          connected: false,
          connectionId: null,
          identityConnectionId: null,
          identityVerified: false,
        };
      },
    }),
    /重启被拒绝/,
  );
  assert.equal(reads, 0);
});
