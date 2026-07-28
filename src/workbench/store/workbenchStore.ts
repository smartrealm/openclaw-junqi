import { create } from 'zustand';
import {
  listTabGroupIds,
  removeTabGroup as removeLayoutGroup,
  resizeTabGroupSplit,
  splitTabGroup as splitLayoutGroup,
} from '../domain/tabGroupLayout';
import { WORKBENCH_SESSION_SCHEMA_VERSION, type WorkbenchSessionSnapshot } from '../session/schema';
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
  sidebarMode: 'full' | 'compact' | 'hidden';
  rightSidebarPanel: 'files' | 'search' | 'source' | 'checks' | 'ports' | 'vault';
  rightSidebarCollapsed: boolean;
  worktrees: Record<WorktreeId, WorkbenchWorktree>;
  activeWorktreeId: WorktreeId | null;
  tabs: Record<TabId, WorkbenchTab>;
  groups: Record<TabGroupId, TabGroup>;
  layout: TabGroupLayoutNode;
  activeGroupId: TabGroupId;
  setWorktrees: (worktrees: WorkbenchWorktree[]) => void;
  addWorktree: (worktree: WorkbenchWorktree) => void;
  activateWorktree: (id: WorktreeId) => void;
  openTab: (groupId: TabGroupId, tab: WorkbenchTab) => void;
  activateTab: (groupId: TabGroupId, tabId: TabId) => void;
  closeTab: (groupId: TabGroupId, tabId: TabId) => void;
  acknowledgePtyCreate: (tabId: TabId) => void;
  replacePtyIdentity: (tabId: TabId, ptyId: string, runId: string) => void;
  splitGroup: (targetGroupId: TabGroupId, newGroupId: TabGroupId, splitId: string, direction: 'horizontal' | 'vertical') => void;
  removeGroup: (groupId: TabGroupId) => void;
  resizeSplit: (splitId: string, ratio: number) => void;
  setSidebarMode: (mode: WorkbenchState['sidebarMode']) => void;
  setRightSidebarPanel: (panel: WorkbenchState['rightSidebarPanel']) => void;
  setRightSidebarCollapsed: (collapsed: boolean) => void;
  hydrateSession: (snapshot: WorkbenchSessionSnapshot | null) => void;
  failHydration: (error: string) => void;
  sessionSnapshot: () => WorkbenchSessionSnapshot;
}

const MAIN_GROUP_ID = 'workbench:group:main';

function adjacentTabId(tabIds: TabId[], closedIndex: number): TabId | null {
  if (tabIds.length === 0) return null;
  return tabIds[Math.min(closedIndex, tabIds.length - 1)] ?? tabIds[tabIds.length - 1] ?? null;
}

function lastOwnedTab(group: TabGroup, tabs: Record<TabId, WorkbenchTab>, worktreeId: WorktreeId): TabId | null {
  return [...group.tabIds].reverse().find((tabId) => tabs[tabId]?.worktreeId === worktreeId) ?? null;
}

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  hydrated: false,
  writerReady: false,
  hydrationError: null,
  sidebarMode: 'full',
  rightSidebarPanel: 'files',
  rightSidebarCollapsed: false,
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

  addWorktree: (worktree) => set((state) => ({
    worktrees: { ...state.worktrees, [worktree.id]: worktree },
    activeWorktreeId: worktree.id,
  })),

  activateWorktree: (id) => set((state) => {
    if (!state.worktrees[id]) return {};
    const groups = Object.fromEntries(Object.entries(state.groups).map(([groupId, group]) => [
      groupId,
      { ...group, activeTabId: lastOwnedTab(group, state.tabs, id) },
    ]));
    const currentHasOwnedTab = groups[state.activeGroupId]?.activeTabId !== null;
    const activeGroupId = currentHasOwnedTab
      ? state.activeGroupId
      : Object.values(groups).find((group) => group.activeTabId !== null)?.id ?? state.activeGroupId;
    return { activeWorktreeId: id, groups, activeGroupId };
  }),

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
      activeWorktreeId: tab.worktreeId,
    };
  }),

  activateTab: (groupId, tabId) => set((state) => {
    const group = state.groups[groupId];
    const tab = state.tabs[tabId];
    return group?.tabIds.includes(tabId) && tab
      ? {
          groups: { ...state.groups, [groupId]: { ...group, activeTabId: tabId } },
          activeGroupId: groupId,
          activeWorktreeId: tab.worktreeId,
        }
      : {};
  }),

  closeTab: (groupId, tabId) => set((state) => {
    const group = state.groups[groupId];
    if (!group || !group.tabIds.includes(tabId)) return {};
    const closedIndex = group.tabIds.indexOf(tabId);
    const tabIds = group.tabIds.filter((id) => id !== tabId);
    const tabs = { ...state.tabs };
    delete tabs[tabId];
    const activeTabId = group.activeTabId === tabId ? adjacentTabId(tabIds, closedIndex) : group.activeTabId;
    return {
      tabs,
      groups: {
        ...state.groups,
        [groupId]: { ...group, tabIds, activeTabId },
      },
      ...(groupId === state.activeGroupId && activeTabId && tabs[activeTabId]
        ? { activeWorktreeId: tabs[activeTabId].worktreeId }
        : {}),
    };
  }),

  acknowledgePtyCreate: (tabId) => set((state) => {
    const tab = state.tabs[tabId];
    if (!tab?.ptyCreatePending) return {};
    return { tabs: { ...state.tabs, [tabId]: { ...tab, ptyCreatePending: false } } };
  }),

  replacePtyIdentity: (tabId, ptyId, ptyRunId) => set((state) => {
    const tab = state.tabs[tabId];
    if (!tab || tab.kind !== 'terminal') return {};
    return {
      tabs: {
        ...state.tabs,
        [tabId]: { ...tab, ptyId, ptyRunId, ptyCreatePending: true },
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
  setSidebarMode: (sidebarMode) => set({ sidebarMode }),
  setRightSidebarPanel: (rightSidebarPanel) => set({ rightSidebarPanel }),
  setRightSidebarCollapsed: (rightSidebarCollapsed) => set({ rightSidebarCollapsed }),

  hydrateSession: (snapshot) => set((state) => snapshot ? {
    hydrated: true,
    writerReady: true,
    hydrationError: null,
    activeWorktreeId: snapshot.activeWorktreeId,
    worktrees: snapshot.worktrees,
    activeGroupId: snapshot.activeGroupId,
    layout: snapshot.layout,
    groups: snapshot.groups,
    tabs: snapshot.tabs,
    sidebarMode: snapshot.sidebarMode,
    rightSidebarPanel: snapshot.rightSidebarPanel,
    rightSidebarCollapsed: snapshot.rightSidebarCollapsed,
  } : {
    hydrated: true,
    writerReady: true,
    hydrationError: null,
  }),

  failHydration: (error) => set({ hydrated: true, writerReady: false, hydrationError: error }),

  sessionSnapshot: () => {
    const state = get();
    return {
      schemaVersion: WORKBENCH_SESSION_SCHEMA_VERSION,
      activeWorktreeId: state.activeWorktreeId,
      worktrees: state.worktrees,
      activeGroupId: state.activeGroupId,
      layout: state.layout,
      groups: state.groups,
      tabs: Object.fromEntries(Object.entries(state.tabs).map(([id, tab]) => [
        id,
        tab.ptyCreatePending ? { ...tab, ptyCreatePending: false } : tab,
      ])),
      sidebarMode: state.sidebarMode,
      rightSidebarPanel: state.rightSidebarPanel,
      rightSidebarCollapsed: state.rightSidebarCollapsed,
    };
  },
}));
