import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeDingTalkAgent } from './dingtalkAgentAuthorization';

function createGateway(config: Record<string, unknown>) {
  const writes: Array<{ method: string; params: Record<string, unknown> }> = [];
  return {
    writes,
    gateway: {
      async call(method: string) {
        assert.equal(method, 'config.get');
        return { exists: true, valid: true, config, hash: 'config-hash' };
      },
      async callPrivileged(method: string, params: Record<string, unknown>) {
        writes.push({ method, params });
        return { ok: true };
      },
    },
  };
}

test('uses one guarded patch for the current list agent and plugin authorization', async () => {
  const fixture = createGateway({
    agents: {
      list: [{ id: 'dingtalk-business', name: 'DingTalk', tools: { allow: ['read'] } }],
    },
    plugins: {
      entries: {
        'junqi-dingtalk': { config: { allowedAgentIds: ['reviewer'], timeoutMs: 30_000 } },
      },
    },
  });

  await authorizeDingTalkAgent(fixture.gateway, 'dingtalk-business');

  assert.equal(fixture.writes.length, 1);
  assert.equal(fixture.writes[0].method, 'config.patch');
  assert.equal(fixture.writes[0].params.baseHash, 'config-hash');
  assert.deepEqual(JSON.parse(String(fixture.writes[0].params.raw)), {
    agents: {
      list: [{ id: 'dingtalk-business', tools: { allow: ['read', 'junqi-dingtalk'] } }],
    },
    plugins: {
      entries: {
        'junqi-dingtalk': { config: { allowedAgentIds: ['reviewer', 'dingtalk-business'] } },
      },
    },
  });
});

test('supports the current entries agent shape without replacing unrelated fields', async () => {
  const fixture = createGateway({
    agents: {
      entries: {
        'dingtalk-business': { name: 'DingTalk', tools: { alsoAllow: ['memory_search'] } },
      },
    },
    plugins: { entries: {} },
  });

  await authorizeDingTalkAgent(fixture.gateway, 'dingtalk-business');

  assert.deepEqual(JSON.parse(String(fixture.writes[0].params.raw)), {
    agents: {
      entries: {
        'dingtalk-business': { tools: { alsoAllow: ['memory_search', 'junqi-dingtalk'] } },
      },
    },
    plugins: {
      entries: {
        'junqi-dingtalk': { config: { allowedAgentIds: ['dingtalk-business'] } },
      },
    },
  });
});

test('does not override an explicit plugin deny rule', async () => {
  const fixture = createGateway({
    agents: {
      list: [{ id: 'dingtalk-business', tools: { deny: ['junqi-dingtalk'] } }],
    },
  });

  await assert.rejects(
    authorizeDingTalkAgent(fixture.gateway, 'dingtalk-business'),
    /明确拒绝了钉钉插件/,
  );
  assert.equal(fixture.writes.length, 0);
});

test('does not create an implicit agent while authorizing the plugin', async () => {
  const fixture = createGateway({ agents: { list: [] } });

  await assert.rejects(
    authorizeDingTalkAgent(fixture.gateway, 'main'),
    /没有显式配置/,
  );
  assert.equal(fixture.writes.length, 0);
});

test('does not override the global OpenClaw deny policy', async () => {
  const fixture = createGateway({
    tools: { deny: ['junqi_dingtalk_runtime_status'] },
    agents: { list: [{ id: 'dingtalk-business' }] },
  });

  await assert.rejects(
    authorizeDingTalkAgent(fixture.gateway, 'dingtalk-business'),
    /全局工具策略明确拒绝了钉钉插件/,
  );
  assert.equal(fixture.writes.length, 0);
});
