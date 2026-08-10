import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAwaitingGatewayVerification,
  planPluginRecovery,
  pluginsNeedingHeal,
  UNVERIFIABLE_PLUGIN_REASON,
  unhealedPlugins,
  type BrokenGatewayPlugin,
  type PluginHealOutcome,
} from './pluginRecovery';

const broken = (id: string): BrokenGatewayPlugin => ({
  id,
  version: null,
  reason: 'missing-main-entry',
  detail: null,
});

const outcome = (id: string, healed: boolean): PluginHealOutcome => ({
  id,
  healed,
  attempted: ['update'],
  error: healed ? null : 'still broken',
});

const smokeCheckBroken = (id: string): BrokenGatewayPlugin => ({
  ...broken(id),
  reason: UNVERIFIABLE_PLUGIN_REASON,
});

test('BUG-CPI-07 heal claims require a verified outcome', () => {
  const plugins = [broken('a'), broken('b'), broken('c')];
  const outcomes = [outcome('a', true), outcome('b', false)];
  // c has no outcome at all — a heal that never ran cannot claim success.
  assert.deepEqual(
    unhealedPlugins(plugins, outcomes).map((plugin) => plugin.id),
    ['b', 'c'],
  );
  assert.deepEqual(unhealedPlugins(plugins, plugins.map((p) => outcome(p.id, true))), []);
});

test('BUG-CPI-07 smoke-check findings receive one start verification then disable', () => {
  const plugin = smokeCheckBroken('gateway-only');
  const attempted = new Set<string>();

  assert.deepEqual(pluginsNeedingHeal([plugin], attempted), [plugin]);
  assert.deepEqual(planPluginRecovery([plugin], attempted), {
    action: 'start-gateway',
    startVerification: [plugin],
  });

  attempted.add(plugin.id);
  assert.deepEqual(pluginsNeedingHeal([plugin], attempted), []);
  assert.deepEqual(planPluginRecovery([plugin], attempted), {
    action: 'disable-plugins',
    startVerification: [],
  });
});

test('BUG-CPI-07 any remaining verifiable plugin skips start verification', () => {
  const smokePlugin = smokeCheckBroken('gateway-only');
  const missingMainPlugin = broken('missing-main');

  assert.deepEqual(planPluginRecovery([smokePlugin, missingMainPlugin], new Set()), {
    action: 'disable-plugins',
    startVerification: [],
  });
});

test('BUG-CPI-07 smoke-check progress is not reported as a failed repair', () => {
  const plugin = smokeCheckBroken('gateway-only');
  assert.equal(isAwaitingGatewayVerification(plugin, outcome(plugin.id, false)), false);
  assert.equal(isAwaitingGatewayVerification(plugin, {
    ...outcome(plugin.id, false),
    error: null,
  }), true);
  assert.equal(isAwaitingGatewayVerification(plugin, outcome(plugin.id, true)), false);
});
