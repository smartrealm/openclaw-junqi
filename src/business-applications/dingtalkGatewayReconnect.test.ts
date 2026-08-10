import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForDingTalkGatewayReconnect } from './dingtalkGatewayReconnect';

test('waits for a new verified connection before refreshing DingTalk state', async () => {
  const snapshots = [
    { connected: true, connectionId: 'old', identityConnectionId: 'old', identityVerified: true },
    { connected: false, connectionId: null, identityConnectionId: null, identityVerified: false },
    { connected: true, connectionId: 'new', identityConnectionId: 'old', identityVerified: true },
    { connected: true, connectionId: 'new', identityConnectionId: 'new', identityVerified: true },
  ];
  let index = 0;
  let elapsed = 0;

  await waitForDingTalkGatewayReconnect({
    previousConnectionId: 'old',
    read: () => snapshots[Math.min(index, snapshots.length - 1)],
    now: () => elapsed,
    wait: async (delayMs) => {
      elapsed += delayMs;
      index += 1;
    },
  });

  assert.equal(index, 3);
});

test('fails instead of refreshing against the stale connection', async () => {
  let elapsed = 0;
  await assert.rejects(
    waitForDingTalkGatewayReconnect({
      previousConnectionId: 'old',
      timeoutMs: 1_000,
      pollIntervalMs: 500,
      read: () => ({
        connected: true,
        connectionId: 'old',
        identityConnectionId: 'old',
        identityVerified: true,
      }),
      now: () => elapsed,
      wait: async (delayMs) => {
        elapsed += delayMs;
      },
    }),
    /未在 60 秒内恢复连接/,
  );
});
