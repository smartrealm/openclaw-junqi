/**
 * Theme — side-effect layer. The only place in the codebase that
 * touches `document.documentElement` or the Tauri window theme.
 * Everything else goes through these two functions.
 */
import type { AegisTheme, ThemeSetting } from './types';
import { HTML_ATTR, NATIVE_TITLE_BAR_MAP } from './constants';

/**
 * Marker class added to <html> during a theme swap so the global
 * `* { transition: background/border/color 150ms }` rule in
 * index.css does NOT run a 150ms color animation on every single
 * element when --aegis-* tokens flip.
 *
 * Without this, switching themes triggers thousands of concurrent
 * transitions that hitch the main thread and read as "UI jumping".
 * Paired with a CSS rule (see index.css) that disables transitions
 * while this class is present.
 */
const SWITCHING_CLASS = 'theme-switching';
type NativeThemeTarget = 'light' | 'dark' | null;
let lastNativeThemeTarget: NativeThemeTarget | undefined;

export function resolveNativeThemeTarget(
  theme: AegisTheme,
  setting: ThemeSetting,
): NativeThemeTarget {
  return setting === 'system' ? null : NATIVE_TITLE_BAR_MAP[theme];
}

/** Writes the data-theme attribute that CSS selectors key on. Synchronous and idempotent. */
export function applyToDocument(theme: AegisTheme): void {
  const html = document.documentElement;
  // Read first: avoid the transition-suppression dance when the theme
  // is unchanged (e.g. resolveTheme is called repeatedly on re-renders).
  if (html.getAttribute(HTML_ATTR) === theme) return;

  html.classList.add(SWITCHING_CLASS);
  html.setAttribute(HTML_ATTR, theme);

  // Force a synchronous reflow so the browser applies the new token
  // values BEFORE we remove .theme-switching. Reading offsetHeight is
  // the canonical "commit pending styles now" trick.
  void html.offsetHeight;

  // Defer un-marking to the next frame so the new styles paint without
  // animation, then transitions resume on subsequent user interactions.
  const resumeTransitions = () => {
    html.classList.remove(SWITCHING_CLASS);
  };
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(resumeTransitions);
  } else {
    window.setTimeout(resumeTransitions, 16);
  }
}

/**
 * Asks the Tauri shell to repaint the native title bar to match the
 * theme. Dynamically imported so the browser/preview build (where
 * `@tauri-apps/api` may fail to load) silently degrades to a no-op.
 *
 * Errors are intentionally swallowed: a wrong-colored title bar is
 * never a fatal error, and surfacing the failure would just spam the
 * console on every theme switch.
 */
export function syncNativeTitleBar(theme: AegisTheme, setting: ThemeSetting): void {
  const target = resolveNativeThemeTarget(theme, setting);
  if (lastNativeThemeTarget === target) return;
  lastNativeThemeTarget = target;
  import('@tauri-apps/api/window')
    .then((m) => m.getCurrentWindow().setTheme(target))
    .catch(() => {
      if (lastNativeThemeTarget === target) lastNativeThemeTarget = undefined;
      /* not running under Tauri — no native chrome to sync */
    });
}

/** Convenience: apply both the CSS attribute and the native chrome in one call. */
export function applyTheme(theme: AegisTheme, setting: ThemeSetting): void {
  applyToDocument(theme);
  syncNativeTitleBar(theme, setting);
}
