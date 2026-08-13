import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isOpenClawConfigReloaderDisabled,
  readOpenClawConfigApplicationEvidence,
} from './OpenClawConfigApplicationClient';

function configResponse(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    valid: true,
    hash: 'config-hash',
    config: {},
    configRevisionHash: 'saved-revision',
    appliedConfigHash: 'active-revision',
    ...overrides,
  };
}

test('只接受 OpenClaw health 的结构化监听器禁用状态', () => {
  assert.equal(isOpenClawConfigReloaderDisabled({
    configReload: { hotReloadStatus: 'disabled' },
  }), true);
  assert.equal(isOpenClawConfigReloaderDisabled({
    configReload: { hotReloadStatus: 'active' },
  }), false);
  assert.equal(isOpenClawConfigReloaderDisabled('hot reload disabled'), false);
});

test('配置待应用且官方监听器禁用时生成一次补偿重启依据', async () => {
  const methods: string[] = [];
  const evidence = await readOpenClawConfigApplicationEvidence(
    'connection-a',
    async (method) => {
      methods.push(method);
      if (method === 'config.get') return configResponse();
      return { configReload: { hotReloadStatus: 'disabled' } };
    },
  );

  assert.equal(evidence.reloadDisabled, true);
  assert.deepEqual(methods, ['config.get', 'health']);
});

test('活动修订已收敛时不发起无用的 health 请求', async () => {
  const methods: string[] = [];
  const evidence = await readOpenClawConfigApplicationEvidence(
    'connection-a',
    async (method) => {
      methods.push(method);
      return configResponse({ appliedConfigHash: 'saved-revision' });
    },
  );

  assert.equal(evidence.reloadDisabled, false);
  assert.deepEqual(methods, ['config.get']);
});

test('health 读取失败时保留未知语义而不是猜测监听器已禁用', async () => {
  const evidence = await readOpenClawConfigApplicationEvidence(
    'connection-a',
    async (method) => {
      if (method === 'config.get') return configResponse();
      throw new Error('health unavailable');
    },
  );

  assert.equal(evidence.reloadDisabled, false);
});
