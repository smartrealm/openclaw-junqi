import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePetBackdropTextStyle, type PetBackdropReading } from './backdropContrast';

const reading = (luminance: number, contrast = 0.05): PetBackdropReading => ({
  available: true, luminance, contrast, reason: 'available',
});

test('pet backdrop contrast chooses dark text on a bright wallpaper', () => {
  assert.equal(resolvePetBackdropTextStyle(reading(0.8))?.foreground, '#101318');
});

test('pet backdrop contrast chooses light text on a dark wallpaper', () => {
  assert.equal(resolvePetBackdropTextStyle(reading(0.12))?.foreground, '#f8fafc');
});

test('pet backdrop contrast strengthens the backing on busy wallpaper without an outline', () => {
  const style = resolvePetBackdropTextStyle(reading(0.8, 0.24));
  assert.equal(style?.bubble, 'rgba(255,255,255,0.66)');
});

test('pet backdrop contrast never guesses when native sampling is unavailable', () => {
  assert.equal(resolvePetBackdropTextStyle({ available: false, luminance: null, contrast: null, reason: 'permission-denied' }), null);
});
