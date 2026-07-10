import test from 'node:test';
import assert from 'node:assert/strict';
import { coveringRadius, resolveTransitionOrigin } from './circularViewTransition';
import { themeTransitionDirection } from './themeTransition';

test('transition origin uses the center of its trigger element', () => {
  const trigger = {
    getBoundingClientRect: () => ({ left: 20, top: 40, width: 60, height: 20 }),
  } as unknown as Element;
  assert.deepEqual(resolveTransitionOrigin(trigger, 1200, 800), { x: 50, y: 50 });
});

test('transition origin falls back to viewport center', () => {
  assert.deepEqual(resolveTransitionOrigin(null, 1200, 800), { x: 600, y: 400 });
});

test('covering radius reaches the farthest viewport corner', () => {
  assert.equal(coveringRadius(0, 0, 300, 400), 500);
  assert.equal(coveringRadius(150, 200, 300, 400), 250);
});

test('switching from dark to a light theme conceals the old scene', () => {
  assert.equal(themeTransitionDirection('aegis-dark', 'aegis-light'), 'conceal');
  assert.equal(themeTransitionDirection('aegis-midnight', 'aegis-eyecare'), 'conceal');
  assert.equal(themeTransitionDirection('aegis-light', 'aegis-dark'), 'reveal');
  assert.equal(themeTransitionDirection('aegis-dark', 'aegis-midnight'), 'reveal');
});
