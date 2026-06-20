/**
 * Theme — public barrel.
 *
 * Re-exports the surface that the rest of the app should depend on.
 * Internal helpers (resolver internals, side-effect primitives) stay
 * accessible via their own paths, but day-to-day callers only need:
 *
 *   import { useTheme, earlyBootstrap, AEGIS_THEMES, type AegisTheme,
 *            type ThemeSetting, STORAGE_KEY } from '@/theme';
 */
export { AEGIS_THEMES, isAegisTheme, isThemeSetting } from './types';
export type { AegisTheme, NativeTitleBarMode, ThemeSetting } from './types';
export { DEFAULT_SETTING, DEFAULT_THEME, HTML_ATTR, NATIVE_TITLE_BAR_MAP, STORAGE_KEY } from './constants';
export { detectOSPreference, resolveTheme } from './resolver';
export { applyTheme, applyToDocument, syncNativeTitleBar } from './apply';
export { earlyBootstrap } from './earlyBootstrap';
export { useTheme } from './useTheme';
