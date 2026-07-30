export interface PetBackdropReading {
  available: boolean;
  luminance: number | null;
  contrast: number | null;
  reason: 'available' | 'permission-denied' | 'unsupported' | 'unavailable';
}

export interface PetBackdropTextStyle {
  foreground: string;
  shadow: string;
}

export type PetBackdropSurface = 'light' | 'dark';

const LIGHT_SURFACE: PetBackdropTextStyle = {
  foreground: '#101318',
  shadow: '0 1px 2px rgba(255,255,255,0.96), 0 0 5px rgba(255,255,255,0.72)',
};

const DARK_SURFACE: PetBackdropTextStyle = {
  foreground: '#f8fafc',
  shadow: '0 1px 2px rgba(0,0,0,0.96), 0 0 5px rgba(0,0,0,0.74)',
};

export function resolvePetBackdropTextStyle(
  reading: PetBackdropReading | null,
  fallbackSurface: PetBackdropSurface,
): PetBackdropTextStyle {
  // Desktop sampling is an optional enhancement. It may be unavailable on
  // macOS without Screen Recording permission, so readability must never
  // depend on it.
  if (!reading?.available || reading.luminance == null) {
    return fallbackSurface === 'dark' ? DARK_SURFACE : LIGHT_SURFACE;
  }

  const lightSurface = reading.luminance > 0.45;
  return lightSurface ? LIGHT_SURFACE : DARK_SURFACE;
}
