import type {
  WorkspaceFileCapabilities,
  WorkspaceFileEntry,
  WorkspaceFileScope,
  WorkspaceFileSearchRequest,
  WorkspaceFileSearchResult,
  WorkspaceImagePreview,
  WorkspaceTextSnapshot,
} from '../domain/types';

export interface WorkspaceFilesAdapter {
  capabilities(scope: WorkspaceFileScope): WorkspaceFileCapabilities;
  listDirectory(scope: WorkspaceFileScope, path: string): Promise<WorkspaceFileEntry[]>;
  readText(scope: WorkspaceFileScope, path: string): Promise<WorkspaceTextSnapshot>;
  readImagePreview(scope: WorkspaceFileScope, path: string): Promise<WorkspaceImagePreview>;
  writeText(scope: WorkspaceFileScope, path: string, content: string): Promise<void>;
  createFile(scope: WorkspaceFileScope, path: string): Promise<void>;
  createDirectory(scope: WorkspaceFileScope, path: string): Promise<void>;
  delete(scope: WorkspaceFileScope, path: string): Promise<void>;
  search(scope: WorkspaceFileScope, request: WorkspaceFileSearchRequest): Promise<WorkspaceFileSearchResult>;
}
