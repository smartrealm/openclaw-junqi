import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePetDarkMode, resolvePetTextPalette, solidPetTextStyle } from './petTheme';

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
  assert.deepEqual(resolvePetTextPalette(true), {
    primary: '#f8fafc',
    secondary: '#dbe4f0',
    danger: '#fecaca',
  });
});

test('pet text style disables webkit outline-only rendering', () => {
  assert.deepEqual(solidPetTextStyle('#fff'), {
    color: '#fff',
    WebkitTextFillColor: '#fff',
    WebkitTextStrokeWidth: 0,
    WebkitTextStrokeColor: 'transparent',
    paintOrder: 'fill',
    textShadow: 'none',
  });
});
