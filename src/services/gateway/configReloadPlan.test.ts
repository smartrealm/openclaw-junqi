import assert from 'node:assert/strict';
import test from 'node:test';
import { diffConfigPaths, planConfigReload } from './configReloadPlan';

/** 以 `config.schema.lookup` 的结构化结果模拟不同路径的运行时重载要求。 */
const SAMPLED_RELOAD_KINDS: Record<string, string> = {
  'gateway.port': 'restart',
  'gateway.auth': 'restart',
  'gateway.bind': 'restart',
  'channels.telegram.botToken': 'restart',
  'agents.defaults.model': 'hot',
  'models.providers': 'hot',
  'agents.defaults.workspace': 'none',
  'session.dmScope': 'none',
  'tools.updatePlan': 'none',
  'skills.install.nodeManager': 'none',
};

const sampledLookup = async (path: string) => {
  const reloadKind = SAMPLED_RELOAD_KINDS[path];
  if (!reloadKind) throw new Error(`unknown path ${path}`);
  return { path, reloadKind };
};

test('changed paths are reported as dotted config paths', () => {
  assert.deepEqual(
    diffConfigPaths({ gateway: { port: 1 } }, { gateway: { port: 2 } }),
    ['gateway.port'],
  );
  assert.deepEqual(diffConfigPaths({ a: { b: 1 } }, { a: { b: 1 } }), []);
  assert.deepEqual(diffConfigPaths({}, { session: { dmScope: 'per-channel-peer' } }), ['session.dmScope']);
  assert.deepEqual(diffConfigPaths({ tools: { x: 1 } }, {}), ['tools.x']);
});

// 重载规划以配置路径为单位，数组不能拆成元素索引路径。
test('arrays are compared whole rather than by index', () => {
  assert.deepEqual(diffConfigPaths({ list: [1, 2] }, { list: [1, 3] }), ['list']);
  assert.deepEqual(diffConfigPaths({ list: [1, 2] }, { list: [1, 2] }), []);
});

test('an unchanged save requires nothing', async () => {
  const plan = await planConfigReload([], sampledLookup);
  assert.equal(plan.kind, 'none');
});

test('hot and none paths do not force a restart', async () => {
  for (const path of ['agents.defaults.model', 'models.providers']) {
    assert.equal((await planConfigReload([path], sampledLookup)).kind, 'hot', path);
  }
  for (const path of ['agents.defaults.workspace', 'session.dmScope', 'tools.updatePlan', 'skills.install.nodeManager']) {
    assert.equal((await planConfigReload([path], sampledLookup)).kind, 'none', path);
  }
});

test('the strongest requirement across changed paths wins', async () => {
  const plan = await planConfigReload(
    ['session.dmScope', 'agents.defaults.model', 'gateway.port'],
    sampledLookup,
  );
  assert.equal(plan.kind, 'restart');
  assert.deepEqual(plan.decidingPaths, ['gateway.port']);

  const hot = await planConfigReload(['session.dmScope', 'agents.defaults.model'], sampledLookup);
  assert.equal(hot.kind, 'hot');
});

// 未知重载语义不能被解释为允许跳过重启。
test('an unavailable lookup degrades to restart, never to hot or none', async () => {
  const plan = await planConfigReload(['session.dmScope'], async () => {
    throw new Error('gateway unreachable');
  });
  assert.equal(plan.kind, 'restart');
  assert.equal(plan.fallbackReason, 'lookup-failed');
});

test('a missing or unrecognised reloadKind degrades to restart', async () => {
  for (const payload of [{}, { reloadKind: 'maybe' }, null, 'restart']) {
    const plan = await planConfigReload(['session.dmScope'], async () => payload);
    assert.equal(plan.kind, 'restart', JSON.stringify(payload));
    assert.equal(plan.fallbackReason, 'reload-kind-missing');
  }
});

test('one unknown path does not suppress a restart demanded by another', async () => {
  const plan = await planConfigReload(['gateway.port', 'not.a.path'], sampledLookup);
  assert.equal(plan.kind, 'restart');
});

// 缺少基线时所有路径都视为变化，仍逐项查询并保留最强重载要求。
test('an absent baseline does not weaken the decision', async () => {
  const saved = { session: { dmScope: 'per-channel-peer' }, gateway: { port: 18789 } };
  const paths = diffConfigPaths({}, saved);
  assert.deepEqual(paths.sort(), ['gateway.port', 'session.dmScope']);
  assert.equal((await planConfigReload(paths, sampledLookup)).kind, 'restart');

  const hotOnly = diffConfigPaths({}, { agents: { defaults: { model: 'x' } } });
  assert.deepEqual(hotOnly, ['agents.defaults.model']);
  assert.equal((await planConfigReload(hotOnly, sampledLookup)).kind, 'hot');
});
