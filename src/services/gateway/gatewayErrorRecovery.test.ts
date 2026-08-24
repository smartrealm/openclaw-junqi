import assert from 'node:assert/strict';
import test from 'node:test';
import type { GatewayLifecycleResult } from './GatewayLifecycleCoordinator';
import { runGatewayErrorScreenRecovery } from './gatewayErrorRecovery';

function deferredResult() {
  let resolve!: (result: GatewayLifecycleResult) => void;
  const promise = new Promise<GatewayLifecycleResult>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

test('Gateway 错误页在重连终态到达前不得退出', async () => {
  const reconnect = deferredResult();
  const commits: string[] = [];

  const recovery = runGatewayErrorScreenRecovery({
    reconnect: () => reconnect.promise,
    onRecovered: () => commits.push('recovered'),
    onFailed: (error) => commits.push(`failed:${error}`),
  });

  assert.deepEqual(commits, []);
  reconnect.resolve({ success: true, action: 'reconnect', source: 'test' });
  const result = await recovery;

  assert.equal(result.success, true);
  assert.deepEqual(commits, ['recovered']);
});

test('Gateway 错误页重连失败时保留失败语义且不得提交恢复', async () => {
  const commits: string[] = [];

  const result = await runGatewayErrorScreenRecovery({
    reconnect: async () => ({
      success: false,
      error: 'Runtime identity attestation failed',
      action: 'reconnect',
      source: 'test',
    }),
    onRecovered: () => commits.push('recovered'),
    onFailed: (error) => commits.push(`failed:${error}`),
  });

  assert.equal(result.success, false);
  assert.deepEqual(commits, ['failed:Runtime identity attestation failed']);
});

test('Gateway 错误页把意外重连异常收敛为可见失败', async () => {
  const commits: string[] = [];

  const result = await runGatewayErrorScreenRecovery({
    reconnect: async () => {
      throw new Error('WebSocket transport closed');
    },
    onRecovered: () => commits.push('recovered'),
    onFailed: (error) => commits.push(`failed:${error}`),
  });

  assert.deepEqual(result, { success: false, error: 'WebSocket transport closed' });
  assert.deepEqual(commits, ['failed:WebSocket transport closed']);
});
