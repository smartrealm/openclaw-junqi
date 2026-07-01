/**
 * Theme presets — the 10 canonical 4-tuples that drive theme derivation.
 *
 * Each entry is the complete input needed by deriveThemeVariables(). No
 * other code should hardcode theme colors — extend this map instead.
 *
 * To add a preset:
 *   1. Add the id to AEGIS_THEMES in types.ts.
 *   2. Add a ThemeInput entry here with the four inputs.
 *   3. (Optional) Add i18n keys for theme.<id>.
 *
 * Tuning guide:
 *   - accent: brand color, drives --aegis-primary* (and the active border tint).
 *   - bg: page background. Its lightness decides dark vs light mode automatically.
 *   - fg: main text color. Must contrast well against bg.
 *   - contrast: 0 = flat UI, 0.5 = balanced (recommended), 1 = high contrast.
 *
 * The 4 original aegis-* presets use inputs that RECONSTRUCT the current
 * aegis-*.css values within ±2 per RGB channel. See derive.test.ts.
 */
import type { AegisTheme, ThemeInput } from './types';

/** All 10 presets, keyed by AegisTheme id. */
export const THEME_PRESETS: Record<AegisTheme, ThemeInput> = {
  // ── Original 4 — values chosen to reconstruct aegis-*.css within ±2/ch ──
  'aegis-dark':     { accent: '#7f9aff', bg: '#1d212a', fg: '#f1f4fb', contrast: 0.50 },
  'aegis-midnight': { accent: '#a78bfa', bg: '#0f1117', fg: '#e6e6e6', contrast: 0.40 },
  'aegis-light':    { accent: '#3b82f6', bg: '#f5f7fb', fg: '#171b24', contrast: 0.50 },
  'aegis-eyecare':  { accent: '#a07a3c', bg: '#f5ecd7', fg: '#5a4a30', contrast: 0.30 },

  // ── New 6 — color-coherent expansions ──
  'ocean':    { accent: '#38bdf8', bg: '#0c1e2e', fg: '#e0f2fe', contrast: 0.50 },
  'rosewood': { accent: '#f43f5e', bg: '#2a1414', fg: '#fef2f2', contrast: 0.45 },
  'forest':   { accent: '#4ade80', bg: '#0f1f15', fg: '#dcfce7', contrast: 0.50 },
  'solar':    { accent: '#f59e0b', bg: '#1c1410', fg: '#fef3c7', contrast: 0.45 },
  'slate':    { accent: '#94a3b8', bg: '#1e293b', fg: '#e2e8f0', contrast: 0.40 },
  'lavender': { accent: '#a855f7', bg: '#faf5ff', fg: '#3b0764', contrast: 0.40 },
};