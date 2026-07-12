import type { Workspace } from './types';

function normalizeWorkspacePath(path: string): string {
  let normalized = path.replace(/\\/g, '/');

  if (/^\/\/\?\/unc\//i.test(normalized)) {
    normalized = `//${normalized.slice(8)}`;
  } else if (/^\/\/\?\//i.test(normalized)) {
    normalized = normalized.slice(4);
  }

  const isWindowsPath = /^[a-z]:\//i.test(normalized) || /^\/\/[^/]/.test(normalized);
  const isRoot = normalized === '/' || /^[a-z]:\/$/i.test(normalized);
  if (!isRoot) normalized = normalized.replace(/\/+$/, '');

  return isWindowsPath ? normalized.toLocaleLowerCase('en-US') : normalized;
}

export function workspacePathsEqual(left: string, right: string): boolean {
  if (!left || !right) return false;
  return normalizeWorkspacePath(left) === normalizeWorkspacePath(right);
}

export function findWorkspaceForDirectory(
  workspaces: Workspace[],
  directory: string,
): Workspace | undefined {
  return workspaces.find((workspace) => workspacePathsEqual(
    workspace.projectDirectory || workspace.workingDirectory,
    directory,
  ));
}

function isInvalidWorkspacePathError(error: unknown): boolean {
  const message = String(error).toLocaleLowerCase();
  return message.includes('does not exist')
    || message.includes('not a directory')
    || message.includes('is empty');
}

export async function migrateLegacyProjectPaths(
  paths: string[],
  record: (path: string) => Promise<void>,
): Promise<string[]> {
  const replayPaths: string[] = [];
  let hasTransientFailure = false;
  // The backend inserts at the front, so migrate oldest to newest.
  for (const path of [...paths].reverse()) {
    try {
      await record(path);
      replayPaths.push(path);
    } catch (error) {
      if (!isInvalidWorkspacePathError(error)) {
        hasTransientFailure = true;
        replayPaths.push(path);
      }
    }
  }
  return hasTransientFailure ? replayPaths.reverse() : [];
}
