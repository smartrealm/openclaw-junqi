import {
  createManagedFilePreviewUrl,
  managedFileExists,
  openManagedFile,
  readManagedOfficePreview,
  readManagedFileText,
  revealManagedFile,
} from '@/api/tauri-commands';

export interface ManagedFileTextRead {
  success: boolean;
  content?: string | null;
  byteSize?: number;
  truncated?: boolean;
  error?: string | null;
}

export interface ManagedFilePreviewUrl {
  success: boolean;
  url?: string | null;
  error?: string | null;
}

export interface ManagedOfficePreview {
  success: boolean;
  format?: 'spreadsheet' | 'presentation' | 'document' | null;
  content?: string | null;
  truncated?: boolean;
  error?: string | null;
}

export async function openLocalManagedFile(path: string): Promise<boolean> {
  const result = await openManagedFile(path);
  return result.success;
}

export async function revealLocalManagedFile(path: string): Promise<boolean> {
  const result = await revealManagedFile(path);
  return result.success;
}

export async function localManagedFileExists(path: string): Promise<boolean> {
  const result = await managedFileExists(path);
  return result.success && result.exists;
}

export async function readLocalManagedFileText(path: string): Promise<ManagedFileTextRead> {
  const result = await readManagedFileText(path);
  return {
    success: result.success,
    content: result.content,
    byteSize: result.byte_size,
    truncated: result.truncated,
    error: result.error,
  };
}

export async function readLocalManagedOfficePreview(path: string, workspaceRoot: string): Promise<ManagedOfficePreview> {
  return readManagedOfficePreview(path, workspaceRoot);
}

export async function createLocalManagedFilePreviewUrl(path: string): Promise<ManagedFilePreviewUrl> {
  return createManagedFilePreviewUrl(path);
}
