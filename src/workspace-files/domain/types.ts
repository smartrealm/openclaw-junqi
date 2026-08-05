import type { HostId } from '@/workbench/domain/types';

export type WorkspaceFilePolicy = 'workspace' | 'terminal-strict' | 'managed-readonly';

export interface WorkspaceFileScope {
  hostId: HostId;
  hostRevision: number;
  workspaceId: string;
  rootPath: string;
  rootRevision: number;
  policy: WorkspaceFilePolicy;
}

export interface WorkspaceFileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink: boolean;
  extension: string | null;
  gitIgnored: boolean;
}

export interface WorkspaceFileCapabilities {
  list: boolean;
  read: boolean;
  write: boolean;
  create: boolean;
  delete: boolean;
  rename: boolean;
  search: boolean;
  watch: boolean;
  nativePreview: boolean;
}

export interface WorkspaceTextSnapshot {
  content: string;
  revision: string | null;
  truncated: boolean;
}

export interface WorkspaceImagePreview {
  dataUrl: string;
  mimeType: string;
  byteLength: number;
}

export interface WorkspaceFileSearchRequest {
  query: string;
  maxResults?: number;
}

export interface WorkspaceFileSearchEntry {
  path: string;
  name: string;
  directory: string;
  extension: string | null;
}

export interface WorkspaceFileSearchResult {
  entries: WorkspaceFileSearchEntry[];
}
