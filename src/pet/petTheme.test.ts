import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePetThemeName, petBubbleTextContainerStyle, petTextShadowForTheme, resolvePetCharacterPalette, resolvePetDarkMode, resolvePetTextPalette, solidPetTextStyle } from './petTheme';
import { DEFAULT_PET_SKIN } from '../stores/petStore';

test('default pet skin is sky-blue jellyfish', () => {
  assert.equal(DEFAULT_PET_SKIN, 'jellyfish');
});

test('pet dark mode follows explicit dark theme names', () => {
  assert.equal(resolvePetDarkMode('aegis-dark', false), true);
  assert.equal(resolvePetDarkMode('aegis-midnight', false), true);
});

test('pet dark mode follows explicit light theme names', () => {
  assert.equal(resolvePetDarkMode('aegis-light', true), false);
  assert.equal(resolvePetDarkMode('aegis-eyecare', true), false);
});

test('pet dark mode falls back to system preference for unknown/system theme', () => {
  assert.equal(resolvePetDarkMode('system', true), true);
  assert.equal(resolvePetDarkMode(null, false), false);
});

test('pet text palette uses solid readable colors for dark theme', () => {
  assert.deepEqual(resolvePetTextPalette('aegis-dark'), {
    primary: '#f8fafc',
    secondary: '#dbe4f0',
    danger: '#fecaca',
  });
});

test('pet text palette uses high-contrast ink for light theme', () => {
  assert.deepEqual(resolvePetTextPalette('aegis-light'), {
    primary: '#020617',
    secondary: '#0f172a',
    danger: '#7f1d1d',
  });
});

test('pet text palette uses darker warm ink for eyecare theme', () => {
  assert.deepEqual(resolvePetTextPalette('aegis-eyecare'), {
    primary: '#201307',
    secondary: '#36220d',
    danger: '#7f1d1d',
  });
});

test('pet theme name normalization preserves concrete themes and resolves fallback', () => {
  assert.equal(normalizePetThemeName('aegis-eyecare', false), 'aegis-eyecare');
  assert.equal(normalizePetThemeName('system', true), 'aegis-dark');
  assert.equal(normalizePetThemeName(null, false), 'aegis-light');
});

test('pet text style disables webkit outline-only rendering', () => {
  assert.deepEqual(solidPetTextStyle('#fff'), {
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
    color: '#fff',
    WebkitTextFillColor: '#fff',
    caretColor: '#fff',
  });
});

test('pet text style can apply dark-theme readability halo', () => {
  const shadow = petTextShadowForTheme('aegis-dark');
  assert.notEqual(shadow, 'none');
  assert.equal(solidPetTextStyle('#fff', shadow).textShadow, shadow);
});

test('pet bubble text container has no visual chrome', () => {
  assert.deepEqual(petBubbleTextContainerStyle('#f8fafc'), {
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
    color: '#f8fafc',
    WebkitTextFillColor: '#f8fafc',
    caretColor: '#f8fafc',
    border: 0,
    isolation: 'isolate',
    opacity: 1,
    pointerEvents: 'none',
  });
});

test('pet bubble text container adds readable halo in dark themes', () => {
  const style = petBubbleTextContainerStyle('#f8fafc', 'aegis-midnight');
  assert.equal(style.background, 'transparent');
  assert.equal(style.boxShadow, 'none');
  assert.notEqual(style.textShadow, 'none');
});

test('pet character palette changes body color by theme and skin', () => {
  assert.equal(resolvePetCharacterPalette('aegis-dark', 'lobster').body, '#ff836f');
  assert.equal(resolvePetCharacterPalette('aegis-midnight', 'lobster').body, '#f26f62');
  assert.equal(resolvePetCharacterPalette('aegis-eyecare', 'lobster').body, '#c96842');
});

test('pet default jellyfish stays sky-blue across regular and dark themes', () => {
  assert.equal(resolvePetCharacterPalette('aegis-light', 'jellyfish').body, '#23a6c8');
  assert.equal(resolvePetCharacterPalette('aegis-dark', 'jellyfish').body, '#73e6ff');
  assert.equal(resolvePetCharacterPalette('aegis-midnight', 'jellyfish').body, '#73e6ff');
});

test('pet character palette avoids pure white eye blocks in dark themes', () => {
  assert.notEqual(resolvePetCharacterPalette('aegis-dark', 'cat').eye.toLowerCase(), '#fff');
  assert.notEqual(resolvePetCharacterPalette('aegis-dark', 'cat').eye.toLowerCase(), '#ffffff');
  assert.notEqual(resolvePetCharacterPalette('aegis-midnight', 'cat').eye.toLowerCase(), '#fff');
  assert.notEqual(resolvePetCharacterPalette('aegis-midnight', 'cat').eye.toLowerCase(), '#ffffff');
});
