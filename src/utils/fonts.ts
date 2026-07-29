import { invoke } from "@tauri-apps/api/core";

export type FontRole = "ui" | "mono" | "editor";
export type FontCatalogSource = "system" | "fallback";

export interface FontCatalog {
  fonts: string[];
  source: FontCatalogSource;
}

const CSS_FONT_KEYWORDS = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
]);

const FONT_STACK_FALLBACKS: Record<FontRole, string> = {
  ui: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  mono: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  editor: "var(--font-mono)",
};

let catalogPromise: Promise<FontCatalog> | null = null;

export function parseFirstFontName(stack: string): string {
  const value = stack.trim();
  if (!value) return "";

  let quote: "\"" | "'" | null = null;
  let escaped = false;
  let end = value.length;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quote) {
      escaped = true;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = quote === character ? null : quote ?? character;
      continue;
    }
    if (character === "," && !quote) {
      end = index;
      break;
    }
  }

  const first = value.slice(0, end).trim();
  if (
    first.length >= 2 &&
    ((first.startsWith("\"") && first.endsWith("\"")) ||
      (first.startsWith("'") && first.endsWith("'")))
  ) {
    return first.slice(1, -1).replace(/\\([\\"'])/g, "$1").trim();
  }
  return first;
}

export function normalizeFontName(value: string): string {
  return parseFirstFontName(value)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 160);
}

export function quoteFontName(name: string): string {
  const normalized = normalizeFontName(name);
  if (!normalized) return "";
  if (normalized.startsWith("-") || CSS_FONT_KEYWORDS.has(normalized.toLowerCase())) {
    return normalized;
  }
  return JSON.stringify(normalized);
}

export function buildFontStack(value: string, role: FontRole): string {
  const family = normalizeFontName(value);
  if (!family) return "";
  const quoted = quoteFontName(family);
  const fallback = FONT_STACK_FALLBACKS[role];
  return parseFirstFontName(fallback).toLowerCase() === family.toLowerCase()
    ? fallback
    : `${quoted}, ${fallback}`;
}

export function normalizeFontCatalog(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .filter((font): font is string => typeof font === "string")
      .map(normalizeFontName)
      .filter((font) => font.length > 0 && !font.startsWith(".")),
  )).sort((left, right) => left.localeCompare(right));
}

export function getFallbackFonts(platform = globalThis.navigator?.platform ?? ""): string[] {
  const normalized = platform.toLowerCase();
  if (normalized.includes("mac")) {
    return ["SF Pro Text", "PingFang SC", "SF Mono", "Menlo", "Monaco", "JetBrains Mono"];
  }
  if (normalized.includes("win")) {
    return ["Segoe UI", "Microsoft YaHei UI", "Cascadia Mono", "Consolas", "JetBrains Mono"];
  }
  return ["Noto Sans", "Noto Sans CJK SC", "DejaVu Sans", "DejaVu Sans Mono", "Liberation Mono"];
}

export function filterFonts(fonts: readonly string[], query: string): string[] {
  const normalizedQuery = normalizeFontName(query).toLowerCase();
  if (!normalizedQuery) return [...fonts];

  const exact: string[] = [];
  const startsWith: string[] = [];
  const contains: string[] = [];
  for (const font of fonts) {
    const normalizedFont = font.toLowerCase();
    if (normalizedFont === normalizedQuery) exact.push(font);
    else if (normalizedFont.startsWith(normalizedQuery)) startsWith.push(font);
    else if (normalizedFont.includes(normalizedQuery)) contains.push(font);
  }
  return [...exact, ...startsWith, ...contains];
}

export async function loadSystemFontCatalog(): Promise<FontCatalog> {
  if (catalogPromise) return catalogPromise;
  catalogPromise = invoke<unknown>("get_system_fonts")
    .then((value): FontCatalog => {
      const fonts = normalizeFontCatalog(value);
      return fonts.length > 0
        ? { fonts, source: "system" }
        : { fonts: getFallbackFonts(), source: "fallback" };
    })
    .catch((): FontCatalog => ({ fonts: getFallbackFonts(), source: "fallback" }));
  return catalogPromise;
}
