import type { TabGroup, TabGroupId, TabGroupLayoutNode, TabId, WorkbenchTab, WorktreeId } from '../domain/types';

export const WORKBENCH_SESSION_SCHEMA_VERSION = 1;

export interface WorkbenchSessionSnapshot {
  schemaVersion: typeof WORKBENCH_SESSION_SCHEMA_VERSION;
  activeWorktreeId: WorktreeId | null;
  activeGroupId: TabGroupId;
  layout: TabGroupLayoutNode;
  groups: Record<TabGroupId, TabGroup>;
  tabs: Record<TabId, WorkbenchTab>;
  sidebarMode: 'full' | 'compact' | 'hidden';
  rightSidebarPanel: 'files' | 'search' | 'source' | 'checks' | 'ports' | 'vault';
  rightSidebarCollapsed: boolean;
}

export function isWorkbenchSessionSnapshot(value: unknown): value is WorkbenchSessionSnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WorkbenchSessionSnapshot>;
  return candidate.schemaVersion === WORKBENCH_SESSION_SCHEMA_VERSION
    && typeof candidate.activeGroupId === 'string'
    && !!candidate.layout && typeof candidate.layout === 'object'
    && !!candidate.groups && typeof candidate.groups === 'object'
    && !!candidate.tabs && typeof candidate.tabs === 'object'
    && (candidate.sidebarMode === 'full' || candidate.sidebarMode === 'compact' || candidate.sidebarMode === 'hidden')
    && typeof candidate.rightSidebarCollapsed === 'boolean';
}
