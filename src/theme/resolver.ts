/**
 * Theme — resolver. Maps the user setting (which may be `system`)
 * to a concrete AegisTheme, given the current OS preference.
 *
 * Pure function. No DOM access, no localStorage access — those are
 * the caller's job. This means it's trivially testable and reusable
 * from both the synchronous boot path and the React render path.
 */
import type { AegisTheme, ThemeSetting } from './types';
import { DEFAULT_THEME } from './constants';
import { isAegisTheme, isThemeSetting } from './types';

/** Probes the OS for its preferred color scheme. Falls back to `dark` on environments without `matchMedia` (SSR, sandboxed). */
export function detectOSPreference(): AegisTheme {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'aegis-dark'
      : 'aegis-light';
  } catch {
    return DEFAULT_THEME;
  }
}

/**
 * Resolves a user setting to a concrete theme.
 *
 * @param setting User-selected ThemeSetting, or a raw string from
 *   localStorage / IPC that hasn't been validated yet. Invalid
 *   values fall through to DEFAULT_THEME so the app always renders
 *   *something* legible.
 * @param osPreference Concrete theme to use when `setting === 'system'`.
 *   Caller-provided so tests stay deterministic.
 */
export function resolveTheme(setting: unknown, osPreference: AegisTheme): AegisTheme {
  if (!isThemeSetting(setting)) return DEFAULT_THEME;
  if (setting === 'system') return osPreference;
  return isAegisTheme(setting) ? setting : DEFAULT_THEME;
}
