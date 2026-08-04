export interface PetBackdropReading {
  available: boolean;
  luminance: number | null;
  contrast: number | null;
  reason: 'available' | 'permission-denied' | 'unsupported' | 'unavailable';
}

export interface PetBackdropTextStyle {
  foreground: string;
  shadow: string;
  surface: PetBackdropSurface;
}

export type PetBackdropSurface = 'light' | 'dark';

const DARK_TEXT_LUMINANCE = 0.00641851682408105;
const LIGHT_TEXT_LUMINANCE = 0.9535594780808019;
const LIGHT_SURFACE: PetBackdropTextStyle = {
  foreground: 'rgb(var(--aegis-pet-text-on-light))',
  shadow: 'none',
  surface: 'light',
};

const DARK_SURFACE: PetBackdropTextStyle = {
  foreground: 'rgb(var(--aegis-pet-text-on-dark))',
  shadow: 'none',
  surface: 'dark',
};

function contrastRatio(left: number, right: number): number {
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}

function chooseSurface(luminance: number): PetBackdropSurface {
  // Every fresh movement sample is authoritative. Retaining the previous
  // foreground can leave white text on a mid-light wallpaper (or the inverse),
  // so always choose the foreground with the stronger WCAG contrast.
  const darkTextContrast = contrastRatio(luminance, DARK_TEXT_LUMINANCE);
  const lightTextContrast = contrastRatio(luminance, LIGHT_TEXT_LUMINANCE);
  return darkTextContrast >= lightTextContrast ? 'light' : 'dark';
}

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

  const surface = chooseSurface(Math.max(0, Math.min(1, reading.luminance)));
  return surface === 'light' ? LIGHT_SURFACE : DARK_SURFACE;
}
