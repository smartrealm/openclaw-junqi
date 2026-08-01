import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { diffConfigPaths, planConfigReload } from './configReloadPlan';

/**
 * Sampled from the installed OpenClaw 2026.7.1-2 gateway via
 * `openclaw gateway call config.schema.lookup`. Six of these ten paths do not
 * need a restart, which is exactly the availability that the previous
 * unconditional restart threw away.
 */
const SAMPLED_RELOAD_KINDS: Record<string, string> = {
  'gateway.port': 'restart',
  'gateway.auth': 'restart',
  'gateway.bind': 'restart',
  'channels.telegram.botToken': 'restart',
  'agents.defaults.model': 'hot',
  'models.providers': 'hot',
  'agents.defaults.workspace': 'none',
  'session.dmScope': 'none',
  'tools.experimental.planTool': 'none',
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

// The reload planner is keyed on config paths, not on array element identity.
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
  for (const path of ['agents.defaults.workspace', 'session.dmScope', 'tools.experimental.planTool', 'skills.install.nodeManager']) {
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

// Not knowing the reload semantics must never read as permission to skip.
test('an unavailable lookup degrades to restart, never to hot or none', async () => {
  const plan = await planConfigReload(['session.dmScope'], async () => {
    throw new Error('gateway unreachable');
  });
  assert.equal(plan.kind, 'restart');
  assert.match(String(plan.fallbackReason), /gateway unreachable/);
});

test('a missing or unrecognised reloadKind degrades to restart', async () => {
  for (const payload of [{}, { reloadKind: 'maybe' }, null, 'restart']) {
    const plan = await planConfigReload(['session.dmScope'], async () => payload);
    assert.equal(plan.kind, 'restart', JSON.stringify(payload));
    assert.ok(plan.fallbackReason);
  }
});

test('one unknown path does not suppress a restart demanded by another', async () => {
  const plan = await planConfigReload(['gateway.port', 'not.a.path'], sampledLookup);
  assert.equal(plan.kind, 'restart');
});

test('the config manager consults the plan before restarting', () => {
  const source = readFileSync('src/pages/ConfigManager/index.tsx', 'utf8');
  assert.match(source, /planConfigReload\(/);
  assert.match(source, /config\.schema\.lookup/);
  // The restart must sit behind the plan, not run unconditionally after save.
  const planIndex = source.indexOf('planConfigReload(');
  const restartIndex = source.indexOf("gatewayLifecycle.restart('config-manager')");
  assert.ok(planIndex >= 0 && restartIndex > planIndex);
  assert.match(source, /if \(reloadPlan\.kind !== 'restart'\)/);
});
