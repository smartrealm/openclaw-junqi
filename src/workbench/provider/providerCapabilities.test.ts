import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const backend = readFileSync(new URL('../../../src-tauri/src/commands/workbench_provider.rs', import.meta.url), 'utf8');
const client = readFileSync(new URL('./providerCapabilities.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../../pages/AgentWorkspace/index.tsx', import.meta.url), 'utf8');

test('provider probe delegates reviewed catalog lookup without launching a provider', () => {
  const probe = backend.slice(backend.indexOf('pub fn probe_workbench_providers'));
  assert.match(probe, /workbench_agent_specs\(\)/);
  assert.match(probe, /crate::platform::detect_path\(spec\.bin\)/);
  assert.doesNotMatch(probe, /Command::new|--version|spawn|output\(/);
});

test('renderer exposes probe metadata but no provider launch action yet', () => {
  assert.match(client, /probe_workbench_providers/);
  assert.match(page, /probeWorkbenchProviders\(\)/);
  assert.match(page, /providerCapabilities\.filter\(\(provider\) => provider\.available\)\.length/);
  assert.doesNotMatch(page, /claimWorkbenchProvider|launchWorkbenchProvider/);
});
