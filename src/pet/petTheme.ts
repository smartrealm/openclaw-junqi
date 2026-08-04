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

export function resolvePetTextPalette(_themeName: PetThemeName): PetTextPalette {
  return {
    primary: 'rgb(var(--aegis-text))',
    secondary: 'rgb(var(--aegis-text-secondary))',
    danger: 'rgb(var(--aegis-danger))',
  };
}

export function resolvePetAccentPalette(_themeName: PetThemeName): PetAccentPalette {
  return {
    primary: 'rgb(var(--aegis-primary))',
    secondary: 'rgb(var(--aegis-accent))',
    warm: 'rgb(var(--aegis-warning))',
    success: 'rgb(var(--aegis-success))',
    warning: 'rgb(var(--aegis-status-attention))',
  };
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

export function petTextShadowForTheme(_themeName: PetThemeName): string {
  return 'none';
}

export function solidPetTextStyle(color: string, _textShadow = 'none'): CSSProperties {
  return {
    ...PET_TEXT_RENDERING_RESET,
    color,
    WebkitTextFillColor: color,
    caretColor: color,
    textShadow: 'none',
  };
}

export function petCaptionTextContainerStyle(color: string, _themeName?: PetThemeName): CSSProperties {
  return {
    ...solidPetTextStyle(color),
    border: 0,
    isolation: 'isolate',
    opacity: 1,
    pointerEvents: 'none',
  };
}
