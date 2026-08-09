/**
 * 共享 Rust `fs_neu` command 的桌面调用适配器。每次调用都传入 `projectPath`，
 * 由 Rust 将其作为安全边界；终端浏览使用拒绝外部符号链接的更严格 command。
 * 字段名与 Rust 结构保持一致。
 */
import { invoke } from '@tauri-apps/api/core';
import { isImageFile } from '@/workspace-files/domain/fileKinds';
import { localWorkspaceFiles } from '@/workspace-files/adapters/localWorkspaceFiles';
import type { WorkspaceFileScope } from '@/workspace-files/domain/types';
import {
  decodeWorkspaceFilePreview,
  type WorkspaceFilePreview,
} from '@/utils/filePreviewCapabilities';

export interface FsEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_symlink?: boolean;
  extension?: string | null;
  is_gitignored?: boolean;
}

export interface ImagePreview {
  data_url: string;
  mime_type: string;
  byte_length: number;
}

export interface TerminalGitFileDiff {
  path: string;
  relative_path: string;
  insertions: number;
  deletions: number;
}

export interface TerminalGitFileDiffResponse {
  root: string;
  repository_root: string | null;
  files: TerminalGitFileDiff[];
}

/** List a directory (sorted dirs-first by the Rust side, IGNORED_DIRS filtered). */
export function readDir(path: string, root: string): Promise<FsEntry[]> {
  return invoke('read_dir_entries', { path, projectPath: root });
}

/** Read terminal sidebar entries without following symlinks outside the workspace. */
export function readTerminalWorkspaceDir(path: string, root: string): Promise<FsEntry[]> {
  return invoke('read_terminal_workspace_dir_entries', { path, projectPath: root });
}

/** Open a workspace file using the operating system's default application. */
export function openWithSystemDefault(path: string, root: string): Promise<void> {
  return invoke('open_path_with_system_default', { path, projectPath: root });
}

/** Reveal a workspace entry in Finder / Explorer / the desktop file manager. */
export function revealInSystemFileManager(path: string, root: string): Promise<void> {
  return invoke('open_in_system_file_manager', { path, projectPath: root });
}

/** Reveal a terminal workspace entry without following external symlinks. */
export function revealTerminalWorkspacePath(path: string, root: string): Promise<void> {
  return invoke('reveal_terminal_workspace_path', { path, projectPath: root });
}

/** Format a workspace entry as safe input for the user's configured shell. */
export function terminalPathInput(path: string, root: string): Promise<string> {
  return invoke('terminal_escape_project_path', { path, projectPath: root });
}

/** Read per-file line counts relative to Git HEAD for terminal tree badges. */
export function readTerminalGitFileDiff(root: string): Promise<TerminalGitFileDiffResponse> {
  return invoke('git_file_diff_stats', { projectPath: root });
}

/** Native watches are active only while the terminal file tree is visible. */
export function setTerminalWorkspaceWatches(watchId: string, generation: number, root: string, paths: string[]): Promise<void> {
  return invoke('set_terminal_workspace_watches', { watchId, generation, projectPath: root, paths });
}

export function clearTerminalWorkspaceWatches(watchId: string, generation: number): Promise<void> {
  return invoke('clear_terminal_workspace_watches', { watchId, generation });
}

/** Read and classify a workspace file without treating unknown binary data as text. */
export async function readFilePreview(path: string, root: string): Promise<WorkspaceFilePreview> {
  return decodeWorkspaceFilePreview(await invoke('read_file_preview', { path, projectPath: root }));
}

function legacyLocalScope(root: string): WorkspaceFileScope {
  return {
    hostId: 'local',
    hostRevision: 0,
    workspaceId: root,
    rootPath: root,
    rootRevision: 0,
    policy: 'workspace',
  };
}

/** Compatibility facade; new consumers should use WorkspaceFilesAdapter directly. */
export async function readFileText(path: string, root: string): Promise<string> {
  return (await localWorkspaceFiles.readText(legacyLocalScope(root), path)).content;
}

/** Compatibility facade; new consumers should use WorkspaceFilesAdapter directly. */
export function writeFileText(path: string, content: string, root: string): Promise<void> {
  return localWorkspaceFiles.writeText(legacyLocalScope(root), path, content);
}

/** Compatibility facade; new consumers should use WorkspaceFilesAdapter directly. */
export async function readImagePreview(path: string, root: string): Promise<ImagePreview> {
  const preview = await localWorkspaceFiles.readImagePreview(legacyLocalScope(root), path);
  return { data_url: preview.dataUrl, mime_type: preview.mimeType, byte_length: preview.byteLength };
}

/** Resolve the current runtime workspace natively, including the active
 *  `agents.defaults.workspace` override and the configured storage layout. */
export function getWorkspacePath(): Promise<string> {
  return invoke('get_workspace_path');
}

export function isImageExt(ext?: string | null): boolean {
  return !!ext && isImageFile(`preview.${ext}`);
}
