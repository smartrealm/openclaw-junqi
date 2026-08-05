import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { OpenclawStatus } from '@/api/tauri-commands';
import {
  describeOpenclawInstallFailure,
  isOpenclawInstallUsable,
  openclawInstallDefects,
  requiresOpenclawRepair,
} from './openclawInstallHealth';

const echo = (key: string) => key;

function status(overrides: Partial<OpenclawStatus> = {}): OpenclawStatus {
  return {
    installed: true,
    version: '2026.7.1',
    path: '/usr/local/bin/openclaw',
    source: 'npm-global',
    binary_found: true,
    package_valid: true,
    gateway_command_ok: true,
    relocation_required: false,
    error: null,
    ...overrides,
  };
}

test('a healthy install has no defects and needs no repair', () => {
  assert.deepEqual(openclawInstallDefects(status()), []);
  assert.equal(requiresOpenclawRepair(status()), false);
  assert.equal(isOpenclawInstallUsable(status()), true);
  assert.equal(describeOpenclawInstallFailure(status(), echo), null);
});

// The regression this closes: a repair was triggered on any of the two
// checks, but success only required `installed`. A half-applied reinstall
// therefore passed here and failed later at gateway startup.
test('every check that triggers a repair also blocks success', () => {
  for (const broken of ['package_valid', 'gateway_command_ok'] as const) {
    const candidate = status({ [broken]: false } as Partial<OpenclawStatus>);
    assert.equal(requiresOpenclawRepair(candidate), true, `${broken} should request a repair`);
    assert.equal(isOpenclawInstallUsable(candidate), false, `${broken} must not pass as usable`);
    assert.ok(describeOpenclawInstallFailure(candidate, echo), `${broken} must produce a diagnostic`);
  }
});

test('the diagnostic names the failed check instead of only "install failed"', () => {
  const message = describeOpenclawInstallFailure(status({ gateway_command_ok: false }), echo);
  assert.match(String(message), /setup\.openclawInstallIncomplete/);
  assert.match(String(message), /gatewayCommandMissing/);
});

test('multiple defects are all reported', () => {
  const message = describeOpenclawInstallFailure(
    status({ package_valid: false, gateway_command_ok: false }),
    echo,
  );
  assert.match(String(message), /packageInvalid/);
  assert.match(String(message), /gatewayCommandMissing/);
});

test('a missing install reports the upstream error when present', () => {
  assert.equal(
    describeOpenclawInstallFailure(status({ installed: false, error: 'npm exited 1' }), echo),
    'npm exited 1',
  );
  assert.equal(
    describeOpenclawInstallFailure(status({ installed: false, error: null }), echo),
    'setup.openclawInstallFailed',
  );
});

// A binary that was never found is a fresh-install case, not a repair case.
test('an absent binary does not request an in-place repair', () => {
  assert.equal(requiresOpenclawRepair(status({ binary_found: false, package_valid: false })), false);
});

test('informational version text is never an installation repair defect', () => {
  for (const version of ['2025.12.31', '2027.1.0', 'not-semver', null]) {
    const candidate = status({ version });
    assert.deepEqual(openclawInstallDefects(candidate), []);
    assert.equal(requiresOpenclawRepair(candidate), false);
    assert.equal(isOpenclawInstallUsable(candidate), true);
  }
});

test('all three locales carry the remaining defect copy', () => {
  for (const locale of ['zh', 'zh-TW', 'en']) {
    const bundle = JSON.parse(readFileSync(`src/locales/${locale}.json`, 'utf8'));
    assert.equal(typeof bundle.setup?.openclawInstallIncomplete, 'string', `${locale} missing incomplete copy`);
    for (const key of ['packageInvalid', 'gatewayCommandMissing']) {
      assert.equal(typeof bundle.setup?.openclawDefect?.[key], 'string', `${locale} missing ${key}`);
    }
  }
});

// HA-01: reinstall replaces the package tree the running service executes from.
// OpenClaw's own update path hands off to a detached service rather than
// rewriting a live tree, and a stop failure must abort instead of overwriting.
test('reinstall and relocate stop the selected service before touching the tree', () => {
  const install = readFileSync('src-tauri/src/commands/setup/openclaw.rs', 'utf8');
  const service = readFileSync('src-tauri/src/commands/gateway_service.rs', 'utf8');

  assert.match(install, /OpenclawInstallMode::ReinstallExisting \| OpenclawInstallMode::Relocate/);
  assert.match(install, /stop_selected_native_service_for_reinstall\(\)/);
  assert.match(install, /Refusing to reinstall while the Gateway service is running/);

  // The stop must run before the package tree is inspected or replaced.
  const stopIndex = install.indexOf('stop_selected_native_service_for_reinstall()');
  const detectIndex = install.indexOf('crate::commands::system::detect_openclaw()');
  assert.ok(stopIndex >= 0 && detectIndex > stopIndex);

  // Ownership is authoritative for the stop; a foreign service is never touched.
  assert.match(service, /fn stop_is_permitted_for_reinstall\(inspection: GatewayServiceInspection\) -> bool \{\n\s+inspection\.installed && belongs_to_selected_state\(inspection\.ownership\)/);
  // Docker does not run from the host npm prefix, so it is a no-op, not a failure.
  assert.match(service, /OpenClawRuntimeMode::Native\n\s+\) \{\n\s+return Ok\(false\);/);
});
