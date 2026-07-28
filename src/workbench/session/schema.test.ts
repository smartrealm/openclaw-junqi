import assert from 'node:assert/strict';
import test from 'node:test';
import { isWorkbenchSessionSnapshot, WORKBENCH_SESSION_SCHEMA_VERSION, type WorkbenchSessionSnapshot } from './schema';

function snapshot(): WorkbenchSessionSnapshot {
  return {
    schemaVersion: WORKBENCH_SESSION_SCHEMA_VERSION,
    activeWorktreeId: null,
    worktrees: {},
    activeGroupId: 'main',
    layout: { type: 'group', groupId: 'main' },
    groups: { main: { id: 'main', tabIds: ['tab'], activeTabId: 'tab' } },
    tabs: {
      tab: { id: 'tab', paneId: 'pane', kind: 'editor', title: 'a.ts', preview: true, pinned: false, dirty: false, filePath: '/repo/a.ts' },
    },
    sidebarMode: 'full', rightSidebarPanel: 'files', rightSidebarCollapsed: false,
  };
}

test('session schema accepts a complete referentially consistent snapshot', () => {
  assert.equal(isWorkbenchSessionSnapshot(snapshot()), true);
});

test('session schema rejects dangling, duplicate and orphan tab identities', () => {
  const dangling = snapshot();
  dangling.groups.main!.activeTabId = 'missing';
  assert.equal(isWorkbenchSessionSnapshot(dangling), false);
  const duplicate = snapshot();
  duplicate.groups.main!.tabIds = ['tab', 'tab'];
  assert.equal(isWorkbenchSessionSnapshot(duplicate), false);
  const orphan = snapshot();
  orphan.tabs.orphan = { ...orphan.tabs.tab!, id: 'orphan' };
  assert.equal(isWorkbenchSessionSnapshot(orphan), false);
});

test('session schema rejects invalid recursive layouts and inactive groups', () => {
  const invalidRatio = snapshot();
  invalidRatio.layout = {
    type: 'split', id: 'split', direction: 'horizontal', ratio: 0.99,
    first: { type: 'group', groupId: 'main' }, second: { type: 'group', groupId: 'right' },
  };
  invalidRatio.groups.right = { id: 'right', tabIds: [], activeTabId: null };
  assert.equal(isWorkbenchSessionSnapshot(invalidRatio), false);
  const absentActive = snapshot();
  absentActive.activeGroupId = 'missing';
  assert.equal(isWorkbenchSessionSnapshot(absentActive), false);
});
