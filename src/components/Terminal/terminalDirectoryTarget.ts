export function terminalDirectoryKey(path: string, caseInsensitive = false): string {
  const normalized = path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

export function findShellIdForDirectory(
  shells: Array<{ id: string; cwd?: string }>,
  directory: string,
  caseInsensitive = false,
): string | null {
  const target = terminalDirectoryKey(directory, caseInsensitive);
  return shells.find((shell) => (
    shell.cwd && terminalDirectoryKey(shell.cwd, caseInsensitive) === target
  ))?.id ?? null;
}
