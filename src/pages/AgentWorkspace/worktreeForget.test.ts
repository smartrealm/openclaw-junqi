import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');

test('forget worktree checkpoints documents and stops PTYs before store mutation', () => {
  const start = source.indexOf('const forgetWorktree = async');
  const flow = source.slice(start, source.indexOf('const addLocalProject', start));
  assert.ok(flow.indexOf('await checkpointLocalEditorDocuments') < flow.indexOf('await closeWorkbenchPtyTabs'));
  assert.ok(flow.indexOf('await closeWorkbenchPtyTabs') < flow.indexOf('commitLocalEditorDocumentRelease'));
  assert.ok(flow.indexOf('commitLocalEditorDocumentRelease') < flow.indexOf('forgetStoreWorktree'));
});

test('forget action explicitly does not claim directory deletion', () => {
  assert.match(source, /从工作台移除（不删除目录）/);
  assert.doesNotMatch(source, /delete_worktree|remove_dir|delete_path/);
});
