export interface PetBackdropReading {
  available: boolean;
  luminance: number | null;
  contrast: number | null;
  reason: 'available' | 'permission-denied' | 'unsupported' | 'unavailable';
}

export interface PetBackdropTextStyle {
  foreground: string;
  shadow: string;
  bubble: string;
  border: string;
  boxShadow: string;
}

const LIGHT_SURFACE: PetBackdropTextStyle = {
  foreground: '#101318',
  shadow: 'none',
  bubble: 'rgba(248,250,252,0.84)',
  border: '1px solid rgba(15,23,42,0.16)',
  boxShadow: '0 2px 8px rgba(15,23,42,0.2)',
};

const DARK_SURFACE: PetBackdropTextStyle = {
  foreground: '#f8fafc',
  shadow: 'none',
  bubble: 'rgba(8,12,18,0.78)',
  border: '1px solid rgba(255,255,255,0.12)',
  boxShadow: '0 2px 8px rgba(0,0,0,0.42)',
};

export function resolvePetBackdropTextStyle(reading: PetBackdropReading | null): PetBackdropTextStyle {
  // Desktop sampling is an optional enhancement. It may be unavailable on
  // macOS without Screen Recording permission, so readability must never
  // depend on it.
  if (!reading?.available || reading.luminance == null) return DARK_SURFACE;

  const lightSurface = reading.luminance > 0.45;
  const base = lightSurface ? LIGHT_SURFACE : DARK_SURFACE;
  const busy = (reading.contrast ?? 0) > 0.18;
  if (!busy) return base;
  return {
    ...base,
    bubble: lightSurface
      ? 'rgba(248,250,252,0.92)'
      : 'rgba(8,12,18,0.9)',
  };
}
