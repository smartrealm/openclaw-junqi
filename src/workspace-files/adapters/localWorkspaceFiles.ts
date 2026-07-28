import { invoke } from '@tauri-apps/api/core';
import type { WorkspaceFilesAdapter } from './types';
import type {
  WorkspaceFileCapabilities,
  WorkspaceFileEntry,
  WorkspaceFileScope,
  WorkspaceFileSearchRequest,
  WorkspaceFileSearchResult,
  WorkspaceImagePreview,
  WorkspaceTextSnapshot,
} from '../domain/types';

interface NativeFileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_symlink?: boolean;
  extension?: string | null;
  is_gitignored?: boolean;
}

interface NativeImagePreview {
  data_url: string;
  mime_type: string;
  byte_length: number;
}

interface NativeFileSearchResult {
  path: string;
  name: string;
  dir: string;
  extension: string | null;
}

const READ_ONLY: WorkspaceFileCapabilities = {
  list: true, read: true, write: false, create: false, delete: false,
  rename: false, search: true, watch: false, nativePreview: true,
};
const READ_WRITE: WorkspaceFileCapabilities = {
  ...READ_ONLY, write: true, create: true, delete: true, watch: true,
};
const TERMINAL_STRICT: WorkspaceFileCapabilities = {
  ...READ_ONLY, search: false,
};

function assertLocalScope(scope: WorkspaceFileScope): void {
  if (scope.hostId !== 'local') throw new Error(`Local file adapter cannot serve host ${scope.hostId}`);
  if (!scope.rootPath) throw new Error('Workspace file scope requires a root path');
  if (!Number.isFinite(scope.hostRevision) || !Number.isFinite(scope.rootRevision)) {
    throw new Error('Workspace file scope requires finite owner revisions');
  }
}

function assertWritable(scope: WorkspaceFileScope): void {
  assertLocalScope(scope);
  if (scope.policy !== 'workspace') throw new Error(`File policy ${scope.policy} is read-only`);
}

export const localWorkspaceFiles: WorkspaceFilesAdapter = {
  capabilities(scope) {
    if (scope.policy === 'workspace') return READ_WRITE;
    if (scope.policy === 'terminal-strict') return TERMINAL_STRICT;
    return READ_ONLY;
  },

  async listDirectory(scope, path): Promise<WorkspaceFileEntry[]> {
    assertLocalScope(scope);
    const command = scope.policy === 'terminal-strict'
      ? 'read_terminal_workspace_dir_entries'
      : 'read_dir_entries';
    const entries = await invoke<NativeFileEntry[]>(command, { path, projectPath: scope.rootPath });
    return entries.map((entry) => ({
      name: entry.name,
      path: entry.path,
      isDirectory: entry.is_dir,
      isSymlink: entry.is_symlink === true,
      extension: entry.extension ?? null,
      gitIgnored: entry.is_gitignored === true,
    }));
  },

  async readText(scope, path): Promise<WorkspaceTextSnapshot> {
    assertLocalScope(scope);
    const content = await invoke<string>('read_file_content', { path, projectPath: scope.rootPath });
    return { content, revision: null, truncated: false };
  },

  async readImagePreview(scope, path): Promise<WorkspaceImagePreview> {
    assertLocalScope(scope);
    const preview = await invoke<NativeImagePreview>('read_image_preview', { path, projectPath: scope.rootPath });
    return { dataUrl: preview.data_url, mimeType: preview.mime_type, byteLength: preview.byte_length };
  },

  async writeText(scope, path, content): Promise<void> {
    assertWritable(scope);
    await invoke('write_file_content', { path, content, projectPath: scope.rootPath });
  },

  async createFile(scope, path): Promise<void> {
    assertWritable(scope);
    await invoke('create_file', { path, projectPath: scope.rootPath });
  },

  async createDirectory(scope, path): Promise<void> {
    assertWritable(scope);
    await invoke('create_directory', { path, projectPath: scope.rootPath });
  },

  async delete(scope, path): Promise<void> {
    assertWritable(scope);
    await invoke('delete_path', { path, projectPath: scope.rootPath });
  },

  async search(scope, request: WorkspaceFileSearchRequest): Promise<WorkspaceFileSearchResult> {
    assertLocalScope(scope);
    if (scope.policy === 'terminal-strict') throw new Error('Terminal-strict file scopes do not expose project search');
    const maxResults = Math.min(2_000, Math.max(1, request.maxResults ?? 200));
    const matches = await invoke<NativeFileSearchResult[]>('search_project_files', {
      projectPath: scope.rootPath,
      query: request.query,
      extensions: [],
      limit: maxResults,
    });
    return { paths: matches.map((match) => match.path), truncated: matches.length >= maxResults };
  },
};
