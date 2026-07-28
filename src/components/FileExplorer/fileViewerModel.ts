export type FileViewMode = "source" | "preview";

function normalizeSeparators(path: string): string {
  return path.replace(/\\/g, "/");
}

function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

function comparablePath(path: string, windows: boolean): string {
  const normalized = normalizeSeparators(path).replace(/\/+$/, "");
  return windows ? normalized.toLocaleLowerCase("en-US") : normalized;
}

export function workspaceRelativePath(path: string, projectPath: string): string {
  const windows = isWindowsPath(path) || isWindowsPath(projectPath);
  const normalizedPath = normalizeSeparators(path);
  const normalizedRoot = normalizeSeparators(projectPath).replace(/\/+$/, "");
  const comparableFile = comparablePath(normalizedPath, windows);
  const comparableRoot = comparablePath(normalizedRoot, windows);

  if (comparableFile === comparableRoot) return normalizedPath.split("/").pop() ?? path;
  if (comparableFile.startsWith(`${comparableRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }
  return path;
}

export function resolveMarkdownResourcePath(
  source: string,
  filePath: string,
  projectPath: string,
): string | null {
  const raw = source.trim().split(/[?#]/, 1)[0];
  if (!raw || raw.startsWith("#") || /^[a-z][a-z\d+.-]*:/i.test(raw) || raw.startsWith("//")) {
    return null;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }

  const separator = filePath.includes("\\") && !filePath.includes("/") ? "\\" : "/";
  const normalize = (value: string) => value.replace(/[\\/]+/g, separator);
  const root = normalize(projectPath).replace(/[\\/]+$/, "");
  const file = normalize(filePath);
  const lastSeparator = file.lastIndexOf(separator);
  const base = lastSeparator === -1 ? root : file.slice(0, lastSeparator);
  const rooted = decoded.startsWith("/") || decoded.startsWith("\\")
    ? `${root}${separator}${decoded.replace(/^[\\/]+/, "")}`
    : `${base}${separator}${decoded}`;
  const segments = normalize(rooted).split(separator);
  const resolved: string[] = [];

  for (const segment of segments) {
    if (segment === "" && resolved.length === 0) {
      resolved.push("");
    } else if (!segment || segment === ".") {
      continue;
    } else if (segment === "..") {
      if (resolved.length <= 1 || resolved[resolved.length - 1]?.endsWith(":")) return null;
      resolved.pop();
    } else {
      resolved.push(segment);
    }
  }

  const candidate = resolved.join(separator);
  const comparableCandidate = comparablePath(candidate, isWindowsPath(root));
  const comparableRoot = comparablePath(root, isWindowsPath(root));
  return comparableCandidate.startsWith(`${comparableRoot}/`) ? candidate : null;
}
