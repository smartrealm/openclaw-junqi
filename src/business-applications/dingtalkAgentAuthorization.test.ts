import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authorizeDingTalkAgent,
  configureDingTalkDwsPath,
} from './dingtalkAgentAuthorization';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function applyPatch(current: unknown, patch: unknown): unknown {
  if (!isRecord(patch)) return structuredClone(patch);
  const result: Record<string, unknown> = isRecord(current) ? structuredClone(current) : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete result[key];
      continue;
    }
    if (Array.isArray(value) && Array.isArray(result[key]) && value.every((entry) => isRecord(entry) && typeof entry.id === 'string')) {
      const entries = structuredClone(result[key]) as unknown[];
      const indexes = new Map(entries.map((entry, index) => [isRecord(entry) ? entry.id : undefined, index]));
      for (const entry of value) {
        if (!isRecord(entry) || typeof entry.id !== 'string') continue;
        const index = indexes.get(entry.id);
        if (index === undefined) entries.push(structuredClone(entry));
        else entries[index] = applyPatch(entries[index], entry);
      }
      result[key] = entries;
      continue;
    }
    result[key] = isRecord(value) ? applyPatch(result[key], value) : structuredClone(value);
  }
  return result;
}

function createGateway(config: Record<string, unknown>, applyWrites = true) {
  const writes: Array<{ method: string; params: Record<string, unknown> }> = [];
  let current = structuredClone(config);
  return {
    writes,
    gateway: {
      async call(method: string) {
        assert.equal(method, 'config.get');
        return { exists: true, valid: true, config: current, hash: 'config-hash' };
      },
      async callPrivileged(method: string, params: Record<string, unknown>) {
        writes.push({ method, params });
        if (applyWrites) current = applyPatch(current, JSON.parse(String(params.raw))) as Record<string, unknown>;
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
    tools: { alsoAllow: ['junqi-dingtalk'] },
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
    tools: { alsoAllow: ['junqi-dingtalk'] },
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

test('将受限的全局工具白名单与当前 Agent 规则同时补入钉钉插件', async () => {
  const fixture = createGateway({
    tools: { allow: ['read'] },
    agents: { list: [{ id: 'main', tools: { alsoAllow: ['memory_search'] } }] },
    plugins: { entries: {} },
  });

  await authorizeDingTalkAgent(fixture.gateway, 'main');

  assert.deepEqual(JSON.parse(String(fixture.writes[0].params.raw)), {
    tools: { allow: ['read', 'junqi-dingtalk'] },
    agents: { list: [{ id: 'main', tools: { alsoAllow: ['memory_search', 'junqi-dingtalk'] } }] },
    plugins: { entries: { 'junqi-dingtalk': { config: { allowedAgentIds: ['main'] } } } },
  });
});

test('空 allow 不会变成只允许钉钉的限制性策略', async () => {
  const fixture = createGateway({
    tools: { allow: [] },
    agents: { list: [{ id: 'main', tools: { allow: [] } }] },
    plugins: { entries: {} },
  });

  await authorizeDingTalkAgent(fixture.gateway, 'main');

  assert.deepEqual(JSON.parse(String(fixture.writes[0].params.raw)), {
    tools: { allow: null, alsoAllow: ['junqi-dingtalk'] },
    agents: { list: [{ id: 'main', tools: { allow: null, alsoAllow: ['junqi-dingtalk'] } }] },
    plugins: { entries: { 'junqi-dingtalk': { config: { allowedAgentIds: ['main'] } } } },
  });
});

test('当前 Session 受 all sandbox 约束时，同时补齐当前 Agent 的 sandbox 工具策略', async () => {
  const fixture = createGateway({
    agents: {
      defaults: { sandbox: { mode: 'all' } },
      list: [{ id: 'main', tools: { allow: ['read'] } }],
    },
    plugins: { entries: {} },
  });

  await authorizeDingTalkAgent(fixture.gateway, 'main', 'agent:main:main');

  assert.deepEqual(JSON.parse(String(fixture.writes[0].params.raw)), {
    tools: { alsoAllow: ['junqi-dingtalk'] },
    agents: {
      list: [{
        id: 'main',
        tools: {
          allow: ['read', 'junqi-dingtalk'],
          sandbox: { tools: { alsoAllow: ['junqi-dingtalk'] } },
        },
      }],
    },
    plugins: { entries: { 'junqi-dingtalk': { config: { allowedAgentIds: ['main'] } } } },
  });
});

test('非 sandboxed 的 main Session 不写入无效的 sandbox 工具策略', async () => {
  const fixture = createGateway({
    agents: {
      defaults: { sandbox: { mode: 'non-main' } },
      list: [{ id: 'main', tools: { allow: ['read'] } }],
    },
    plugins: { entries: {} },
  });

  await authorizeDingTalkAgent(fixture.gateway, 'main', 'agent:main:main');

  const patch = JSON.parse(String(fixture.writes[0].params.raw));
  assert.equal(patch.agents.list[0].tools.sandbox, undefined);
});

test('sandbox 空 allow 保持 OpenClaw 的允许全部语义', async () => {
  const fixture = createGateway({
    agents: {
      defaults: { sandbox: { mode: 'all' } },
      list: [{ id: 'main', tools: { sandbox: { tools: { allow: [] } } } }],
    },
    plugins: { entries: {} },
  });

  await authorizeDingTalkAgent(fixture.gateway, 'main', 'agent:main:main');

  const patch = JSON.parse(String(fixture.writes[0].params.raw));
  assert.equal(patch.agents.list[0].tools.sandbox, undefined);
});

test('全局 sandbox 明确拒绝钉钉时不伪造授权成功', async () => {
  const fixture = createGateway({
    tools: { sandbox: { tools: { deny: ['junqi-dingtalk'] } } },
    agents: {
      defaults: { sandbox: { mode: 'all' } },
      list: [{ id: 'main' }],
    },
  });

  await assert.rejects(
    authorizeDingTalkAgent(fixture.gateway, 'main', 'agent:main:main'),
    /全局 sandbox 工具策略明确拒绝了钉钉插件/,
  );
  assert.equal(fixture.writes.length, 0);
});

test('成功回执未在后续配置快照中收敛时保持授权失败', async () => {
  const fixture = createGateway({
    agents: { list: [{ id: 'main' }] },
    plugins: { entries: {} },
  }, false);

  await assert.rejects(authorizeDingTalkAgent(fixture.gateway, 'main'), /没有确认全局工具策略/);
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

test('将核验后的 DWS 运行路径写入插件配置且保留其他配置', async () => {
  const fixture = createGateway({
    plugins: {
      entries: {
        'junqi-dingtalk': { config: { allowedAgentIds: ['main'], timeoutMs: 30_000 } },
      },
    },
  });

  await configureDingTalkDwsPath(fixture.gateway, '/verified/npm/lib/node_modules/dingtalk-workspace-cli/bin/dws.js');

  assert.deepEqual(JSON.parse(String(fixture.writes[0].params.raw)), {
    plugins: {
      entries: {
        'junqi-dingtalk': { config: { dwsPath: '/verified/npm/lib/node_modules/dingtalk-workspace-cli/bin/dws.js' } },
      },
    },
  });
  assert.equal(fixture.writes[0].params.baseHash, 'config-hash');
});

test('DWS 运行路径未变化时不重复写配置', async () => {
  const fixture = createGateway({
    plugins: {
      entries: {
        'junqi-dingtalk': { config: { dwsPath: '/verified/npm/lib/node_modules/dingtalk-workspace-cli/bin/dws.js' } },
      },
    },
  });

  await configureDingTalkDwsPath(fixture.gateway, '/verified/npm/lib/node_modules/dingtalk-workspace-cli/bin/dws.js');

  assert.equal(fixture.writes.length, 0);
});
