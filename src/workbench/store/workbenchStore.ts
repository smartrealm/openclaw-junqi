import { create } from 'zustand';
import {
  listTabGroupIds,
  removeTabGroup as removeLayoutGroup,
  resizeTabGroupSplit,
  splitTabGroup as splitLayoutGroup,
} from '../domain/tabGroupLayout';
import { WORKBENCH_SESSION_SCHEMA_VERSION, type WorkbenchSessionSnapshot } from '../session/schema';
import {
  claimProviderSession,
  releaseProviderClaim,
  updateProviderClaimStatus,
  type ProviderClaimRequest,
  type ProviderClaimState,
  type ProviderSessionClaim,
} from '../domain/providerSession';
import type {
  TabGroup,
  TabGroupId,
  TabGroupLayoutNode,
  TabId,
  WorkbenchTab,
  WorkbenchWorktree,
  WorktreeId,
} from '../domain/types';

export type WorkbenchResourceTransactionKind =
  | 'add-worktree'
  | 'forget-worktree'
  | 'close-tab'
  | 'close-group'
  | 'restart-terminal'
  | 'reset-session';

export interface WorkbenchResourceTransaction {
  token: string;
  kind: WorkbenchResourceTransactionKind;
}

interface WorkbenchState {
  hydrated: boolean;
  writerReady: boolean;
  hydrationError: string | null;
  sidebarMode: 'full' | 'compact' | 'hidden';
  rightSidebarPanel: 'files' | 'search' | 'source' | 'checks' | 'ports' | 'vault';
  rightSidebarCollapsed: boolean;
  worktrees: Record<WorktreeId, WorkbenchWorktree>;
  activeWorktreeId: WorktreeId | null;
  forgottenLegacyWorktreeIds: WorktreeId[];
  tabs: Record<TabId, WorkbenchTab>;
  groups: Record<TabGroupId, TabGroup>;
  layout: TabGroupLayoutNode;
  activeGroupId: TabGroupId;
  providerClaims: ProviderClaimState;
  resourceTransaction: WorkbenchResourceTransaction | null;
  beginResourceTransaction: (kind: WorkbenchResourceTransactionKind) => string | null;
  endResourceTransaction: (token: string) => boolean;
  claimProvider: (request: ProviderClaimRequest) => ReturnType<typeof claimProviderSession>;
  updateProviderStatus: (paneId: string, claimId: string, generation: number, status: ProviderSessionClaim['status']) => void;
  releaseProvider: (paneId: string, claimId: string, generation: number) => void;
  setWorktrees: (worktrees: WorkbenchWorktree[]) => void;
  addWorktree: (worktree: WorkbenchWorktree) => void;
  forgetWorktree: (id: WorktreeId, transactionToken: string) => void;
  activateWorktree: (id: WorktreeId) => void;
  openTab: (groupId: TabGroupId, tab: WorkbenchTab) => void;
  activateTab: (groupId: TabGroupId, tabId: TabId) => void;
  closeTab: (groupId: TabGroupId, tabId: TabId, transactionToken: string) => void;
  setTabDirty: (tabId: TabId, dirty: boolean) => void;
  acknowledgePtyCreate: (tabId: TabId) => void;
  replacePtyIdentity: (tabId: TabId, ptyId: string, runId: string, transactionToken: string) => void;
  reconcileProviderPtyExit: (ptyId: string, runId: string) => void;
  splitGroup: (targetGroupId: TabGroupId, newGroupId: TabGroupId, splitId: string, direction: 'horizontal' | 'vertical', moveActiveTab?: boolean) => void;
  removeGroup: (groupId: TabGroupId, transactionToken: string) => void;
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

function transactionOwns(state: WorkbenchState, token: string): boolean {
  return state.resourceTransaction?.token === token;
}

function withoutPaneClaims(state: ProviderClaimState, paneIds: Iterable<string>): ProviderClaimState {
  const byPane = { ...state.byPane };
  for (const paneId of paneIds) delete byPane[paneId];
  return { byPane };
}

function activeWorktreeForGroup(
  groupId: TabGroupId,
  groups: Record<TabGroupId, TabGroup>,
  tabs: Record<TabId, WorkbenchTab>,
  fallback: WorktreeId | null,
): WorktreeId | null {
  const activeTabId = groups[groupId]?.activeTabId;
  return (activeTabId && tabs[activeTabId]?.worktreeId) || fallback;
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
  forgottenLegacyWorktreeIds: [],
  tabs: {},
  groups: { [MAIN_GROUP_ID]: { id: MAIN_GROUP_ID, tabIds: [], activeTabId: null } },
  layout: { type: 'group', groupId: MAIN_GROUP_ID },
  activeGroupId: MAIN_GROUP_ID,
  providerClaims: { byPane: {} },
  resourceTransaction: null,

  beginResourceTransaction: (kind) => {
    let token: string | null = null;
    set((state) => {
      if (state.resourceTransaction) return {};
      token = crypto.randomUUID();
      return { resourceTransaction: { token, kind } };
    });
    return token;
  },
  endResourceTransaction: (token) => {
    let released = false;
    set((state) => {
      if (!transactionOwns(state, token)) return {};
      released = true;
      return { resourceTransaction: null };
    });
    return released;
  },

  claimProvider: (request) => {
    let result!: ReturnType<typeof claimProviderSession>;
    set((state) => {
      result = claimProviderSession(state.providerClaims, request);
      return result.ok ? { providerClaims: result.state } : {};
    });
    return result;
  },
  updateProviderStatus: (paneId, claimId, generation, status) => set((state) => ({
    providerClaims: updateProviderClaimStatus(state.providerClaims, paneId, claimId, generation, status),
  })),
  releaseProvider: (paneId, claimId, generation) => set((state) => ({
    providerClaims: releaseProviderClaim(state.providerClaims, paneId, claimId, generation),
  })),

  setWorktrees: (worktrees) => set((state) => {
    if (state.resourceTransaction) return {};
    const next = Object.fromEntries(worktrees.map((worktree) => [worktree.id, worktree]));
    return {
      worktrees: next,
      activeWorktreeId: state.activeWorktreeId && next[state.activeWorktreeId]
        ? state.activeWorktreeId
        : worktrees[0]?.id ?? null,
    };
  }),

  addWorktree: (worktree) => set((state) => state.resourceTransaction ? {} : ({
    worktrees: { ...state.worktrees, [worktree.id]: worktree },
    activeWorktreeId: worktree.id,
    forgottenLegacyWorktreeIds: state.forgottenLegacyWorktreeIds.filter((id) => id !== worktree.id),
  })),

  forgetWorktree: (id, transactionToken) => set((state) => {
    if (!transactionOwns(state, transactionToken) || !state.worktrees[id]) return {};
    const forgottenTabs = new Set(Object.values(state.tabs)
      .filter((tab) => tab.worktreeId === id)
      .map((tab) => tab.id));
    const tabs = Object.fromEntries(Object.entries(state.tabs)
      .filter(([tabId]) => !forgottenTabs.has(tabId)));
    const groups = Object.fromEntries(Object.entries(state.groups).map(([groupId, group]) => {
      const previousIndex = group.activeTabId ? group.tabIds.indexOf(group.activeTabId) : 0;
      const tabIds = group.tabIds.filter((tabId) => !forgottenTabs.has(tabId));
      return [groupId, {
        ...group,
        tabIds,
        activeTabId: group.activeTabId && !forgottenTabs.has(group.activeTabId)
          ? group.activeTabId
          : adjacentTabId(tabIds, Math.max(0, previousIndex)),
      }];
    }));
    const worktrees = { ...state.worktrees };
    delete worktrees[id];
    const byPane = { ...state.providerClaims.byPane };
    for (const tabId of forgottenTabs) {
      const paneId = state.tabs[tabId]?.paneId;
      if (paneId) delete byPane[paneId];
    }
    const forgottenLegacyWorktreeIds = id.startsWith('legacy-worktree:')
      ? [...new Set([...state.forgottenLegacyWorktreeIds, id])]
      : state.forgottenLegacyWorktreeIds;
    const fallbackWorktreeId = state.activeWorktreeId === id
      ? Object.keys(worktrees)[0] ?? null
      : state.activeWorktreeId;
    const activeWorktreeId = activeWorktreeForGroup(state.activeGroupId, groups, tabs, fallbackWorktreeId);
    return {
      worktrees, tabs, groups, activeWorktreeId, forgottenLegacyWorktreeIds,
      providerClaims: { byPane },
    };
  }),

  activateWorktree: (id) => set((state) => {
    if (state.resourceTransaction || !state.worktrees[id]) return {};
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
    if (state.resourceTransaction) return {};
    const group = state.groups[groupId];
    if (!group) return {};
    // A preview can already own an editor document lease. Replacing it inside a
    // synchronous Store mutation would bypass checkpoint/release, so previews
    // remain explicit tabs until the resource transaction layer closes them.
    const tabIds = group.tabIds.includes(tab.id) ? group.tabIds : [...group.tabIds, tab.id];
    const tabs = { ...state.tabs, [tab.id]: tab };
    const groups = Object.fromEntries(Object.entries(state.groups).map(([id, candidate]) => {
      if (id === groupId || !candidate.tabIds.includes(tab.id)) return [id, candidate];
      const movedIndex = candidate.tabIds.indexOf(tab.id);
      const nextIds = candidate.tabIds.filter((candidateId) => candidateId !== tab.id);
      return [id, {
        ...candidate,
        tabIds: nextIds,
        activeTabId: candidate.activeTabId === tab.id
          ? adjacentTabId(nextIds, movedIndex)
          : candidate.activeTabId,
      }];
    }));
    groups[groupId] = { ...group, tabIds, activeTabId: tab.id };
    return {
      tabs,
      groups,
      activeGroupId: groupId,
      activeWorktreeId: tab.worktreeId,
    };
  }),

  activateTab: (groupId, tabId) => set((state) => {
    if (state.resourceTransaction) return {};
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

  closeTab: (groupId, tabId, transactionToken) => set((state) => {
    if (!transactionOwns(state, transactionToken)) return {};
    const group = state.groups[groupId];
    if (!group || !group.tabIds.includes(tabId)) return {};
    const closedIndex = group.tabIds.indexOf(tabId);
    const tabIds = group.tabIds.filter((id) => id !== tabId);
    const tabs = { ...state.tabs };
    delete tabs[tabId];
    const activeTabId = group.activeTabId === tabId ? adjacentTabId(tabIds, closedIndex) : group.activeTabId;
    const groups = {
      ...state.groups,
      [groupId]: { ...group, tabIds, activeTabId },
    };
    return {
      tabs,
      groups,
      providerClaims: withoutPaneClaims(state.providerClaims, [state.tabs[tabId]?.paneId].filter(Boolean) as string[]),
      ...(groupId === state.activeGroupId
        ? { activeWorktreeId: activeWorktreeForGroup(groupId, groups, tabs, state.activeWorktreeId) }
        : {}),
    };
  }),

  setTabDirty: (tabId, dirty) => set((state) => {
    const tab = state.tabs[tabId];
    if (!tab || tab.dirty === dirty) return {};
    return { tabs: { ...state.tabs, [tabId]: { ...tab, dirty, preview: dirty ? false : tab.preview } } };
  }),

  acknowledgePtyCreate: (tabId) => set((state) => {
    const tab = state.tabs[tabId];
    if (!tab?.ptyCreatePending) return {};
    return { tabs: { ...state.tabs, [tabId]: { ...tab, ptyCreatePending: false } } };
  }),

  replacePtyIdentity: (tabId, ptyId, ptyRunId, transactionToken) => set((state) => {
    if (!transactionOwns(state, transactionToken)) return {};
    const tab = state.tabs[tabId];
    if (!tab || tab.kind !== 'terminal') return {};
    return {
      tabs: {
        ...state.tabs,
        [tabId]: { ...tab, ptyId, ptyRunId, ptyCreatePending: true },
      },
    };
  }),

  reconcileProviderPtyExit: (ptyId, runId) => set((state) => ({
    providerClaims: withoutPaneClaims(
      state.providerClaims,
      Object.values(state.providerClaims.byPane)
        .filter((claim) => claim.ptyId === ptyId && claim.ptyRunId === runId)
        .map((claim) => claim.paneId),
    ),
  })),

  splitGroup: (targetGroupId, newGroupId, splitId, direction, moveActiveTab = false) => set((state) => {
    if (state.resourceTransaction) return {};
    const target = state.groups[targetGroupId];
    if (!target || state.groups[newGroupId]) return {};
    const movedTabId = moveActiveTab ? target.activeTabId : null;
    const targetTabIds = movedTabId ? target.tabIds.filter((id) => id !== movedTabId) : target.tabIds;
    const targetActiveTabId = movedTabId
      ? adjacentTabId(targetTabIds, target.tabIds.indexOf(movedTabId))
      : target.activeTabId;
    return {
      groups: {
        ...state.groups,
        [targetGroupId]: { ...target, tabIds: targetTabIds, activeTabId: targetActiveTabId },
        [newGroupId]: { id: newGroupId, tabIds: movedTabId ? [movedTabId] : [], activeTabId: movedTabId },
      },
      layout: splitLayoutGroup(state.layout, targetGroupId, splitId, newGroupId, direction),
      activeGroupId: newGroupId,
    };
  }),

  removeGroup: (groupId, transactionToken) => set((state) => {
    if (!transactionOwns(state, transactionToken) || Object.keys(state.groups).length <= 1) return {};
    const layout = removeLayoutGroup(state.layout, groupId);
    if (!layout) return {};
    const groups = { ...state.groups };
    const tabs = { ...state.tabs };
    const removedTabIds = groups[groupId]?.tabIds ?? [];
    const removedPaneIds = removedTabIds.flatMap((tabId) => state.tabs[tabId]?.paneId ? [state.tabs[tabId]!.paneId] : []);
    removedTabIds.forEach((tabId) => delete tabs[tabId]);
    delete groups[groupId];
    const activeGroupId = state.activeGroupId === groupId
      ? listTabGroupIds(layout)[0]!
      : state.activeGroupId;
    return {
      groups, tabs, layout, activeGroupId,
      activeWorktreeId: activeWorktreeForGroup(activeGroupId, groups, tabs, state.activeWorktreeId),
      providerClaims: withoutPaneClaims(state.providerClaims, removedPaneIds),
    };
  }),

  resizeSplit: (splitId, ratio) => set((state) => state.resourceTransaction ? {} : ({
    layout: resizeTabGroupSplit(state.layout, splitId, ratio),
  })),
  setSidebarMode: (sidebarMode) => set({ sidebarMode }),
  setRightSidebarPanel: (rightSidebarPanel) => set({ rightSidebarPanel }),
  setRightSidebarCollapsed: (rightSidebarCollapsed) => set({ rightSidebarCollapsed }),

  hydrateSession: (snapshot) => set(() => snapshot ? {
    hydrated: true,
    writerReady: true,
    hydrationError: null,
    activeWorktreeId: snapshot.activeWorktreeId,
    worktrees: snapshot.worktrees,
    forgottenLegacyWorktreeIds: snapshot.forgottenLegacyWorktreeIds,
    activeGroupId: snapshot.activeGroupId,
    layout: snapshot.layout,
    groups: snapshot.groups,
    tabs: snapshot.tabs,
    sidebarMode: snapshot.sidebarMode,
    rightSidebarPanel: snapshot.rightSidebarPanel,
    rightSidebarCollapsed: snapshot.rightSidebarCollapsed,
    providerClaims: { byPane: {} },
    resourceTransaction: null,
  } : {
    hydrated: true,
    writerReady: true,
    hydrationError: null,
    providerClaims: { byPane: {} },
    resourceTransaction: null,
  }),

  failHydration: (error) => set({ hydrated: true, writerReady: false, hydrationError: error }),

  sessionSnapshot: () => {
    const state = get();
    return {
      schemaVersion: WORKBENCH_SESSION_SCHEMA_VERSION,
      activeWorktreeId: state.activeWorktreeId,
      worktrees: state.worktrees,
      forgottenLegacyWorktreeIds: state.forgottenLegacyWorktreeIds,
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
