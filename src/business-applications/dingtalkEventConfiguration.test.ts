import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { OpenClawRuntimeConfigClient } from '@/services/gateway/OpenClawRuntimeConfigClient';
import {
  loadDingTalkEventConfiguration,
  DINGTALK_EVENT_KEYS,
  applyDingTalkEventConfiguration,
  DingTalkEventConfigurationAppliedError,
  normalizeDingTalkEventConfiguration,
  saveDingTalkEventConfiguration,
  type DingTalkEventConfiguration,
} from './dingtalkEventConfiguration';

test('桌面配置器事件枚举与钉钉插件 manifest 保持一致', async () => {
  const manifest = JSON.parse(await readFile(new URL(
    '../../packages/junqi-dingtalk/openclaw.plugin.json',
    import.meta.url,
  ), 'utf8')) as {
    configSchema: {
      properties: {
        eventSubscriptions: {
          items: { properties: { eventKeys: { items: { enum: string[] } } } };
        };
      };
    };
  };
  assert.deepEqual(
    manifest.configSchema.properties.eventSubscriptions.items.properties.eventKeys.items.enum,
    [...DINGTALK_EVENT_KEYS],
  );
});

function configEnvelope(config: Record<string, unknown>, hash: string) {
  return { exists: true, valid: true, config, hash };
}

test('读取钉钉事件配置时保留精确 Profile、类别、目标和内存上限', async () => {
  const client = new OpenClawRuntimeConfigClient({
    async call() {
      return configEnvelope({
        plugins: {
          entries: {
            'junqi-dingtalk': {
              config: {
                eventProfile: 'corp-a:user-a',
                eventBufferSize: 36,
                eventSubscriptions: [{
                  eventKeys: ['user_im_message_receive_o2o'],
                  openDingTalkId: 'open-user-a',
                }],
              },
            },
          },
        },
      }, 'config-hash');
    },
    async callPrivileged() {
      throw new Error('不应写入配置');
    },
  });

  assert.deepEqual(await loadDingTalkEventConfiguration(client), {
    enabled: true,
    profile: 'corp-a:user-a',
    bufferSize: 36,
    subscriptions: [{
      category: 'im-user',
      eventKeys: ['user_im_message_receive_o2o'],
      openDingTalkId: 'open-user-a',
    }],
  });
});

test('事件配置拒绝跨类别、缺少目标和无订阅启用', () => {
  assert.throws(() => normalizeDingTalkEventConfiguration({
    enabled: true,
    profile: 'corp-a:user-a',
    bufferSize: 100,
    subscriptions: [],
  }), /至少配置一个事件组/);
  assert.throws(() => normalizeDingTalkEventConfiguration({
    enabled: true,
    profile: 'corp-a:user-a',
    bufferSize: 100,
    subscriptions: [{
      category: 'oa',
      eventKeys: ['user_oa_approval_task_created', 'user_todo_task_create'],
    }],
  }), /不能混合/);
  assert.throws(() => normalizeDingTalkEventConfiguration({
    enabled: true,
    profile: 'corp-a:user-a',
    bufferSize: 100,
    subscriptions: [{
      category: 'im-user',
      eventKeys: ['user_im_message_receive_user'],
    }],
  }), /一种成员身份/);
  assert.throws(() => normalizeDingTalkEventConfiguration({
    enabled: true,
    profile: 'corp-a:user-a',
    bufferSize: 100,
    subscriptions: [{
      category: 'todo',
      eventKeys: ['user_todo_task_create'],
      unsupported: 'value',
    } as never],
  }), /不支持的字段/);
});

test('保存事件配置使用新鲜 baseHash、显式数组替换并在写后重读', async () => {
  let config: Record<string, unknown> = {
    plugins: {
      entries: {
        'junqi-dingtalk': {
          config: {
            dwsPath: '/verified/dws.js',
            allowedAgentIds: ['main'],
            eventProfile: 'corp-a:user-a',
            eventBufferSize: 100,
            eventSubscriptions: [{ eventKeys: ['user_todo_task_create'] }],
          },
        },
      },
    },
  };
  let hash = 'before-hash';
  const writes: Array<Record<string, unknown>> = [];
  const client = new OpenClawRuntimeConfigClient({
    async call(method) {
      assert.equal(method, 'config.get');
      return configEnvelope(config, hash);
    },
    async callPrivileged(method, params) {
      assert.equal(method, 'config.patch');
      writes.push(params);
      const patch = JSON.parse(String(params.raw)) as {
        plugins: { entries: { 'junqi-dingtalk': { config: Record<string, unknown> } } };
      };
      const currentPlugin = (config.plugins as {
        entries: { 'junqi-dingtalk': { config: Record<string, unknown> } };
      }).entries['junqi-dingtalk'].config;
      config = {
        plugins: {
          entries: {
            'junqi-dingtalk': {
              config: { ...currentPlugin, ...patch.plugins.entries['junqi-dingtalk'].config },
            },
          },
        },
      };
      hash = 'after-hash';
      return { ok: true };
    },
  });
  const desired: DingTalkEventConfiguration = {
    enabled: true,
    profile: 'corp-a:user-a',
    bufferSize: 24,
    subscriptions: [{
      category: 'oa',
      eventKeys: ['user_oa_approval_task_created', 'user_oa_approval_task_finished'],
    }],
  };

  const result = await saveDingTalkEventConfiguration(client, desired);

  assert.equal(result.changed, true);
  assert.deepEqual(result.configuration, desired);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.baseHash, 'before-hash');
  assert.deepEqual(writes[0]?.replacePaths, [
    'plugins.entries.junqi-dingtalk.config.eventSubscriptions',
  ]);
  assert.deepEqual(JSON.parse(String(writes[0]?.raw)), {
    plugins: {
      entries: {
        'junqi-dingtalk': {
          config: {
            eventProfile: 'corp-a:user-a',
            eventSubscriptions: [{
              eventKeys: ['user_oa_approval_task_created', 'user_oa_approval_task_finished'],
            }],
            eventBufferSize: 24,
          },
        },
      },
    },
  });
  const confirmedPlugin = (config.plugins as {
    entries: { 'junqi-dingtalk': { config: Record<string, unknown> } };
  }).entries['junqi-dingtalk'].config;
  assert.equal(confirmedPlugin.dwsPath, '/verified/dws.js');
  assert.deepEqual(confirmedPlugin.allowedAgentIds, ['main']);
});

test('未变化的事件配置不重复写入', async () => {
  let writes = 0;
  const client = new OpenClawRuntimeConfigClient({
    async call() {
      return configEnvelope({
        plugins: {
          entries: {
            'junqi-dingtalk': {
              config: {
                eventProfile: 'corp-a:user-a',
                eventBufferSize: 100,
                eventSubscriptions: [{ eventKeys: ['user_todo_task_create'] }],
              },
            },
          },
        },
      }, 'config-hash');
    },
    async callPrivileged() {
      writes += 1;
      return { ok: true };
    },
  });
  const result = await saveDingTalkEventConfiguration(client, {
    enabled: true,
    profile: 'corp-a:user-a',
    bufferSize: 100,
    subscriptions: [{ category: 'todo', eventKeys: ['user_todo_task_create'] }],
  });

  assert.equal(result.changed, false);
  assert.equal(writes, 0);
});

test('停用事件时清空订阅并删除 Profile', async () => {
  let config: Record<string, unknown> = {
    plugins: {
      entries: {
        'junqi-dingtalk': {
          config: {
            eventProfile: 'corp-a:user-a',
            eventBufferSize: 100,
            eventSubscriptions: [{ eventKeys: ['user_todo_task_create'] }],
          },
        },
      },
    },
  };
  const writes: Record<string, unknown>[] = [];
  const client = new OpenClawRuntimeConfigClient({
    async call() {
      return configEnvelope(config, 'config-hash');
    },
    async callPrivileged(_method, params) {
      writes.push(params);
      const pluginConfig = ((config.plugins as {
        entries: { 'junqi-dingtalk': { config: Record<string, unknown> } };
      }).entries['junqi-dingtalk'].config);
      delete pluginConfig.eventProfile;
      pluginConfig.eventSubscriptions = [];
      pluginConfig.eventBufferSize = 64;
      return { ok: true };
    },
  });

  const result = await saveDingTalkEventConfiguration(client, {
    enabled: false,
    profile: '',
    bufferSize: 64,
    subscriptions: [],
  });

  assert.equal(result.changed, true);
  assert.deepEqual(result.configuration, {
    enabled: false,
    profile: '',
    bufferSize: 64,
    subscriptions: [],
  });
  assert.equal(writes.length, 1);
  const raw = JSON.parse(String(writes[0]?.raw)) as {
    plugins: { entries: { 'junqi-dingtalk': { config: Record<string, unknown> } } };
  };
  assert.equal(raw.plugins.entries['junqi-dingtalk'].config.eventProfile, null);
  assert.deepEqual(raw.plugins.entries['junqi-dingtalk'].config.eventSubscriptions, []);
});

test('配置写入回读不一致时不报告成功', async () => {
  const client = new OpenClawRuntimeConfigClient({
    async call() {
      return configEnvelope({}, 'config-hash');
    },
    async callPrivileged() {
      return { ok: true };
    },
  });

  await assert.rejects(saveDingTalkEventConfiguration(client, {
    enabled: true,
    profile: 'corp-a:user-a',
    bufferSize: 100,
    subscriptions: [{ category: 'todo', eventKeys: ['user_todo_task_create'] }],
  }), /未确认钉钉事件配置已按请求写入/);
});

test('配置写后只在同一运行目标重启，并在重启后再次读取', async () => {
  let eventBufferSize = 100;
  let restartCount = 0;
  let readCount = 0;
  let identity = { connectionId: 'connection-before', targetFingerprint: 'target-a' };
  const client = new OpenClawRuntimeConfigClient({
    async call() {
      readCount += 1;
      return configEnvelope({
        plugins: {
          entries: {
            'junqi-dingtalk': {
              config: {
                eventProfile: 'corp-a:user-a',
                eventBufferSize,
                eventSubscriptions: [{ eventKeys: ['user_todo_task_create'] }],
              },
            },
          },
        },
      }, `hash-${readCount}`);
    },
    async callPrivileged() {
      eventBufferSize = 48;
      return { ok: true };
    },
  });

  const result = await applyDingTalkEventConfiguration({
    client,
    value: {
      enabled: true,
      profile: 'corp-a:user-a',
      bufferSize: 48,
      subscriptions: [{ category: 'todo', eventKeys: ['user_todo_task_create'] }],
    },
    expectedConnectionId: 'connection-before',
    expectedTargetFingerprint: 'target-a',
    currentIdentity: () => identity,
    restart: async () => {
      restartCount += 1;
      identity = { connectionId: 'connection-after', targetFingerprint: 'target-a' };
    },
  });

  assert.equal(result.changed, true);
  assert.equal(result.restarted, true);
  assert.equal(restartCount, 1);
  assert.equal(readCount, 3);
});

test('配置写后运行目标变化时不重启并保留已写入状态', async () => {
  let eventBufferSize = 100;
  let restartCount = 0;
  const client = new OpenClawRuntimeConfigClient({
    async call() {
      return configEnvelope({
        plugins: {
          entries: {
            'junqi-dingtalk': {
              config: {
                eventProfile: 'corp-a:user-a',
                eventBufferSize,
                eventSubscriptions: [{ eventKeys: ['user_todo_task_create'] }],
              },
            },
          },
        },
      }, 'config-hash');
    },
    async callPrivileged() {
      eventBufferSize = 48;
      return { ok: true };
    },
  });

  await assert.rejects(applyDingTalkEventConfiguration({
    client,
    value: {
      enabled: true,
      profile: 'corp-a:user-a',
      bufferSize: 48,
      subscriptions: [{ category: 'todo', eventKeys: ['user_todo_task_create'] }],
    },
    expectedConnectionId: 'connection-before',
    expectedTargetFingerprint: 'target-a',
    currentIdentity: () => ({ connectionId: 'connection-other', targetFingerprint: 'target-b' }),
    restart: async () => { restartCount += 1; },
  }), (error) => {
    assert.equal(error instanceof DingTalkEventConfigurationAppliedError, true);
    assert.equal((error as DingTalkEventConfigurationAppliedError).configuration.bufferSize, 48);
    assert.equal((error as DingTalkEventConfigurationAppliedError).reason, 'runtime_changed');
    return true;
  });
  assert.equal(restartCount, 0);
});

test('应用未变化的配置时不重启运行时', async () => {
  let restartCount = 0;
  const client = new OpenClawRuntimeConfigClient({
    async call() {
      return configEnvelope({
        plugins: {
          entries: {
            'junqi-dingtalk': {
              config: {
                eventProfile: 'corp-a:user-a',
                eventBufferSize: 100,
                eventSubscriptions: [{ eventKeys: ['user_todo_task_create'] }],
              },
            },
          },
        },
      }, 'config-hash');
    },
    async callPrivileged() {
      throw new Error('不应写入配置');
    },
  });

  const result = await applyDingTalkEventConfiguration({
    client,
    value: {
      enabled: true,
      profile: 'corp-a:user-a',
      bufferSize: 100,
      subscriptions: [{ category: 'todo', eventKeys: ['user_todo_task_create'] }],
    },
    expectedConnectionId: 'connection-a',
    expectedTargetFingerprint: 'target-a',
    currentIdentity: () => ({ connectionId: 'connection-a', targetFingerprint: 'target-a' }),
    restart: async () => { restartCount += 1; },
  });

  assert.equal(result.changed, false);
  assert.equal(result.restarted, false);
  assert.equal(restartCount, 0);
});

test('重启失败时保留已确认写入的配置并标记应用失败', async () => {
  let eventBufferSize = 100;
  const client = new OpenClawRuntimeConfigClient({
    async call() {
      return configEnvelope({
        plugins: {
          entries: {
            'junqi-dingtalk': {
              config: {
                eventProfile: 'corp-a:user-a',
                eventBufferSize,
                eventSubscriptions: [{ eventKeys: ['user_todo_task_create'] }],
              },
            },
          },
        },
      }, 'config-hash');
    },
    async callPrivileged() {
      eventBufferSize = 48;
      return { ok: true };
    },
  });

  await assert.rejects(applyDingTalkEventConfiguration({
    client,
    value: {
      enabled: true,
      profile: 'corp-a:user-a',
      bufferSize: 48,
      subscriptions: [{ category: 'todo', eventKeys: ['user_todo_task_create'] }],
    },
    expectedConnectionId: 'connection-a',
    expectedTargetFingerprint: 'target-a',
    currentIdentity: () => ({ connectionId: 'connection-a', targetFingerprint: 'target-a' }),
    restart: async () => { throw new Error('restart failed'); },
  }), (error) => {
    assert.equal(error instanceof DingTalkEventConfigurationAppliedError, true);
    assert.equal((error as DingTalkEventConfigurationAppliedError).reason, 'apply_failed');
    assert.equal((error as DingTalkEventConfigurationAppliedError).configuration.bufferSize, 48);
    return true;
  });
});
