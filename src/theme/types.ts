/**
 * Theme — Single Source of Truth for the theme token vocabulary.
 *
 * The `AEGIS_THEMES` tuple is the canonical inventory. Every other
 * file (CSS selectors, settings store, native title bar mapping)
 * derives its allowed values from here. To add a new theme:
 *   1. Add the token to AEGIS_THEMES.
 *   2. Add a CSS file under src/styles/themes/<token>.css and import
 *      it from src/styles/index.css.
 *   3. Add it to NATIVE_TITLE_BAR_MAP if its background isn't
 *      already covered.
 * No other file changes required — the type system will flag the
 * call sites that need attention.
 */

/** Concrete themes that exist in the CSS layer + derive presets. Keep in lockstep with src/styles/themes/ (4 originals have static CSS files) and src/theme/presets.ts (all 10).
 *  Order: 4 hand-tuned originals first, then 6 HSL-derived expansions.
 */
export const AEGIS_THEMES = [
  // Original 4 — values tuned to match the legacy aegis-*.css files within ±12 RGB.
  'aegis-dark', 'aegis-midnight', 'aegis-light', 'aegis-eyecare',
  // New 6 — HSL-derived, hand-tuned 4-tuples (presets.ts).
  'ocean', 'rosewood', 'forest', 'solar', 'slate', 'lavender',
] as const;
export type AegisTheme = typeof AEGIS_THEMES[number];

/** User-facing setting value. `system` follows the OS — at apply time it resolves to a concrete AegisTheme. */
export type ThemeSetting = AegisTheme | 'system';

/** macOS native title bar only supports two modes. eyecare is a light variant. */
export type NativeTitleBarMode = 'dark' | 'light';

/** Type-narrowing guard. Accepts unknown so callers can validate localStorage / IPC inputs in one step. */
export function isAegisTheme(value: unknown): value is AegisTheme {
  return typeof value === 'string' && (AEGIS_THEMES as readonly string[]).includes(value);
}

export function isThemeSetting(value: unknown): value is ThemeSetting {
  return value === 'system' || isAegisTheme(value);
}

/** localStorage keys for font persistence. Applied to CSS custom properties --font-ui / --font-mono at boot and on change. */
export const AEGIS_FONTS_STORAGE_KEYS = {
  uiFont: 'aegis-font-ui',
  monoFont: 'aegis-font-mono',
} as const;

// ─── Derivation contract (SPEC §2.1) ────────────────────────────────────────
// These types power `derive.ts` — the math layer that produces 25+ CSS vars
// from 4 inputs. Pure functions, no DOM, no React.

/** A single hex color in `#rrggbb` form. Branded to prevent accidental string usage. */
export type HexColor = `#${string}`;

/** Type-narrowing guard for HexColor. Accepts unknown for boundary validation. */
export function isHexColor(value: unknown): value is HexColor {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

/** The 4 inputs that uniquely determine all ~25 derived CSS variables.
 *  contrast ∈ [0, 1]: 0 = flat low-contrast, 1 = sharp high-contrast. */
export interface ThemeInput {
  accent: HexColor;
  bg: HexColor;
  fg: HexColor;
  contrast: number;
}

/** Every variable the rest of the app reads, in CSS form.
 *  RGB triplets ("241 244 251") match the existing `rgb(var(--aegis-...))` pattern.
 *  Internal __nativeTitleBarMode is NOT a CSS variable — consumed by apply.ts only. */
export interface DerivedTheme {
  // Backgrounds (5 stops)
  '--aegis-bg': string;
  '--aegis-surface': string;
  '--aegis-surface-elevated': string;
  '--aegis-elevated': string;
  '--aegis-card': string;

  // Text (4 stops)
  '--aegis-text': string;
  '--aegis-text-secondary': string;
  '--aegis-text-muted': string;
  '--aegis-text-dim': string;

  // Borders (3 alpha stops)
  '--aegis-border': string;
  '--aegis-border-hover': string;
  '--aegis-border-active': string;

  // Primary (3 stops + 2 tints)
  '--aegis-primary': string;
  '--aegis-primary-hover': string;
  '--aegis-primary-deep': string;
  '--aegis-primary-glow': string;
  '--aegis-primary-surface': string;

  // Status (semantic — derived from accent via hue rotation)
  '--aegis-success': string;
  '--aegis-warning': string;
  '--aegis-danger': string;
  '--aegis-success-surface': string;
  '--aegis-warning-surface': string;
  '--aegis-danger-surface': string;

  /** Tauri-only: which mode to render the OS title bar in. */
  __nativeTitleBarMode: NativeTitleBarMode;
}
