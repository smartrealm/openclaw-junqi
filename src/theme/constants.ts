/**
 * Theme — runtime constants. Kept separate from types.ts so a single
 * `import { STORAGE_KEY } from '@/theme/constants'` doesn't pull in
 * type-only symbols, and vice versa.
 */
import type { AegisTheme, NativeTitleBarMode, ThemeSetting } from './types';
import { deriveThemeVariables } from './derive';
import { THEME_PRESETS } from './presets';

/** Local mirror of the const tuple so we can iterate at module init without a circular type. */
const AEGIS_THEMES_ARRAY: readonly AegisTheme[] = [
  'aegis-dark', 'aegis-midnight', 'aegis-light', 'aegis-eyecare',
  'ocean', 'rosewood', 'forest', 'solar', 'slate', 'lavender',
];

/** localStorage key for the user-selected theme. Persisted across sessions. */
export const STORAGE_KEY = 'aegis-theme';

/** HTML attribute that CSS selectors key on (`[data-theme="aegis-dark"]` etc.). */
export const HTML_ATTR = 'data-theme';

/** Fallback when nothing else is known (localStorage error, OS hint missing, invalid value). */
export const DEFAULT_THEME: AegisTheme = 'aegis-dark';

/** Default user setting on first run. `system` adapts to the OS. */
export const DEFAULT_SETTING: ThemeSetting = 'system';

/**
 * macOS title bar can only render dark or light chrome. Every aegis theme
 * declares which native mode best matches its background brightness so the
 * traffic lights and window frame don't clash with the app body.
 *
 * Derived from `deriveThemeVariables` rather than hand-coded so any new
 * preset added to THEME_PRESETS automatically gets the right mapping.
 * (Previously this was a literal map; the migration is to make preset
 * additions require zero changes outside presets.ts.)
 */
export const NATIVE_TITLE_BAR_MAP: Record<AegisTheme, NativeTitleBarMode> =
  Object.fromEntries(
    AEGIS_THEMES_ARRAY.map((id) => [id, deriveThemeVariables(THEME_PRESETS[id]).__nativeTitleBarMode]),
  ) as Record<AegisTheme, NativeTitleBarMode>;
