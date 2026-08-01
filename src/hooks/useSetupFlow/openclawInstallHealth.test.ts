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
    version_ok: true,
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

// The regression this closes: a repair was triggered on any of the three
// checks, but success only required `installed`. A half-applied reinstall
// therefore passed here and failed later at gateway startup.
test('every check that triggers a repair also blocks success', () => {
  for (const broken of ['version_ok', 'package_valid', 'gateway_command_ok'] as const) {
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
  assert.equal(requiresOpenclawRepair(status({ binary_found: false, version_ok: false })), false);
});

test('the installer flow uses the shared criteria at both sites', () => {
  const source = readFileSync('src/hooks/useSetupFlow/useSetupInstallers.ts', 'utf8');
  assert.match(source, /requiresOpenclawRepair\(openclaw\)/);
  assert.match(source, /describeOpenclawInstallFailure\(installed, t\)/);
  assert.doesNotMatch(source, /if \(!installed\.installed\)/);
});

test('all three locales carry the defect copy', () => {
  for (const locale of ['zh', 'zh-TW', 'en']) {
    const bundle = JSON.parse(readFileSync(`src/locales/${locale}.json`, 'utf8'));
    assert.equal(typeof bundle.setup?.openclawInstallIncomplete, 'string', `${locale} missing incomplete copy`);
    for (const key of ['versionUnsupported', 'packageInvalid', 'gatewayCommandMissing']) {
      assert.equal(typeof bundle.setup?.openclawDefect?.[key], 'string', `${locale} missing ${key}`);
    }
  }
});
