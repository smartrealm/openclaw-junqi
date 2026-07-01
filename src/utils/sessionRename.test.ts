/**
 * Unit tests for src/utils/sessionRename.ts — the rename helper used by
 * ChatTabs (tab rename + NewSessionPicker inline rename) and
 * NavSidebar (sidebar row rename). Three surfaces, one helper; this
 * file locks down its contract.
 *
 * Background: the original implementation had `setSessionLabel` INSIDE
 * the gateway try/catch, so any gateway failure (offline, schema
 * mismatch) silently blocked the local rename from happening. User
 * feedback: "rename doesn't work." Fix: local update is now
 * unconditional, gateway sync is best-effort. These tests cover both
 * branches so the ordering can't regress.
 *
 * Runs with the project test runner:
 *   node --import ./test-setup.ts --import tsx --test src/utils/sessionRename.test.ts
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Side-effect import: registers the localStorage + matchMedia shim the
// app code expects when running outside the browser/Tauri webview.
// test-setup.ts lives at the repo root (used as `--import ./test-setup.ts`
// from the npm test script).
import '../../test-setup';

// We pre-populate the store BEFORE importing sessionRename so the
// imported function's reference to useChatStore is bound to the same
// store instance the test will inspect.
import { useChatStore, type Session } from '../stores/chatStore';
import { applySessionRename } from './sessionRename';

const TEST_KEY = 'agent:test:rename-1';

function seedSession(label = 'Original Label'): Session {
  const seed: Session = {
    key: TEST_KEY,
    label,
    lastMessage: 'previous turn',
    lastTimestamp: '2026-01-01T00:00:00.000Z',
  };
  // Replace the whole sessions array with our seed so the test sees
  // a known starting state.
  useChatStore.setState({ sessions: [seed] });
  return seed;
}

function getSession(): Session | undefined {
  return useChatStore.getState().sessions.find((s) => s.key === TEST_KEY);
}

describe('applySessionRename', () => {
  beforeEach(() => {
    // Reset to a known state between tests.
    useChatStore.setState({ sessions: [] });
  });

  test('happy path: updates the local store label', async () => {
    seedSession('Before');
    const before = getSession();
    assert.ok(before, 'seed session must exist before the rename');
    assert.equal(before.label, 'Before');

    const result = await applySessionRename(TEST_KEY, 'After');

    // The local store MUST reflect the new label even if the gateway
    // sync threw (which it does in this test env — no Tauri runtime).
    assert.equal(result, true, 'returns true on success');
    const after = getSession();
    assert.ok(after, 'session must still exist after rename');
    assert.equal(after?.label, 'After',
      'local store label must update unconditionally');
  });

  test('trims whitespace before applying', async () => {
    seedSession('Trim me');
    await applySessionRename(TEST_KEY, '   Padded   ');
    assert.equal(getSession()?.label, 'Padded',
      'leading/trailing whitespace should be trimmed');
  });

  test('empty / whitespace-only label is a no-op (no store change)', async () => {
    seedSession('Keep me');
    await applySessionRename(TEST_KEY, '   ');
    assert.equal(getSession()?.label, 'Keep me',
      'empty rename must not overwrite the existing label');
  });

  test('label === current label is a no-op (still returns true, no churn)', async () => {
    seedSession('Same');
    const result = await applySessionRename(TEST_KEY, 'Same');
    assert.equal(result, true);
    assert.equal(getSession()?.label, 'Same');
  });

  test('whitespace-trimmed label equal to current is a no-op', async () => {
    seedSession('Same');
    const result = await applySessionRename(TEST_KEY, '  Same  ');
    // After trim, 'Same' === 'Same', so applySessionRename short-circuits.
    assert.equal(result, true);
    assert.equal(getSession()?.label, 'Same');
  });

  test('REGRESSION: label updates even if gateway sync throws', async () => {
    // Background: the bug we fixed in commit 427a6ac was that
    //   setSessionLabel was inside the try/catch, so a failed gateway
    //   call silenced the local rename too. This test would have caught
    //   that bug — if local updates stop happening when the gateway
    //   throws, this test fails.
    //
    // The Node test runner has no Tauri runtime, so gateway.setSessionLabel
    //   is guaranteed to throw "Not connected" — exactly the failure mode
    //   we want to survive.
    seedSession('Original');
    const result = await applySessionRename(TEST_KEY, 'Survives Gateway Failure');
    assert.equal(result, true,
      'returns true even on gateway failure (local update is the contract)');
    assert.equal(getSession()?.label, 'Survives Gateway Failure',
      'local store MUST update even when the gateway sync throws');
  });

  test('preserves other session fields (only label changes)', async () => {
    const seed = seedSession('Original');
    seed.lastMessage = 'keep me';
    seed.lastTimestamp = '2026-01-01T00:00:00.000Z';

    await applySessionRename(TEST_KEY, 'New Label');

    const after = getSession();
    assert.equal(after?.lastMessage, 'keep me', 'lastMessage preserved');
    assert.equal(after?.lastTimestamp, '2026-01-01T00:00:00.000Z',
      'lastTimestamp preserved');
    assert.equal(after?.key, seed.key, 'key preserved');
  });

  test('rename of non-existent key still returns true (label may not exist)', async () => {
    // Edge case: someone passes a key that has no Session in the store.
    // The helper doesn't crash; the call still goes to the gateway.
    // Local store has no entry to mutate, so nothing to verify except
    // the function completes without throwing.
    useChatStore.setState({ sessions: [] });
    const result = await applySessionRename('agent:nonexistent:key', 'whatever');
    assert.equal(result, true);
  });
});