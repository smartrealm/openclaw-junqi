import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const storage = readFileSync(new URL('./storage.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../../pages/AgentWorkspace/index.tsx', import.meta.url), 'utf8');
const backend = readFileSync(new URL('../../../src-tauri/src/commands/workbench_session.rs', import.meta.url), 'utf8');

test('session reset is a native archive operation, not a renderer overwrite', () => {
  assert.match(storage, /invoke<boolean>\('reset_workbench_session'/);
  assert.match(backend, /recovery-\{\}/);
  assert.match(backend, /fs::rename\(&source, &destination\)/);
  assert.match(backend, /for \(original, archived\) in moved\.into_iter\(\)\.rev\(\)/);
  assert.match(backend, /recovery rollback incomplete/);
  assert.doesNotMatch(backend.slice(backend.indexOf('fn reset_at'), backend.indexOf('fn save_at')), /remove_file/);
});

test('failed hydration offers one explicit reset action and reloads only after success', () => {
  const reset = page.slice(page.indexOf('const resetSession = async'), page.indexOf('\n\n  return (', page.indexOf('const resetSession = async')));
  assert.ok(reset.indexOf("await resetWorkbenchSession('local')") < reset.indexOf('window.location.reload()'));
  assert.match(page, /归档并重置会话/);
});

test('load save and reset share the native session operation gate', () => {
  const commands = backend.slice(backend.indexOf('pub fn load_workbench_session'));
  assert.equal(commands.match(/session_operation_gate\(\)/g)?.length, 3);
});
