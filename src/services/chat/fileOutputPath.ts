import type { FileRef } from '@/types/RenderBlock';

function isLocalFilePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('file://');
}

function normalizeLocalPath(value: string): string {
  if (!value.startsWith('file://')) return value.replace(/\\/g, '/');
  try {
    const url = new URL(value);
    const decoded = decodeURIComponent(url.pathname);
    return (/^\/[A-Za-z]:\//.test(decoded) ? decoded.slice(1) : decoded).replace(/\\/g, '/');
  } catch {
    return '';
  }
}

export function cleanOutputFilePath(value: string): string {
  return value
    .trim()
    .replace(/^`+|`+$/g, '')
    .replace(/^["']+|["']+$/g, '')
    .replace(/^<+|>+$/g, '')
    .replace(/[，。；;:：]+$/g, '')
    .trim()
    .replace(/\/+$/, '');
}

function joinWithinWorkspace(root: string, relativePath: string): string | null {
  const normalizedRoot = normalizeLocalPath(cleanOutputFilePath(root)).replace(/[\\/]+$/, '');
  if (!isLocalFilePath(normalizedRoot)) return null;

  const safeSegments: string[] = [];
  for (const segment of relativePath.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') return null;
    safeSegments.push(segment);
  }
  return safeSegments.length > 0 ? `${normalizedRoot}/${safeSegments.join('/')}` : null;
}

function isWithinWorkspace(candidate: string, workspaceRoot: string): boolean {
  const normalizedRoot = normalizeLocalPath(cleanOutputFilePath(workspaceRoot)).replace(/[\\/]+$/, '');
  const normalizedCandidate = normalizeLocalPath(candidate).replace(/[\\/]+$/, '');
  if (!normalizedRoot || !normalizedCandidate) return false;
  const caseInsensitive = /^[A-Za-z]:\//.test(normalizedRoot);
  const root = caseInsensitive ? normalizedRoot.toLowerCase() : normalizedRoot;
  const path = caseInsensitive ? normalizedCandidate.toLowerCase() : normalizedCandidate;
  return path === root || path.startsWith(`${root}/`);
}

export function resolveOutputFilePath(file: FileRef, workspaceRoot?: string): string | null {
  if (!workspaceRoot || !isLocalFilePath(cleanOutputFilePath(workspaceRoot))) return null;
  const directPath = cleanOutputFilePath(file.path || '');
  if (isLocalFilePath(directPath)) {
    const normalized = normalizeLocalPath(directPath);
    return isWithinWorkspace(normalized, workspaceRoot) ? normalized : null;
  }

  const relativePath = cleanOutputFilePath(file.relativePath || directPath);
  if (!relativePath || isLocalFilePath(relativePath)) return null;
  return joinWithinWorkspace(workspaceRoot, relativePath);
}
