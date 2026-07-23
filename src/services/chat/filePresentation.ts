function displayPathSegments(rawPath: string): string[] {
  let value = rawPath.trim();
  if (value.startsWith('file://')) {
    try {
      value = decodeURIComponent(new URL(value).pathname);
      if (/^\/[A-Za-z]:\//.test(value)) value = value.slice(1);
    } catch {
      value = value.replace(/^file:\/\/+/, '');
    }
  }
  return value.replace(/\/+$/, '').split(/[/\\]/).filter(Boolean);
}

export function getFileName(rawPath: string): string {
  const segments = displayPathSegments(rawPath);
  return segments.at(-1) || rawPath;
}

/** The one useful bit of a long absolute path in a compact chat attachment row. */
export function getFileParentFolder(rawPath: string): string | null {
  const segments = displayPathSegments(rawPath);
  return segments.length > 1 ? segments.at(-2) ?? null : null;
}
