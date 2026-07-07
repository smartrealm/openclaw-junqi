export const ACCENT_COLORS = ['teal', 'blue', 'purple', 'rose', 'amber', 'emerald'] as const;
export type AccentColor = typeof ACCENT_COLORS[number];
export const DEFAULT_ACCENT_COLOR: AccentColor = 'blue';

const ACCENT_SHADES: Record<AccentColor, { 400: string; 500: string; 600: string }> = {
  teal: { 400: '78 201 176', 500: '61 184 159', 600: '44 167 142' },
  blue: { 400: '108 159 255', 500: '90 143 255', 600: '70 120 225' },
  purple: { 400: '192 132 252', 500: '168 85 247', 600: '147 51 234' },
  rose: { 400: '251 113 133', 500: '244 63 94', 600: '225 29 72' },
  amber: { 400: '232 184 78', 500: '210 165 60', 600: '185 142 42' },
  emerald: { 400: '52 211 153', 500: '16 185 129', 600: '5 150 105' },
};

export function isAccentColor(value: unknown): value is AccentColor {
  return typeof value === 'string' && (ACCENT_COLORS as readonly string[]).includes(value);
}

export function normalizeAccentColor(value: unknown): AccentColor {
  return isAccentColor(value) ? value : DEFAULT_ACCENT_COLOR;
}

export function readPersistedAccentColor(storage: Pick<Storage, 'getItem'> = localStorage): AccentColor | null {
  const raw = storage.getItem('aegis-accent-color');
  return isAccentColor(raw) ? raw : null;
}

export function applyAccentColor(color: AccentColor): void {
  const root = document.documentElement;
  const shades = ACCENT_SHADES[color];
  root.style.setProperty('--aegis-primary', shades[400]);
  root.style.setProperty('--aegis-primary-hover', shades[500]);
  root.style.setProperty('--aegis-primary-deep', shades[600]);
  root.style.setProperty('--aegis-primary-glow', `rgb(${shades[400]} / 0.16)`);
  root.style.setProperty('--aegis-primary-surface', `rgb(${shades[400]} / 0.08)`);
}
