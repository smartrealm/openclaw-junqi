export function isJsonFileName(fileName: string): boolean {
  const baseName = fileName.replace(/^.*[/\\]/, "");
  const dot = baseName.lastIndexOf(".");
  return dot > 0 && baseName.slice(dot + 1).toLowerCase() === "json";
}

/**
 * Return a stable, read-only representation for a JSON preview.
 * Formatting never mutates the source document; invalid JSON stays visible as
 * the original text so previewing a file cannot hide an edit or parse error.
 */
export function formatJsonPreview(content: string): string | null {
  try {
    const value: unknown = JSON.parse(content);
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
}
