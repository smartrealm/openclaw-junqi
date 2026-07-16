export interface PetBackdropReading {
  available: boolean;
  luminance: number | null;
  contrast: number | null;
  reason: 'available' | 'permission-denied' | 'unsupported' | 'unavailable';
}

export interface PetBackdropTextStyle {
  foreground: string;
  stroke: string;
  shadow: string;
  bubble: string;
}

const DARK: PetBackdropTextStyle = {
  foreground: '#101318',
  stroke: 'rgba(255,255,255,0.92)',
  shadow: '0 1px 3px rgba(255,255,255,0.82)',
  bubble: 'rgba(255,255,255,0.24)',
};

const LIGHT: PetBackdropTextStyle = {
  foreground: '#f8fafc',
  stroke: 'rgba(0,0,0,0.88)',
  shadow: '0 1px 3px rgba(0,0,0,0.82)',
  bubble: 'rgba(0,0,0,0.24)',
};

export function resolvePetBackdropTextStyle(reading: PetBackdropReading | null): PetBackdropTextStyle | null {
  if (!reading?.available || reading.luminance == null) return null;
  // Use the WCAG relative-luminance crossover. Texture/contrast increases the
  // bubble opacity slightly so a busy wallpaper cannot erase the caption.
  const base = reading.luminance > 0.45 ? DARK : LIGHT;
  const busy = (reading.contrast ?? 0) > 0.18;
  return busy ? { ...base, bubble: base.bubble.replace('0.24', '0.34') } : base;
}
