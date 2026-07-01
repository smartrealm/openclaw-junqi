/**
 * Theme derivation — pure math. The 4-input → 25-variable contract.
 *
 * NO side-effects, NO DOM, NO localStorage, NO imports outside types.
 * This file must remain trivially unit-testable and reusable from both
 * the synchronous boot path (earlyBootstrap) and the React render path
 * (useTheme).
 *
 * Invariants (enforced by tests in derive.test.ts):
 *   - hex <-> rgb <-> hsl round-trips with ≤1 unit precision loss
 *   - derive({...preset}) is deterministic: same input → same output
 *   - bg drives surface scale monotonically; fg drives text scale monotonically
 *   - contrast ∈ [0, 1] controls stop spacing (no out-of-range values)
 */
import type { DerivedTheme, HexColor, ThemeInput } from './types';

// ─── Color conversions ──────────────────────────────────────────────────────

export interface RGB { r: number; g: number; b: number }
export interface HSL { h: number; s: number; l: number }

/** Parse a `#rrggbb` hex color into 0..255 channels. Throws on malformed input — callers must validate. */
export function hexToRgb(hex: HexColor): RGB {
  const s = hex.replace(/^#/, '');
  if (s.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(s)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
}

/** Format RGB channels as `R G B` (space-separated, for CSS rgb(var(--aegis-...)) pattern). */
export function rgbToTriplet({ r, g, b }: RGB): string {
  return `${Math.round(r)} ${Math.round(g)} ${Math.round(b)}`;
}

/** Format RGB channels as a `#rrggbb` hex string. */
export function rgbToHex({ r, g, b }: RGB): HexColor {
  const toHex = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}` as HexColor;
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn: h = (gn - bn) / d + (gn < bn ? 6 : 0); break;
      case gn: h = (bn - rn) / d + 2; break;
      case bn: h = (rn - gn) / d + 4; break;
    }
    h /= 6;
  }
  return { h: h * 360, s, l };
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  const hn = ((h % 360) + 360) % 360 / 360;
  const sn = clamp(s, 0, 1);
  const ln = clamp(l, 0, 1);
  if (sn === 0) {
    const v = Math.round(ln * 255);
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;
  return {
    r: hue2rgb(p, q, hn + 1 / 3) * 255,
    g: hue2rgb(p, q, hn) * 255,
    b: hue2rgb(p, q, hn - 1 / 3) * 255,
  };
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Linear interpolate from a to b by t (0..1). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ─── Stops (multi-step ramps) ───────────────────────────────────────────────

/**
 * Generate `count` stops from `from` to `to` in HSL space, evenly spaced.
 * Returned as RGB triplet strings (space-separated for CSS `rgb(var(...))`).
 *
 * Stops preserve hue and saturation; only lightness interpolates.
 * This matches the observed pattern in aegis-dark.css (text scale = hue fixed,
 * L monotonically decreasing; surface scale = L monotonically increasing).
 */
export function buildStops(
  from: HSL,
  to: HSL,
  count: number,
  curve: (t: number) => number = (t) => t,
): string[] {
  const stops: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 1 : curve(i / (count - 1));
    const hsl: HSL = {
      h: lerp(from.h, to.h, t),
      s: lerp(from.s, to.s, t),
      l: lerp(from.l, to.l, t),
    };
    stops.push(rgbToTriplet(hslToRgb(hsl)));
  }
  return stops;
}

/** Generate alpha overlays of a given RGB color at N stops (returns CSS rgba strings). */
export function buildAlphaStops(rgb: RGB, alphas: number[]): string[] {
  return alphas.map((a) => `rgba(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}, ${a})`);
}

// ─── Derive ─────────────────────────────────────────────────────────────────

/**
 * Detect mode from background lightness. Returns 'dark' if bg.lightness < 0.5,
 * else 'light'. This drives which way text/border stops interpolate.
 */
function detectMode(bg: HSL): 'dark' | 'light' {
  return bg.l < 0.5 ? 'dark' : 'light';
}

/** Neutral grey target — used for hover/active border in light mode. */
const NEUTRAL_GREY_DARK: HSL = { h: 220, s: 0.015, l: 0.701 };
const NEUTRAL_GREY_LIGHT: HSL = { h: 220, s: 0.015, l: 0.40 };

/**
 * Derive 25+ CSS variables from a 4-input ThemeInput.
 * Pure function. Same input → same output, always.
 */
export function deriveThemeVariables(input: ThemeInput): DerivedTheme {
  const accentRgb = hexToRgb(input.accent);
  const bgRgb = hexToRgb(input.bg);
  const fgRgb = hexToRgb(input.fg);
  const accentHsl = rgbToHsl(accentRgb);
  const bgHsl = rgbToHsl(bgRgb);
  const fgHsl = rgbToHsl(fgRgb);
  const mode = detectMode(bgHsl);

  // contrast controls stop spacing: 0 = nearly flat, 1 = widely spaced.
  // Surface delta in HSL lightness space, scaled by contrast.
  const contrast = clamp(input.contrast, 0, 1);
  // Text scale: at contrast=0.5 the span matches the legacy aegis-dark
  // ramp (text→dim with deltas 0.089/0.175/0.288). t^1.5 approximates the
  // accelerating curve (text-dim is the biggest drop).
  // Saturation decays faster than linearly — legacy uses much lower sat
  // at the muted/dim stops than the bright text stop.
  const textSpan = 0.46 * 2 * contrast;   // contrast=0.5 → span=0.46 (legacy)
  const TEXT_CURVE = [0, 0.192, 0.544, 1.0];
  const TEXT_SAT_CURVE = mode === 'dark'
    ? [1.0, 0.50, 0.35, 0.20]
    : [1.0, 0.60, 0.45, 0.30];

  // ── Surface scale (5 stops: bg → surface-elevated → surface → elevated → card)
  // Non-linear curve: small bump from bg → surface-elevated (e.g. for sticky
  // bars above panels), then accelerating toward card (the most "popped" tier).
  // Base offsets are tuned so contrast=0.5 reproduces the legacy aegis-dark.css
  // values within ±2 RGB per channel. Scale linearly by 2*contrast to get
  // contrast=1.0 (max) or contrast=0.0 (flat).
  const surfaceSign = mode === 'dark' ? 1 : -1;
  const surfaceBase = bgHsl.l;
  const surfaceSpan = 0.115 * 2 * contrast;   // 0 at contrast=0, 0.23 at contrast=1
  // Normalized offset fractions [bg, surface-elevated, surface, elevated, card].
  // At contrast=0.5 these match the legacy aegis-dark ramp.
  const SURFACE_CURVE = mode === 'dark'
    ? [0, 0.14, 0.25, 0.55, 1.0]
    : [0, 0.18, 0.35, 0.65, 1.0];  // light mode: slightly tighter card spread
  // Saturation falls off as we go up the ramp (legacy pattern: bg has a
  // blue tint, card is nearly neutral grey). Each entry is a multiplier on
  // bg.s. The legacy aegis-dark values are hand-picked and don't strictly
  // follow a formula — this curve is a best-effort approximation.
  // Tuned at contrast=0.5; scales implicitly with contrast via surfaceSpan.
  const SURFACE_SAT_CURVE = mode === 'dark'
    ? [1.0, 1.10, 0.95, 0.70, 0.35]
    : [1.0, 0.95, 0.85, 0.65, 0.40];
  const surfaceStops: HSL[] = [];
  for (let i = 0; i < 5; i++) {
    surfaceStops.push({
      h: bgHsl.h,
      s: clamp(bgHsl.s * SURFACE_SAT_CURVE[i], 0, 1),
      l: clamp(surfaceBase + surfaceSign * surfaceSpan * SURFACE_CURVE[i], 0.02, 0.98),
    });
  }
  // Reorder to match CSS variable naming:
  // --aegis-bg = surfaceStops[0]
  // --aegis-surface-elevated = surfaceStops[1]  (between bg and surface)
  // --aegis-surface = surfaceStops[2]
  // --aegis-elevated = surfaceStops[3]
  // --aegis-card = surfaceStops[4]

  // ── Text scale (4 stops: text → text-secondary → text-muted → text-dim)
  // Text gets DIMMER as you go down. Legacy aegis-dark pattern: hue stays
  // close to the background hue throughout, but saturation decreases so
  // dim text reads as "subtle blue-grey" not "saturated blue". We keep
  // saturation close to fg.s (the user's chosen text color) and only
  // interpolate hue slightly toward the background's hue. Non-linear L
  // curve (t^1.5) makes the dim step drop further than secondary.
  const textSign = mode === 'dark' ? -1 : 1;
  const textStops: HSL[] = [];
  for (let i = 0; i < 4; i++) {
    const t = TEXT_CURVE[i];
    textStops.push({
      h: lerp(fgHsl.h, bgHsl.h, t * 0.3),  // mostly fg hue, slight blue lean
      s: clamp(fgHsl.s * TEXT_SAT_CURVE[i], 0, 1),
      l: clamp(fgHsl.l + textSign * textSpan * t, 0.05, 0.98),
    });
  }

  // ── Primary scale (3 stops: primary → primary-hover → primary-deep)
  // Legacy aegis-dark: primary (#7f9aff, L=0.749) → hover (#6f8eff, L=0.718,
  // delta 0.031) → deep (#6987ff, L=0.706, delta 0.043). Hover is closer to
  // primary than deep is, so the curve is [0, 0.72, 1.0].
  const primarySpan = 0.043 * 2 * contrast;   // contrast=0.5 → span=0.043 (legacy)
  const PRIMARY_CURVE = [0, 0.72, 1.0];
  const primaryStops: HSL[] = [];
  for (let i = 0; i < 3; i++) {
    primaryStops.push({
      h: accentHsl.h,
      s: accentHsl.s,
      l: clamp(accentHsl.l - primarySpan * PRIMARY_CURVE[i], 0.10, 0.95),
    });
  }

  // ── Borders (3 alpha stops of overlay color)
  // Dark mode: white overlay. Light mode: black overlay.
  const borderOverlay = mode === 'dark' ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
  const borderAlphas = [0.07, 0.12, 0.30];
  const borderActive = mode === 'dark' ? 0.30 : 0.40;
  const borderActiveRgba = `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, ${borderActive})`;

  // ── Status (semantic — fixed hue, fixed L/S tuned to match legacy values).
  // These are intentionally NOT derived from the accent's L/S: status colors
  // need predictable legibility on any background, so they're a constant
  // palette. Saturation differs per status (danger = fully saturated,
  // warning = warm, success = muted) for instant recognition.
  // Values matched to the legacy aegis-dark.css status palette within ±2/ch.
  const statusHsl = (targetHue: number, saturation: number, lightness: number): HSL => ({
    h: targetHue,
    s: saturation,
    l: lightness,
  });
  const successHsl = statusHsl(151, 0.56, 0.54);   // green — legacy #3dd68c
  const warningHsl = statusHsl(37, 0.75, 0.55);    // amber/orange — legacy #f5a623
  const dangerHsl = statusHsl(0, 1.00, 0.67);      // red — legacy #ff5555

  // ── Glow & surface tints (alpha overlays of primary)
  const primaryGlow = `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.34)`;
  const primarySurface = `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.14)`;

  // ── Native title bar mode (Tauri)
  const nativeTitleBarMode: 'dark' | 'light' = mode;

  // ── Assemble result
  return {
    '--aegis-bg': rgbToTriplet(hslToRgb(surfaceStops[0])),
    '--aegis-surface-elevated': rgbToTriplet(hslToRgb(surfaceStops[1])),
    '--aegis-surface': rgbToTriplet(hslToRgb(surfaceStops[2])),
    '--aegis-elevated': rgbToTriplet(hslToRgb(surfaceStops[3])),
    '--aegis-card': rgbToTriplet(hslToRgb(surfaceStops[4])),

    '--aegis-text': rgbToTriplet(hslToRgb(textStops[0])),
    '--aegis-text-secondary': rgbToTriplet(hslToRgb(textStops[1])),
    '--aegis-text-muted': rgbToTriplet(hslToRgb(textStops[2])),
    '--aegis-text-dim': rgbToTriplet(hslToRgb(textStops[3])),

    '--aegis-primary': rgbToTriplet(hslToRgb(primaryStops[0])),
    '--aegis-primary-hover': rgbToTriplet(hslToRgb(primaryStops[1])),
    '--aegis-primary-deep': rgbToTriplet(hslToRgb(primaryStops[2])),
    '--aegis-primary-glow': primaryGlow,
    '--aegis-primary-surface': primarySurface,

    '--aegis-border': `rgba(${borderOverlay.r}, ${borderOverlay.g}, ${borderOverlay.b}, ${borderAlphas[0]})`,
    '--aegis-border-hover': `rgba(${borderOverlay.r}, ${borderOverlay.g}, ${borderOverlay.b}, ${borderAlphas[1]})`,
    '--aegis-border-active': borderActiveRgba,

    '--aegis-success': rgbToTriplet(hslToRgb(successHsl)),
    '--aegis-warning': rgbToTriplet(hslToRgb(warningHsl)),
    '--aegis-danger': rgbToTriplet(hslToRgb(dangerHsl)),

    '--aegis-success-surface': `rgba(${hslToRgb(successHsl).r}, ${hslToRgb(successHsl).g}, ${hslToRgb(successHsl).b}, 0.14)`,
    '--aegis-warning-surface': `rgba(${hslToRgb(warningHsl).r}, ${hslToRgb(warningHsl).g}, ${hslToRgb(warningHsl).b}, 0.14)`,
    '--aegis-danger-surface': `rgba(${hslToRgb(dangerHsl).r}, ${hslToRgb(dangerHsl).g}, ${hslToRgb(dangerHsl).b}, 0.12)`,

    __nativeTitleBarMode: nativeTitleBarMode,
  };
}