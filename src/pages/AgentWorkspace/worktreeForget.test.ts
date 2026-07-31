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

// The forget affordance used to hard-code its Chinese copy. It now goes through
// i18n, so the guarantee lives in the locale bundles instead of index.tsx. Assert
// the binding here and the wording in each locale, otherwise an i18n migration can
// silently drop the "we do not delete your folder" promise (which is what happened
// when the button moved to WorkspaceChrome).
const localeNonDeletionCopy: ReadonlyArray<readonly [string, RegExp]> = [
  ['zh.json', /不删除目录/],
  ['zh-TW.json', /不刪除目錄/],
  ['en.json', /not deleted/i],
];

test('forget action explicitly does not claim directory deletion', () => {
  assert.match(source, /label=\{t\('agentWorkspace\.forgetWorkspace'/);
  for (const [file, marker] of localeNonDeletionCopy) {
    const bundle = JSON.parse(readFileSync(new URL(`../../locales/${file}`, import.meta.url), 'utf8'));
    const copy = bundle.agentWorkspace?.forgetWorkspace;
    assert.equal(typeof copy, 'string', `${file} is missing agentWorkspace.forgetWorkspace`);
    assert.match(copy, marker, `${file} must state that the directory is not deleted`);
  }
  assert.doesNotMatch(source, /delete_worktree|remove_dir|delete_path/);
  const sidebarRow = source.slice(source.indexOf('className={`junqi-wb-worktree${'), source.indexOf('</section>', source.indexOf('className={`junqi-wb-worktree${')));
  assert.match(sidebarRow, /<\/div>/);
  assert.match(sidebarRow, /junqi-wb-worktree-select/);
  assert.match(sidebarRow, /junqi-wb-worktree-forget/);
});
