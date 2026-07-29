import {
  isMarkdownFile,
  type ManagedFilePreview,
} from '@/utils/filePreviewCapabilities';

export type FilePreviewKind = ManagedFilePreview['kind'];
export type LocalFilePreview = ManagedFilePreview;

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
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v']);
const PDF_EXTENSIONS = new Set(['pdf']);
const TEXT_EXTENSIONS = new Set([
  'txt', 'text', 'log', 'json', 'jsonc', 'csv', 'tsv', 'xml', 'yml', 'yaml', 'toml',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp',
  'h', 'hpp', 'css', 'scss', 'sass', 'less', 'sh', 'bash', 'zsh', 'fish', 'sql',
  'ini', 'conf', 'config', 'properties', 'env', 'editorconfig', 'gitignore',
  'rb', 'php', 'swift', 'kt', 'kts', 'scala', 'lua', 'r', 'dart', 'ex', 'exs',
  'vue', 'svelte', 'astro', 'graphql', 'gql', 'proto', 'gradle', 'mmd', 'mermaid',
  'ipynb',
]);
const TEXT_FILE_NAMES = new Set([
  'dockerfile', 'makefile', 'gnumakefile', 'bsdmakefile', 'justfile',
  'license', 'readme', 'changelog', 'authors', 'contributors',
]);

export class FilePreviewError extends Error {
  constructor(readonly code: 'unsupported' | 'unavailable') {
    super(code === 'unsupported' ? 'This file type cannot be previewed inline' : 'The file could not be read for preview');
    this.name = 'FilePreviewError';
  }
}

export function getFilePreviewKind(fileName: string): FilePreviewKind | null {
  const baseName = fileName.replace(/^.*[\\/]/, '').trim().toLowerCase();
  const extension = baseName.includes('.') ? baseName.split('.').pop() ?? '' : '';
  if (HTML_EXTENSIONS.has(extension)) return 'html';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (PDF_EXTENSIONS.has(extension)) return 'pdf';
  if (isMarkdownFile(baseName)) return 'markdown';
  if (
    TEXT_EXTENSIONS.has(extension)
    || TEXT_FILE_NAMES.has(baseName)
    || baseName.startsWith('dockerfile.')
    || baseName.startsWith('makefile.')
    || baseName.startsWith('.env.')
  ) return 'text';
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

export async function loadLocalFilePreview(
  rawPath: string,
  fileName: string,
  bridge: LocalFilePreviewBridge = window.aegis ?? {},
): Promise<LocalFilePreview> {
  const kind = getFilePreviewKind(fileName);
  if (!kind) throw new FilePreviewError('unsupported');

  if (kind === 'html' || kind === 'image' || kind === 'audio' || kind === 'video' || kind === 'pdf') {
    const url = await createNativePreviewUrl(rawPath, bridge);
    if (url) {
      return kind === 'html'
        ? { kind: 'html', mode: 'interactive', url }
        : { kind, url };
    }
    if (kind !== 'html') throw new FilePreviewError('unavailable');
  }

  const text = await readLocalTextPreview(rawPath, bridge);
  if (kind === 'html') {
    return { kind: 'html', mode: 'static', ...text };
  }
  return { kind, ...text };
}

function normalizedDirectory(path: string): string {
  const normalized = normalizePreviewPath(path).replace(/\\/g, '/').replace(/\/+$/, '');
  const slash = normalized.lastIndexOf('/');
  return slash <= 0 ? normalized.slice(0, slash + 1) : normalized.slice(0, slash);
}

function pathIsInside(candidate: string, root: string): boolean {
  const normalizedCandidate = candidate.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const caseInsensitive = /^[A-Za-z]:/.test(normalizedRoot);
  const comparableCandidate = caseInsensitive ? normalizedCandidate.toLowerCase() : normalizedCandidate;
  const comparableRoot = caseInsensitive ? normalizedRoot.toLowerCase() : normalizedRoot;
  return comparableCandidate === comparableRoot || comparableCandidate.startsWith(`${comparableRoot}/`);
}

export function resolveLocalFileReference(
  reference: string,
  ownerPath: string,
  allowedRoot = normalizedDirectory(ownerPath),
): string | null {
  const value = reference.trim();
  if (!value || value.startsWith('#') || /^(?:https?:|data:|mailto:)/i.test(value)) return null;
  const absoluteReference = value.startsWith('file://')
    ? normalizePreviewPath(value)
    : value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)
      ? value
      : null;
  if (absoluteReference) {
    return pathIsInside(absoluteReference, allowedRoot) ? absoluteReference : null;
  }

  const normalizedOwner = normalizePreviewPath(ownerPath).replace(/\\/g, '/');
  const drive = normalizedOwner.match(/^[A-Za-z]:/)?.[0] ?? '';
  const absolute = normalizedOwner.startsWith('/') || Boolean(drive);
  const ownerSegments = normalizedOwner.split('/');
  ownerSegments.pop();
  const floor = drive ? 1 : absolute ? 1 : 0;
  for (const segment of value.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (ownerSegments.length > floor) ownerSegments.pop();
      continue;
    }
    ownerSegments.push(segment);
  }
  const resolved = ownerSegments.join('/') || (absolute ? '/' : null);
  return resolved && pathIsInside(resolved, allowedRoot) ? resolved : null;
}

export async function loadLocalMarkdownImage(
  reference: string,
  ownerPath: string,
  allowedRoot?: string,
  bridge: LocalFilePreviewBridge = window.aegis ?? {},
): Promise<string | null> {
  const resolved = resolveLocalFileReference(reference, ownerPath, allowedRoot);
  return resolved ? createNativePreviewUrl(resolved, bridge) : null;
}
