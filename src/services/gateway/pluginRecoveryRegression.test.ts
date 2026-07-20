import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  isAwaitingGatewayVerification,
  planPluginRecovery,
  pluginsNeedingHeal,
  UNVERIFIABLE_PLUGIN_REASON,
  unhealedPlugins,
  type BrokenGatewayPlugin,
  type PluginHealOutcome,
} from './pluginRecovery';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

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

test('BUG-CPI-07 detection is structured, hints are cross-validated, no plugin names are hardcoded', () => {
  const rust = source('src-tauri/src/commands/plugin_recovery.rs');
  // Channel B replicates the smoke check from each plugin's own manifest.
  assert.match(rust, /plugins", "list", "--json"/);
  assert.match(rust, /fn missing_main_entry/);
  // Channel A hints must never bypass cross-validation against the list.
  assert.match(rust, /hints\.iter\(\)\.any\(\|hint\| hint == &entry\.id\)/);
  // No concrete plugin id may be baked into production code. Doc comments may
  // cite the observed real-world case; executable lines may not.
  const productionCode = rust
    .split('#[cfg(test)]')[0]
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  assert.doesNotMatch(productionCode, /openclaw-lark|larksuite/);
});

test('BUG-CPI-07 heal ladder re-checks after every rung and validates npm specs', () => {
  const rust = source('src-tauri/src/commands/plugin_recovery.rs');
  const doctor = rust.indexOf('"doctor", "--fix"');
  const update = rust.indexOf('"plugins", "update"');
  const install = rust.indexOf('"plugins", "install"');
  assert.ok(doctor >= 0 && update > doctor && install > update,
    'ladder order must be doctor-fix (invalid config) before update before reinstall');
  const recheckCount = rust.split('plugin_is_still_broken(&id).await?').length - 1;
  assert.ok(recheckCount >= 3, 'every rung must end in a decidable re-check');
  assert.match(rust, /is_valid_npm_spec\(&spec\)/);
  assert.match(rust, /validate_cli_identifier\(&id, "plugin id"\)/);
  assert.match(rust, /GATEWAY_SMOKE_CHECK_REASON/);
  assert.match(rust, /let verifiable = is_verifiable_reason/);
});

test('BUG-CPI-07 invalid-config damage class falls back to structured config validation', () => {
  const rust = source('src-tauri/src/commands/plugin_recovery.rs');
  // Detection: locked `plugins list` must fall back to validator issue paths.
  assert.match(rust, /"config", "validate", "--json"/);
  assert.match(rust, /strip_prefix\(CONFIG_PLUGIN_ENTRY_PREFIX\)/);
  assert.match(rust, /config_validation_plugin_issues\(\)\.await/);
});

test('BUG-CPI-07 disable is the last rung and the UI offers it only for verified findings', () => {
  const hook = source('src/hooks/useSetupFlow.ts');
  assert.match(hook, /listBrokenGatewayPlugins\(/);
  assert.match(hook, /unhealedPlugins\(/);
  assert.match(hook, /pluginsNeedingHeal\(/);
  assert.match(hook, /planPluginRecovery\(/);
  assert.match(hook, /disableOpenclawPlugin\(/);
  const page = source('src/pages/SetupPage.tsx');
  assert.match(page, /flow\.brokenPlugins\.length > 0/);
  assert.match(page, /disablePluginsAndRetry/);
});
