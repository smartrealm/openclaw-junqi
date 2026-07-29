import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const storage = readFileSync(new URL('./storage.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../../pages/AgentWorkspace/index.tsx', import.meta.url), 'utf8');
const backendCommands = readFileSync(new URL('../../../src-tauri/src/commands/workbench_session.rs', import.meta.url), 'utf8');
const backendStorage = readFileSync(new URL('../../../src-tauri/src/commands/workbench_session/storage.rs', import.meta.url), 'utf8');

test('session reset is a native archive operation, not a renderer overwrite', () => {
  assert.match(storage, /invoke<boolean>\('reset_workbench_session'/);
  assert.match(backendCommands, /storage::reset\(&session_path/);
  assert.match(backendStorage, /recovery-\{\}/);
  assert.match(backendStorage, /fs::rename\(&source, &destination\)/);
  assert.match(backendStorage, /moved\s*\.into_iter\(\)\s*\.rev\(\)/);
  assert.match(backendStorage, /recovery rollback incomplete/);
  const resetTransaction = backendStorage.slice(
    backendStorage.indexOf('pub(super) fn reset'),
    backendStorage.indexOf('pub(super) fn save'),
  );
  assert.doesNotMatch(resetTransaction, /remove_file/);
});

test('failed hydration offers one explicit reset action and reloads only after success', () => {
  const reset = page.slice(page.indexOf('const resetSession = async'), page.indexOf('\n\n  return (', page.indexOf('const resetSession = async')));
  assert.ok(reset.indexOf("await resetWorkbenchSession('local')") < reset.indexOf('window.location.reload()'));
  assert.match(page, /归档并重置会话/);
});

test('load save and reset share the native session operation gate', () => {
  const commands = backendCommands.slice(backendCommands.indexOf('pub fn load_workbench_session'));
  assert.equal(commands.match(/session_operation_gate\(\)/g)?.length, 3);
});
