import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const backend = readFileSync(new URL('../../../src-tauri/src/commands/workbench_provider.rs', import.meta.url), 'utf8');
const pty = readFileSync(new URL('../../../src-tauri/src/commands/workbench_pty.rs', import.meta.url), 'utf8');
const client = readFileSync(new URL('./providerClaimClient.ts', import.meta.url), 'utf8');

test('native provider claim validates the exact live PTY under the shared lifecycle gate', () => {
  const claim = backend.slice(backend.indexOf('pub fn claim_workbench_provider'), backend.indexOf('pub fn release_workbench_provider'));
  assert.ok(claim.indexOf('lifecycle_gate()') < claim.indexOf('assert_current_owner_locked'));
  assert.match(claim, /&request\.worktree_id/);
  assert.match(claim, /&request\.pane_id/);
  assert.match(claim, /\.canonicalize\(\)/);
  assert.match(claim, /transcript\.starts_with\(&cwd\)/);
  assert.match(claim, /resolve_reviewed_provider\(&request\.provider_id\)/);
  assert.match(claim, /provider PTY is already claimed/);
  assert.match(claim, /provider resume identity is already claimed/);
});

test('provider claim release is fenced by pane claim and generation', () => {
  assert.match(backend, /claim\.claim_id == claim_id && claim\.generation == generation/);
  assert.match(backend, /AtomicU64/);
  assert.match(backend, /fn lock_claims\(\) -> Result</);
  assert.match(backend, /ownership is degraded/);
  assert.doesNotMatch(backend, /poisoned\.into_inner\(\)/);
  assert.match(backend, /validate_component\("pane id", &pane_id, MAX_OWNER_ID_BYTES\)/);
  assert.match(client, /binaryPath: string/);
  assert.match(client, /release_workbench_provider/);
});

test('every PTY physical completion releases provider ownership', () => {
  assert.match(pty, /release_claims_for_pty_locked\(&exit_id\)/);
  assert.ok((pty.match(/release_claims_for_pty_locked/g) ?? []).length >= 5);
  assert.match(pty, /clear_claims_locked\(\)/);
});
