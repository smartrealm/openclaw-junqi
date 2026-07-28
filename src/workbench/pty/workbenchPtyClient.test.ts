import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const client = readFileSync(new URL('./workbenchPtyClient.ts', import.meta.url), 'utf8');
const backend = readFileSync(new URL('../../../src-tauri/src/commands/workbench_pty.rs', import.meta.url), 'utf8');

test('workbench PTY protocol carries explicit PTY and run identities', () => {
  for (const command of ['create_workbench_pty', 'input_workbench_pty', 'resize_workbench_pty', 'snapshot_workbench_pty', 'stop_workbench_pty', 'stop_workbench_ptys']) {
    assert.match(client, new RegExp(command));
  }
  assert.match(client, /output\.ptyId !== identity\.ptyId \|\| output\.runId !== identity\.runId/);
});

test('workbench PTY detects output gaps and requests snapshot-capable recovery', () => {
  assert.match(client, /output\.sequence !== sequence \+ 1/);
  assert.match(client, /onGap\(sequence \+ 1, output\.sequence\)/);
  assert.match(client, /snapshotWorkbenchPty/);
  assert.match(backend, /MAX_SNAPSHOT_BYTES: usize = 2 \* 1024 \* 1024/);
});

test('create and stop lifecycle operations share one backend gate', () => {
  assert.match(backend, /fn lifecycle_gate\(\)/);
  const create = backend.slice(backend.indexOf('pub fn create_workbench_pty'), backend.indexOf('pub fn input_workbench_pty'));
  const stop = backend.slice(backend.indexOf('pub fn stop_workbench_pty'), backend.indexOf('#\[cfg\(test\)\]'));
  assert.match(create, /lifecycle_gate\(\)/);
  assert.match(stop, /lifecycle_gate\(\)/);
});

test('completed runs remain exactly closable through a bounded tombstone', () => {
  assert.match(backend, /MAX_COMPLETED_RUNS: usize = 512/);
  assert.match(backend, /remember_completed_run\(&exit_id, &exit_run\)/);
  assert.match(backend, /if is_completed_run\(&pty_id, &run_id\)/);
  assert.match(backend, /completed: true/);
  assert.match(backend, /consume_completed_run\(&pty_id, &run_id\)/);
});

test('batch stop validates every PTY owner before physical termination', () => {
  const batch = backend.slice(backend.indexOf('pub fn stop_workbench_ptys'));
  assert.ok(batch.indexOf('current_handle') < batch.indexOf('stop_handle'));
  assert.match(batch, /for identity in &identities/);
  assert.match(batch, /for \(identity, \(pty_id, handle\)\) in identities\.iter\(\)\.zip\(handles\)/);
});

test('workbench PTY is isolated from legacy task and independent terminal registries', () => {
  assert.doesNotMatch(backend, /agent_task_pty/);
  assert.doesNotMatch(backend, /pty_neu/);
  assert.doesNotMatch(client, /terminalPtyHandoff|terminalSessionRegistry|workspaceStore/);
});
