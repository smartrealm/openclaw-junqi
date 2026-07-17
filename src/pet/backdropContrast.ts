export interface PetBackdropReading {
  available: boolean;
  luminance: number | null;
  contrast: number | null;
  reason: 'available' | 'permission-denied' | 'unsupported' | 'unavailable';
}

export interface PetBackdropTextStyle {
  foreground: string;
  stroke: string;
  strokeWidth: number;
  shadow: string;
  bubble: string;
}

const DARK: PetBackdropTextStyle = {
  foreground: '#101318',
  stroke: 'rgba(255,255,255,0.98)',
  strokeWidth: 1.5,
  shadow: '0 0 2px rgba(255,255,255,0.98), 0 1px 4px rgba(255,255,255,0.92)',
  bubble: 'rgba(255,255,255,0.52)',
};

const LIGHT: PetBackdropTextStyle = {
  foreground: '#f8fafc',
  stroke: 'rgba(0,0,0,0.96)',
  strokeWidth: 1.5,
  shadow: '0 0 2px rgba(0,0,0,0.96), 0 1px 4px rgba(0,0,0,0.9)',
  bubble: 'rgba(0,0,0,0.52)',
};

export function resolvePetBackdropTextStyle(reading: PetBackdropReading | null): PetBackdropTextStyle | null {
  if (!reading?.available || reading.luminance == null) return null;
  // Use the WCAG relative-luminance crossover. A strong opposite-color
  // outline plus a translucent backing keeps text legible on busy wallpaper.
  const base = reading.luminance > 0.45 ? DARK : LIGHT;
  const busy = (reading.contrast ?? 0) > 0.18;
  return busy
    ? { ...base, strokeWidth: 2, bubble: base.bubble.replace('0.52', '0.66') }
    : base;
}
