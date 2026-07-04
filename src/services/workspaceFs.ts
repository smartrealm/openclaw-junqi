/**
 * Thin invoke() wrappers around the existing Rust `fs_neu` commands, scoped for
 * the agent workspace file panel. Every call passes a `projectPath` root that
 * the Rust side uses as a security boundary (`validate_path_within`), so the
 * panel can never read/write outside the agent's workspace.
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
