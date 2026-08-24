import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GatewayScopeUpgradeCancelledError,
  GatewayScopeUpgradeCoordinator,
} from './GatewayScopeUpgrade';

test('权限升级严格校验请求并在设备令牌保存后重连', async () => {
  const calls: string[] = [];
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  const coordinator = new GatewayScopeUpgradeCoordinator({
    captureConnection: () => ({
      connectionId: 'daily-1',
      scopes: ['operator.read', 'operator.write', 'operator.talk'],
    }),
    requestFenced: async (method, params, connectionId) => {
      assert.equal(connectionId, 'daily-1');
      requests.push({ method, params });
      if (method === 'device.scopes.requestUpgrade') return { requestId: 'upgrade-1' };
      return {
        status: 'approved',
        requestId: 'upgrade-1',
        deviceToken: 'rotated-device-token',
        scopes: ['operator.admin', 'operator.read', 'operator.write', 'operator.talk'],
      };
    },
    applyRotatedDeviceCredential: async (token, connectionId) => {
      assert.equal(token, 'rotated-device-token');
      assert.equal(connectionId, 'daily-1');
      calls.push('保存并重连');
    },
  });

  const operation = await coordinator.begin(['operator.admin']);
  assert.equal(operation.requestId, 'upgrade-1');
  assert.deepEqual(await operation.completion, {
    status: 'approved',
    requestId: 'upgrade-1',
    scopes: ['operator.admin', 'operator.read', 'operator.write', 'operator.talk'],
  });
  assert.deepEqual(requests, [
    {
      method: 'device.scopes.requestUpgrade',
      params: {
        scopes: ['operator.admin', 'operator.read', 'operator.write', 'operator.talk'],
      },
    },
    {
      method: 'device.scopes.waitUpgrade',
      params: { requestId: 'upgrade-1' },
    },
  ]);
  assert.deepEqual(calls, ['保存并重连']);
});

test('权限升级拒绝不保存凭据且不重连', async () => {
  let applied = false;
  const coordinator = new GatewayScopeUpgradeCoordinator({
    captureConnection: () => ({ connectionId: 'daily-1', scopes: ['operator.read'] }),
    requestFenced: async (method) => method === 'device.scopes.requestUpgrade'
      ? { requestId: 'upgrade-2' }
      : { status: 'rejected', requestId: 'upgrade-2' },
    applyRotatedDeviceCredential: async () => { applied = true; },
  });

  const operation = await coordinator.begin(['operator.admin']);
  assert.deepEqual(await operation.completion, {
    status: 'rejected',
    requestId: 'upgrade-2',
  });
  assert.equal(applied, false);
});

test('权限升级拒绝错配请求标识和缺失管理员权限的批准结果', async () => {
  const mismatched = new GatewayScopeUpgradeCoordinator({
    captureConnection: () => ({ connectionId: 'daily-1', scopes: ['operator.read'] }),
    requestFenced: async (method) => method === 'device.scopes.requestUpgrade'
      ? { requestId: 'upgrade-3' }
      : {
        status: 'approved',
        requestId: 'other-request',
        deviceToken: 'rotated-device-token',
        scopes: ['operator.admin'],
      },
    applyRotatedDeviceCredential: async () => {},
  });
  const mismatchOperation = await mismatched.begin(['operator.admin']);
  await assert.rejects(mismatchOperation.completion, /请求标识不匹配/);

  const insufficient = new GatewayScopeUpgradeCoordinator({
    captureConnection: () => ({ connectionId: 'daily-1', scopes: ['operator.read'] }),
    requestFenced: async (method) => method === 'device.scopes.requestUpgrade'
      ? { requestId: 'upgrade-4' }
      : {
        status: 'approved',
        requestId: 'upgrade-4',
        deviceToken: 'rotated-device-token',
        scopes: ['operator.read'],
      },
    applyRotatedDeviceCredential: async () => {},
  });
  const insufficientOperation = await insufficient.begin(['operator.admin']);
  await assert.rejects(insufficientOperation.completion, /未授予请求的权限/);
});

test('取消权限升级会终止官方 waiter 且保持明确取消语义', async () => {
  const coordinator = new GatewayScopeUpgradeCoordinator({
    captureConnection: () => ({ connectionId: 'daily-1', scopes: ['operator.read'] }),
    requestFenced: async (method, _params, _connectionId, options) => {
      if (method === 'device.scopes.requestUpgrade') return { requestId: 'upgrade-5' };
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    },
    applyRotatedDeviceCredential: async () => {},
  });

  const operation = await coordinator.begin(['operator.admin']);
  coordinator.cancel();
  await assert.rejects(operation.completion, GatewayScopeUpgradeCancelledError);
});
