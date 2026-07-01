/**
 * Theme — synchronous boot.
 *
 * Must be callable from main.tsx BEFORE React mounts and BEFORE the
 * stylesheet loads. The CSS layer (aegis-dark.css, aegis-light.css,
 * aegis-eyecare.css) no longer uses `:root` as a fallback — each
 * theme is keyed exclusively on `[data-theme="..."]`. Without an
 * attribute on <html>, NO theme matches and the app paints unstyled.
 *
 * Therefore: this function MUST be called at the top of main.tsx,
 * before any `import './styles/index.css'` resolves.
 *
 * Avoids the native-title-bar sync — that's an async Tauri import
 * and would either block boot or race the React mount. The React
 * `useTheme` hook owns that sync once the app is alive.
 */
import { applyToDocument } from './apply';
import { STORAGE_KEY } from './constants';
import { AEGIS_FONTS_STORAGE_KEYS } from './types';
import { detectOSPreference, resolveTheme } from './resolver';

/** Reads localStorage, resolves to a concrete theme, writes data-theme to <html>. Also applies any persisted font families to --font-ui / --font-mono CSS custom properties so the correct fonts are ready before the first paint. Returns the resolved theme so callers can log / inspect it. */
export function earlyBootstrap(): void {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    // localStorage unavailable (incognito / sandboxed) — saved stays null
    // and we fall through to the OS preference.
  }
  const resolved = resolveTheme(saved, detectOSPreference());
  applyToDocument(resolved);

  // ── Apply persisted fonts as CSS custom properties ──────────
  const root = document.documentElement;
  try {
    const uiFont = localStorage.getItem(AEGIS_FONTS_STORAGE_KEYS.uiFont);
    if (uiFont) root.style.setProperty('--font-ui', uiFont);
  } catch {
    // localStorage unavailable — skip
  }
  try {
    const monoFont = localStorage.getItem(AEGIS_FONTS_STORAGE_KEYS.monoFont);
    if (monoFont) root.style.setProperty('--font-mono', monoFont);
  } catch {
    // localStorage unavailable — skip
  }
}
