import { invoke } from "@tauri-apps/api/core";

let cachedFonts: string[] | null = null;

export async function loadSystemFonts(): Promise<string[]> {
  if (cachedFonts) return cachedFonts;

  try {
    const fonts = await invoke<string[]>("get_system_fonts");
    cachedFonts = fonts;
    return fonts;
  } catch {
    return [];
  }
}

export function parseFirstFontName(stack: string): string {
  const trimmed = stack.trim();
  if (!trimmed) return "";

  // Handle comma-separated stack: take first entry
  const first = trimmed.split(",")[0]!.trim();

  // Strip surrounding quotes
  if (
    (first.startsWith('"') && first.endsWith('"')) ||
    (first.startsWith("'") && first.endsWith("'"))
  ) {
    return first.slice(1, -1);
  }
  return first;
}

/**
 * System font names with spaces or non-ASCII characters (e.g. "Maple Mono NF CN")
 * must be quoted; otherwise, Canvas 2D ctx.font parsing will tokenize them into
 * multiple family names, each with failed fallback.
 * Names containing commas are already a family stack — returned as-is.
 * Already-quoted names are also returned as-is.
 */
export function quoteFontName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  if (trimmed.includes(",")) return trimmed;
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed;
  }
  if (/^[A-Za-z][A-Za-z0-9-]*$/.test(trimmed)) return trimmed;
  return `"${trimmed.replace(/"/g, '\\"')}"`;
}

/** Search-ranking filter: exact match > starts-with > contains. */
export function filterFonts(fonts: string[], query: string): string[] {
  if (!query) return fonts;
  const q = query.toLowerCase();

  const exact: string[] = [];
  const startsWith: string[] = [];
  const contains: string[] = [];

  for (const f of fonts) {
    const lower = f.toLowerCase();
    if (lower === q) exact.push(f);
    else if (lower.startsWith(q)) startsWith.push(f);
    else if (lower.includes(q)) contains.push(f);
  }

  return [...exact, ...startsWith, ...contains];
}
