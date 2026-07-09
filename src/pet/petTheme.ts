import type { CSSProperties } from 'react';
import type { PetSkin } from './skins';

export type PetThemeName = 'aegis-light' | 'aegis-dark' | 'aegis-midnight' | 'aegis-eyecare';

export interface PetTextPalette {
  primary: string;
  secondary: string;
  danger: string;
}

export interface PetCharacterPalette {
  body: string;
  ink: string;
  eye: string;
  eyeHighlight: string;
  highlight: string;
  sparkle: string;
  groundShadowOpacity: number;
}

export interface PetAccentPalette {
  primary: string;
  secondary: string;
  warm: string;
  success: string;
  warning: string;
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

export function resolvePetAccentPalette(themeName: PetThemeName): PetAccentPalette {
  switch (themeName) {
    case 'aegis-light':
      return {
        primary: '#ef6f5e',
        secondary: '#c96842',
        warm: '#d97706',
        success: '#16825d',
        warning: '#b45309',
      };
    case 'aegis-eyecare':
      return {
        primary: '#c96842',
        secondary: '#9d6a42',
        warm: '#9a5a1f',
        success: '#3d7c59',
        warning: '#8a5a12',
      };
    case 'aegis-midnight':
      return {
        primary: '#f26f62',
        secondary: '#ff9a72',
        warm: '#f6c177',
        success: '#9bd88f',
        warning: '#e8b066',
      };
    case 'aegis-dark':
    default:
      return {
        primary: '#ff836f',
        secondary: '#ffad83',
        warm: '#f6c177',
        success: '#8bd98b',
        warning: '#f0b45d',
      };
  }
}

const BODY_BY_THEME: Record<PetThemeName, Record<PetSkin, string>> = {
  'aegis-light': {
    robot: '#5d7cff',
    lobster: '#ef6f5e',
    cat: '#8b6ff6',
    jellyfish: '#23a6c8',
    ghost: '#8da2c7',
    'blue-mascot': '#38bdf8',
  },
  'aegis-dark': {
    robot: '#8fa2ff',
    lobster: '#ff836f',
    cat: '#b49cff',
    jellyfish: '#73e6ff',
    ghost: '#c9d5e8',
    'blue-mascot': '#7dd3fc',
  },
  'aegis-midnight': {
    robot: '#7f92ee',
    lobster: '#f26f62',
    cat: '#9d86ee',
    jellyfish: '#73e6ff',
    ghost: '#aebbd0',
    'blue-mascot': '#67e8f9',
  },
  'aegis-eyecare': {
    robot: '#7d6bca',
    lobster: '#c96842',
    cat: '#9d6a42',
    jellyfish: '#4f9d91',
    ghost: '#c7b891',
    'blue-mascot': '#4f9dba',
  },
};

export function resolvePetCharacterPalette(themeName: PetThemeName, skin: PetSkin): PetCharacterPalette {
  const body = BODY_BY_THEME[themeName]?.[skin] ?? BODY_BY_THEME['aegis-dark'].cat;
  switch (themeName) {
    case 'aegis-light':
      return {
        body,
        ink: '#172033',
        eye: '#f7fbff',
        eyeHighlight: '#ffffff',
        highlight: '#ffffff',
        sparkle: '#0f172a',
        groundShadowOpacity: 0.14,
      };
    case 'aegis-eyecare':
      return {
        body,
        ink: '#2f1f10',
        eye: '#fff8e7',
        eyeHighlight: '#ffffff',
        highlight: '#fff1c2',
        sparkle: '#3a2815',
        groundShadowOpacity: 0.13,
      };
    case 'aegis-midnight':
      return {
        body,
        ink: '#111827',
        eye: '#dbe7f7',
        eyeHighlight: '#f8fbff',
        highlight: '#e6eefb',
        sparkle: '#d9e2f2',
        groundShadowOpacity: 0.22,
      };
    case 'aegis-dark':
    default:
      return {
        body,
        ink: '#162033',
        eye: '#e6eefb',
        eyeHighlight: '#ffffff',
        highlight: '#eef5ff',
        sparkle: '#eef5ff',
        groundShadowOpacity: 0.20,
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

export function petTextShadowForTheme(themeName: PetThemeName): string {
  switch (themeName) {
    case 'aegis-dark':
    case 'aegis-midnight':
      return '0 1px 2px rgba(0,0,0,0.92), 0 0 8px rgba(0,0,0,0.72), 0 0 14px rgba(0,0,0,0.42)';
    default:
      return 'none';
  }
}

export function solidPetTextStyle(color: string, textShadow = 'none'): CSSProperties {
  return {
    ...PET_TEXT_RENDERING_RESET,
    color,
    WebkitTextFillColor: color,
    caretColor: color,
    textShadow,
  };
}

export function petBubbleTextContainerStyle(color: string, themeName?: PetThemeName): CSSProperties {
  return {
    ...solidPetTextStyle(color, themeName ? petTextShadowForTheme(themeName) : 'none'),
    border: 0,
    isolation: 'isolate',
    opacity: 1,
    pointerEvents: 'none',
  };
}
