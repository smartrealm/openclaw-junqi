import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { useWorkbenchStore } from './workbenchStore';
import type { WorkbenchTab } from '../domain/types';

const mainGroup = 'workbench:group:main';
const tab = (id: string, preview = false, dirty = false): WorkbenchTab => ({
  id,
  paneId: `pane:${id}`,
  kind: 'editor',
  title: id,
  preview,
  pinned: false,
  dirty,
});

beforeEach(() => {
  useWorkbenchStore.setState({
    worktrees: {}, activeWorktreeId: null, tabs: {},
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

test('closing an active tab selects the adjacent right tab before the left fallback', () => {
  for (const id of ['a', 'b', 'c']) useWorkbenchStore.getState().openTab(mainGroup, tab(id));
  useWorkbenchStore.getState().activateTab(mainGroup, 'b');
  useWorkbenchStore.getState().closeTab(mainGroup, 'b');
  assert.equal(useWorkbenchStore.getState().groups[mainGroup]?.activeTabId, 'c');
  useWorkbenchStore.getState().closeTab(mainGroup, 'c');
  assert.equal(useWorkbenchStore.getState().groups[mainGroup]?.activeTabId, 'a');
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
