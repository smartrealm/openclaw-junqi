import type { ManagedFilePreview } from '@/utils/filePreviewCapabilities';
import { isJsonFileName } from '@/utils/jsonPreview';
import { resolveWorkspacePreview } from '@/workspace-files/services/previewResolver';
import {
  createLocalManagedFilePreviewUrl,
  readLocalManagedOfficePreview,
  readLocalManagedFileText,
} from './managedFileRuntime';

export type FilePreviewKind = ManagedFilePreview['kind'] | 'office';
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
    readOfficePreview?: (path: string, workspaceRoot: string) => Promise<{
      success: boolean;
      format?: 'spreadsheet' | 'presentation' | 'document' | null;
      content?: string | null;
      truncated?: boolean;
    }>;
  };
  file?: {
    read?: (path: string) => Promise<{
      base64: string;
    } | null>;
  };
}

const nativePreviewBridge: LocalFilePreviewBridge = {
  managedFiles: {
    read: readLocalManagedFileText,
    createPreview: createLocalManagedFilePreviewUrl,
    readOfficePreview: readLocalManagedOfficePreview,
  },
};

const MANAGED_PREVIEW_CAPABILITIES = {
  read: true,
  write: false,
  nativePreview: true,
} as const;

export class FilePreviewError extends Error {
  constructor(readonly code: 'unsupported' | 'unavailable') {
    super(code === 'unsupported' ? 'This file type cannot be previewed inline' : 'The file could not be read for preview');
    this.name = 'FilePreviewError';
  }
}

export function getFilePreviewKind(fileName: string): FilePreviewKind | null {
  if (/\.(?:xlsx|pptx|docx)$/i.test(fileName)) return 'office';
  if (isJsonFileName(fileName)) return 'json';
  const resolution = resolveWorkspacePreview({
    path: fileName,
    policy: 'managed-readonly',
    capabilities: MANAGED_PREVIEW_CAPABILITIES,
    interactiveHtml: true,
  });
  if (resolution.mode === 'editor') return 'text';
  if (resolution.mode === 'markdown') return 'markdown';
  if (resolution.mode === 'isolated-html' || resolution.mode === 'static-html') return 'html';
  if (resolution.mode === 'scoped-pdf') return 'pdf';
  if (
    resolution.mode === 'scoped-media'
    && (resolution.kind === 'image' || resolution.kind === 'audio' || resolution.kind === 'video')
  ) {
    return resolution.kind;
  }
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
  bridge: LocalFilePreviewBridge = nativePreviewBridge,
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
  workspaceRoot: string | undefined,
  bridge: LocalFilePreviewBridge = nativePreviewBridge,
): Promise<LocalFilePreview> {
  const kind = getFilePreviewKind(fileName);
  if (!kind) throw new FilePreviewError('unsupported');

  if (kind === 'office') {
    if (!workspaceRoot) throw new FilePreviewError('unavailable');
    const result = await bridge.managedFiles?.readOfficePreview?.(normalizePreviewPath(rawPath), workspaceRoot);
    if (!result?.success || !result.content || !result.format) throw new FilePreviewError('unavailable');
    return {
      kind: 'text',
      content: result.content,
      truncated: result.truncated === true,
    };
  }

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
  bridge: LocalFilePreviewBridge = nativePreviewBridge,
): Promise<string | null> {
  const resolved = resolveLocalFileReference(reference, ownerPath, allowedRoot);
  return resolved ? createNativePreviewUrl(resolved, bridge) : null;
}
