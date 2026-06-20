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

/** Concrete themes that exist in the CSS layer. Keep in lockstep with src/styles/themes/. */
export const AEGIS_THEMES = ['aegis-dark', 'aegis-midnight', 'aegis-light', 'aegis-eyecare'] as const;
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
