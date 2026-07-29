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
    }, activeWorktreeId: 'local-project', forgottenLegacyWorktreeIds: [], tabs: {},
    groups: { [mainGroup]: { id: mainGroup, tabIds: [], activeTabId: null } },
    layout: { type: 'group', groupId: mainGroup }, activeGroupId: mainGroup,
    providerClaims: { byPane: {} }, resourceTransaction: null,
  });
});

function transaction(kind: Parameters<ReturnType<typeof useWorkbenchStore.getState>['beginResourceTransaction']>[0]): string {
  const token = useWorkbenchStore.getState().beginResourceTransaction(kind);
  assert.ok(token);
  return token;
}

test('opening previews never bypasses document cleanup by silently deleting an owned tab', () => {
  const store = useWorkbenchStore.getState();
  store.openTab(mainGroup, tab('preview-a', true));
  useWorkbenchStore.getState().openTab(mainGroup, tab('preview-b', true));
  assert.deepEqual(useWorkbenchStore.getState().groups[mainGroup]?.tabIds, ['preview-a', 'preview-b']);
  useWorkbenchStore.getState().setTabDirty('preview-a', true);
  assert.equal(useWorkbenchStore.getState().tabs['preview-a']?.preview, false);
  assert.equal(useWorkbenchStore.getState().tabs['preview-a']?.dirty, true);
});

test('opening an existing tab in another group moves its single ownership', () => {
  useWorkbenchStore.getState().openTab(mainGroup, tab('shared'));
  useWorkbenchStore.getState().splitGroup(mainGroup, 'right', 'split-owner', 'horizontal');
  useWorkbenchStore.getState().openTab('right', tab('shared'));
  const state = useWorkbenchStore.getState();
  assert.deepEqual(state.groups[mainGroup]?.tabIds, []);
  assert.equal(state.groups[mainGroup]?.activeTabId, null);
  assert.deepEqual(state.groups.right?.tabIds, ['shared']);
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
  let token = transaction('close-tab');
  useWorkbenchStore.getState().closeTab(mainGroup, 'b', token);
  useWorkbenchStore.getState().endResourceTransaction(token);
  assert.equal(useWorkbenchStore.getState().groups[mainGroup]?.activeTabId, 'c');
  token = transaction('close-tab');
  useWorkbenchStore.getState().closeTab(mainGroup, 'c', token);
  useWorkbenchStore.getState().endResourceTransaction(token);
  assert.equal(useWorkbenchStore.getState().groups[mainGroup]?.activeTabId, 'a');
});

test('forgetting a worktree removes only its owned tabs and record', () => {
  useWorkbenchStore.getState().addWorktree({
    id: 'other', projectId: 'other', repositoryId: 'other', hostId: 'local',
    hostRevision: 0, path: '/other', branch: null, lifecycle: 'active',
  });
  useWorkbenchStore.getState().openTab(mainGroup, { ...tab('local-tab'), worktreeId: 'local-project' });
  const otherTab = { ...tab('other-tab'), worktreeId: 'other' };
  useWorkbenchStore.getState().openTab(mainGroup, otherTab);
  useWorkbenchStore.setState({ providerClaims: { byPane: {
    [otherTab.paneId]: {
      claimId: 'claim', generation: 1, worktreeId: 'other', paneId: otherTab.paneId,
      ptyId: 'pty', ptyRunId: 'run', providerId: 'claude', providerSessionId: null,
      transcriptPath: null, status: 'running',
    },
  } } });
  const token = transaction('forget-worktree');
  useWorkbenchStore.getState().forgetWorktree('other', token);
  useWorkbenchStore.getState().endResourceTransaction(token);
  const state = useWorkbenchStore.getState();
  assert.equal(state.worktrees.other, undefined);
  assert.equal(state.tabs['other-tab'], undefined);
  assert.ok(state.tabs['local-tab']);
  assert.deepEqual(state.groups[mainGroup]?.tabIds, ['local-tab']);
  assert.equal(state.providerClaims.byPane[otherTab.paneId], undefined);
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

test('splitting can atomically move the active tab without duplicate ownership', () => {
  for (const id of ['left', 'active']) useWorkbenchStore.getState().openTab(mainGroup, tab(id));
  useWorkbenchStore.getState().splitGroup(mainGroup, 'right', 'split-move', 'horizontal', true);
  const state = useWorkbenchStore.getState();
  assert.deepEqual(state.groups[mainGroup]?.tabIds, ['left']);
  assert.equal(state.groups[mainGroup]?.activeTabId, 'left');
  assert.deepEqual(state.groups.right?.tabIds, ['active']);
  assert.equal(state.groups.right?.activeTabId, 'active');
});

test('group removal deletes owned tabs and collapses layout', () => {
  useWorkbenchStore.getState().splitGroup(mainGroup, 'right', 'split-1', 'horizontal');
  useWorkbenchStore.getState().openTab('right', tab('right-tab'));
  const token = transaction('close-group');
  useWorkbenchStore.getState().removeGroup('right', token);
  useWorkbenchStore.getState().endResourceTransaction(token);
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
  const token = transaction('restart-terminal');
  useWorkbenchStore.getState().replacePtyIdentity('terminal', 'pty-next', 'run-next', token);
  useWorkbenchStore.getState().endResourceTransaction(token);
  assert.equal(useWorkbenchStore.getState().tabs.terminal?.ptyId, 'pty-next');
  assert.equal(useWorkbenchStore.getState().tabs.terminal?.ptyRunId, 'run-next');
  assert.equal(useWorkbenchStore.getState().tabs.terminal?.ptyCreatePending, true);
});

test('provider claims are runtime-only fenced state and hydration clears them', () => {
  const claim = useWorkbenchStore.getState().claimProvider({
    claimId: 'claim', worktreeId: 'local-project', paneId: 'pane',
    ptyId: 'pty', ptyRunId: 'run', providerId: 'claude',
    providerSessionId: null, transcriptPath: null,
  });
  assert.equal(claim.ok, true);
  assert.equal('providerClaims' in useWorkbenchStore.getState().sessionSnapshot(), false);
  useWorkbenchStore.getState().hydrateSession(useWorkbenchStore.getState().sessionSnapshot());
  assert.deepEqual(useWorkbenchStore.getState().providerClaims.byPane, {});
});

test('resource transactions reject stale release and allow only owner commits', () => {
  const first = transaction('close-tab');
  assert.equal(useWorkbenchStore.getState().beginResourceTransaction('close-group'), null);
  assert.equal(useWorkbenchStore.getState().endResourceTransaction('stale-token'), false);
  assert.equal(useWorkbenchStore.getState().resourceTransaction?.token, first);
  useWorkbenchStore.getState().closeTab(mainGroup, 'missing', 'stale-token');
  assert.equal(useWorkbenchStore.getState().endResourceTransaction(first), true);
});

test('terminal restart owner can replace identity while ordinary mutations remain fenced', () => {
  useWorkbenchStore.getState().openTab(mainGroup, {
    ...tab('terminal'), kind: 'terminal', ptyId: 'pty', ptyRunId: 'run', ptyCreatePending: false,
  });
  const token = transaction('restart-terminal');
  useWorkbenchStore.getState().openTab(mainGroup, tab('blocked'));
  useWorkbenchStore.getState().replacePtyIdentity('terminal', 'pty-next', 'run-next', token);
  const state = useWorkbenchStore.getState();
  assert.equal(state.tabs.blocked, undefined);
  assert.equal(state.tabs.terminal?.ptyId, 'pty-next');
  assert.equal(state.tabs.terminal?.ptyCreatePending, true);
});

test('tab and group commits remove their exact renderer provider claims', () => {
  useWorkbenchStore.getState().openTab(mainGroup, { ...tab('claimed'), kind: 'terminal', ptyId: 'pty', ptyRunId: 'run' });
  useWorkbenchStore.setState({ providerClaims: { byPane: {
    'pane:claimed': {
      claimId: 'claim', generation: 9, worktreeId: 'local-project', paneId: 'pane:claimed',
      ptyId: 'pty', ptyRunId: 'run', providerId: 'claude', providerSessionId: null,
      transcriptPath: null, status: 'running',
    },
  } } });
  const token = transaction('close-tab');
  useWorkbenchStore.getState().closeTab(mainGroup, 'claimed', token);
  assert.equal(useWorkbenchStore.getState().providerClaims.byPane['pane:claimed'], undefined);
});

test('natural PTY exit reconciles only the exact renderer claim identity', () => {
  useWorkbenchStore.setState({ providerClaims: { byPane: {
    old: { claimId: 'old', generation: 1, worktreeId: 'local-project', paneId: 'old', ptyId: 'pty', ptyRunId: 'old-run', providerId: 'claude', providerSessionId: null, transcriptPath: null, status: 'running' },
    current: { claimId: 'current', generation: 2, worktreeId: 'local-project', paneId: 'current', ptyId: 'pty', ptyRunId: 'new-run', providerId: 'claude', providerSessionId: null, transcriptPath: null, status: 'running' },
  } } });
  useWorkbenchStore.getState().reconcileProviderPtyExit('pty', 'old-run');
  assert.equal(useWorkbenchStore.getState().providerClaims.byPane.old, undefined);
  assert.ok(useWorkbenchStore.getState().providerClaims.byPane.current);
});

test('session snapshots always emit the current schema version', () => {
  assert.equal(useWorkbenchStore.getState().sessionSnapshot().schemaVersion, 3);
});
