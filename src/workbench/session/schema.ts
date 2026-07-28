import { listTabGroupIds } from '../domain/tabGroupLayout';
import type { TabGroup, TabGroupId, TabGroupLayoutNode, TabId, WorkbenchTab, WorkbenchTabKind, WorkbenchWorktree, WorktreeId } from '../domain/types';

export const WORKBENCH_SESSION_SCHEMA_VERSION = 1;

export interface WorkbenchSessionSnapshot {
  schemaVersion: typeof WORKBENCH_SESSION_SCHEMA_VERSION;
  activeWorktreeId: WorktreeId | null;
  worktrees: Record<WorktreeId, WorkbenchWorktree>;
  activeGroupId: TabGroupId;
  layout: TabGroupLayoutNode;
  groups: Record<TabGroupId, TabGroup>;
  tabs: Record<TabId, WorkbenchTab>;
  sidebarMode: 'full' | 'compact' | 'hidden';
  rightSidebarPanel: 'files' | 'search' | 'source' | 'checks' | 'ports' | 'vault';
  rightSidebarCollapsed: boolean;
}

const TAB_KINDS: ReadonlySet<WorkbenchTabKind> = new Set([
  'agent-terminal', 'editor', 'diff', 'browser', 'conflict-review', 'check-details',
]);
const RIGHT_PANELS = new Set(['files', 'search', 'source', 'checks', 'ports', 'vault']);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validLayout(value: unknown, splitIds: Set<string>, groupIds: Set<string>): value is TabGroupLayoutNode {
  const node = record(value);
  if (!node || typeof node.type !== 'string') return false;
  if (node.type === 'group') {
    if (typeof node.groupId !== 'string' || !node.groupId || groupIds.has(node.groupId)) return false;
    groupIds.add(node.groupId);
    return true;
  }
  if (node.type !== 'split' || typeof node.id !== 'string' || !node.id || splitIds.has(node.id)) return false;
  if (node.direction !== 'horizontal' && node.direction !== 'vertical') return false;
  if (typeof node.ratio !== 'number' || !Number.isFinite(node.ratio) || node.ratio < 0.15 || node.ratio > 0.85) return false;
  splitIds.add(node.id);
  return validLayout(node.first, splitIds, groupIds) && validLayout(node.second, splitIds, groupIds);
}

function validTab(id: string, value: unknown): value is WorkbenchTab {
  const tab = record(value);
  return !!tab
    && tab.id === id
    && typeof tab.paneId === 'string' && tab.paneId.length > 0
    && typeof tab.kind === 'string' && TAB_KINDS.has(tab.kind as WorkbenchTabKind)
    && typeof tab.title === 'string'
    && typeof tab.preview === 'boolean'
    && typeof tab.pinned === 'boolean'
    && typeof tab.dirty === 'boolean'
    && (tab.filePath === undefined || typeof tab.filePath === 'string')
    && (tab.diffStaged === undefined || typeof tab.diffStaged === 'boolean');
}

export function isWorkbenchSessionSnapshot(value: unknown): value is WorkbenchSessionSnapshot {
  const candidate = record(value);
  if (!candidate || candidate.schemaVersion !== WORKBENCH_SESSION_SCHEMA_VERSION) return false;
  if (candidate.activeWorktreeId !== null && typeof candidate.activeWorktreeId !== 'string') return false;
  const worktrees = record(candidate.worktrees);
  if (!worktrees) return false;
  for (const [id, value] of Object.entries(worktrees)) {
    const worktree = record(value);
    if (!worktree || worktree.id !== id || typeof worktree.path !== 'string' || !worktree.path) return false;
    if (typeof worktree.hostId !== 'string' || typeof worktree.hostRevision !== 'number') return false;
  }
  if (candidate.activeWorktreeId !== null && !worktrees[candidate.activeWorktreeId]) return false;
  if (typeof candidate.activeGroupId !== 'string') return false;
  if (candidate.sidebarMode !== 'full' && candidate.sidebarMode !== 'compact' && candidate.sidebarMode !== 'hidden') return false;
  if (typeof candidate.rightSidebarPanel !== 'string' || !RIGHT_PANELS.has(candidate.rightSidebarPanel)) return false;
  if (typeof candidate.rightSidebarCollapsed !== 'boolean') return false;

  const groups = record(candidate.groups);
  const tabs = record(candidate.tabs);
  if (!groups || !tabs || !validLayout(candidate.layout, new Set(), new Set())) return false;
  const layoutGroupIds = new Set(listTabGroupIds(candidate.layout as TabGroupLayoutNode));
  if (layoutGroupIds.size === 0 || Object.keys(groups).length !== layoutGroupIds.size) return false;
  if (!layoutGroupIds.has(candidate.activeGroupId)) return false;

  const referencedTabs = new Set<string>();
  for (const groupId of layoutGroupIds) {
    const group = record(groups[groupId]);
    if (!group || group.id !== groupId || !Array.isArray(group.tabIds)) return false;
    if (group.activeTabId !== null && typeof group.activeTabId !== 'string') return false;
    const tabIds = group.tabIds;
    if (!tabIds.every((id): id is string => typeof id === 'string')) return false;
    if (new Set(tabIds).size !== tabIds.length) return false;
    if (group.activeTabId !== null && !tabIds.includes(group.activeTabId)) return false;
    for (const tabId of tabIds) {
      if (referencedTabs.has(tabId) || !validTab(tabId, tabs[tabId])) return false;
      referencedTabs.add(tabId);
    }
  }
  if (Object.keys(tabs).length !== referencedTabs.size) return false;
  return true;
}
