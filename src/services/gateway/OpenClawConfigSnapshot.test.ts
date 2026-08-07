import assert from 'node:assert/strict';
import test from 'node:test';
import { readOpenClawConfigSnapshot } from './OpenClawConfigSnapshot';

test('accepts an existing valid config snapshot with its conflict hash', () => {
  const snapshot = readOpenClawConfigSnapshot({
    exists: true,
    valid: true,
    hash: 'config-hash',
    path: '/runtime/openclaw.json',
    config: { agents: { list: [{ id: 'research' }] } },
  });

  assert.equal(snapshot.exists, true);
  assert.equal(snapshot.hash, 'config-hash');
  assert.equal(snapshot.path, '/runtime/openclaw.json');
  assert.deepEqual(snapshot.config.agents?.list, [{ id: 'research' }]);
});

test('allows a valid first-write snapshot without a hash', () => {
  const snapshot = readOpenClawConfigSnapshot({
    exists: false,
    valid: true,
    config: {},
  });

  assert.equal(snapshot.exists, false);
  assert.equal(snapshot.hash, undefined);
});

test('rejects malformed, invalid, and hashless existing snapshots', () => {
  for (const response of [
    { agents: { list: [] } },
    { exists: true, valid: false, config: {} },
    { exists: true, valid: true, config: {} },
    { exists: false, valid: true, config: [] },
  ]) {
    assert.throws(() => readOpenClawConfigSnapshot(response), /OpenClaw config/);
  }
});
