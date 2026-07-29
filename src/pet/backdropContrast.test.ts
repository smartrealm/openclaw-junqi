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
  assert.equal(style.bubble, 'rgba(248,250,252,0.92)');
});

test('pet backdrop contrast fails safe when native sampling is unavailable', () => {
  const style = resolvePetBackdropTextStyle({
    available: false,
    luminance: null,
    contrast: null,
    reason: 'permission-denied',
  });

  assert.equal(style.foreground, '#f8fafc');
  assert.equal(style.bubble, 'rgba(8,12,18,0.78)');
  assert.equal(style.border, '1px solid rgba(255,255,255,0.12)');
});

test('pet backdrop contrast always returns a readable surface', () => {
  const states: Array<PetBackdropReading | null> = [
    null,
    { available: false, luminance: null, contrast: null, reason: 'unsupported' },
    reading(0.05),
    reading(0.95),
  ];

  for (const state of states) {
    const style = resolvePetBackdropTextStyle(state);
    assert.ok(style.foreground);
    assert.ok(style.bubble);
    assert.ok(style.border);
  }
});
