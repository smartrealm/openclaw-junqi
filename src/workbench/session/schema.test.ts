import assert from 'node:assert/strict';
import test from 'node:test';
import { isWorkbenchSessionSnapshot, migrateWorkbenchSessionSnapshot, WORKBENCH_SESSION_SCHEMA_VERSION, type WorkbenchSessionSnapshot } from './schema';

function snapshot(): WorkbenchSessionSnapshot {
  return {
    schemaVersion: WORKBENCH_SESSION_SCHEMA_VERSION,
    activeWorktreeId: 'worktree',
    forgottenLegacyWorktreeIds: [],
    worktrees: {
      worktree: {
        id: 'worktree', projectId: 'project', repositoryId: 'repo', hostId: 'local',
        hostRevision: 0, path: '/repo', branch: null, lifecycle: 'active',
      },
    },
    activeGroupId: 'main',
    layout: { type: 'group', groupId: 'main' },
    groups: { main: { id: 'main', tabIds: ['tab'], activeTabId: 'tab' } },
    tabs: {
      tab: { id: 'tab', worktreeId: 'worktree', paneId: 'pane', kind: 'editor', title: 'a.ts', preview: true, pinned: false, dirty: false, filePath: '/repo/a.ts' },
    },
    sidebarMode: 'full', rightSidebarPanel: 'files', rightSidebarCollapsed: false,
  };
}

test('session schema accepts a complete referentially consistent snapshot', () => {
  assert.equal(isWorkbenchSessionSnapshot(snapshot()), true);
});

test('session schema deterministically migrates v2 tombstones to an empty set', () => {
  const legacy = { ...snapshot(), schemaVersion: 2 } as Record<string, unknown>;
  delete legacy.forgottenLegacyWorktreeIds;
  const migrated = migrateWorkbenchSessionSnapshot(legacy);
  assert.equal(isWorkbenchSessionSnapshot(migrated), true);
  assert.deepEqual((migrated as WorkbenchSessionSnapshot).forgottenLegacyWorktreeIds, []);
});

test('session schema removes retired capability placeholders without breaking group ownership', () => {
  const legacy = snapshot() as unknown as Record<string, unknown>;
  legacy.schemaVersion = 3;
  legacy.rightSidebarPanel = 'vault';
  legacy.tabs = {
    tab: (snapshot().tabs.tab),
    retired: {
      id: 'retired', worktreeId: 'worktree', paneId: 'retired-pane', kind: 'browser',
      title: 'Browser', preview: false, pinned: false, dirty: false,
    },
  };
  legacy.groups = {
    main: { id: 'main', tabIds: ['tab', 'retired'], activeTabId: 'retired' },
  };

  const migrated = migrateWorkbenchSessionSnapshot(legacy);
  assert.equal(isWorkbenchSessionSnapshot(migrated), true);
  const snapshotAfterMigration = migrated as WorkbenchSessionSnapshot;
  assert.equal(snapshotAfterMigration.rightSidebarPanel, 'files');
  assert.deepEqual(snapshotAfterMigration.groups.main?.tabIds, ['tab']);
  assert.equal(snapshotAfterMigration.groups.main?.activeTabId, 'tab');
  assert.equal(snapshotAfterMigration.tabs.retired, undefined);
});

test('session schema keeps unknown legacy state invalid instead of normalizing it', () => {
  const legacy = snapshot() as unknown as Record<string, unknown>;
  legacy.schemaVersion = 3;
  legacy.rightSidebarPanel = 'unverified';
  assert.equal(isWorkbenchSessionSnapshot(migrateWorkbenchSessionSnapshot(legacy)), false);
});

test('session schema rejects durable PTY process-create authorization', () => {
  const authorized = snapshot();
  authorized.tabs.tab.ptyCreatePending = true;
  assert.equal(isWorkbenchSessionSnapshot(authorized), false);
});

test('session schema rejects tabs whose worktree owner is missing', () => {
  const missingOwner = snapshot();
  missingOwner.tabs.tab.worktreeId = 'missing';
  assert.equal(isWorkbenchSessionSnapshot(missingOwner), false);
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

test('session schema rejects incomplete process tabs and duplicate native ownership identities', () => {
  const missingPty = snapshot();
  missingPty.tabs.tab = { ...missingPty.tabs.tab!, kind: 'terminal', filePath: undefined };
  assert.equal(isWorkbenchSessionSnapshot(missingPty), false);

  const duplicatePane = snapshot();
  duplicatePane.groups.main!.tabIds.push('other');
  duplicatePane.tabs.other = { ...duplicatePane.tabs.tab!, id: 'other' };
  assert.equal(isWorkbenchSessionSnapshot(duplicatePane), false);

  const duplicatePty = snapshot();
  duplicatePty.tabs.tab = { ...duplicatePty.tabs.tab!, kind: 'terminal', filePath: undefined, ptyId: 'pty', ptyRunId: 'run' };
  duplicatePty.groups.main!.tabIds.push('other');
  duplicatePty.tabs.other = { ...duplicatePty.tabs.tab!, id: 'other', paneId: 'other-pane' };
  assert.equal(isWorkbenchSessionSnapshot(duplicatePty), false);
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
