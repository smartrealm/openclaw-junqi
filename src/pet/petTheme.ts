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

export function resolvePetTextPalette(isDark: boolean): PetTextPalette {
  return isDark
    ? {
        primary: '#f8fafc',
        secondary: '#dbe4f0',
        danger: '#fecaca',
      }
    : {
        primary: '#111827',
        secondary: '#1f2937',
        danger: '#991b1b',
      };
}

export function solidPetTextStyle(color: string): CSSProperties {
  return {
    color,
    WebkitTextFillColor: color,
    WebkitTextStrokeWidth: 0,
    WebkitTextStrokeColor: 'transparent',
    paintOrder: 'fill',
    textShadow: 'none',
  };
}
