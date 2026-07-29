import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');

test('forget worktree checkpoints documents and stops PTYs before store mutation', () => {
  const start = source.indexOf('const forgetWorktree = async');
  const flow = source.slice(start, source.indexOf('const addLocalProject', start));
  const markers = [
    "beginResourceTransaction('forget-worktree')",
    'await checkpointLocalEditorDocuments',
    'await closeWorkbenchPtyTabs',
    'commitLocalEditorDocumentRelease',
    'forgetStoreWorktree(worktreeId, transactionToken)',
  ];
  const positions = markers.map((marker) => flow.indexOf(marker));
  positions.forEach((position, index) => assert.notEqual(position, -1, `missing marker: ${markers[index]}`));
  for (let index = 1; index < positions.length; index += 1) {
    assert.ok(positions[index - 1]! < positions[index]!, `${markers[index - 1]} must precede ${markers[index]}`);
  }
});

test('forget action explicitly does not claim directory deletion', () => {
  assert.match(source, /从工作台移除（不删除目录）/);
  assert.doesNotMatch(source, /delete_worktree|remove_dir|delete_path/);
  const sidebarRow = source.slice(source.indexOf('className={`junqi-wb-worktree${'), source.indexOf('</section>', source.indexOf('className={`junqi-wb-worktree${')));
  assert.match(sidebarRow, /<\/div>/);
  assert.match(sidebarRow, /junqi-wb-worktree-select/);
  assert.match(sidebarRow, /junqi-wb-worktree-forget/);
});
