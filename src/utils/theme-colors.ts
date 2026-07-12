/**
 * Theme-aware color utilities
 * Instead of hardcoded colors, these functions read from CSS variables
 * so they automatically adapt to dark/light mode.
 *
 * Usage:
 *   themeHex('primary')           → '#4EC9B0' (dark) / '#3DB89F' (light)
 *   themeAlpha('primary', 0.1)    → 'rgba(78,201,176,0.1)' / 'rgba(61,184,159,0.1)'
 *   overlay(0.05)                 → 'rgba(255,255,255,0.05)' / 'rgba(0,0,0,0.05)'
 *   dataColor(0)                  → '#4EC9B0' (dark) / '#4EC9B0' (light, same scale)
 *   themeColorVar('primary')      → 'rgb(var(--aegis-primary))'
 *   themeColorVar('primary', .1)  → 'rgb(var(--aegis-primary) / 0.1)'
 *
 * Source of truth: primitives.css (--color-teal-400 = 78 201 176 for dark,
 * --color-teal-500 = 61 184 159 for light), wired through aegis-*.css.
 *
 * ⚠️ These read getComputedStyle at call time — always call inside
 *    render functions, useMemo, or event handlers. Never at module scope.
 */

function getVar(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name).trim();
}

export type ThemeColorName = 'primary' | 'accent' | 'danger' | 'warning' | 'success';

/**
 * Returns a live CSS color reference. Unlike themeHex/themeAlpha, this string
 * is resolved by the browser at paint time, so a mounted SVG or inline style
 * follows theme changes without requiring a React render.
 */
export function themeColorVar(name: ThemeColorName, alpha?: number): string {
  const opacity = alpha === undefined ? '' : ` / ${alpha}`;
  return `rgb(var(--aegis-${name})${opacity})`;
}

/** Live CSS reference for the data-visualization palette. */
export function dataColorVar(index: number): string {
  return `var(--aegis-data-${(index % 10) + 1})`;
}

/** Returns HEX color — for Charts, SVG fill/stroke, style={{}} */
export function themeHex(name: ThemeColorName): string {
  const rgb = getVar(`--aegis-${name}`);
  const [r, g, b] = rgb.split(' ').map(Number);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return '#888888';
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Returns rgba() with alpha — replaces `#4EC9B015` hex-alpha patterns */
export function themeAlpha(name: string, alpha: number): string {
  const rgb = getVar(`--aegis-${name}`);
  return `rgba(${rgb.replace(/ /g, ',')},${alpha})`;
}

/** Overlay color — white in dark, black in light — replaces rgba(255,255,255,X) */
export function overlay(alpha: number): string {
  const rgb = getVar('--aegis-overlay');
  return `rgba(${rgb.replace(/ /g, ',')},${alpha})`;
}

/** Data visualization palette — for charts, agent/model colors */
export function dataColor(index: number): string {
  return getVar(`--aegis-data-${(index % 10) + 1}`);
}
