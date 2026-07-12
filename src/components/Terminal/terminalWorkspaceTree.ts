export interface TerminalGitFileDiff {
  path: string;
  insertions: number;
  deletions: number;
}

export interface TerminalGitDiffCounts {
  insertions: number;
  deletions: number;
}

export interface TerminalGitDiffIndex {
  files: ReadonlyMap<string, TerminalGitDiffCounts>;
  directories: ReadonlyMap<string, TerminalGitDiffCounts>;
}

export const TERMINAL_SIDEBAR_MIN_WIDTH = 220;
export const TERMINAL_SIDEBAR_MAX_WIDTH = 480;

export type TerminalSidebarMode = 'full' | 'compact' | 'hidden';

export function nextTerminalSidebarMode(mode: TerminalSidebarMode): TerminalSidebarMode {
  if (mode === 'full') return 'compact';
  if (mode === 'compact') return 'hidden';
  return 'full';
}

export function clampTerminalSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return TERMINAL_SIDEBAR_MIN_WIDTH;
  return Math.round(Math.min(TERMINAL_SIDEBAR_MAX_WIDTH, Math.max(TERMINAL_SIDEBAR_MIN_WIDTH, value)));
}

export function resizeTerminalSidebarWidth(
  startWidth: number,
  horizontalDelta: number,
  direction: 'ltr' | 'rtl',
): number {
  const inlineDelta = direction === 'rtl' ? -horizontalDelta : horizontalDelta;
  return clampTerminalSidebarWidth(startWidth + inlineDelta);
}

export function terminalWorkspacePathKey(value: string): string {
  let normalized = value.replace(/\\/g, '/');
  if (/^\/\/\?\/unc\//i.test(normalized)) {
    normalized = `//${normalized.slice(8)}`;
  } else if (normalized.startsWith('//?/')) {
    normalized = normalized.slice(4);
  }
  while (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  if (/^[A-Za-z]:/.test(normalized) || normalized.startsWith('//')) {
    normalized = normalized.toLocaleLowerCase('en-US');
  }
  return normalized;
}

function parentPath(value: string): string {
  const lastSlash = value.lastIndexOf('/');
  if (lastSlash < 0) return '';
  if (lastSlash === 0) return '/';
  return value.slice(0, lastSlash);
}

function safeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

export function buildTerminalGitDiffIndex(
  root: string,
  diffs: readonly TerminalGitFileDiff[],
): TerminalGitDiffIndex {
  const rootKey = terminalWorkspacePathKey(root);
  const files = new Map<string, TerminalGitDiffCounts>();
  const directories = new Map<string, TerminalGitDiffCounts>();
  const rootPrefix = rootKey === '/' ? '/' : `${rootKey}/`;

  for (const diff of diffs) {
    const path = terminalWorkspacePathKey(diff.path);
    if (!path || path === rootKey || !path.startsWith(rootPrefix)) continue;
    files.set(path, {
      insertions: safeCount(diff.insertions),
      deletions: safeCount(diff.deletions),
    });
  }

  for (const [path, counts] of files) {
    let directory = parentPath(path);
    while (directory && directory !== rootKey && directory.startsWith(rootPrefix)) {
      const previous = directories.get(directory) ?? { insertions: 0, deletions: 0 };
      directories.set(directory, {
        insertions: previous.insertions + counts.insertions,
        deletions: previous.deletions + counts.deletions,
      });
      const parent = parentPath(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }

  return { files, directories };
}
