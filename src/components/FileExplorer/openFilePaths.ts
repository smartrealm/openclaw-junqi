import type { OpenFileTab } from "./FileViewer";

function separatorFor(path: string): "/" | "\\" {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}
export function pathIsTargetOrDescendant(path: string, targetPath: string, isDirectory: boolean): boolean {
  if (path === targetPath) return true;
  if (!isDirectory) return false;
  return path.startsWith(`${targetPath}${separatorFor(targetPath)}`);
}

export function rebaseOpenFilePath(
  path: string,
  oldPath: string,
  newPath: string,
  isDirectory: boolean,
): string {
  if (path === oldPath) return newPath;
  if (!isDirectory) return path;
  const prefix = `${oldPath}${separatorFor(oldPath)}`;
  return path.startsWith(prefix) ? `${newPath}${path.slice(oldPath.length)}` : path;
}

export function rebaseOpenFileTabs(
  tabs: OpenFileTab[],
  oldPath: string,
  newPath: string,
  isDirectory: boolean,
): OpenFileTab[] {
  return tabs.map((tab) => {
    const path = rebaseOpenFilePath(tab.path, oldPath, newPath, isDirectory);
    if (path === tab.path) return tab;
    const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    return { ...tab, path, name: path.slice(separatorIndex + 1) };
  });
}

export function removeOpenFileTabs(
  tabs: OpenFileTab[],
  targetPath: string,
  isDirectory: boolean,
): OpenFileTab[] {
  return tabs.filter((tab) => !pathIsTargetOrDescendant(tab.path, targetPath, isDirectory));
}
