import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePetThemeName, petBubbleTextContainerStyle, resolvePetDarkMode, resolvePetTextPalette, solidPetTextStyle } from './petTheme';

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
