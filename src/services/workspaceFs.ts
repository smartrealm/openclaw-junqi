/**
 * Thin invoke() wrappers around shared Rust `fs_neu` commands. Every call
 * passes a `projectPath` root that the Rust side uses as a security boundary.
 * Terminal browsing uses stricter commands that reject external symlinks.
 *
 * Field names mirror the Rust structs (serde default = snake_case).
 */
import { invoke } from '@tauri-apps/api/core';

export interface FsEntry {
  name: string;
  path: string;
  is_dir: boolean;
  extension?: string | null;
  is_gitignored?: boolean;
}

export interface ImagePreview {
  data_url: string;
  mime_type: string;
  byte_length: number;
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

/** Read a text file's content. Throws for binary/oversized files (Rust guards). */
export function readFileText(path: string, root: string): Promise<string> {
  return invoke('read_file_content', { path, projectPath: root });
}

/** Overwrite a text file. */
export function writeFileText(path: string, content: string, root: string): Promise<void> {
  return invoke('write_file_content', { path, content, projectPath: root });
}

/** Read an image as a data URL for inline preview. */
export function readImagePreview(path: string, root: string): Promise<ImagePreview> {
  return invoke('read_image_preview', { path, projectPath: root });
}

/** The default runtime workspace path (~/.openclaw/workspace), used as fallback
 *  when the active agent has no explicit `workspace` configured. */
export function getWorkspacePath(): Promise<string> {
  return invoke('get_workspace_path');
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'tiff']);

export function isImageExt(ext?: string | null): boolean {
  return !!ext && IMAGE_EXTS.has(ext.toLowerCase());
}
