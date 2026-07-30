import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePetBackdropTextStyle, type PetBackdropReading } from './backdropContrast';

const reading = (luminance: number, contrast = 0.05): PetBackdropReading => ({
  available: true, luminance, contrast, reason: 'available',
});

test('pet backdrop contrast chooses dark text on a bright wallpaper', () => {
  const style = resolvePetBackdropTextStyle(reading(0.8), 'dark');
  assert.equal(style.foreground, '#101318');
  assert.match(style.shadow, /rgba\(255,255,255/);
});

test('pet backdrop contrast chooses light text on a dark wallpaper', () => {
  const style = resolvePetBackdropTextStyle(reading(0.12), 'light');
  assert.equal(style.foreground, '#f8fafc');
  assert.match(style.shadow, /rgba\(0,0,0/);
});

test('pet backdrop contrast never adds a card when wallpaper contrast is high', () => {
  const calm = resolvePetBackdropTextStyle(reading(0.8), 'dark');
  const busy = resolvePetBackdropTextStyle(reading(0.8, 0.24), 'dark');
  assert.deepEqual(busy, calm);
  assert.equal('bubble' in busy, false);
  assert.equal('border' in busy, false);
  assert.equal('boxShadow' in busy, false);
});

test('pet backdrop contrast follows the resolved light theme when native sampling is unavailable', () => {
  const style = resolvePetBackdropTextStyle({
    available: false,
    luminance: null,
    contrast: null,
    reason: 'permission-denied',
  }, 'light');

  assert.equal(style.foreground, '#101318');
  assert.match(style.shadow, /rgba\(255,255,255/);
});

test('pet backdrop contrast follows the resolved dark theme when native sampling is unavailable', () => {
  const style = resolvePetBackdropTextStyle(null, 'dark');

  assert.equal(style.foreground, '#f8fafc');
  assert.match(style.shadow, /rgba\(0,0,0/);
});

test('pet backdrop contrast always returns a readable surface', () => {
  const states: Array<PetBackdropReading | null> = [
    null,
    { available: false, luminance: null, contrast: null, reason: 'unsupported' },
    reading(0.05),
    reading(0.95),
  ];

  for (const state of states) {
    const style = resolvePetBackdropTextStyle(state, 'light');
    assert.ok(style.foreground);
    assert.ok(style.shadow);
  }
});
