export type HostId = string;
export type ProjectId = string;
export type RepositoryId = string;
export type WorktreeId = string;
export type TabGroupId = string;
export type TabId = string;
export type PaneId = string;
export type PtyId = string;
export type PtyRunId = string;
export type ProviderId = string;
export type ProviderSessionId = string;

export type WorkbenchHostKind = 'local' | 'ssh' | 'runtime';
export type WorkbenchConnectionState = 'connected' | 'connecting' | 'offline' | 'error';

export interface WorkbenchHostCapabilities {
  files: boolean;
  git: boolean;
  terminal: boolean;
  browser: boolean;
  hostedReview: boolean;
}

export interface WorkbenchHost {
  id: HostId;
  kind: WorkbenchHostKind;
  revision: number;
  connectionState: WorkbenchConnectionState;
  capabilities: WorkbenchHostCapabilities;
}

export interface WorkbenchWorktree {
  id: WorktreeId;
  projectId: ProjectId;
  repositoryId: RepositoryId;
  hostId: HostId;
  hostRevision: number;
  path: string;
  branch: string | null;
  lifecycle: 'active' | 'sleeping' | 'waking' | 'deleting' | 'unavailable';
}

export type WorkbenchTabKind = 'agent-terminal' | 'editor' | 'diff' | 'browser' | 'conflict-review' | 'check-details';

export interface WorkbenchTab {
  id: TabId;
  paneId: PaneId;
  kind: WorkbenchTabKind;
  title: string;
  preview: boolean;
  pinned: boolean;
  dirty: boolean;
}

export interface TabGroup {
  id: TabGroupId;
  tabIds: TabId[];
  activeTabId: TabId | null;
}

export type TabGroupLayoutNode =
  | { type: 'group'; groupId: TabGroupId }
  | {
      type: 'split';
      id: string;
      direction: 'horizontal' | 'vertical';
      ratio: number;
      first: TabGroupLayoutNode;
      second: TabGroupLayoutNode;
    };
