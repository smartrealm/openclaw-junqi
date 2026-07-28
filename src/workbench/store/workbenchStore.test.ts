import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { useWorkbenchStore } from './workbenchStore';
import type { WorkbenchTab } from '../domain/types';

const mainGroup = 'workbench:group:main';
const tab = (id: string, preview = false, dirty = false): WorkbenchTab => ({
  id,
  worktreeId: 'local-project',
  paneId: `pane:${id}`,
  kind: 'editor',
  title: id,
  preview,
  pinned: false,
  dirty,
});

beforeEach(() => {
  useWorkbenchStore.setState({
    hydrated: false, writerReady: false, hydrationError: null,
    sidebarMode: 'full', rightSidebarPanel: 'files', rightSidebarCollapsed: false,
    worktrees: {
      'local-project': {
        id: 'local-project', projectId: 'project', repositoryId: 'repo', hostId: 'local',
        hostRevision: 0, path: '/repo', branch: null, lifecycle: 'active',
      },
    }, activeWorktreeId: 'local-project', tabs: {},
    groups: { [mainGroup]: { id: mainGroup, tabIds: [], activeTabId: null } },
    layout: { type: 'group', groupId: mainGroup }, activeGroupId: mainGroup,
  });
});

test('workbench store replaces only clean preview tabs', () => {
  const store = useWorkbenchStore.getState();
  store.openTab(mainGroup, tab('preview-a', true));
  useWorkbenchStore.getState().openTab(mainGroup, tab('preview-b', true));
  assert.deepEqual(useWorkbenchStore.getState().groups[mainGroup]?.tabIds, ['preview-b']);
  useWorkbenchStore.getState().openTab(mainGroup, tab('dirty-preview', true, true));
  useWorkbenchStore.getState().openTab(mainGroup, tab('preview-c', true));
  assert.deepEqual(useWorkbenchStore.getState().groups[mainGroup]?.tabIds, ['dirty-preview', 'preview-c']);
});

test('tab activation synchronizes its worktree owner', () => {
  useWorkbenchStore.getState().addWorktree({
    id: 'other', projectId: 'other', repositoryId: 'other', hostId: 'local',
    hostRevision: 0, path: '/other', branch: null, lifecycle: 'active',
  });
  useWorkbenchStore.getState().openTab(mainGroup, { ...tab('owned'), worktreeId: 'local-project' });
  assert.equal(useWorkbenchStore.getState().activeWorktreeId, 'local-project');
  useWorkbenchStore.getState().activateWorktree('other');
  assert.equal(useWorkbenchStore.getState().groups[mainGroup]?.activeTabId, null);
  useWorkbenchStore.getState().activateTab(mainGroup, 'owned');
  assert.equal(useWorkbenchStore.getState().activeWorktreeId, 'local-project');
});

test('closing an active tab selects the adjacent right tab before the left fallback', () => {
  for (const id of ['a', 'b', 'c']) useWorkbenchStore.getState().openTab(mainGroup, tab(id));
  useWorkbenchStore.getState().activateTab(mainGroup, 'b');
  useWorkbenchStore.getState().closeTab(mainGroup, 'b');
  assert.equal(useWorkbenchStore.getState().groups[mainGroup]?.activeTabId, 'c');
  useWorkbenchStore.getState().closeTab(mainGroup, 'c');
  assert.equal(useWorkbenchStore.getState().groups[mainGroup]?.activeTabId, 'a');
});

test('workbench-owned projects survive session snapshots independently of legacy tasks', () => {
  const worktree = {
    id: 'local-project', projectId: 'project', repositoryId: 'repo', hostId: 'local',
    hostRevision: 0, path: '/repo', branch: null, lifecycle: 'active' as const,
  };
  useWorkbenchStore.getState().addWorktree(worktree);
  const persisted = useWorkbenchStore.getState().sessionSnapshot();
  assert.deepEqual(persisted.worktrees['local-project'], worktree);
});

test('hydration is the only action that opens the session writer gate', () => {
  assert.equal(useWorkbenchStore.getState().writerReady, false);
  useWorkbenchStore.getState().hydrateSession(null);
  assert.equal(useWorkbenchStore.getState().hydrated, true);
  assert.equal(useWorkbenchStore.getState().writerReady, true);
  useWorkbenchStore.getState().failHydration('corrupt');
  assert.equal(useWorkbenchStore.getState().writerReady, false);
  assert.equal(useWorkbenchStore.getState().hydrationError, 'corrupt');
});

test('group removal deletes owned tabs and collapses layout', () => {
  useWorkbenchStore.getState().splitGroup(mainGroup, 'right', 'split-1', 'horizontal');
  useWorkbenchStore.getState().openTab('right', tab('right-tab'));
  useWorkbenchStore.getState().removeGroup('right');
  const state = useWorkbenchStore.getState();
  assert.deepEqual(state.layout, { type: 'group', groupId: mainGroup });
  assert.equal(state.groups.right, undefined);
  assert.equal(state.tabs['right-tab'], undefined);
  assert.equal(state.activeGroupId, mainGroup);
});

test('PTY create authorization is one-shot and never durable', () => {
  useWorkbenchStore.getState().openTab(mainGroup, {
    ...tab('terminal'), kind: 'terminal', ptyId: 'pty', ptyRunId: 'run', ptyCreatePending: true,
  });
  assert.equal(useWorkbenchStore.getState().sessionSnapshot().tabs.terminal?.ptyCreatePending, false);
  useWorkbenchStore.getState().acknowledgePtyCreate('terminal');
  assert.equal(useWorkbenchStore.getState().tabs.terminal?.ptyCreatePending, false);
  useWorkbenchStore.getState().replacePtyIdentity('terminal', 'pty-next', 'run-next');
  assert.equal(useWorkbenchStore.getState().tabs.terminal?.ptyId, 'pty-next');
  assert.equal(useWorkbenchStore.getState().tabs.terminal?.ptyRunId, 'run-next');
  assert.equal(useWorkbenchStore.getState().tabs.terminal?.ptyCreatePending, true);
});

test('session snapshots always emit the current schema version', () => {
  assert.equal(useWorkbenchStore.getState().sessionSnapshot().schemaVersion, 2);
});
