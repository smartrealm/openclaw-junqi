import { create } from 'zustand';
import {
  listTabGroupIds,
  removeTabGroup as removeLayoutGroup,
  resizeTabGroupSplit,
  splitTabGroup as splitLayoutGroup,
} from '../domain/tabGroupLayout';
import type { WorkbenchSessionSnapshot } from '../session/schema';
import type {
  TabGroup,
  TabGroupId,
  TabGroupLayoutNode,
  TabId,
  WorkbenchTab,
  WorkbenchWorktree,
  WorktreeId,
} from '../domain/types';

interface WorkbenchState {
  hydrated: boolean;
  writerReady: boolean;
  hydrationError: string | null;
  worktrees: Record<WorktreeId, WorkbenchWorktree>;
  activeWorktreeId: WorktreeId | null;
  tabs: Record<TabId, WorkbenchTab>;
  groups: Record<TabGroupId, TabGroup>;
  layout: TabGroupLayoutNode;
  activeGroupId: TabGroupId;
  setWorktrees: (worktrees: WorkbenchWorktree[]) => void;
  activateWorktree: (id: WorktreeId) => void;
  openTab: (groupId: TabGroupId, tab: WorkbenchTab) => void;
  activateTab: (groupId: TabGroupId, tabId: TabId) => void;
  closeTab: (groupId: TabGroupId, tabId: TabId) => void;
  splitGroup: (targetGroupId: TabGroupId, newGroupId: TabGroupId, splitId: string, direction: 'horizontal' | 'vertical') => void;
  removeGroup: (groupId: TabGroupId) => void;
  resizeSplit: (splitId: string, ratio: number) => void;
  hydrateSession: (snapshot: WorkbenchSessionSnapshot | null) => void;
  failHydration: (error: string) => void;
  sessionSnapshot: () => WorkbenchSessionSnapshot;
}

const MAIN_GROUP_ID = 'workbench:group:main';

function adjacentTabId(tabIds: TabId[], closedIndex: number): TabId | null {
  if (tabIds.length === 0) return null;
  return tabIds[Math.min(closedIndex, tabIds.length - 1)] ?? tabIds[tabIds.length - 1] ?? null;
}

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  hydrated: false,
  writerReady: false,
  hydrationError: null,
  worktrees: {},
  activeWorktreeId: null,
  tabs: {},
  groups: { [MAIN_GROUP_ID]: { id: MAIN_GROUP_ID, tabIds: [], activeTabId: null } },
  layout: { type: 'group', groupId: MAIN_GROUP_ID },
  activeGroupId: MAIN_GROUP_ID,

  setWorktrees: (worktrees) => set((state) => {
    const next = Object.fromEntries(worktrees.map((worktree) => [worktree.id, worktree]));
    return {
      worktrees: next,
      activeWorktreeId: state.activeWorktreeId && next[state.activeWorktreeId]
        ? state.activeWorktreeId
        : worktrees[0]?.id ?? null,
    };
  }),

  activateWorktree: (id) => set((state) => (
    state.worktrees[id] ? { activeWorktreeId: id } : {}
  )),

  openTab: (groupId, tab) => set((state) => {
    const group = state.groups[groupId];
    if (!group) return {};
    const existingPreviewId = group.tabIds.find((id) => state.tabs[id]?.preview && !state.tabs[id]?.dirty);
    const retainedIds = existingPreviewId && existingPreviewId !== tab.id
      ? group.tabIds.filter((id) => id !== existingPreviewId)
      : group.tabIds;
    const tabIds = retainedIds.includes(tab.id) ? retainedIds : [...retainedIds, tab.id];
    const tabs = { ...state.tabs, [tab.id]: tab };
    if (existingPreviewId && existingPreviewId !== tab.id) delete tabs[existingPreviewId];
    return {
      tabs,
      groups: { ...state.groups, [groupId]: { ...group, tabIds, activeTabId: tab.id } },
      activeGroupId: groupId,
    };
  }),

  activateTab: (groupId, tabId) => set((state) => {
    const group = state.groups[groupId];
    return group?.tabIds.includes(tabId)
      ? { groups: { ...state.groups, [groupId]: { ...group, activeTabId: tabId } }, activeGroupId: groupId }
      : {};
  }),

  closeTab: (groupId, tabId) => set((state) => {
    const group = state.groups[groupId];
    if (!group || !group.tabIds.includes(tabId)) return {};
    const closedIndex = group.tabIds.indexOf(tabId);
    const tabIds = group.tabIds.filter((id) => id !== tabId);
    const tabs = { ...state.tabs };
    delete tabs[tabId];
    return {
      tabs,
      groups: {
        ...state.groups,
        [groupId]: {
          ...group,
          tabIds,
          activeTabId: group.activeTabId === tabId ? adjacentTabId(tabIds, closedIndex) : group.activeTabId,
        },
      },
    };
  }),

  splitGroup: (targetGroupId, newGroupId, splitId, direction) => set((state) => {
    if (!state.groups[targetGroupId] || state.groups[newGroupId]) return {};
    return {
      groups: { ...state.groups, [newGroupId]: { id: newGroupId, tabIds: [], activeTabId: null } },
      layout: splitLayoutGroup(state.layout, targetGroupId, splitId, newGroupId, direction),
      activeGroupId: newGroupId,
    };
  }),

  removeGroup: (groupId) => set((state) => {
    if (Object.keys(state.groups).length <= 1) return {};
    const layout = removeLayoutGroup(state.layout, groupId);
    if (!layout) return {};
    const groups = { ...state.groups };
    const tabs = { ...state.tabs };
    groups[groupId]?.tabIds.forEach((tabId) => delete tabs[tabId]);
    delete groups[groupId];
    const activeGroupId = state.activeGroupId === groupId
      ? listTabGroupIds(layout)[0]!
      : state.activeGroupId;
    return { groups, tabs, layout, activeGroupId };
  }),

  resizeSplit: (splitId, ratio) => set((state) => ({
    layout: resizeTabGroupSplit(state.layout, splitId, ratio),
  })),

  hydrateSession: (snapshot) => set((state) => snapshot ? {
    hydrated: true,
    writerReady: true,
    hydrationError: null,
    activeWorktreeId: snapshot.activeWorktreeId,
    activeGroupId: snapshot.activeGroupId,
    layout: snapshot.layout,
    groups: snapshot.groups,
    tabs: snapshot.tabs,
  } : {
    hydrated: true,
    writerReady: true,
    hydrationError: null,
  }),

  failHydration: (error) => set({ hydrated: true, writerReady: false, hydrationError: error }),

  sessionSnapshot: () => {
    const state = get();
    return {
      schemaVersion: 1,
      activeWorktreeId: state.activeWorktreeId,
      activeGroupId: state.activeGroupId,
      layout: state.layout,
      groups: state.groups,
      tabs: state.tabs,
      sidebarMode: 'full',
      rightSidebarPanel: 'files',
      rightSidebarCollapsed: false,
    };
  },
}));
