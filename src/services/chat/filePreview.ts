export type FilePreviewKind = 'html' | 'image' | 'markdown' | 'text';
export type LocalBinaryPreviewKind = 'image' | 'audio' | 'video' | 'pdf';

export type LocalFilePreview =
  | {
      kind: 'html';
      mode: 'interactive';
      url: string;
    }
  | {
      kind: 'html';
      mode: 'static';
      content: string;
      truncated: boolean;
    }
  | {
      kind: 'image';
      url: string;
    }
  | {
      kind: 'markdown' | 'text';
      content: string;
      truncated: boolean;
    };

export interface LocalBinaryPreview {
  kind: LocalBinaryPreviewKind;
  url: string;
}

export interface ManagedTextReadResult {
  success: boolean;
  content?: string | null;
  byteSize?: number;
  truncated?: boolean;
  error?: string | null;
}

export interface ManagedPreviewUrlResult {
  success: boolean;
  url?: string | null;
  error?: string | null;
}

export interface LocalFilePreviewBridge {
  managedFiles?: {
    read?: (path: string) => Promise<ManagedTextReadResult>;
    createPreview?: (path: string) => Promise<ManagedPreviewUrlResult>;
  };
  file?: {
    read?: (path: string) => Promise<{
      base64: string;
    } | null>;
  };
}

const HTML_EXTENSIONS = new Set(['html', 'htm']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'tif', 'tiff']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'webm']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v']);
const PDF_EXTENSIONS = new Set(['pdf']);
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdown']);
const TEXT_EXTENSIONS = new Set([
  'txt', 'text', 'log', 'json', 'jsonc', 'csv', 'xml', 'yml', 'yaml', 'toml',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp',
  'h', 'hpp', 'css', 'scss', 'sh', 'bash', 'zsh', 'sql',
]);

export class FilePreviewError extends Error {
  constructor(readonly code: 'unsupported' | 'unavailable') {
    super(code === 'unsupported' ? 'This file type cannot be previewed inline' : 'The file could not be read for preview');
    this.name = 'FilePreviewError';
  }
}

export function getFilePreviewKind(fileName: string): FilePreviewKind | null {
  const extension = fileName.split('.').pop()?.trim().toLowerCase() ?? '';
  if (HTML_EXTENSIONS.has(extension)) return 'html';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (MARKDOWN_EXTENSIONS.has(extension)) return 'markdown';
  if (TEXT_EXTENSIONS.has(extension)) return 'text';
  return null;
}

export function getLocalBinaryPreviewKind(fileName: string): LocalBinaryPreviewKind | null {
  const extension = fileName.split('.').pop()?.trim().toLowerCase() ?? '';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (PDF_EXTENSIONS.has(extension)) return 'pdf';
  return null;
}

export function decodeBase64Utf8(base64: string): string {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function normalizePreviewPath(rawPath: string): string {
  if (!rawPath.startsWith('file://')) return rawPath;
  try {
    const url = new URL(rawPath);
    const decoded = decodeURIComponent(url.pathname);
    return /^\/[A-Za-z]:\//.test(decoded) ? decoded.slice(1) : decoded;
  } catch {
    return rawPath.replace(/^file:\/\/+/, '');
  }
}

export async function readLocalTextPreview(
  rawPath: string,
  bridge: LocalFilePreviewBridge = window.aegis ?? {},
): Promise<{ content: string; truncated: boolean; byteSize: number }> {
  const path = normalizePreviewPath(rawPath);
  const managedReader = bridge.managedFiles?.read;
  if (managedReader) {
    try {
      const result = await managedReader(path);
      if (result.success && typeof result.content === 'string') {
        return {
          content: result.content,
          truncated: result.truncated === true,
          byteSize: result.byteSize ?? 0,
        };
      }
    } catch {
      // Fall through to the legacy raw reader for browser-only development.
    }
  }

  const rawReader = bridge.file?.read;
  if (rawReader) {
    try {
      const result = await rawReader(path);
      if (result?.base64) {
        return {
          content: decodeBase64Utf8(result.base64),
          truncated: false,
          byteSize: 0,
        };
      }
    } catch {
      // The caller receives one stable, localizable error below.
    }
  }

  throw new FilePreviewError('unavailable');
}

async function createNativePreviewUrl(
  rawPath: string,
  bridge: LocalFilePreviewBridge,
): Promise<string | null> {
  const createPreview = bridge.managedFiles?.createPreview;
  if (!createPreview) return null;
  try {
    const result = await createPreview(normalizePreviewPath(rawPath));
    return result.success && typeof result.url === 'string' && result.url.length > 0
      ? result.url
      : null;
  } catch {
    return null;
  }
}

/** Loads binary media through the native scoped preview protocol, never by raw file read. */
export async function loadLocalBinaryPreview(
  rawPath: string,
  fileName: string,
  bridge: LocalFilePreviewBridge = window.aegis ?? {},
): Promise<LocalBinaryPreview> {
  const kind = getLocalBinaryPreviewKind(fileName);
  if (!kind) throw new FilePreviewError('unsupported');
  const url = await createNativePreviewUrl(rawPath, bridge);
  if (!url) throw new FilePreviewError('unavailable');
  return { kind, url };
}

export async function loadLocalFilePreview(
  rawPath: string,
  fileName: string,
  bridge: LocalFilePreviewBridge = window.aegis ?? {},
): Promise<LocalFilePreview> {
  const kind = getFilePreviewKind(fileName);
  if (!kind) throw new FilePreviewError('unsupported');

  if (kind === 'html' || kind === 'image') {
    const url = await createNativePreviewUrl(rawPath, bridge);
    if (url) {
      return kind === 'html'
        ? { kind: 'html', mode: 'interactive', url }
        : { kind: 'image', url };
    }
    if (kind === 'image') throw new FilePreviewError('unavailable');
  }

  const text = await readLocalTextPreview(rawPath, bridge);
  if (kind === 'html') {
    return { kind: 'html', mode: 'static', ...text };
  }
  return { kind, ...text };
}
