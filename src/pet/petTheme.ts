import type { CSSProperties } from 'react';

export type PetThemeName = 'aegis-light' | 'aegis-dark' | 'aegis-midnight' | 'aegis-eyecare';

export interface PetTextPalette {
  primary: string;
  secondary: string;
  danger: string;
}

const DARK_THEMES = new Set<string>(['aegis-dark', 'aegis-midnight']);
const LIGHT_THEMES = new Set<string>(['aegis-light', 'aegis-eyecare']);

export function resolvePetDarkMode(themeName: string | null, systemDark: boolean): boolean {
  if (themeName && DARK_THEMES.has(themeName)) return true;
  if (themeName && LIGHT_THEMES.has(themeName)) return false;
  return systemDark;
}

export function normalizePetThemeName(themeName: string | null, systemDark: boolean): PetThemeName {
  if (themeName === 'aegis-light' || themeName === 'aegis-dark' || themeName === 'aegis-midnight' || themeName === 'aegis-eyecare') {
    return themeName;
  }
  return systemDark ? 'aegis-dark' : 'aegis-light';
}

export function resolvePetTextPalette(themeName: PetThemeName): PetTextPalette {
  switch (themeName) {
    case 'aegis-dark':
    case 'aegis-midnight':
      return {
        primary: '#f8fafc',
        secondary: '#dbe4f0',
        danger: '#fecaca',
      };
    case 'aegis-eyecare':
      return {
        primary: '#201307',
        secondary: '#36220d',
        danger: '#7f1d1d',
      };
    case 'aegis-light':
    default:
      return {
        primary: '#020617',
        secondary: '#0f172a',
        danger: '#7f1d1d',
      };
  }
}

const PET_TEXT_RENDERING_RESET: CSSProperties = {
  WebkitTextStroke: '0 transparent',
  WebkitTextStrokeWidth: 0,
  WebkitTextStrokeColor: 'transparent',
  WebkitBackgroundClip: 'border-box',
  background: 'transparent',
  backgroundColor: 'transparent',
  backgroundImage: 'none',
  boxShadow: 'none',
  filter: 'none',
  mixBlendMode: 'normal',
  outline: 'none',
  paintOrder: 'fill',
  textDecoration: 'none',
  textShadow: 'none',
  WebkitFontSmoothing: 'antialiased',
  MozOsxFontSmoothing: 'grayscale',
};

export function solidPetTextStyle(color: string): CSSProperties {
  return {
    ...PET_TEXT_RENDERING_RESET,
    color,
    WebkitTextFillColor: color,
    caretColor: color,
  };
}

export function petBubbleTextContainerStyle(color: string): CSSProperties {
  return {
    ...solidPetTextStyle(color),
    border: 0,
    isolation: 'isolate',
    opacity: 1,
    pointerEvents: 'none',
  };
}
