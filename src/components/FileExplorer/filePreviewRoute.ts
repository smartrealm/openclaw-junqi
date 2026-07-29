import { pathIsTargetOrDescendant } from './openFilePaths';
import type { OpenFileTab } from './FileViewer';

export interface FilePreviewRouteSelection {
  treeRequested: boolean;
  projectPath: string | null;
  file: OpenFileTab | null;
}

function fileName(path: string): string {
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return path.slice(separator + 1);
}

export function parseFilePreviewRoute(searchParams: URLSearchParams): FilePreviewRouteSelection {
  const projectPath = searchParams.get('path')?.trim() || null;
  const requestedFile = searchParams.get('file')?.trim() || null;
  const treeRequested = searchParams.get('view') === 'tree' || Boolean(projectPath || requestedFile);
  const file = projectPath
    && requestedFile
    && requestedFile !== projectPath
    && pathIsTargetOrDescendant(requestedFile, projectPath, true)
      ? { path: requestedFile, name: fileName(requestedFile) }
      : null;
  return { treeRequested, projectPath, file };
}

export function createFilePreviewRoute(projectPath: string, filePath: string): string {
  const searchParams = new URLSearchParams({
    view: 'tree',
    path: projectPath,
    file: filePath,
  });
  return `/files?${searchParams.toString()}`;
}
